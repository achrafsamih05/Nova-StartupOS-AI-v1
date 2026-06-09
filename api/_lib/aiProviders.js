// =====================================================================
// Nova StartupOS AI — Shared AI provider fallback chain (v3)
// ---------------------------------------------------------------------
// Centralizes the OpenRouter model priority list AND the database-backed
// provider chain so /api/generate-deck and /api/ai-stream share a single
// source of truth.
//
// FAILURE MODE FIX:
//   The original deck endpoint hardcoded `anthropic/claude-3.5-sonnet`,
//   which OpenRouter has decommissioned ("No endpoints found for ...").
//   This module replaces that with a *priority chain* of currently-
//   supported models, retries each one, and falls back automatically
//   on 4xx/5xx upstream errors.
//
// Public API:
//   • OPENROUTER_MODEL_CHAIN          — ordered list of models to try
//   • DEPRECATED_MODEL_MAP            — old → new model rewrites
//   • normalizeModel(name)            — rewrite deprecated → current
//   • callOpenRouterWithFallback(...) — try each model with retries
//   • friendlyError(err)              — turn raw errors into UX text
//   • diag.record({...})              — structured monitoring log
// =====================================================================

'use strict';

// ---------------------------------------------------------------------
// 1. CURRENT, ACTIVELY-SUPPORTED MODELS (June 2026)
// ---------------------------------------------------------------------
// Anthropic's `claude-3.5-sonnet` was retired on OpenRouter; we move to
// `claude-sonnet-4`. Gemini 1.5 was retired; we use `gemini-2.5-pro`.
// Order = preference. Anything that fails → next provider.
const OPENROUTER_MODEL_CHAIN = [
  { id: 'anthropic/claude-sonnet-4',    label: 'Claude Sonnet 4',  vendor: 'anthropic' },
  { id: 'google/gemini-2.5-pro',        label: 'Gemini 2.5 Pro',   vendor: 'google'    },
  { id: 'openai/gpt-4o',                label: 'GPT-4o',           vendor: 'openai'    },
  { id: 'openai/gpt-4o-mini',           label: 'GPT-4o mini',      vendor: 'openai'    },
  { id: 'deepseek/deepseek-chat',       label: 'DeepSeek Chat',    vendor: 'deepseek'  },
];

// Map of removed/deprecated model identifiers → their current
// replacements. Used both at request time (silent rewrite) and by the
// migration script that updates ai_providers_config.default_model rows.
const DEPRECATED_MODEL_MAP = {
  'anthropic/claude-3.5-sonnet':          'anthropic/claude-sonnet-4',
  'anthropic/claude-3-5-sonnet':          'anthropic/claude-sonnet-4',
  'anthropic/claude-3-5-sonnet-20241022': 'anthropic/claude-sonnet-4',
  'claude-3-5-sonnet':                    'anthropic/claude-sonnet-4',
  'claude-3-5-sonnet-20241022':           'anthropic/claude-sonnet-4',
  'claude-3.5-sonnet':                    'anthropic/claude-sonnet-4',
  'google/gemini-flash-1.5':              'google/gemini-2.5-pro',
  'google/gemini-pro-1.5':                'google/gemini-2.5-pro',
  'gemini-1.5-flash':                     'google/gemini-2.5-pro',
  'gemini-1.5-pro':                       'google/gemini-2.5-pro',
};

// We never let a "safety" / classifier model leak into a generation call.
const SAFETY_MODEL_BLOCKLIST = /content-safety|safety|guard|moderation/i;

function normalizeModel(name) {
  if (!name) return '';
  if (DEPRECATED_MODEL_MAP[name]) return DEPRECATED_MODEL_MAP[name];
  return name;
}

function isSafetyModel(name) {
  return !!name && SAFETY_MODEL_BLOCKLIST.test(name);
}

// ---------------------------------------------------------------------
// 2. STRUCTURED MONITORING / DIAGNOSTICS LOG
// ---------------------------------------------------------------------
// Every call to an AI provider logs a single line with: provider, model,
// duration, status, attempt, error. This is the "diagnostics report" —
// in production these flow into Vercel's log drains and the Supabase
// `ai_requests` table. Locally they go to stdout.
const diag = {
  record(entry) {
    const e = Object.assign({
      ts: new Date().toISOString(),
    }, entry || {});
    // One JSON line per event keeps log drains happy.
    try { console.log('[NOVA_AI]', JSON.stringify(e)); } catch (_) { /* noop */ }
    return e;
  },
};

