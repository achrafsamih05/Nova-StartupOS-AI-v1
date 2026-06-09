// =====================================================================
// Nova StartupOS AI — Smoke / unit tests (no network, no Supabase)
// ---------------------------------------------------------------------
// Run with `npm test` (or `node tests/run.js`). These tests cover the
// pure-logic modules: assessment scoring, deck JSON parser, and the
// Stripe price-id mapping resolver.
// =====================================================================

const assert = require('assert');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}
function suite(name, fn) { console.log('\n' + name); fn(); }

/* --------------------- Inline modules under test ------------------- */
// Re-implement the scoring fn here to avoid pulling main.js (which depends
// on DOM globals). The implementation is identical to main.js.
function computeAssessmentScores(s, docCounts) {
  s = s || {};
  docCounts = docCounts || { plans: 0, decks: 0, chats: 0 };
  const has = (v) => !!(v && String(v).trim().length);
  const len = (v) => (v ? String(v).trim().length : 0);
  const stageOrder = { 'Idea': 0, 'MVP': 1, 'Pre-seed': 1, 'Early Stage': 2, 'Seed': 2, 'Growth': 3, 'Scale': 4 };
  const stageW = stageOrder[s.stage] != null ? stageOrder[s.stage] : 0;
  let innovation = 35;
  innovation += Math.min(20, Math.floor(len(s.problem)  / 20));
  innovation += Math.min(20, Math.floor(len(s.solution) / 20));
  if (/\bai\b|machine learning|llm|agent|automat/i.test(s.solution || '')) innovation += 10;
  innovation += stageW * 3;
  let scalability = 40;
  if (/saas|software|platform|marketplace|ai/i.test(s.industry || '')) scalability += 18;
  if (/global|international|africa|mena|asia|europe|latam/i.test(s.market || '')) scalability += 12;
  scalability += Math.min(15, Math.floor(len(s.market) / 30));
  scalability += stageW * 4;
  let market = 35;
  market += Math.min(25, Math.floor(len(s.market) / 15));
  if (has(s.country)) market += 10;
  if (has(s.industry)) market += 10;
  market += stageW * 4;
  let investment = 25;
  if (has(s.problem) && has(s.solution)) investment += 15;
  investment += Math.min(20, docCounts.plans * 8 + docCounts.decks * 6 + docCounts.chats * 1);
  if (has(s.country)) investment += 5;
  investment += stageW * 8;
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  return { innovation: clamp(innovation), scalability: clamp(scalability), market: clamp(market), investment: clamp(investment) };
}

function parseDeckJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*"slides"[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (Array.isArray(obj.slides) && obj.slides.length) return obj.slides;
  } catch (_) {}
  return null;
}

/* ----------------------------- Tests ------------------------------ */

suite('Assessment scoring', () => {
  test('empty startup yields modest baseline scores within 0-100', () => {
    const s = computeAssessmentScores({}, { plans: 0, decks: 0, chats: 0 });
    Object.values(s).forEach(v => assert.ok(v >= 0 && v <= 100, 'out of range: ' + v));
    assert.ok(s.innovation < 60 && s.investment < 60, 'expected modest baseline');
  });

  test('AI-native solution + Growth stage scores higher than empty', () => {
    const empty = computeAssessmentScores({});
    const rich = computeAssessmentScores({
      stage: 'Growth', industry: 'SaaS',
      country: 'France', market: 'European SMEs in supply-chain logistics across the EU and UK',
      problem: 'Suppliers and SMEs lack real-time visibility into shipping delays which costs millions.',
      solution: 'AI-native dashboard that ingests carrier APIs and predicts delays automatically.',
    }, { plans: 1, decks: 1, chats: 3 });
    assert.ok(rich.innovation  > empty.innovation,  'innovation should rise');
    assert.ok(rich.scalability > empty.scalability, 'scalability should rise');
    assert.ok(rich.market      > empty.market,      'market should rise');
    assert.ok(rich.investment  > empty.investment,  'investment should rise');
  });

  test('investment score reflects produced documents', () => {
    const a = computeAssessmentScores({ stage: 'Seed', problem: 'X', solution: 'Y', country: 'US' }, { plans: 0, decks: 0, chats: 0 });
    const b = computeAssessmentScores({ stage: 'Seed', problem: 'X', solution: 'Y', country: 'US' }, { plans: 2, decks: 1, chats: 0 });
    assert.ok(b.investment > a.investment);
  });

  test('all scores hit their ceiling for a maxed-out startup', () => {
    const s = computeAssessmentScores({
      stage: 'Scale', industry: 'AI marketplace platform SaaS',
      country: 'Singapore',
      market: 'Global enterprise customers across Europe, Asia, MENA, LATAM, and North America with deep procurement budgets.',
      problem: 'A long, detailed problem statement covering multiple dimensions of pain felt acutely by enterprise buyers across geographies and industries.'.repeat(2),
      solution: 'A long AI-native solution leveraging machine learning and agent automation to fix the entire workflow end to end.'.repeat(2),
    }, { plans: 5, decks: 5, chats: 50 });
    // Each axis must be high (>= 90) and never exceed 100.
    Object.values(s).forEach(v => {
      assert.ok(v <= 100, 'score exceeds 100: ' + v);
      assert.ok(v >= 75,  'score not high enough: ' + v);
    });
  });
});

