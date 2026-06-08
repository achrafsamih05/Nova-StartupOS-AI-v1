// =====================================================================
// Nova StartupOS AI — Project-aware Deck/Plan Generator (Bridge)
// ---------------------------------------------------------------------
// Route:  POST /api/generate-deck
//
// Responsibility:
//   1. Verify the caller's Supabase JWT.
//   2. Read THIS project's `supabase_schema.sql` and
//      `TECHNICAL_SPECIFICATION.md` from disk (bundled via vercel.json
//      `includeFiles`).
//   3. Compose a system prompt that grounds the LLM in our tech stack
//      and the active startup's profile.
//   4. Call Claude (Anthropic Messages API) with a strict JSON schema
//      directive — falls back to OpenRouter `anthropic/claude-3.5-sonnet`
//      and finally to OpenAI's JSON-mode if no Anthropic key is configured.
//   5. Parse the response into a slides array and return it as JSON.
//
// The frontend (`js/main.js#generateDeck`) calls this and feeds the
// returned `slides` array into `paintDeck()` which renders the semantic
// schema the PPTX exporter consumes.
// =====================================================================

const fs = require('fs');
const path = require('path');
const {
  applyCors, handlePreflight, jsonError, readJsonBody, verifyAuth,
  checkRateLimit, incrementUsage, recordAiRequest, recordAudit,
  clientIp,
} = require('./_lib/auth');
const { sanitizeMessages } = require('./_lib/messages');

const AI_DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '200', 10);
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENAI_KEY     = process.env.OPENAI_API_KEY;

// ---- Project-context loader (cached after first cold start) --------
// Vercel ships these files when listed in vercel.json's `includeFiles`.
let _projectContextCache = null;
function loadProjectContext() {
  if (_projectContextCache) return _projectContextCache;

  // We try several candidate roots because Vercel's working directory
  // is not perfectly stable across runtime versions.
  const candidates = [
    process.cwd(),
    path.join(process.cwd(), 'api', '..'),
    path.resolve(__dirname, '..'),
  ];

  function readSafe(name, maxBytes) {
    for (const root of candidates) {
      const full = path.join(root, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        const raw = fs.readFileSync(full, 'utf8');
        // Head-trim to keep prompts under control. Spec/schema are stable
        // and authoritative — trimming the tail loses the least signal.
        return raw.length > maxBytes ? raw.slice(0, maxBytes) + '\n…[truncated]' : raw;
      } catch (_) { /* try next root */ }
    }
    return '';
  }

  const schema = readSafe('supabase_schema.sql', 14000);
  const schemaV2 = readSafe('supabase_schema_v2.sql', 6000);
  const spec   = readSafe('TECHNICAL_SPECIFICATION.md', 14000);

  _projectContextCache = {
    schema, schemaV2, spec,
    loadedAt: new Date().toISOString(),
    have: { schema: !!schema, schemaV2: !!schemaV2, spec: !!spec },
  };
  return _projectContextCache;
}

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
  if (ctx.schema) block += '\n\n[supabase_schema.sql]\n' + ctx.schema;
  if (ctx.schemaV2) block += '\n\n[supabase_schema_v2.sql]\n' + ctx.schemaV2;
  if (ctx.spec)   block += '\n\n[TECHNICAL_SPECIFICATION.md]\n' + ctx.spec;

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

/* -------------------------- LLM callers -------------------------- */
async function callAnthropic(systemPrompt, userPrompt) {
  if (!ANTHROPIC_KEY) throw new Error('anthropic_not_configured');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error('anthropic_' + res.status + ':' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) throw new Error('anthropic_empty_response');
  return text;
}

async function callOpenRouterClaude(systemPrompt, userPrompt) {
  if (!OPENROUTER_KEY) throw new Error('openrouter_not_configured');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + OPENROUTER_KEY,
      'HTTP-Referer': 'https://novastartupos.ai',
      'X-Title': 'Nova StartupOS AI',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-3.5-sonnet',
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error('openrouter_' + res.status + ':' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('openrouter_empty_response');
  return text;
}

async function callOpenAI(systemPrompt, userPrompt) {
  if (!OPENAI_KEY) throw new Error('openai_not_configured');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + OPENAI_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      response_format: { type: 'json_object' }, // forces JSON
      messages: [
        // OpenAI's JSON mode requires the word "json" in the prompt.
        { role: 'system', content: systemPrompt + '\n\nReply with a JSON object whose only key is "slides" containing the slides array.' },
        { role: 'user',   content: userPrompt + '\n\nReturn JSON of shape: {"slides":[...]}' },
      ],
    }),
  });
  if (!res.ok) throw new Error('openai_' + res.status + ':' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('openai_empty_response');
  return text;
}

