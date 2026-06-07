// =====================================================================
// Nova StartupOS AI — Stripe Webhook Handler
// ---------------------------------------------------------------------
// Route:  POST /api/stripe-webhook
//
// Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET,
// then upserts the subscription/payment row and syncs profiles.plan_tier.
//
// Vercel note: we MUST receive the raw body for signature verification.
// We disable the default body parser via the exported `config` and read
// the raw stream ourselves.
// =====================================================================

const Stripe = require('stripe');
const { getServiceClient } = require('./_lib/auth');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET    = process.env.STRIPE_WEBHOOK_SECRET;

module.exports.config = { api: { bodyParser: false } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function planTierFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRICE_PRO_MONTHLY     ||
      priceId === process.env.STRIPE_PRICE_PRO_YEARLY)     return 'Pro';
  if (priceId === process.env.STRIPE_PRICE_STARTUP_MONTHLY ||
      priceId === process.env.STRIPE_PRICE_STARTUP_YEARLY) return 'Startup';
  return null;
}

async function notify(admin, userId, type, title, body, link) {
  if (!userId) return;
  try {
    await admin.from('notifications').insert({ user_id: userId, type, title, body, link });
  } catch (_) { /* swallow */ }
}

async function syncProfileTier(admin, userId, planTier) {
  if (!userId || !planTier) return;
  await admin.from('profiles').update({ plan_tier: planTier }).eq('id', userId);
}

async function upsertSubscription(admin, sub, userIdHint) {
  const userId = userIdHint
    || (sub.metadata && sub.metadata.supabase_user_id)
    || null;
  if (!userId) return null;

  const priceId = sub.items && sub.items.data && sub.items.data[0] ? sub.items.data[0].price.id : null;
  const planTier = planTierFromPriceId(priceId) || 'Pro';

  const row = {
    user_id: userId,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : (sub.customer && sub.customer.id),
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    plan_tier: planTier,
    status: sub.status,
    current_period_start: sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null,
    current_period_end:   sub.current_period_end   ? new Date(sub.current_period_end   * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at:          sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
  };

  await admin.from('subscriptions').upsert(row, { onConflict: 'stripe_subscription_id' });

  // Plan tier on the profile reflects the *active* state.
  if (['active', 'trialing'].includes(sub.status)) {
    await syncProfileTier(admin, userId, planTier);
  } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
    await syncProfileTier(admin, userId, 'Free');
  }

  return { userId, planTier };
}

async function recordPayment(admin, invoice) {
  const userId = invoice.metadata && invoice.metadata.supabase_user_id;
  const fallbackUserId = await (async () => {
    if (userId) return userId;
    if (!invoice.subscription) return null;
    const { data } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_subscription_id', invoice.subscription)
      .maybeSingle();
    return data ? data.user_id : null;
  })();
  if (!fallbackUserId) return;

  const subId = invoice.subscription
    ? (await admin.from('subscriptions').select('id').eq('stripe_subscription_id', invoice.subscription).maybeSingle()).data?.id
    : null;

  await admin.from('payments').upsert({
    user_id: fallbackUserId,
    subscription_id: subId,
    stripe_payment_intent_id: invoice.payment_intent || null,
    stripe_invoice_id: invoice.id,
    amount_cents: invoice.amount_paid || invoice.amount_due || 0,
    currency: invoice.currency || 'usd',
    status: invoice.paid ? 'succeeded' : (invoice.status === 'open' ? 'pending' : 'failed'),
    description: invoice.lines && invoice.lines.data[0] ? invoice.lines.data[0].description : null,
    receipt_url: invoice.hosted_invoice_url || null,
  }, { onConflict: 'stripe_invoice_id' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    res.status(500).json({ error: 'Stripe webhook is not configured.' });
    return;
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let raw, event;
  try {
    raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: 'Webhook signature verification failed: ' + err.message });
  }

  const admin = getServiceClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || (session.metadata && session.metadata.supabase_user_id);
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          const result = await upsertSubscription(admin, sub, userId);
          if (result) {
            await notify(admin, result.userId, 'billing.activated',
                         `${result.planTier} plan activated`, 'Welcome aboard!', '/?section=billing');
          }
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await upsertSubscription(admin, sub);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await recordPayment(admin, invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await recordPayment(admin, invoice);
        const { data: subRow } = await admin
          .from('subscriptions').select('user_id, plan_tier')
          .eq('stripe_subscription_id', invoice.subscription).maybeSingle();
        if (subRow) {
          await notify(admin, subRow.user_id, 'billing.payment_failed',
                       'Payment failed', 'Update your card to keep your plan active.', '/?section=billing');
        }
        break;
      }
      default:
        // Ignore other event types silently.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: 'Webhook handler error: ' + err.message });
  }
};