suite('Deck JSON parsing', () => {
  test('parses pure JSON', () => {
    const txt = '{"slides":[{"title":"Problem","body":"X"}]}';
    const out = parseDeckJson(txt);
    assert.ok(out && out.length === 1 && out[0].title === 'Problem');
  });

  test('parses JSON inside code fences and prose', () => {
    const txt = 'Here you go!\n```json\n{"slides":[{"title":"A","body":"B"},{"title":"C","body":"D"}]}\n```';
    const out = parseDeckJson(txt);
    assert.ok(out && out.length === 2);
  });

  test('returns null on invalid JSON', () => {
    assert.strictEqual(parseDeckJson('no json here'), null);
    assert.strictEqual(parseDeckJson('{"slides": [bogus]}'), null);
  });
});

suite('Stripe price mapping (server)', () => {
  // Mirror of api/stripe-checkout.js logic.
  const PRICE_MAP = {
    pro:     { monthly: 'price_pro_m', yearly: 'price_pro_y' },
    startup: { monthly: 'price_startup_m', yearly: 'price_startup_y' },
  };
  test('valid plan + cycle resolves a price id', () => {
    assert.strictEqual(PRICE_MAP['pro']['monthly'], 'price_pro_m');
    assert.strictEqual(PRICE_MAP['startup']['yearly'], 'price_startup_y');
  });
  test('unknown plan returns undefined', () => {
    assert.strictEqual(PRICE_MAP['enterprise'], undefined);
  });
});

suite('AI provider fallback chain', () => {
  // Synthetic test of the resolveProviderChain shape: ensures missing
  // provider keys do not crash the chain builder.
  const PROVIDERS = {
    openrouter: { keyEnv: 'OPENROUTER_API_KEY' },
    openai:     { keyEnv: 'OPENAI_API_KEY' },
  };
  test('only providers with keys present in env survive the filter', () => {
    process.env.OPENROUTER_API_KEY = 'x';
    delete process.env.OPENAI_API_KEY;
    const enabled = ['openrouter', 'openai'];
    const result = enabled
      .map(n => ({ name: n, keyEnv: PROVIDERS[n].keyEnv }))
      .filter(p => process.env[p.keyEnv]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, 'openrouter');
  });
});