// ---------------------------------------------------------------------
// 3. OPENROUTER CALLER WITH RETRY + FALLBACK
// ---------------------------------------------------------------------
// `chain` is the ordered list of models to try. For each model we
// retry up to `attempts` times (default 3) on transient failures
// (network errors, 408/429/500/502/503/504). On a permanent failure
// (4xx other than 408/429), we move to the next model immediately.
//
// Returns { text, model, vendor, durationMs, attempts: [...] } on
// success. Throws an Error tagged with `.userMessage` for friendly UX
// when every model in the chain fails.
async function callOpenRouterWithFallback(opts) {
  opts = opts || {};
  const apiKey = opts.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const e = new Error('openrouter_not_configured');
    e.userMessage = 'AI service is temporarily unavailable. Please try again shortly.';
    throw e;
  }

  // Allow caller to supply a custom chain (with override) or use default.
  let chain = (opts.chain || OPENROUTER_MODEL_CHAIN)
    .map((m) => (typeof m === 'string' ? { id: normalizeModel(m), vendor: 'unknown' } : Object.assign({}, m, { id: normalizeModel(m.id) })))
    .filter((m) => m.id && !isSafetyModel(m.id));

  // Optional: prepend a caller-preferred model if it isn't already in
  // the chain. This lets per-call overrides win without dropping the
  // safety-net providers underneath.
  if (opts.preferredModel) {
    const pm = normalizeModel(opts.preferredModel);
    if (pm && !isSafetyModel(pm) && !chain.some((m) => m.id === pm)) {
      chain.unshift({ id: pm, label: pm, vendor: 'preferred' });
    }
  }

  if (!chain.length) {
    const e = new Error('no_valid_models');
    e.userMessage = 'No AI models are currently available. Please try again later.';
    throw e;
  }

  const messages = opts.messages || [];
  const maxTokens = opts.max_tokens || 4096;
  const attempts = Math.max(1, opts.attempts || 3);
  const timeoutMs = opts.timeoutMs || 45000;
  const stream = !!opts.stream;
  const responseFormat = opts.response_format || null;

  const trail = [];
  let lastErr = null;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const t0 = Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        const body = {
          model: model.id,
          messages,
          max_tokens: maxTokens,
        };
        if (stream) body.stream = true;
        if (responseFormat) body.response_format = responseFormat;

        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: ac.signal,
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://novastartupos.ai',
            'X-Title':      'Nova StartupOS AI',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        clearTimeout(timer);

        const durationMs = Date.now() - t0;

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          const status = res.status;
          // Permanent failure → break the inner loop, try next model.
          const isTransient = status === 408 || status === 429 || status >= 500;
          const err = new Error('openrouter_' + status + ':' + (errText || '').slice(0, 240));
          err.status = status;
          err.transient = isTransient;
          trail.push({ model: model.id, attempt, status, durationMs, ok: false, transient: isTransient });
          diag.record({
            event: 'ai.attempt',
            provider: 'openrouter', model: model.id, vendor: model.vendor,
            attempt, status, durationMs, ok: false, transient: isTransient,
            error: (errText || '').slice(0, 240),
          });
          lastErr = err;
          if (isTransient && attempt < attempts) {
            // Backoff before retrying the same model.
            await sleep(200 * attempt);
            continue;
          }
          break; // permanent: skip remaining attempts on this model.
        }

        // Streaming path: hand the body back to the caller for SSE piping.
        if (stream) {
          trail.push({ model: model.id, attempt, status: 200, durationMs, ok: true });
          diag.record({
            event: 'ai.stream_open',
            provider: 'openrouter', model: model.id, vendor: model.vendor,
            attempt, durationMs, ok: true,
          });
          return { stream: true, body: res.body, model: model.id, vendor: model.vendor, durationMs, trail };
        }

        // Non-stream path.
        const data = await res.json();
        const text = data && data.choices && data.choices[0]
          && data.choices[0].message && data.choices[0].message.content;
        if (!text) {
          const err = new Error('openrouter_empty_response');
          err.transient = true;
          trail.push({ model: model.id, attempt, status: 200, durationMs, ok: false, empty: true });
          diag.record({
            event: 'ai.attempt',
            provider: 'openrouter', model: model.id, vendor: model.vendor,
            attempt, status: 200, durationMs, ok: false, empty: true,
          });
          lastErr = err;
          if (attempt < attempts) { await sleep(150 * attempt); continue; }
          break;
        }
        trail.push({ model: model.id, attempt, status: 200, durationMs, ok: true });
        diag.record({
          event: 'ai.success',
          provider: 'openrouter', model: model.id, vendor: model.vendor,
          attempt, durationMs, ok: true, completion_chars: text.length,
        });
        return {
          text, model: model.id, vendor: model.vendor,
          durationMs, attempts: trail, attempt,
        };
      } catch (e) {
        clearTimeout(timer);
        const durationMs = Date.now() - t0;
        const aborted = e && e.name === 'AbortError';
        trail.push({ model: model.id, attempt, error: (e && e.message) || 'fetch_failed',
                     durationMs, ok: false, aborted });
        diag.record({
          event: 'ai.attempt',
          provider: 'openrouter', model: model.id, vendor: model.vendor,
          attempt, durationMs, ok: false, aborted,
          error: (e && e.message) || 'fetch_failed',
        });
        lastErr = e;
        if (attempt < attempts) { await sleep(200 * attempt); continue; }
      }
    } // attempts loop
  } // chain loop

  // Every model failed → throw a friendly error.
  const finalErr = new Error('all_models_failed:' + (lastErr && lastErr.message || 'unknown'));
  finalErr.userMessage = 'The selected AI model is temporarily unavailable. Nova tried multiple providers but none responded. Please try again in a moment.';
  finalErr.attempts = trail;
  finalErr.cause = lastErr;
  diag.record({ event: 'ai.exhausted', attempts: trail, lastError: lastErr && lastErr.message });
  throw finalErr;
}

