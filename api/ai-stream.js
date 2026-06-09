// =====================================================================
// Nova StartupOS AI — Secure AI Streaming Proxy v3 (Vercel / Node.js)
// ---------------------------------------------------------------------
// Route:  POST /api/ai-stream  (rewritten in vercel.json)
//
// What changed (v3):
//   • Provider chain shared with /api/generate-deck via _lib/aiProviders.
//   • Deprecated model names (anthropic/claude-3.5-sonnet etc.) are
//     silently rewritten to the current equivalents at request time,
//     so an unmigrated database row can never produce the dreaded
//     "No endpoints found" error again.
//   • If the database-resolved provider stream errors out, we now
//     also fall back to the OpenRouter model chain transparently.
//   • Friendly user-facing errors via friendlyError() — provider
//     internals never reach the browser.
// =====================================================================

const {
  handlePreflight, jsonError, readJsonBody, verifyAuth,
  checkRateLimit, incrementUsage, recordAiRequest, recordAudit,
  clientIp, getServiceClient,
} = require('./_lib/auth');
const { sanitizeMessages } = require('./_lib/messages');
const { classifyPrompt }   = require('./_lib/safetyGate');
const { buildContextBlock } = require('./_lib/projectContext');
const {
  resolveDbProviderChain,
  OPENROUTER_MODEL_CHAIN,
  callOpenRouterWithFallback,
  normalizeModel,
  isSafetyModel,
  friendlyError,
  diag,
} = require('./_lib/aiProviders');

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

// Stream a chunk-by-chunk SSE proxy from any OpenAI-compatible upstream
// (OpenRouter, OpenAI, DeepSeek). Returns the total chars streamed.
async function streamOpenAiCompatible(res, prov, messages) {
  const t0 = Date.now();
  const upstream = await fetch(prov.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env[prov.keyEnv],
      'HTTP-Referer': 'https://novastartupos.ai',
      'X-Title':      'Nova StartupOS AI',
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
    const e = new Error('upstream_' + upstream.status + ':' + (errText || '').slice(0, 240));
    e.status = upstream.status;
    diag.record({
      event: 'ai.stream_failed',
      provider: prov.name, model: prov.model,
      status: upstream.status, durationMs: Date.now() - t0, ok: false,
      error: (errText || '').slice(0, 240),
    });
    throw e;
  }

  diag.record({
    event: 'ai.stream_open',
    provider: prov.name, model: prov.model,
    status: 200, durationMs: Date.now() - t0, ok: true,
  });

  return await pipeOpenAiSse(upstream.body, res);
}