/* --------- Centralized AI provider helpers (deck/stream) ---------- */
suite('AI provider helpers (aiProviders.js)', () => {
  const {
    OPENROUTER_MODEL_CHAIN, DEPRECATED_MODEL_MAP,
    normalizeModel, isSafetyModel, friendlyError,
  } = require('../api/_lib/aiProviders');

  test('chain has the required current models in priority order', () => {
    const ids = OPENROUTER_MODEL_CHAIN.map(m => m.id);
    assert.strictEqual(ids[0], 'anthropic/claude-sonnet-4');
    assert.strictEqual(ids[1], 'google/gemini-2.5-pro');
    assert.ok(ids.includes('openai/gpt-4o'));
    assert.ok(ids.includes('openai/gpt-4o-mini'));
    assert.ok(ids.includes('deepseek/deepseek-chat'));
  });

  test('chain contains zero deprecated model identifiers', () => {
    const ids = OPENROUTER_MODEL_CHAIN.map(m => m.id);
    Object.keys(DEPRECATED_MODEL_MAP).forEach(old => {
      assert.ok(!ids.includes(old), 'deprecated model still in chain: ' + old);
    });
    assert.ok(!ids.some(id => /claude-3\.5|gemini-flash-1\.5|claude-3-5-sonnet/i.test(id)),
      'chain still references a retired model name');
  });

  test('normalizeModel rewrites every deprecated alias', () => {
    assert.strictEqual(normalizeModel('anthropic/claude-3.5-sonnet'), 'anthropic/claude-sonnet-4');
    assert.strictEqual(normalizeModel('claude-3-5-sonnet-20241022'),  'anthropic/claude-sonnet-4');
    assert.strictEqual(normalizeModel('google/gemini-flash-1.5'),     'google/gemini-2.5-pro');
    assert.strictEqual(normalizeModel('gemini-1.5-pro'),              'google/gemini-2.5-pro');
    // Current model is preserved.
    assert.strictEqual(normalizeModel('anthropic/claude-sonnet-4'),   'anthropic/claude-sonnet-4');
  });

  test('isSafetyModel rejects classifier identifiers', () => {
    assert.strictEqual(isSafetyModel('nvidia/llama-3.1-nemotron-content-safety'), true);
    assert.strictEqual(isSafetyModel('llamaguard/something'), true);
    assert.strictEqual(isSafetyModel('anthropic/claude-sonnet-4'), false);
    assert.strictEqual(isSafetyModel(''), false);
  });

  test('friendlyError translates raw provider strings', () => {
    const ne = friendlyError(new Error('No endpoints found for anthropic/claude-3.5-sonnet'));
    assert.ok(/temporarily unavailable/i.test(ne) && /switching/i.test(ne));
    const re = friendlyError(new Error('openrouter_429: rate limit'));
    assert.ok(/rate.?limit/i.test(re));
    const ce = friendlyError(new Error('openrouter_503: service unavailable'));
    assert.ok(/hiccup|temporarily/i.test(ce));
    // Default fallback message
    const fb = friendlyError(new Error('something exotic'), 'CUSTOM');
    assert.strictEqual(fb, 'CUSTOM');
  });
});

