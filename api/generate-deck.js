// =====================================================================
// Nova StartupOS AI — Project-aware Deck/Plan Generator (v3)
// ---------------------------------------------------------------------
// Route:  POST /api/generate-deck
//
// What changed (v3):
//   • Replaced the deprecated `anthropic/claude-3.5-sonnet` hardcode
//     with a fallback chain (Claude Sonnet 4 → Gemini 2.5 Pro → GPT-4o
//     → GPT-4o-mini → DeepSeek). See api/_lib/aiProviders.js.
//   • Added 3-attempt retry logic with exponential backoff per model.
//   • Friendly user-facing error messages — no raw provider strings.
//   • Structured monitoring log of every attempt.
//   • Native Anthropic + OpenAI native paths still try first when their
//     dedicated keys are configured; otherwise OpenRouter handles all.
//
// Returns: { slides: [...], meta: { provider, model, slideCount, attempts } }
// =====================================================================

const {
  handlePreflight, jsonError, readJsonBody, verifyAuth,
  checkRateLimit, incrementUsage, recordAiRequest, recordAudit,
  clientIp,
} = require('./_lib/auth');
const { sanitizeMessages } = require('./_lib/messages');
const { classifyPrompt }   = require('./_lib/safetyGate');
const projectContext       = require('./_lib/projectContext');
const {
  OPENROUTER_MODEL_CHAIN,
  callOpenRouterWithFallback,
  friendlyError,
  diag,
} = require('./_lib/aiProviders');

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '200', 10);
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_KEY     = process.env.OPENAI_API_KEY;

const loadProjectContext = projectContext.load;

/* ---------------------- Prompt construction ---------------------- */
function buildSystemPrompt(ctx, startup, audience, locale) {
  const isAr = locale !== 'en';
  const intro = isAr
    ? 'أنت Nova، شريك ذكاء اصطناعي يصنع عروض تقديمية وخطط أعمال بمستوى المستثمرين. ستقرأ بنية مشروع "Nova StartupOS AI" أدناه (مخطط Supabase + المواصفات التقنية) وستستخدمها لتخصيص العرض بدقة لهذا المنتج تحديدًا.'
    : 'You are Nova, an AI co-founder generating investor-ready pitch decks. You will read the Nova StartupOS AI project below (Supabase schema + technical spec) and tailor the deck to this exact product.';
  const audienceLine = isAr
    ? (audience === 'investors' ? 'الجمهور: مستثمرون مرحلة Pre-seed إلى Series A.' : 'الجمهور: ' + audience)
    : 'Audience: pre-seed to Series A investors.';
  const styleLine = isAr
    ? 'الأسلوب: عربية فصحى، جمل قصيرة وأرقام عند توفّرها. لا تستخدم Markdown.'
    : 'Style: concise sentences, prefer numbers, no Markdown.';

  let block = '';
  if (ctx.schema)   block += '\n\n[supabase_schema.sql]\n' + ctx.schema;
  if (ctx.schemaV2) block += '\n\n[supabase_schema_v2.sql]\n' + ctx.schemaV2;
  if (ctx.spec)     block += '\n\n[TECHNICAL_SPECIFICATION.md]\n' + ctx.spec;

  let profile = '';
  if (startup) {
    const lines = [];
    if (startup.name)     lines.push((isAr ? '- الاسم: '   : '- Name: ')     + startup.name);
    if (startup.industry) lines.push((isAr ? '- القطاع: '  : '- Industry: ') + startup.industry);
    if (startup.country)  lines.push((isAr ? '- الدولة: '  : '- Country: ')  + startup.country);
    if (startup.market)   lines.push((isAr ? '- السوق: '   : '- Market: ')   + startup.market);
    if (startup.problem)  lines.push((isAr ? '- المشكلة: ' : '- Problem: ')  + startup.problem);
    if (startup.solution) lines.push((isAr ? '- الحل: '    : '- Solution: ') + startup.solution);
    if (startup.stage)    lines.push((isAr ? '- المرحلة: ' : '- Stage: ')    + startup.stage);
    if (lines.length) profile = (isAr ? '\n\nبيانات الشركة:\n' : '\n\nStartup profile:\n') + lines.join('\n');
  }

  return [intro, audienceLine, styleLine].join(' ') +
         (isAr ? '\n\nسياق المشروع (للقراءة فقط):' : '\n\nProject context (read-only):') +
         block + profile;
}