async function pipeOpenAiSse(stream, res) {
  const reader = stream.getReader();
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
        if (delta) { totalChars += delta.length; sseWrite(res, { choices: [{ delta: { content: delta } }] }); }
      } catch (_) { /* partial chunk */ }
    }
  }
  return totalChars;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  // 1. Auth
  let auth;
  try { auth = await verifyAuth(req); }
  catch (e) { return jsonError(res, 500, e.message); }
  if (!auth) return jsonError(res, 401, 'Invalid or expired session.');
  const { profile } = auth;
  const ip = clientIp(req);

  // 2. IP block check
  if (ip) {
    try {
      const admin = getServiceClient();
      const { data: blocked } = await admin
        .from('blocked_ips').select('id').eq('ip_address', ip).maybeSingle();
      if (blocked) {
        await recordAiRequest({ user_id: profile.id, status: 'blocked',
                                error_message: 'ip_blocked', ip_address: ip });
        return jsonError(res, 403, 'Access denied.');
      }
    } catch (_) { /* silent */ }
  }

  // 3. Rate limit
  const rl = await checkRateLimit(profile.id, 'ai_requests', AI_DAILY_LIMIT);
  if (!rl.ok) {
    await recordAiRequest({
      user_id: profile.id, status: 'rate_limited',
      error_message: 'daily limit ' + rl.limit + ' reached', ip_address: ip,
    });
    return jsonError(res, 429, 'Daily AI quota exhausted.', { limit: rl.limit, current: rl.current });
  }

  // 4. Body validation
  const body = await readJsonBody(req);
  const prompt = (body.prompt || '').toString();
  const clientSystem = (body.systemPrompt || '').toString();
  const requestedModel = normalizeModel((body.model || '').toString());
  if (!prompt.trim()) return jsonError(res, 400, 'Prompt is required.');
  if (prompt.length > 16000) return jsonError(res, 413, 'Prompt is too long.');

  // 4b. Safety gate
  const safety = await classifyPrompt(prompt, { apiKey: process.env.OPENROUTER_API_KEY });
  if (!safety.safe) {
    await Promise.all([
      recordAiRequest({
        user_id: profile.id, status: 'blocked',
        error_message: 'safety_blocked' + (safety.category ? ':' + safety.category : ''),
        ip_address: ip,
      }),
      recordAudit(profile, 'ai.blocked_unsafe', 'ai_requests', null,
                  { category: safety.category, raw: safety.raw.slice(0, 200) }, ip),
    ]).catch(() => {});
    return jsonError(res, 422,
      'This message was flagged by the content safety classifier.',
      { category: safety.category });
  }

  // 5. Provider chain — DB-driven first, OpenRouter fallback.
  const admin = getServiceClient();
  let chain;
  try { chain = await resolveDbProviderChain(admin, requestedModel); }
  catch (e) { return jsonError(res, 503, friendlyError(e, e.message)); }

  // 6. Open the SSE response BEFORE writing any data, so the client gets
  // headers immediately. Even if we end up needing the OpenRouter
  // fallback chain we're still safe — we only flush data on first delta.
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Build a clean conversation list (alternation rules).
  const projectCtx = buildContextBlock();
  const rawTurns = [
    { role: 'system', content: MASTER_SYSTEM_PROMPT + projectCtx },
    ...(clientSystem ? [{ role: 'system', content: clientSystem }] : []),
    { role: 'user',   content: prompt },
  ];
  const clean = sanitizeMessages(rawTurns);
  const messages = (clean.system ? [{ role: 'system', content: clean.system }] : [])
    .concat(clean.messages);

  let providerUsed = null;
  let modelUsed = null;
  let completionChars = 0;
  let lastErr = null;
  const startedAt = Date.now();
  const trail = [];

  // 6a. Try the DB chain first (native providers when keyed; otherwise
  // each row is shimmed to OpenRouter inside resolveDbProviderChain).
  for (const prov of chain) {
    try {
      providerUsed = prov.name;
      modelUsed = prov.model;
      completionChars = await streamOpenAiCompatible(res, prov, messages);
      lastErr = null;
      trail.push({ provider: prov.name, model: prov.model, ok: true });
      break;
    } catch (e) {
      lastErr = e;
      trail.push({ provider: prov.name, model: prov.model, ok: false,
                   status: e.status, error: (e.message || '').slice(0, 200) });
      // Already streamed bytes? Stop falling back — partial UX is better
      // than corrupting the SSE channel.
      if (res.writableLength > 0) break;
    }
  }

  // 6b. If we never got a single delta and OpenRouter is configured, walk
  // the centralized model chain as a final defense. This covers the case
  // where every DB row's model is dead but OpenRouter itself still works.
  if (lastErr && completionChars === 0 && process.env.OPENROUTER_API_KEY && res.writableLength === 0) {
    try {
      const out = await callOpenRouterWithFallback({
        apiKey: process.env.OPENROUTER_API_KEY,
        chain: OPENROUTER_MODEL_CHAIN,
        attempts: 2,
        max_tokens: AI_MAX_TOKENS,
        messages,
        stream: true,
      });
      providerUsed = 'openrouter-fallback';
      modelUsed = out.model;
      completionChars = await pipeOpenAiSse(out.body, res);
      trail.push({ provider: 'openrouter-fallback', model: out.model, ok: true });
      lastErr = null;
    } catch (e) {
      lastErr = e;
      trail.push({ provider: 'openrouter-fallback', ok: false,
                   error: (e.message || '').slice(0, 200) });
    }
  }

  if (lastErr && completionChars === 0) {
    sseWrite(res, { error: friendlyError(lastErr, 'AI service is temporarily unavailable.') });
  }
  res.write('data: [DONE]\n\n');
  res.end();

  // 7. Telemetry
  const totalMs = Date.now() - startedAt;
  diag.record({
    event: lastErr && completionChars === 0 ? 'stream.failed' : 'stream.success',
    provider: providerUsed, model: modelUsed,
    completion_chars: completionChars, totalMs, attempts: trail.length,
  });
  await Promise.all([
    incrementUsage(profile.id, 'ai_requests', 1),
    recordAiRequest({
      user_id: profile.id,
      provider_name: providerUsed,
      model: modelUsed,
      prompt_chars: prompt.length,
      completion_chars: completionChars,
      status: lastErr && completionChars === 0 ? 'error' : 'ok',
      error_message: lastErr ? (lastErr.message || '').slice(0, 500) : null,
      ip_address: ip,
    }),
    recordAudit(profile, 'ai.request', 'ai_requests', null,
                { provider: providerUsed, model: modelUsed, prompt_chars: prompt.length,
                  total_ms: totalMs, attempts: trail.length,
                  safety: { skipped: !!safety.skipped, category: safety.category,
                            raw: (safety.raw || '').slice(0, 80) } },
                ip),
  ]).catch(() => {});
};