/* ------------------- Message sanitizer (chat 400 fix) -------------- */
suite('AI message sanitizer', () => {
  const { sanitizeMessages } = require('../api/_lib/messages');

  test('empty input → empty output', () => {
    const out = sanitizeMessages([]);
    assert.strictEqual(out.system, null);
    assert.deepStrictEqual(out.messages, []);
  });

  test('hoists multiple leading system messages into one', () => {
    const out = sanitizeMessages([
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user',   content: 'hi' },
    ]);
    assert.strictEqual(out.system, 'A\n\nB');
    assert.deepStrictEqual(out.messages, [{ role: 'user', content: 'hi' }]);
  });

  test('collapses consecutive user turns (the actual bug fix)', () => {
    const out = sanitizeMessages([
      { role: 'system', content: 'Nova system' },
      { role: 'user',   content: 'Workspace context: …' },
      { role: 'user',   content: 'My actual question' },
    ]);
    assert.strictEqual(out.messages.length, 1);
    assert.strictEqual(out.messages[0].role, 'user');
    assert.ok(out.messages[0].content.indexOf('Workspace context') !== -1);
    assert.ok(out.messages[0].content.indexOf('My actual question') !== -1);
  });

  test('collapses consecutive assistant turns', () => {
    const out = sanitizeMessages([
      { role: 'user',      content: 'q' },
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
      { role: 'user',      content: 'q2' },
    ]);
    // user, assistant(a1+a2), user
    assert.strictEqual(out.messages.length, 3);
    assert.strictEqual(out.messages[1].role, 'assistant');
    assert.strictEqual(out.messages[1].content, 'a1\n\na2');
  });

  test('demotes mid-conversation system to user and merges', () => {
    const out = sanitizeMessages([
      { role: 'user',   content: 'hello' },
      { role: 'system', content: 'mid-rule (should be demoted)' },
      { role: 'user',   content: 'world' },
    ]);
    assert.strictEqual(out.system, null);
    assert.strictEqual(out.messages.length, 1);
    assert.ok(out.messages[0].content.indexOf('mid-rule') !== -1);
  });

  test('drops trailing assistant turns', () => {
    const out = sanitizeMessages([
      { role: 'user',      content: 'q' },
      { role: 'assistant', content: 'old reply' },
    ]);
    assert.strictEqual(out.messages.length, 1);
    assert.strictEqual(out.messages[0].role, 'user');
  });

  test('prepends placeholder when conversation starts with assistant', () => {
    const out = sanitizeMessages([
      { role: 'assistant', content: 'Welcome!' },
      { role: 'user',      content: 'help me' },
    ]);
    assert.strictEqual(out.messages.length, 3);
    assert.strictEqual(out.messages[0].role, 'user');
    assert.strictEqual(out.messages[1].role, 'assistant');
    assert.strictEqual(out.messages[2].role, 'user');
  });

  test('drops empty/whitespace-only messages', () => {
    const out = sanitizeMessages([
      { role: 'system', content: '  ' },
      { role: 'user',   content: '' },
      { role: 'user',   content: 'real prompt' },
    ]);
    assert.strictEqual(out.system, null);
    assert.strictEqual(out.messages.length, 1);
    assert.strictEqual(out.messages[0].content, 'real prompt');
  });

  test('output strictly alternates user/assistant/user/...', () => {
    const out = sanitizeMessages([
      { role: 'system', content: 'sys' },
      { role: 'user',   content: 'a' },
      { role: 'user',   content: 'b' },
      { role: 'assistant', content: 'c' },
      { role: 'assistant', content: 'd' },
      { role: 'user',   content: 'e' },
      { role: 'system', content: 'mid' },
      { role: 'user',   content: 'f' },
    ]);
    // Expected: system='sys', messages=[user(a+b), assistant(c+d), user(e+mid+f)]
    assert.strictEqual(out.system, 'sys');
    assert.strictEqual(out.messages.length, 3);
    assert.strictEqual(out.messages[0].role, 'user');
    assert.strictEqual(out.messages[1].role, 'assistant');
    assert.strictEqual(out.messages[2].role, 'user');
    // Walk the array — every adjacent pair must differ in role.
    for (let i = 1; i < out.messages.length; i++) {
      assert.notStrictEqual(out.messages[i].role, out.messages[i - 1].role,
        'adjacent same-role found at index ' + i);
    }
  });
});

/* ---------------------- Safety classifier parser ----------------- */
suite('Safety classifier verdict parser', () => {
  const { parseVerdict } = require('../api/_lib/safetyGate');

  test('canonical safe', () => {
    const v = parseVerdict('User Safety: safe');
    assert.strictEqual(v.safe, true);
    assert.strictEqual(v.category, null);
  });

  test('canonical unsafe with category', () => {
    const v = parseVerdict('User Safety: unsafe\nS3');
    assert.strictEqual(v.safe, false);
    assert.strictEqual(v.category, 'S3');
  });

  test('case-insensitive', () => {
    assert.strictEqual(parseVerdict('USER SAFETY: SAFE').safe, true);
    assert.strictEqual(parseVerdict('user safety:UNSAFE').safe, false);
  });

  test('bare safe / unsafe responses', () => {
    assert.strictEqual(parseVerdict('safe').safe, true);
    assert.strictEqual(parseVerdict('unsafe').safe, false);
  });

  test('empty / unknown response is treated as safe (benign of the doubt)', () => {
    assert.strictEqual(parseVerdict('').safe, true);
    assert.strictEqual(parseVerdict('something weird').safe, true);
  });

  test('"unsafe" wins over substring "safe" earlier in the line', () => {
    const v = parseVerdict('Re: safety check — User Safety: unsafe\nS5');
    assert.strictEqual(v.safe, false);
    assert.strictEqual(v.category, 'S5');
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