function buildUserPrompt(startupName, locale) {
  const isAr = locale !== 'en';
  if (isAr) {
    return (
      'أنشئ عرضًا تقديميًا للمستثمرين باللغة العربية الفصحى لشركة "' + (startupName || 'الشركة') + '". ' +
      'أعد المحتوى **حصريًا** كمصفوفة JSON صالحة (Array)، بدون أي نص أو تعليقات أو علامات أكواد قبلها أو بعدها، ' +
      'بهذا الشكل بالضبط:\n' +
      '[\n' +
      '  { "type": "cover", "title": "...", "subtitle": "..." },\n' +
      '  { "type": "standard", "title": "المشكلة", "content": "...", "bullets": ["...", "..."] },\n' +
      '  { "type": "standard", "title": "الحل التقني باستخدام Supabase", "content": "...", "bullets": ["...", "..."] }\n' +
      ']\n\n' +
      'متطلبات إلزامية:\n' +
      '1) العدد الإجمالي للشرائح بالضبط 10.\n' +
      '2) الشريحة الأولى من نوع cover وتحتوي title وsubtitle.\n' +
      '3) باقي الشرائح من نوع standard وتحتوي title وcontent (نصّ واحد، 2-3 جمل) وbullets (3-5 نقاط مختصرة).\n' +
      '4) العناوين بالترتيب: شريحة الغلاف، المشكلة، الحل التقني (اربط بمكوّنات Supabase وVercel وLLM)، السوق وحجمه، ' +
      'المنتج (المعمارية)، نموذج الأعمال، المنافسة، الجاذبية والمؤشرات، الفريق، الطلب التمويلي.\n' +
      '5) اعتمد على معطيات schema والمواصفات التقنية لربط شرائح الحل والمنتج بالمعمارية الفعلية (RLS، Edge Functions، Stripe Webhooks، AI Streaming Proxy).\n' +
      '6) لا تستخدم Markdown أو ```json أو أي وسوم. JSON صرف فقط.'
    );
  }
  return (
    'Generate an investor pitch deck for "' + (startupName || 'the startup') + '". ' +
    'Return ONLY a valid JSON array (no prose, no code fences) shaped exactly:\n' +
    '[\n' +
    '  { "type": "cover",    "title": "...", "subtitle": "..." },\n' +
    '  { "type": "standard", "title": "Problem",                   "content": "...", "bullets": ["...","..."] },\n' +
    '  { "type": "standard", "title": "Solution (built on Supabase)", "content": "...", "bullets": ["...","..."] }\n' +
    ']\n' +
    'Requirements: exactly 10 slides; first must be cover; remainder are standard with content (2-3 sentences) and 3-5 bullets each. ' +
    'Order: Cover, Problem, Solution (tech), Market, Product (architecture), Business Model, Competition, Traction, Team, Funding Ask. ' +
    'Ground the Solution and Product slides in the supplied schema + spec (RLS, Edge Functions, Stripe webhooks, AI streaming proxy).'
  );
}

/* ---------------------- Native provider callers ----------------- */
// Anthropic native — used only when ANTHROPIC_API_KEY is set, otherwise
// OpenRouter handles Anthropic models.
async function callAnthropicNative(systemPrompt, userPrompt) {
  if (!ANTHROPIC_KEY) throw new Error('anthropic_not_configured');
  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      // Claude Sonnet 4 (current). The previous `claude-3-5-sonnet-20241022`
      // returns a 404 from Anthropic now.
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const durationMs = Date.now() - t0;
  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 240);
    diag.record({ event: 'ai.attempt', provider: 'anthropic', model: 'claude-sonnet-4-20250514',
                  status: res.status, durationMs, ok: false, error: errText });
    const e = new Error('anthropic_' + res.status + ':' + errText);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) {
    diag.record({ event: 'ai.attempt', provider: 'anthropic', model: 'claude-sonnet-4-20250514',
                  status: 200, durationMs, ok: false, empty: true });
    throw new Error('anthropic_empty_response');
  }
  diag.record({ event: 'ai.success', provider: 'anthropic', model: 'claude-sonnet-4-20250514',
                durationMs, ok: true, completion_chars: text.length });
  return { text, model: 'claude-sonnet-4-20250514', vendor: 'anthropic', durationMs };
}

// OpenAI native JSON-mode — used as the absolute last resort when neither
// Anthropic nor OpenRouter responded.
async function callOpenAINative(systemPrompt, userPrompt) {
  if (!OPENAI_KEY) throw new Error('openai_not_configured');
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + OPENAI_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt + '\n\nReply with a JSON object whose only key is "slides" containing the slides array.' },
        { role: 'user',   content: userPrompt + '\n\nReturn JSON of shape: {"slides":[...]}' },
      ],
    }),
  });
  const durationMs = Date.now() - t0;
  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 240);
    diag.record({ event: 'ai.attempt', provider: 'openai', model: 'gpt-4o-mini',
                  status: res.status, durationMs, ok: false, error: errText });
    const e = new Error('openai_' + res.status + ':' + errText);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) {
    diag.record({ event: 'ai.attempt', provider: 'openai', model: 'gpt-4o-mini',
                  status: 200, durationMs, ok: false, empty: true });
    throw new Error('openai_empty_response');
  }
  diag.record({ event: 'ai.success', provider: 'openai', model: 'gpt-4o-mini',
                durationMs, ok: true, completion_chars: text.length });
  return { text, model: 'gpt-4o-mini', vendor: 'openai', durationMs };
}

