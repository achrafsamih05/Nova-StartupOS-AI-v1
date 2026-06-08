// =====================================================================
// Nova StartupOS AI — Secure AI Streaming Proxy (Vercel / Node.js)
// ---------------------------------------------------------------------
// Route:  POST /api/ai-stream  (rewritten in vercel.json)
//
// Hardening (v2):
//   • JWT verified via shared verifyAuth() helper.
//   • Per-user daily rate limit (AI_DAILY_LIMIT, default 200).
//   • Provider chosen from ai_providers_config by priority + is_default,
//     with fallback to the next enabled provider on upstream failure.
//   • IP allowlist consulted via blocked_ips.
//   • Each invocation persists a row in ai_requests (status / cost / sizes).
//   • CORS allowlisted via ALLOWED_ORIGINS.
//   • Hidden master system prompt never leaves the server.
// =====================================================================

const {
  applyCors, handlePreflight, jsonError, readJsonBody, verifyAuth,
  checkRateLimit, incrementUsage, recordAiRequest, recordAudit,
  clientIp, getServiceClient,
} = require('./_lib/auth');
const { sanitizeMessages } = require('./_lib/messages');

// Per-provider upstream endpoints + the env var holding each secret key.
// Anthropic and Gemini have their own native APIs but require slightly
// different request bodies — we route them through OpenRouter when the
// dedicated key is missing, so existing OpenRouter setups keep working.
const PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',                   keyEnv: 'OPENROUTER_API_KEY', native: true },
  openai:     { url: 'https://api.openai.com/v1/chat/completions',                      keyEnv: 'OPENAI_API_KEY',     native: true },
  deepseek:   { url: 'https://api.deepseek.com/v1/chat/completions',                    keyEnv: 'DEEPSEEK_API_KEY',   native: true },
  anthropic:  { url: 'https://api.anthropic.com/v1/messages',                           keyEnv: 'ANTHROPIC_API_KEY',  native: 'anthropic' },
  gemini:     { url: 'https://generativelanguage.googleapis.com/v1beta/models',         keyEnv: 'GEMINI_API_KEY',     native: 'gemini' },
};

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '200', 10);
const AI_MAX_TOKENS  = parseInt(process.env.AI_MAX_TOKENS  || '2048', 10);

const MASTER_SYSTEM_PROMPT =
  'You are Nova, an AI co-founder inside Nova StartupOS AI. You help founders ' +
  'turn ideas into investment-ready startups: business plans, pitch decks, ' +
  'readiness assessments, fundraising strategy, and startup-visa guidance. ' +
  'Be concise, structured, practical, and encouraging. Use clear section ' +
  'headings when producing documents.';

function sseWrite(res, obj) {
  res.write('data: ' + JSON.stringify(obj) + '\n\n');
}

// Resolve enabled providers ordered by priority, with the fallback to OpenRouter
// when a provider's dedicated key is absent.
async function resolveProviderChain(admin, requestedModel) {
  const { data: configs, error } = await admin
    .from('ai_providers_config')
    .select('provider_name, enabled, priority, is_default, default_model')
    .eq('enabled', true)
    .order('is_default', { ascending: false })
    .order('priority',   { ascending: true });

  if (error) throw new Error('Could not read AI provider config.');
  if (!configs || !configs.length) throw new Error('No AI provider is currently enabled.');

  return configs.map((c) => {
    const meta = PROVIDERS[c.provider_name];
    if (!meta) return null;
    let url = meta.url;
    let keyEnv = meta.keyEnv;
    let nativeShape = meta.native;
    // Fallback to OpenRouter if the native key is absent.
    if (!process.env[keyEnv] && process.env.OPENROUTER_API_KEY) {
      url = PROVIDERS.openrouter.url;
      keyEnv = PROVIDERS.openrouter.keyEnv;
      nativeShape = true;
    }
    return {
      name: c.provider_name,
      url,
      keyEnv,
      nativeShape,
      model: requestedModel || c.default_model || 'google/gemini-flash-1.5',
    };
  }).filter(Boolean).filter((p) => process.env[p.keyEnv]);
}

