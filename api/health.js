// =====================================================================
// Nova StartupOS AI — System Health Probe
// ---------------------------------------------------------------------
// Route:  GET /api/health  (admin/super-admin only)
//
// Pings DB + AI providers + Stripe and returns latency + status,
// also records a system_events row for the historical chart.
// =====================================================================

const {
  applyCors, handlePreflight, jsonError, verifyAuth, getServiceClient,
} = require('./_lib/auth');

async function timed(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
    return { source: label, status: 'ok', latency_ms: Date.now() - t0 };
  } catch (e) {
    return { source: label, status: 'down', latency_ms: Date.now() - t0, error: e.message };
  }
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res, 'GET, OPTIONS')) return;
  if (req.method !== 'GET') return jsonError(res, 405, 'Method not allowed');

  const auth = await verifyAuth(req);
  if (!auth) return jsonError(res, 401, 'Authentication required.');
  if (!['Admin', 'Super Admin'].includes(auth.profile.role)) {
    return jsonError(res, 403, 'Admin only.');
  }

  const admin = getServiceClient();

  const probes = await Promise.all([
    timed('database', async () => {
      const { error } = await admin.from('profiles').select('id', { count: 'exact', head: true });
      if (error) throw error;
    }),
    timed('ai', async () => {
      const { error } = await admin.from('ai_providers_config').select('provider_name', { head: true });
      if (error) throw error;
    }),
    timed('storage', async () => {
      const { error } = await admin.storage.from('startup-logos').list('', { limit: 1 });
      if (error) throw error;
    }),
    timed('stripe', async () => {
      if (!process.env.STRIPE_SECRET_KEY) throw new Error('not_configured');
      const r = await fetch('https://api.stripe.com/v1/balance', {
        headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY },
      });
      if (!r.ok) throw new Error('http_' + r.status);
    }),
  ]);

  // Persist for historical charts (best-effort).
  try {
    await admin.from('system_events').insert(probes.map((p) => ({
      source: p.source, status: p.status, latency_ms: p.latency_ms, metadata: p.error ? { error: p.error } : {},
    })));
  } catch (_) { /* non-fatal */ }

  res.status(200).json({ probes, timestamp: new Date().toISOString() });
};