/* ----------------------- JSON parsing utils ---------------------- */
function extractSlidesArray(text) {
  if (!text) return null;
  let s = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  try {
    const direct = JSON.parse(s);
    if (Array.isArray(direct)) return direct;
    if (direct && Array.isArray(direct.slides)) return direct.slides;
  } catch (_) {}

  const arrayMatch = s.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const arr = JSON.parse(arrayMatch[0]);
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }

  const objMatch = s.match(/\{[\s\S]*"slides"[\s\S]*\}/);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]);
      if (obj && Array.isArray(obj.slides)) return obj.slides;
    } catch (_) {}
  }
  return null;
}

function validateSlides(slides) {
  if (!Array.isArray(slides) || !slides.length) return null;
  return slides.map((raw) => {
    const slide = (raw && typeof raw === 'object') ? raw : {};
    const type  = slide.type === 'cover' ? 'cover' : 'standard';
    const out = { type: type, title: String(slide.title || '').trim() };
    if (type === 'cover') {
      out.subtitle = String(slide.subtitle || '').trim();
    } else {
      out.content = String(slide.content || '').trim();
      if (Array.isArray(slide.bullets)) {
        out.bullets = slide.bullets.map((b) => String(b || '').trim()).filter(Boolean).slice(0, 8);
      }
    }
    return out;
  }).filter((s) => s.title);
}