// Open the SSE stream and pipe an OpenAI-compatible response through.
async function streamOpenAiCompatible(res, prov, messages) {
  const upstream = await fetch(prov.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env[prov.keyEnv],
      'HTTP-Referer': 'https://novastartupos.ai',
      'X-Title': 'Nova StartupOS AI',
    },
    body: JSON.stringify({
      model: prov.model,
      messages,
      stream: true,
      max_tokens: AI_MAX_TOKENS,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => upstream.statusText);
    throw new Error('Upstream ' + upstream.status + ': ' + errText.slice(0, 300));
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalChars = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.indexOf('data:') !== 0) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
        if (delta) {
          totalChars += delta.length;
          sseWrite(res, { choices: [{ delta: { content: delta } }] });
        }
      } catch (_) { /* partial chunk */ }
    }
  }
  return totalChars;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  // ---- 1. Auth ------------------------------------------------------
  let auth;
  try { auth = await verifyAuth(req); }
  catch (e) { return jsonError(res, 500, e.message); }
  if (!auth) return jsonError(res, 401, 'Invalid or expired session.');

  const { profile } = auth;
  const ip = clientIp(req);

  // ---- 2. IP block check -------------------------------------------
  if (ip) {
    try {
      const admin = getServiceClient();
      const { data: blocked } = await admin
        .from('blocked_ips').select('id').eq('ip_address', ip).maybeSingle();
      if (blocked) {
        await recordAiRequest({ user_id: profile.id, status: 'blocked', error_message: 'ip_blocked', ip_address: ip });
        return jsonError(res, 403, 'Access denied.');
      }
    } catch (_) { /* don't fail the request on side-channel errors */ }
  }

  // ---- 3. Rate limit ------------------------------------------------
  const rl = await checkRateLimit(profile.id, 'ai_requests', AI_DAILY_LIMIT);
  if (!rl.ok) {
    await recordAiRequest({
      user_id: profile.id, status: 'rate_limited',
      error_message: `daily limit ${rl.limit} reached`, ip_address: ip,
    });
    return jsonError(res, 429, 'Daily AI quota exhausted.', { limit: rl.limit, current: rl.current });
  }

  // ---- 4. Body validation ------------------------------------------
  const body = await readJsonBody(req);
  const prompt = (body.prompt || '').toString();
  const clientSystem = (body.systemPrompt || '').toString();
  const requestedModel = (body.model || '').toString();
  if (!prompt.trim()) return jsonError(res, 400, 'Prompt is required.');
  if (prompt.length > 16000) return jsonError(res, 413, 'Prompt is too long.');

  // ---- 5. Provider chain --------------------------------------------
  const admin = getServiceClient();
  let chain;
  try { chain = await resolveProviderChain(admin, requestedModel); }
  catch (e) { return jsonError(res, 503, e.message); }
  if (!chain.length) return jsonError(res, 503, 'No AI provider key is configured on the server.');

  // ---- 6. Stream + fallback ----------------------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Build the raw turn list, then sanitize so every provider receives a
  // well-formed conversation: exactly one leading system, then strict
  // user/assistant/user… alternation ending on a user turn. This is what
  // fixes the OpenRouter/Anthropic 400:
  //   "Conversation roles must alternate user/assistant/user/assistant…"
  const rawTurns = [
    { role: 'system', content: MASTER_SYSTEM_PROMPT },
    ...(clientSystem ? [{ role: 'system', content: clientSystem }] : []),
    { role: 'user',   content: prompt },
  ];
  const clean = sanitizeMessages(rawTurns);
  const messages = (clean.system ? [{ role: 'system', content: clean.system }] : [])
    .concat(clean.messages);

  let providerUsed = null;
  let completionChars = 0;
  let lastErr = null;

  for (const prov of chain) {
    try {
      providerUsed = prov.name;
      completionChars = await streamOpenAiCompatible(res, prov, messages);
      lastErr = null;
      break; // success
    } catch (e) {
      lastErr = e;
      // If we already wrote SSE bytes, abort fallback (client sees partial).
      if (res.headersSent && res.writableLength > 0) break;
    }
  }

  if (lastErr) {
    sseWrite(res, { error: 'AI service unavailable: ' + lastErr.message });
  }
  res.write('data: [DONE]\n\n');
  res.end();

  // ---- 7. Telemetry (fire-and-forget) -------------------------------
  await Promise.all([
    incrementUsage(profile.id, 'ai_requests', 1),
    recordAiRequest({
      user_id: profile.id,
      provider_name: providerUsed,
      model: chain[0] ? chain[0].model : null,
      prompt_chars: prompt.length,
      completion_chars: completionChars,
      status: lastErr ? 'error' : 'ok',
      error_message: lastErr ? lastErr.message.slice(0, 500) : null,
      ip_address: ip,
    }),
    recordAudit(profile, 'ai.request', 'ai_requests', null,
                { provider: providerUsed, prompt_chars: prompt.length }, ip),
  ]).catch(() => {});
};