/* ----------------------- JSON parsing utils ---------------------- */
function extractSlidesArray(text) {
  if (!text) return null;
  // Strip code fences.
  let s = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  // Try direct parse first.
  try {
    const direct = JSON.parse(s);
    if (Array.isArray(direct)) return direct;
    if (direct && Array.isArray(direct.slides)) return direct.slides;
  } catch (_) {}

  // Try the largest JSON array substring.
  const arrayMatch = s.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const arr = JSON.parse(arrayMatch[0]);
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }

  // Try a "{...slides:[...]...}" object.
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

  // 2. Rate limit (shares the AI quota bucket)
  const rl = await checkRateLimit(profile.id, 'ai_requests', AI_DAILY_LIMIT);
  if (!rl.ok) {
    await recordAiRequest({ user_id: profile.id, status: 'rate_limited', error_message: 'daily limit reached', ip_address: ip });
    return jsonError(res, 429, 'Daily AI quota exhausted.', { limit: rl.limit, current: rl.current });
  }

  // 3. Inputs
  const body = await readJsonBody(req);
  const startupName = String(body.startupName || body.name || '').trim();
  const startup     = body.startup && typeof body.startup === 'object' ? body.startup : {};
  const audience    = String(body.audience || 'investors');
  const locale      = String(body.locale || 'ar');

  // 4. Project context — bundled at deploy time (vercel.json includeFiles)
  const ctx = loadProjectContext();

  // 5. Prompts
  const systemPrompt = buildSystemPrompt(ctx, Object.assign({ name: startupName }, startup), audience, locale);
  const userPrompt   = buildUserPrompt(startupName, locale);

  // Sanitize before handing to providers (Anthropic enforces alternation,
  // and a future change that adds prior turns would break otherwise).
  const clean = sanitizeMessages([
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userPrompt },
  ]);
  const safeSystem = clean.system || systemPrompt;
  const safeUser   = (clean.messages.find(function (m) { return m.role === 'user'; }) || { content: userPrompt }).content;

  // 6. Provider chain — Claude → OpenRouter Claude → OpenAI JSON-mode
  let providerUsed = null;
  let raw = null;
  let lastErr = null;
  const chain = [
    { name: 'anthropic',         fn: () => callAnthropic(safeSystem, safeUser),       enabled: !!ANTHROPIC_KEY },
    { name: 'openrouter-claude', fn: () => callOpenRouterClaude(safeSystem, safeUser), enabled: !!OPENROUTER_KEY },
    { name: 'openai',            fn: () => callOpenAI(safeSystem, safeUser),          enabled: !!OPENAI_KEY },
  ].filter((c) => c.enabled);

  if (!chain.length) return jsonError(res, 503, 'No AI provider key is configured on the server (set ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY).');

  for (const c of chain) {
    try {
      providerUsed = c.name;
      raw = await c.fn();
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (lastErr || !raw) {
    await recordAiRequest({ user_id: profile.id, provider_name: providerUsed, status: 'error', error_message: (lastErr && lastErr.message) || 'all_providers_failed', ip_address: ip });
    return jsonError(res, 502, 'AI generation failed: ' + ((lastErr && lastErr.message) || 'all providers failed'));
  }

  // 7. Parse + validate
  const slides = validateSlides(extractSlidesArray(raw));
  if (!slides || !slides.length) {
    await recordAiRequest({ user_id: profile.id, provider_name: providerUsed, status: 'error', error_message: 'invalid_json_from_llm', ip_address: ip });
    return jsonError(res, 502, 'AI returned an unparseable response. Try again.', { providerUsed, sample: String(raw).slice(0, 200) });
  }

  // 8. Telemetry (fire-and-forget)
  await Promise.all([
    incrementUsage(profile.id, 'ai_requests', 1),
    recordAiRequest({
      user_id: profile.id,
      provider_name: providerUsed,
      model: providerUsed === 'anthropic' ? 'claude-3-5-sonnet' : (providerUsed === 'openai' ? 'gpt-4o-mini' : 'anthropic/claude-3.5-sonnet'),
      prompt_chars: safeSystem.length + safeUser.length,
      completion_chars: raw.length,
      status: 'ok',
      ip_address: ip,
    }),
    recordAudit(profile, 'deck.generated', 'generated_documents', null,
                { provider: providerUsed, slides: slides.length, project_context: ctx.have }, ip),
  ]).catch(() => {});

  return res.status(200).json({
    slides,
    meta: {
      provider: providerUsed,
      slideCount: slides.length,
      projectContextLoaded: ctx.have,
    },
  });
};
