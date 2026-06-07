// =====================================================================
// Nova StartupOS AI — Shared serverless helpers
// ---------------------------------------------------------------------
// Centralizes:
//   • Supabase service-role client construction
//   • CORS preflight handling with an env-driven origin allowlist
//   • Bearer-token verification → returns the authenticated profile
//   • Rate limiting backed by usage_tracking
//   • Audit-log + AI-request recording
//   • JSON body parsing
// =====================================================================

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Lazily-instantiated singleton service-role client. Reused across invocations
// when the function instance is warm.
let _admin = null;
function getServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Server is not configured (missing Supabase env vars).');
  }
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

// Comma-separated allowlist; falls back to "*" only when explicitly unset.
function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
function pickOrigin(req) {
  const list = allowedOrigins();
  const origin = req.headers.origin || '';
  if (!list.length) return '*';
  return list.includes(origin) ? origin : list[0];
}

function applyCors(req, res, methods = 'POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', pickOrigin(req));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Stripe-Signature');
}

function handlePreflight(req, res, methods) {
  if (req.method === 'OPTIONS') {
    applyCors(req, res, methods);
    res.status(204).end();
    return true;
  }
  applyCors(req, res, methods);
  return false;
}

function jsonError(res, code, message, extra) {
  res.status(code).json(Object.assign({ error: message }, extra || {}));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; }
  }
  // Vercel Node runtime usually pre-parses JSON. Fall back to manual read.
  return await new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; });
    req.on('end', () => {
      try { resolve(JSON.parse(buf || '{}')); } catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// Verifies the Supabase JWT and loads the matching profile row.
// Returns { user, profile } or null on failure (callers handle 401).
async function verifyAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const admin = getServiceClient();
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData || !userData.user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('id, name, email, role, plan_tier, is_active')
    .eq('id', userData.user.id)
    .single();

  if (!profile || profile.is_active === false) return null;
  return { user: userData.user, profile };
}

// Sliding daily-window rate limit using usage_tracking rows.
// metric: e.g. 'ai_requests'. Returns { ok, current, limit }.
async function checkRateLimit(userId, metric, limit) {
  const admin = getServiceClient();
  const period = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data: row } = await admin
    .from('usage_tracking')
    .select('count')
    .eq('user_id', userId)
    .eq('metric', metric)
    .eq('period', period)
    .maybeSingle();
  const current = row ? Number(row.count) || 0 : 0;
  return { ok: current < limit, current, limit };
}

// Atomically bump the counter (creates the row on first hit).
async function incrementUsage(userId, metric, by = 1) {
  const admin = getServiceClient();
  const period = new Date().toISOString().slice(0, 10);
  // Upsert via raw RPC-like flow: try update first, fall back to insert.
  const { data: existing } = await admin
    .from('usage_tracking')
    .select('id, count')
    .eq('user_id', userId).eq('metric', metric).eq('period', period)
    .maybeSingle();

  if (existing) {
    await admin
      .from('usage_tracking')
      .update({ count: (Number(existing.count) || 0) + by })
      .eq('id', existing.id);
  } else {
    await admin
      .from('usage_tracking')
      .insert({ user_id: userId, metric, period, count: by });
  }
}

// Server-side audit logger. Failure is swallowed — never break the request.
async function recordAudit(profile, action, resource, resourceId, metadata, ip) {
  try {
    const admin = getServiceClient();
    await admin.from('audit_logs').insert({
      user_id: profile && profile.id,
      user_name: profile && profile.name,
      user_email: profile && profile.email,
      action,
      resource: resource || null,
      resource_id: resourceId ? String(resourceId) : null,
      metadata: metadata || {},
      ip_address: ip || null,
    });
  } catch (_) { /* audit must never throw */ }
}

async function recordAiRequest(row) {
  try {
    const admin = getServiceClient();
    await admin.from('ai_requests').insert(row);
  } catch (_) { /* swallow */ }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return (fwd.split(',')[0] || '').trim() || req.socket?.remoteAddress || null;
}

module.exports = {
  getServiceClient,
  applyCors,
  handlePreflight,
  jsonError,
  readJsonBody,
  verifyAuth,
  checkRateLimit,
  incrementUsage,
  recordAudit,
  recordAiRequest,
  clientIp,
};