// ---------------------------------------------------------------------
// 4. FRIENDLY ERROR HELPER
// ---------------------------------------------------------------------
// Translates raw provider/HTTP errors into safe, user-facing messages.
function friendlyError(err, fallback) {
  const msg = (err && (err.userMessage || err.message)) || '';
  if (!msg) return fallback || 'Something went wrong. Please try again.';

  // Specific OpenRouter signal: deprecated/missing model.
  if (/no endpoints found for/i.test(msg)) {
    return 'The selected AI model is temporarily unavailable. Nova is switching to another provider automatically.';
  }
  if (/openrouter_429|rate.?limit|too many requests/i.test(msg)) {
    return 'AI requests are rate-limited right now. Please wait a moment and try again.';
  }
  if (/openrouter_5\d\d|upstream|timeout|abort/i.test(msg)) {
    return 'The AI provider had a hiccup. Nova will try another provider automatically — please retry.';
  }
  if (/openrouter_4\d\d/i.test(msg)) {
    return 'The AI request was rejected. If this keeps happening, please contact support.';
  }
  if (/not_configured|no_valid_models|all_models_failed/i.test(msg)) {
    return 'AI service is temporarily unavailable. Please try again shortly.';
  }
  return err && err.userMessage ? err.userMessage : (fallback || 'Something went wrong. Please try again.');
}

// ---------------------------------------------------------------------
// 5. DB-BACKED PROVIDER CHAIN (used by /api/ai-stream)
// ---------------------------------------------------------------------
// Builds the ordered list of native + OpenRouter providers that have
// a key configured. Native keys take priority; everything else falls
// through OpenRouter so a single key gives access to all models.
const NATIVE_PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions',           keyEnv: 'OPENROUTER_API_KEY' },
  openai:     { url: 'https://api.openai.com/v1/chat/completions',              keyEnv: 'OPENAI_API_KEY'    },
  deepseek:   { url: 'https://api.deepseek.com/v1/chat/completions',            keyEnv: 'DEEPSEEK_API_KEY'  },
};

async function resolveDbProviderChain(admin, requestedModel) {
  const { data: configs, error } = await admin
    .from('ai_providers_config')
    .select('provider_name, enabled, priority, is_default, default_model')
    .eq('enabled', true)
    .order('is_default', { ascending: false })
    .order('priority',   { ascending: true });

  if (error) {
    const e = new Error('Could not read AI provider config.');
    e.userMessage = 'AI service configuration is unavailable. Please try again shortly.';
    throw e;
  }
  if (!configs || !configs.length) {
    const e = new Error('no_enabled_providers');
    e.userMessage = 'No AI provider is currently enabled. Please contact support.';
    throw e;
  }

  const sanitizedRequested = (requestedModel && !isSafetyModel(requestedModel))
    ? normalizeModel(requestedModel)
    : '';

  const chain = configs.map((c) => {
    const native = NATIVE_PROVIDERS[c.provider_name];
    let url, keyEnv;
    if (native && process.env[native.keyEnv]) {
      url = native.url;
      keyEnv = native.keyEnv;
    } else if (process.env.OPENROUTER_API_KEY) {
      // Fallback through OpenRouter when the native key is missing.
      url = NATIVE_PROVIDERS.openrouter.url;
      keyEnv = NATIVE_PROVIDERS.openrouter.keyEnv;
    } else {
      return null;
    }

    let model = sanitizedRequested
      || normalizeModel(c.default_model)
      || OPENROUTER_MODEL_CHAIN[0].id;
    if (isSafetyModel(model)) model = OPENROUTER_MODEL_CHAIN[0].id;

    return {
      name: c.provider_name,
      url,
      keyEnv,
      model,
    };
  }).filter(Boolean);

  return chain;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = {
  OPENROUTER_MODEL_CHAIN,
  DEPRECATED_MODEL_MAP,
  NATIVE_PROVIDERS,
  normalizeModel,
  isSafetyModel,
  callOpenRouterWithFallback,
  resolveDbProviderChain,
  friendlyError,
  diag,
};