/* ----------------------------- Handler --------------------------- */
module.exports = async (req, res) => {
  if (handlePreflight(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');

  // 1. Auth
  let auth;
  try { auth = await verifyAuth(req); }
  catch (e) { return jsonError(res, 500, e.message); }
  if (!auth) return jsonError(res, 401, 'Authentication required.');
  const { profile } = auth;
  const ip = clientIp(req);

  // 2. Rate limit
  const rl = await checkRateLimit(profile.id, 'ai_requests', AI_DAILY_LIMIT);
  if (!rl.ok) {
    await recordAiRequest({ user_id: profile.id, status: 'rate_limited',
                            error_message: 'daily limit reached', ip_address: ip });
    return jsonError(res, 429, 'Daily AI quota exhausted.', { limit: rl.limit, current: rl.current });
  }

  // 3. Inputs
  const body = await readJsonBody(req);
  const startupName = String(body.startupName || body.name || '').trim();
  const startup     = body.startup && typeof body.startup === 'object' ? body.startup : {};
  const audience    = String(body.audience || 'investors');
  const locale      = String(body.locale || 'ar');

  // 4. Project context
  const ctx = loadProjectContext();

  // 5. Prompts
  const systemPrompt = buildSystemPrompt(ctx, Object.assign({ name: startupName }, startup), audience, locale);
  const userPrompt   = buildUserPrompt(startupName, locale);

  // 5b. Safety gate
  const safety = await classifyPrompt(userPrompt, { apiKey: OPENROUTER_KEY });
  if (!safety.safe) {
    await Promise.all([
      recordAiRequest({ user_id: profile.id, status: 'blocked',
        error_message: 'safety_blocked' + (safety.category ? ':' + safety.category : ''), ip_address: ip }),
      recordAudit(profile, 'deck.blocked_unsafe', 'generated_documents', null,
                  { category: safety.category, raw: (safety.raw || '').slice(0, 200) }, ip),
    ]).catch(() => {});
    return jsonError(res, 422,
      'This deck request was flagged by the content safety classifier.',
      { category: safety.category });
  }

  // Sanitize message shape (alternation rules).
  const clean = sanitizeMessages([
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ]);
  const safeSystem = clean.system || systemPrompt;
  const safeUser   = (clean.messages.find(function (m) { return m.role === 'user'; }) || { content: userPrompt }).content;

  // 6. Provider chain — automatic fallback. Order:
  //    1) Anthropic native (if ANTHROPIC_API_KEY set) — direct claude-sonnet-4
  //    2) OpenRouter chain (claude-sonnet-4 → gemini-2.5-pro → gpt-4o → gpt-4o-mini → deepseek)
  //    3) OpenAI native JSON-mode (last resort, if OPENAI_API_KEY set)
  let providerUsed = null;
  let modelUsed = null;
  let raw = null;
  let durationMs = 0;
  let attemptsTrail = [];
  let lastErr = null;
  const startedAt = Date.now();

  // 6a. Try Anthropic native (3 attempts on transient failures).
  if (!raw && ANTHROPIC_KEY) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const out = await callAnthropicNative(safeSystem, safeUser);
        raw = out.text; providerUsed = 'anthropic'; modelUsed = out.model;
        durationMs = out.durationMs;
        attemptsTrail.push({ provider: 'anthropic', attempt, ok: true, durationMs: out.durationMs });
        break;
      } catch (e) {
        lastErr = e;
        const transient = !e.status || e.status === 408 || e.status === 429 || e.status >= 500;
        attemptsTrail.push({ provider: 'anthropic', attempt, ok: false,
                             error: (e.message || '').slice(0, 200), transient });
        if (!transient) break; // permanent → fallthrough to next provider
        if (attempt < 3) await new Promise(r => setTimeout(r, 200 * attempt));
      }
    }
  }

  // 6b. OpenRouter fallback chain (each model gets up to 3 attempts).
  if (!raw && OPENROUTER_KEY) {
    try {
      const out = await callOpenRouterWithFallback({
        apiKey: OPENROUTER_KEY,
        chain: OPENROUTER_MODEL_CHAIN,
        attempts: 3,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: safeSystem },
          { role: 'user',   content: safeUser },
        ],
      });
      raw = out.text; providerUsed = 'openrouter'; modelUsed = out.model;
      durationMs = out.durationMs;
      attemptsTrail = attemptsTrail.concat(out.attempts.map(a => Object.assign({ provider: 'openrouter' }, a)));
    } catch (e) {
      lastErr = e;
      attemptsTrail = attemptsTrail.concat((e.attempts || []).map(a => Object.assign({ provider: 'openrouter' }, a)));
    }
  }

  // 6c. OpenAI native JSON-mode (last-ditch).
  if (!raw && OPENAI_KEY) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const out = await callOpenAINative(safeSystem, safeUser);
        raw = out.text; providerUsed = 'openai'; modelUsed = out.model;
        durationMs = out.durationMs;
        attemptsTrail.push({ provider: 'openai', attempt, ok: true, durationMs: out.durationMs });
        break;
      } catch (e) {
        lastErr = e;
        const transient = !e.status || e.status === 408 || e.status === 429 || e.status >= 500;
        attemptsTrail.push({ provider: 'openai', attempt, ok: false,
                             error: (e.message || '').slice(0, 200), transient });
        if (!transient) break;
        if (attempt < 3) await new Promise(r => setTimeout(r, 200 * attempt));
      }
    }
  }

  if (!raw) {
    const totalMs = Date.now() - startedAt;
    diag.record({ event: 'deck.failed', totalMs, attempts: attemptsTrail,
                  lastError: lastErr && lastErr.message });
    await recordAiRequest({
      user_id: profile.id, provider_name: providerUsed,
      status: 'error',
      error_message: ((lastErr && (lastErr.message || '')) || 'all_providers_failed').slice(0, 500),
      ip_address: ip,
    });
    if (!ANTHROPIC_KEY && !OPENROUTER_KEY && !OPENAI_KEY) {
      return jsonError(res, 503,
        'AI service is not configured. Please contact support.');
    }
    return jsonError(res, 502,
      friendlyError(lastErr, 'AI generation is temporarily unavailable. Please try again in a moment.'),
      { attempts: attemptsTrail.length });
  }

  // 7. Parse + validate
  const slides = validateSlides(extractSlidesArray(raw));
  if (!slides || !slides.length) {
    diag.record({ event: 'deck.parse_failed', provider: providerUsed, model: modelUsed,
                  sample: String(raw).slice(0, 200) });
    await recordAiRequest({
      user_id: profile.id, provider_name: providerUsed, model: modelUsed,
      status: 'error', error_message: 'invalid_json_from_llm', ip_address: ip,
    });
    return jsonError(res, 502,
      'Nova received an unparseable response from the AI. Please try again.',
      { providerUsed });
  }

  // 8. Telemetry
  const totalMs = Date.now() - startedAt;
  diag.record({
    event: 'deck.success',
    provider: providerUsed, model: modelUsed,
    slideCount: slides.length, totalMs, attempts: attemptsTrail.length,
  });
  await Promise.all([
    incrementUsage(profile.id, 'ai_requests', 1),
    recordAiRequest({
      user_id: profile.id,
      provider_name: providerUsed,
      model: modelUsed,
      prompt_chars: safeSystem.length + safeUser.length,
      completion_chars: raw.length,
      status: 'ok',
      ip_address: ip,
    }),
    recordAudit(profile, 'deck.generated', 'generated_documents', null,
                { provider: providerUsed, model: modelUsed, slides: slides.length,
                  total_ms: totalMs, attempts: attemptsTrail.length,
                  project_context: ctx.have }, ip),
  ]).catch(() => {});

  return res.status(200).json({
    slides,
    meta: {
      provider: providerUsed,
      model: modelUsed,
      slideCount: slides.length,
      durationMs: totalMs,
      attempts: attemptsTrail.length,
      projectContextLoaded: ctx.have,
    },
  });
};
