// =====================================================================
// Nova StartupOS AI — Stripe Checkout Session Generator (v2)
// ---------------------------------------------------------------------
// Route:  POST /api/stripe-checkout
//
// Hardening:
//   • Authenticated via Supabase JWT — no anonymous checkouts.
//   • Plan + cycle resolved server-side from STRIPE_PRICE_* env vars,
//     so the browser cannot inject arbitrary Stripe Price IDs.
//   • Reuses the customer's stripe_customer_id when known.
//   • Audit logged.
// =====================================================================

const Stripe = require('stripe');
const {
  applyCors, handlePreflight, jsonError, readJsonBody, verifyAuth,
  getServiceClient, recordAudit, clientIp,
} = require('./_lib/auth');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = process.env.SITE_URL || 'https://nova-startupos-ai.vercel.app';

// Server-controlled mapping. Frontend sends only { plan, cycle }.
const PRICE_MAP = {
  pro:     { monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,     yearly: process.env.STRIPE_PRICE_PRO_YEARLY },
  startup: { monthly: process.env.STRIPE_PRICE_STARTUP_MONTHLY, yearly: process.env.STRIPE_PRICE_STARTUP_YEARLY },
};

function planTierFromKey(key) {
  if (key === 'pro') return 'Pro';
  if (key === 'startup') return 'Startup';
  return null;
}

module.exports = async (req, res) => {
  if (handlePreflight(req, res, 'POST, OPTIONS')) return;
  if (req.method !== 'POST') return jsonError(res, 405, 'Method not allowed');
  if (!STRIPE_SECRET_KEY) return jsonError(res, 500, 'Stripe is not configured.');

  const auth = await verifyAuth(req);
  if (!auth) return jsonError(res, 401, 'Authentication required.');
  const { profile } = auth;
  const ip = clientIp(req);

  const body = await readJsonBody(req);
  const plan = String(body.plan || '').toLowerCase();
  const cycle = String(body.cycle || 'monthly').toLowerCase();
  if (!PRICE_MAP[plan]) return jsonError(res, 400, 'Unknown plan.');
  const priceId = PRICE_MAP[plan][cycle];
  if (!priceId) return jsonError(res, 400, `Price ID for ${plan}/${cycle} is not configured on the server.`);

  const planTier = planTierFromKey(plan);

  try {
    const stripe = Stripe(STRIPE_SECRET_KEY);
    const admin = getServiceClient();

    // Reuse an existing Stripe customer for this user if we already have one.
    const { data: subRow } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', profile.id)
      .not('stripe_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const sessionOpts = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: profile.id,
      metadata: {
        supabase_user_id: profile.id,
        plan_tier: planTier,
        billing_cycle: cycle,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: profile.id,
          plan_tier: planTier,
        },
      },
      success_url: SITE_URL + '/?billing=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  SITE_URL + '/?billing=cancelled',
      allow_promotion_codes: true,
    };

    if (subRow && subRow.stripe_customer_id) {
      sessionOpts.customer = subRow.stripe_customer_id;
    } else if (profile.email) {
      sessionOpts.customer_email = profile.email;
    }

    const session = await stripe.checkout.sessions.create(sessionOpts);

    await recordAudit(profile, 'billing.checkout_started', 'subscriptions', session.id,
                      { plan: planTier, cycle }, ip);

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    return jsonError(res, 500, err.message || 'Could not create checkout session.');
  }
};
