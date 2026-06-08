/* =====================================================================
   Nova StartupOS AI - Application logic
   Single-page app: landing + founder dashboard sharing one design system.
   No build step required. All modules are modular functions.
   ===================================================================== */

/* ----------------------------- STATE ----------------------------- */
let isDark = true;
let currentUser = null;
let chatHistory = [];

/* ----------------------------- THEME ----------------------------- */
function toggleTheme() {
  isDark = !isDark;
  document.getElementById('htmlRoot').classList.toggle('lm', !isDark);
  const si = document.getElementById('suni'), mi = document.getElementById('mooni');
  if (si) { si.style.display = isDark ? 'none' : 'inline'; mi.style.display = isDark ? 'inline' : 'none'; }
  const dsi = document.getElementById('dbSunI'), dmi = document.getElementById('dbMoonI');
  if (dsi) { dsi.style.display = isDark ? 'none' : 'inline'; dmi.style.display = isDark ? 'inline' : 'none'; }
  const dmtog = document.getElementById('darkModeToggle');
  if (dmtog) dmtog.checked = isDark;
  updateChartColors();
}
document.getElementById('thbtn')?.addEventListener('click', toggleTheme);

/* ----------------------------- NAVBAR ---------------------------- */
window.addEventListener('scroll', () =>
  document.getElementById('nbar')?.classList.toggle('scr', scrollY > 40)
);
let mbOpen = false;
document.getElementById('mbtog')?.addEventListener('click', () => {
  mbOpen = !mbOpen;
  document.getElementById('mbmenu').classList.toggle('open', mbOpen);
  document.getElementById('barIcon').style.display = mbOpen ? 'none' : 'inline';
  document.getElementById('xIcon').style.display = mbOpen ? 'inline' : 'none';
});
document.querySelectorAll('#mbmenu a, #mbmenu button').forEach(el =>
  el.addEventListener('click', () => {
    mbOpen = false;
    document.getElementById('mbmenu').classList.remove('open');
    document.getElementById('barIcon').style.display = 'inline';
    document.getElementById('xIcon').style.display = 'none';
  })
);

/* ----------------------------- REVEAL ---------------------------- */
const rvObs = new IntersectionObserver(
  entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); }),
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
);
document.querySelectorAll('.rv').forEach(el => rvObs.observe(el));

/* --------------------------- VIDEO POPUP ------------------------- */
if (window.jQuery && jQuery.fn.magnificPopup) {
  $('.vidpop').magnificPopup({
    type: 'iframe',
    iframe: { patterns: { youtube: { index: 'youtube.com/', id: 'v=', src: 'https://www.youtube.com/embed/%id%?autoplay=1&rel=0' } } },
    mainClass: 'mfp-fade', removalDelay: 160
  });
}

/* -------------------------- PRICING TOGGLE ----------------------- */
document.getElementById('ptog')?.addEventListener('change', function () {
  const y = this.checked;
  document.getElementById('ptogThumb').style.transform = y ? 'translateX(24px)' : 'translateX(0)';
  document.querySelectorAll('.pv').forEach(el => el.textContent = y ? el.dataset.y : el.dataset.m);
  document.querySelectorAll('.pper').forEach((el, i) => {
    if (i < 3) el.textContent = y ? 'billed yearly' : 'per month, billed monthly';
  });
});

/* --------------------------- AUTH FLOW --------------------------- */
function swTab(t) {
  const isL = t === 'login';
  document.getElementById('fLogin').style.display = isL ? 'block' : 'none';
  document.getElementById('fSignup').style.display = isL ? 'none' : 'block';
  document.getElementById('tabLogin').classList.toggle('on', isL);
  document.getElementById('tabSignup').classList.toggle('on', !isL);
  document.getElementById('loginErr').style.display = 'none';
  document.getElementById('signupErr').style.display = 'none';
}
function showErrLogin(msg) { document.getElementById('loginErrMsg').textContent = msg; document.getElementById('loginErr').style.display = 'block'; }
function showErrSignup(msg) { document.getElementById('signupErrMsg').textContent = msg; document.getElementById('signupErr').style.display = 'block'; }
function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (loading) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Please wait...'; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.html || label; }
}
function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  document.getElementById('loginErr').style.display = 'none';
  if (!email) return showErrLogin('Please enter your email address.');
  if (!pass) return showErrLogin('Please enter your password.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErrLogin('Please enter a valid email address.');
  if (pass.length < 6) return showErrLogin('Password must be at least 6 characters.');
  if (!window.NovaApi || !window.NovaApi.supabase) {
    return showErrLogin('Authentication is not configured. Please contact your administrator.');
  }
  setLoading('loginBtn', true);
  // Real auth only — no demo fallback. Failure is failure.
  NovaApi.login(email, pass)
    .then(user => {
      setLoading('loginBtn', false);
      loginSuccess(Object.assign({ backend: true }, user));
    })
    .catch(err => {
      setLoading('loginBtn', false);
      if (err.status === 403) return showErrLogin(err.message || 'Account disabled.');
      if (err.status === 422 || err.status === 401) return showErrLogin('Invalid email or password.');
      return showErrLogin(err.message || 'Could not sign you in. Please try again.');
    });
}
function doSignup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pass = document.getElementById('signupPass').value;
  document.getElementById('signupErr').style.display = 'none';
  if (!name) return showErrSignup('Please enter your full name.');
  if (!email) return showErrSignup('Please enter your email address.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErrSignup('Please enter a valid email address.');
  if (pass.length < 8) return showErrSignup('Password must be at least 8 characters.');
  if (!window.NovaApi || !window.NovaApi.supabase) {
    return showErrSignup('Authentication is not configured. Please contact your administrator.');
  }
  setLoading('signupBtn', true);
  NovaApi.register({ name, email, password: pass })
    .then(user => {
      setLoading('signupBtn', false);
      // Some Supabase projects require email confirmation — handle gracefully.
      if (!user) {
        showErrSignup('Check your email to confirm your account, then sign in.');
        swTab('login');
        return;
      }
      loginSuccess(Object.assign({ backend: true }, user));
    })
    .catch(err => {
      setLoading('signupBtn', false);
      const msg = err.message || 'Could not create your account.';
      showErrSignup(msg);
    });
}
function quickLogin(provider) {
  if (!window.NovaApi || !window.NovaApi.supabase) {
    return showErrLogin('Authentication is not configured. Please contact your administrator.');
  }
  // Real OAuth — no fake users. Browser is redirected to the provider.
  NovaApi.quickLogin(provider).catch(err => {
    showErrLogin(err.message || 'Could not start ' + provider + ' sign-in.');
  });
}
function loginSuccess(user) {
  // --- Role realignment: support both singular `role` and plural `roles`. ---
  // Backend (Supabase) returns a singular `user.role` ('User'|'Admin'|'Super Admin').
  // The legacy gating system reads `user.roles` (array) and the boolean flags.
  if (user) {
    if (!Array.isArray(user.roles)) user.roles = user.role ? [user.role] : [];
    if (user.role && !user.roles.includes(user.role)) user.roles.push(user.role);
    // Derive boolean flags from role if not already provided by the backend.
    const roleStr = (user.role || user.roles[0] || '').toLowerCase();
    if (user.is_super_admin == null) user.is_super_admin = roleStr === 'super admin';
    if (user.is_admin == null) user.is_admin = roleStr === 'admin' || user.is_super_admin;
  }
  currentUser = user;
  chatHistory = [];
  bootstrap.Offcanvas.getInstance(document.getElementById('lofc'))?.hide();
  const initials = user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('userAvatar', initials); set('userName', user.name); set('userPlan', user.plan);
  set('pdAvatar', initials); set('pdName', user.name); set('pdEmail', user.email);
  set('pdPlan', user.plan); set('pdPlanDetail', user.plan);
  set('greetName', user.name.split(' ')[0]);
  set('settingsAvatar', initials); set('settingsName', user.name); set('settingsEmail', user.email);
  setVal('profileName', user.name); setVal('profileEmail', user.email);
  document.getElementById('landing').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  window.scrollTo(0, 0);
  // Reveal admin areas based on role (backend-provided flags).
  if (window.NovaAdmin) NovaAdmin.applyRole(user);
  // Backend session is the only path. Hydrate, render, surface notifications.
  syncFromBackend().then(() => {
    renderWorkspaceUI(); renderStartupCards(); renderConvListBackend();
    updateAIStatus(); setTimeout(initOverviewChart, 200);
    refreshNotifications();
  });
  renderFunding('all'); renderVisa();
  // first-run onboarding (only if the user has zero startups)
  setTimeout(() => {
    if (localStorage.getItem('nova.onboarded') !== '1' && (!NovaStore.getStartups() || !NovaStore.getStartups().length)) {
      try { NovaWizard.startOnboarding(); } catch (_) {}
    }
  }, 600);
}

/* ---------------- BACKEND DATA SYNC (real API → local store) ---------------- */
let NOVA_BACKEND = false;

// Map a Supabase `startups` row to the legacy frontend/NovaStore shape.
// current_stage → stage, logo_url → logo, startup_score → score.
function mapStartupRow(s) {
  s = s || {};
  return {
    name: s.name,
    industry: s.industry,
    country: s.country,
    stage: s.current_stage || s.stage || 'Idea',
    logo: s.logo_url || s.logo || null,
    score: (s.startup_score != null ? s.startup_score : (s.score != null ? s.score : 0)),
    scores: s.scores || {},
    market: s.target_market || s.market || '',
    problem: s.problem || '',
    solution: s.solution || '',
  };
}

async function syncFromBackend() {
  NOVA_BACKEND = true;
  try {
    NovaStore.reset();
    // Ensure a workspace exists locally (Supabase RLS scopes startups to the user).
    let ws = NovaStore.getActiveWorkspace();
    if (!ws) { ws = NovaStore.createWorkspace({ name: 'My Workspace' }); }
    NovaStore.setActiveWorkspace(ws.id);

    // Fetch startups (RLS-restricted to the logged-in user) and map field names.
    const startups = await NovaApi.getStartups();
    for (const s of startups) {
      const st = NovaStore.createStartup(mapStartupRow(s));
      remoteMap.startups[st.id] = s.id;
    }
  } catch (e) {
    console.warn('Backend sync failed, using local store:', e.message);
    NOVA_BACKEND = false;
    if (!NovaStore.getActiveWorkspace()) NovaStore.createWorkspace({ name: 'My Workspace' });
  }
}
// maps local store ids -> backend ids
const remoteMap = { workspaces: {}, startups: {} };

async function renderConvListBackend() {
  // Conversations are persisted as 'chat' rows in generated_documents; the
  // chat list itself is a local convenience view in NovaStore.
  return renderConvList();
}
async function loadBackendConversation(id) {
  // Backwards-compat hook (no remote conversation store in v2).
  loadConversation(id);
}
function doLogout() {
  currentUser = null; chatHistory = []; NOVA_BACKEND = false;
  if (window.NovaApi) NovaApi.logout();
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('landing').style.display = 'block';
  window.scrollTo(0, 0);
}
// Native layout teardown after a session ends.
function logoutSuccess() {
  currentUser = null; chatHistory = []; NOVA_BACKEND = false;
  const dash = document.getElementById('dashboard');
  const land = document.getElementById('landing');
  if (dash) dash.style.display = 'none';
  if (land) land.style.display = 'block';
  window.scrollTo(0, 0);
}

/* ----------------------- DASHBOARD NAVIGATION -------------------- */
function dbNav(section, btn) {
  document.querySelectorAll('.db-nl').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.db-section').forEach(s => s.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else document.querySelectorAll('.db-nl').forEach(b => {
    const oc = b.getAttribute('onclick');
    if (oc && oc.includes("'" + section + "'")) b.classList.add('active');
  });
  const sec = document.getElementById('sec-' + section);
  if (sec) { sec.classList.add('active'); sec.style.animation = 'fadeIn .4s ease'; }
  document.getElementById('dbSidebar').classList.remove('mob-open');
  document.getElementById('notifDropdown')?.classList.remove('open');
  document.getElementById('profileDropdown')?.classList.remove('open');
  const ch = document.getElementById('profileChevron'); if (ch) ch.style.transform = 'rotate(0deg)';
  if (section === 'overview') setTimeout(initOverviewChart, 100);
  if (section === 'readiness') setTimeout(initReadinessChart, 100);
  if (section === 'analytics') setTimeout(initAnalytics, 100);
  if (section === 'documents') renderDocuments(docFilter);
  if (section === 'billing') renderBilling();
  if (section === 'copilot') { renderConvList(); setTimeout(() => document.getElementById('chatInp')?.focus(), 200); }
  // Admin / super-admin sections load real data from the backend.
  if ((section.startsWith('a-') || section.startsWith('s-')) && window.NovaAdmin) {
    setTimeout(() => NovaAdmin.load(section), 60);
  }
}

/* ----------------------------- CHARTS ---------------------------- */
let ovChartInst = null, raChartInst = null;
function chartColors() {
  return { grid: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)', ticks: isDark ? '#6b6b8a' : '#7878a0' };
}
function initOverviewChart() {
  const ctx = document.getElementById('ovChart');
  if (!ctx) return;
  if (ovChartInst) { ovChartInst.destroy(); ovChartInst = null; }
  const c = ctx.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 280);
  g.addColorStop(0, 'rgba(139,92,246,0.35)'); g.addColorStop(1, 'rgba(59,130,246,0.02)');
  const labels = Array.from({ length: 30 }, (_, i) => `${i + 1}`);
  const data = [48, 50, 52, 51, 55, 57, 58, 60, 61, 63, 62, 64, 66, 65, 67, 69, 70, 71, 70, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82];
  const { grid, ticks } = chartColors();
  ovChartInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Startup Score', data, fill: true, backgroundColor: g, borderColor: '#8b5cf6', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: .42 }] },
    options: {
      responsive: true, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(22,22,42,.95)', titleColor: '#a78bfa', bodyColor: '#a8a8c8', borderColor: 'rgba(139,92,246,.3)', borderWidth: 1, padding: 10, callbacks: { label: c => ' Score: ' + c.parsed.y + '/100' } } },
      scales: { x: { grid: { color: grid }, ticks: { color: ticks, font: { family: 'Space Grotesk', size: 11 }, maxTicksLimit: 10 } }, y: { min: 0, max: 100, grid: { color: grid }, ticks: { color: ticks, font: { family: 'Space Grotesk', size: 11 } } } }
    }
  });
}
function initReadinessChart() {
  const ctx = document.getElementById('raChart');
  if (!ctx) return;
  if (raChartInst) { raChartInst.destroy(); raChartInst = null; }
  const { ticks } = chartColors();
  const get = k => parseInt(document.querySelector(`[data-ra="${k}"]`)?.textContent || 0);
  raChartInst = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Innovation', 'Scalability', 'Market', 'Team', 'Financials', 'Investment'],
      datasets: [{
        label: 'Your Startup',
        data: [get('innovation'), get('scalability'), get('market'), 72, 65, get('investment')],
        fill: true, backgroundColor: 'rgba(139,92,246,0.18)', borderColor: '#8b5cf6', borderWidth: 2,
        pointBackgroundColor: '#8b5cf6', pointRadius: 3
      }]
    },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { r: { suggestedMin: 0, suggestedMax: 100, angleLines: { color: chartColors().grid }, grid: { color: chartColors().grid }, pointLabels: { color: ticks, font: { family: 'Space Grotesk', size: 11 } }, ticks: { display: false, stepSize: 25 } } }
    }
  });
}
function updateChartColors() {
  if (ovChartInst) {
    const { grid, ticks } = chartColors();
    ovChartInst.options.scales.x.grid.color = grid; ovChartInst.options.scales.x.ticks.color = ticks;
    ovChartInst.options.scales.y.grid.color = grid; ovChartInst.options.scales.y.ticks.color = ticks;
    ovChartInst.update();
  }
  if (raChartInst) initReadinessChart();
}

/* ------------------- BUSINESS PLAN GENERATOR --------------------- */
function generatePlan(e) {
  if (e) e.preventDefault();
  const v = id => (document.getElementById(id).value || '').trim();
  const name = v('bpName') || 'Your Startup';
  const industry = v('bpIndustry');
  const country = v('bpCountry') || 'your market';
  const market = v('bpMarket') || 'your target customers';
  const problem = v('bpProblem') || 'an important unmet need';
  const solution = v('bpSolution') || 'an innovative solution';
  setLoading('bpBtn', true);

  // Real AI generation through the secure /api/ai-stream proxy.
  const userPrompt =
    `Write an investor-ready business plan for "${name}", a ${industry || 'tech'} startup in ${country}. ` +
    `Target market: ${market}. Problem: ${problem}. Solution: ${solution}. ` +
    `Use these exact section headings and order: ` +
    `1. Executive Summary  2. Market Analysis  3. Business Model  4. Competitor Analysis  ` +
    `5. SWOT Analysis (Strengths/Weaknesses/Opportunities/Threats as four bullet lists)  ` +
    `6. Marketing Strategy  7. Financial Overview  8. Growth Strategy. ` +
    `Format with clear ## headings and concise paragraphs / bullet points.`;
  const sysCtx = NovaAI.buildSystemPrompt({ startup: { name, industry, country, market, problem, solution } });

  document.getElementById('bpEmpty').style.display = 'none';
  document.getElementById('bpResult').style.display = 'block';
  document.getElementById('bpResultTitle').textContent = name + ' \u2014 Business Plan';
  const sectionsEl = document.getElementById('bpSections');
  sectionsEl.innerHTML = '<div class="doc-section"><div class="d-flex align-items-center gap-2" style="color:var(--tx3)"><span class="spinner-border spinner-border-sm"></span><span>Nova is drafting your plan…</span></div></div>';
  document.getElementById('bpResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

  let acc = '';
  NovaAI.generateStream(
    userPrompt, sysCtx,
    (delta) => { acc += delta; sectionsEl.innerHTML = renderMarkdownSections(acc); },
    (full)  => {
      setLoading('bpBtn', false, '<i class="fa-solid fa-wand-magic-sparkles me-2"></i>Generate Business Plan');
      sectionsEl.innerHTML = renderMarkdownSections(full || acc);
      const st = NovaStore.getActiveStartup();
      if (st) NovaStore.updateStartup(st.id, { name, industry, country, market, problem, solution });
      persistGeneratedDocument('plan', name + ' — Business Plan', sectionsEl.innerHTML);
      novaToast('Business plan generated and saved.');
    },
    (err)   => {
      setLoading('bpBtn', false, '<i class="fa-solid fa-wand-magic-sparkles me-2"></i>Generate Business Plan');
      sectionsEl.innerHTML = '<div class="doc-section" style="color:#f87171"><i class="fa-solid fa-triangle-exclamation me-2"></i>Could not generate plan: ' + escapeHtml(err.message || 'unknown error') + '</div>';
    }
  );
}

// Render simple Markdown headings / lists into the existing doc-section format.
function renderMarkdownSections(md) {
  if (!md) return '';
  const ICONS = {
    'executive summary':  ['fa-star',                '#fbbf24'],
    'market analysis':    ['fa-chart-line',          '#60a5fa'],
    'business model':     ['fa-cubes',               '#a78bfa'],
    'competitor analysis':['fa-chess',               '#f59e0b'],
    'swot analysis':      ['fa-table-cells-large',   '#34d399'],
    'marketing strategy': ['fa-bullhorn',            '#ec4899'],
    'financial overview': ['fa-coins',               '#34d399'],
    'growth strategy':    ['fa-arrow-trend-up',      '#8b5cf6'],
  };
  // Split on H1/H2 headings ("# X" or "## X"). Strip leading numbering ("1. Executive Summary").
  const blocks = md.split(/(^|\n)#{1,3}\s+/).filter(Boolean);
  if (blocks.length < 2) return '<div class="doc-section">' + mdLite(md) + '</div>';
  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    const seg = blocks[i].replace(/^\n/, '');
    const newlineIdx = seg.indexOf('\n');
    if (newlineIdx === -1) continue;
    let heading = seg.slice(0, newlineIdx).replace(/^\d+\.\s*/, '').trim();
    const rest    = seg.slice(newlineIdx + 1).trim();
    if (!heading) continue;
    const key = heading.toLowerCase();
    const meta = ICONS[key] || ['fa-circle-dot', '#a78bfa'];
    out += `<div class="doc-section"><h6><i class="fa-solid ${meta[0]}" style="color:${meta[1]}"></i>${escapeHtml(heading)}</h6>${mdLite(rest)}</div>`;
  }
  return out;
}

// Render a backend-generated plan (real AI or backend fallback).
function renderBackendPlan(name, plan) {
  document.getElementById('bpEmpty').style.display = 'none';
  document.getElementById('bpResult').style.display = 'block';
  document.getElementById('bpResultTitle').textContent = (plan.title || (name + ' — Business Plan'));
  let swot = {};
  try { swot = typeof plan.swot === 'string' ? JSON.parse(plan.swot) : (plan.swot || {}); } catch (e) { swot = {}; }
  const sec = (icon, color, title, body) => `<div class="doc-section"><h6><i class="fa-solid ${icon}" style="color:${color}"></i>${title}</h6>${body}</div>`;
  const p = t => `<p>${escapeHtml(t || '').replace(/\n/g, '<br>')}</p>`;
  const swotList = k => (swot[k] || []).map(x => `<li>${escapeHtml(x)}</li>`).join('') || '<li>—</li>';
  document.getElementById('bpSections').innerHTML =
    sec('fa-star', '#fbbf24', 'Executive Summary', p(plan.executive_summary)) +
    sec('fa-chart-line', '#60a5fa', 'Market Analysis', p(plan.market_analysis)) +
    sec('fa-cubes', '#a78bfa', 'Business Model', p(plan.business_model)) +
    sec('fa-chess', '#f59e0b', 'Competitor Analysis', p(plan.competitor_analysis)) +
    sec('fa-table-cells-large', '#34d399', 'SWOT Analysis', `<div class="swot-grid">
      <div class="swot-box" style="background:rgba(52,211,153,.06)"><h6 style="color:#34d399">Strengths</h6><ul>${swotList('strengths')}</ul></div>
      <div class="swot-box" style="background:rgba(245,158,11,.06)"><h6 style="color:#fbbf24">Weaknesses</h6><ul>${swotList('weaknesses')}</ul></div>
      <div class="swot-box" style="background:rgba(96,165,250,.06)"><h6 style="color:#60a5fa">Opportunities</h6><ul>${swotList('opportunities')}</ul></div>
      <div class="swot-box" style="background:rgba(239,68,68,.06)"><h6 style="color:#f87171">Threats</h6><ul>${swotList('threats')}</ul></div></div>`) +
    sec('fa-bullhorn', '#ec4899', 'Marketing Strategy', p(plan.marketing_strategy)) +
    sec('fa-coins', '#34d399', 'Financial Overview', p(plan.financial_overview)) +
    sec('fa-arrow-trend-up', '#8b5cf6', 'Growth Strategy', p(plan.growth_strategy));
  lastPlanId = plan.id;
  document.getElementById('bpResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  persistGeneratedDocument('plan', (plan.title || (name + ' — Business Plan')), document.getElementById('bpSections').innerHTML);
}

function renderLocalPlan(name, industry, country, market, problem, solution) {
    document.getElementById('bpEmpty').style.display = 'none';
    document.getElementById('bpResult').style.display = 'block';
    document.getElementById('bpResultTitle').textContent = name + ' \u2014 Business Plan';
    document.getElementById('bpSections').innerHTML = `
      <div class="doc-section">
        <h6><i class="fa-solid fa-star" style="color:#fbbf24"></i>Executive Summary</h6>
        <p>${name} is a ${industry} startup based in ${country}, built to solve ${problem.toLowerCase()} ${name} delivers ${solution.toLowerCase()} serving ${market}. With a clear wedge into a growing market and an AI-native approach, ${name} is positioned to capture early demand and scale regionally within 24 months.</p>
      </div>
      <div class="doc-section">
        <h6><i class="fa-solid fa-chart-line" style="color:#60a5fa"></i>Market Analysis</h6>
        <p>The ${industry} sector in ${country} and surrounding regions is expanding as digital adoption accelerates. Target customers (${market}) are currently underserved by legacy alternatives.</p>
        <ul>
          <li>Large and growing addressable market with rising willingness to pay.</li>
          <li>Incumbents are slow, expensive, and not AI-driven.</li>
          <li>Regulatory and cultural fit favors a local-first ${industry} player.</li>
        </ul>
      </div>
      <div class="doc-section">
        <h6><i class="fa-solid fa-cubes" style="color:#a78bfa"></i>Business Model</h6>
        <p>${name} monetizes through a subscription model with usage-based upsells, complemented by partnership revenue.</p>
        <ul>
          <li><strong>Primary:</strong> Monthly/annual SaaS subscription tiers.</li>
          <li><strong>Secondary:</strong> Transaction or usage fees as volume grows.</li>
          <li><strong>Expansion:</strong> Enterprise contracts and ${country} regional partnerships.</li>
        </ul>
      </div>
      <div class="doc-section">
        <h6><i class="fa-solid fa-table-cells-large" style="color:#34d399"></i>SWOT Analysis</h6>
        <div class="swot-grid">
          <div class="swot-box" style="background:rgba(52,211,153,.06)"><h6 style="color:#34d399">Strengths</h6><ul><li>AI-native product</li><li>Strong founder-market fit</li><li>Fast time-to-value</li></ul></div>
          <div class="swot-box" style="background:rgba(245,158,11,.06)"><h6 style="color:#fbbf24">Weaknesses</h6><ul><li>Early-stage brand</li><li>Limited initial capital</li><li>Small team</li></ul></div>
          <div class="swot-box" style="background:rgba(96,165,250,.06)"><h6 style="color:#60a5fa">Opportunities</h6><ul><li>Underserved ${country} market</li><li>Regional expansion</li><li>Platform partnerships</li></ul></div>
          <div class="swot-box" style="background:rgba(239,68,68,.06)"><h6 style="color:#f87171">Threats</h6><ul><li>Incumbent response</li><li>Regulatory shifts</li><li>New AI entrants</li></ul></div>
        </div>
      </div>
      <div class="doc-section">
        <h6><i class="fa-solid fa-arrow-trend-up" style="color:#8b5cf6"></i>Growth Strategy</h6>
        <ul>
          <li><strong>Phase 1 (0\u20136 mo):</strong> Launch in ${country}, onboard design partners, refine product.</li>
          <li><strong>Phase 2 (6\u201318 mo):</strong> Scale acquisition, prove unit economics, raise seed round.</li>
          <li><strong>Phase 3 (18\u201336 mo):</strong> Expand regionally, build enterprise motion, target Series A.</li>
        </ul>
      </div>`;
    document.getElementById('bpResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    lastPlan = { name, industry, country, market, problem, solution, html: document.getElementById('bpSections').innerHTML };
    const st = NovaStore.getActiveStartup();
    if (st) NovaStore.updateStartup(st.id, { name, industry, country, market, problem, solution, plan: lastPlan });
    persistGeneratedDocument('plan', name + ' — Business Plan', document.getElementById('bpSections').innerHTML);
}
let lastPlan = null;
let lastPlanId = null;

/* Persist a generated asset to the generated_documents table, then refresh
   the Documents Center grid. No-op when not connected to the backend. */
function persistGeneratedDocument(docType, title, content) {
  if (!window.NovaApi || !NovaApi.saveDocument) return;
  const startupRemote = remoteMap.startups[NovaStore.raw().activeStartupId] || null;
  NovaApi.saveDocument({ startup_id: startupRemote, doc_type: docType, title, content })
    .then(() => refreshDocumentsCenter())
    .catch(() => {});
}

/* --------------------- PITCH DECK GENERATOR ---------------------- */
const DECK_SLIDES = [
  ['Problem', 'fa-circle-exclamation', 'Customers struggle with a slow, costly, fragmented experience. The pain is frequent, expensive, and growing.'],
  ['Solution', 'fa-lightbulb', 'An AI-native product that removes the friction entirely, delivering value in minutes instead of weeks.'],
  ['Market', 'fa-globe', 'A large and growing addressable market with strong tailwinds from rising digital and AI adoption.'],
  ['Product', 'fa-cube', 'An intuitive platform with AI at the core. Simple to start, powerful as you scale, built mobile-first.'],
  ['Business Model', 'fa-sack-dollar', 'Subscription tiers with usage-based upsells and partnership revenue. Healthy margins, expanding ARPU.'],
  ['Competition', 'fa-chess', 'Legacy incumbents are slow and expensive. Our AI-native approach and local focus are hard to replicate.'],
  ['Traction', 'fa-arrow-trend-up', 'Early pilots, a growing waitlist, and strong week-over-week engagement validate demand.'],
  ['Team', 'fa-users', 'A founding team with deep domain expertise, technical strength, and prior startup experience.'],
  ['Financials', 'fa-chart-column', '3-year projections show a clear path to profitability with improving unit economics at scale.'],
  ['Funding Ask', 'fa-handshake', 'Raising a seed round to accelerate growth, expand the team, and reach the next funding milestone.']
];
async function generateDeck() {
  const startup = (document.getElementById('pdStartup').value || '').trim() || 'Your Startup';
  lastDeckStartup = startup;
  setLoading('pdBtn', true);

  // Show a streaming placeholder so the UI never appears frozen.
  const wrap = document.getElementById('pdResult');
  document.getElementById('pdEmpty').style.display = 'none';
  if (wrap) {
    wrap.style.display = 'grid';
    wrap.innerHTML =
      '<div class="ppt-card"><div class="ppt-frame" style="display:flex;align-items:center;justify-content:center">' +
        '<div style="text-align:center;color:#475569;font-family:Cairo,Tajawal,sans-serif">' +
          '<div class="spinner-border mb-3" style="color:#6366F1"></div>' +
          '<div style="font-weight:700">يقرأ Nova بنية المشروع…</div>' +
          '<div style="font-size:.85rem;margin-top:6px">جارٍ تحليل supabase_schema.sql والمواصفات التقنية</div>' +
        '</div>' +
      '</div></div>';
  }

  try {
    const st = NovaStore.getActiveStartup() || {};
    const res = await NovaApi.generateDeck({
      startupName: startup,
      startup: {
        name: startup,
        industry: st.industry, country: st.country,
        market: st.market, problem: st.problem, solution: st.solution,
        stage: st.stage, score: st.score,
      },
      audience: 'investors',
      locale: 'ar',
    });

    // Server returns { slides: [...], meta: {...} }. Validate the shape
    // before we hand it off to the renderer so a malformed payload can't
    // wipe the dashboard.
    const slides = (res && Array.isArray(res.slides) && res.slides.length)
      ? res.slides
      : null;
    if (!slides) throw new Error('Unexpected response shape — no slides returned.');

    paintDeck(slides);
    persistGeneratedDocument('deck', startup + ' — Pitch Deck', JSON.stringify(slides));
    novaToast('Pitch deck generated by Nova (' + (res.meta && res.meta.provider) + ').');
  } catch (err) {
    if (wrap) wrap.innerHTML = '';
    document.getElementById('pdEmpty').style.display = 'flex';
    if (err && err.status === 429) {
      novaToast('Daily AI quota reached — try again tomorrow.');
    } else if (err && err.status === 503) {
      novaToast('AI provider not configured on the server.');
    } else {
      novaToast('Generation failed: ' + (err.message || 'unknown error'));
    }
  } finally {
    setLoading('pdBtn', false, '<i class="fa-solid fa-wand-magic-sparkles me-2"></i>Generate Deck');
  }
}

// Tolerant JSON extractor — accepts plain JSON, fenced JSON, or prose+JSON.
function parseDeckJson(text) {
  if (!text) return null;
  // Try direct parse first (best case).
  try {
    const direct = JSON.parse(text);
    if (direct && Array.isArray(direct.slides) && direct.slides.length) return direct.slides;
  } catch (_) {}
  // Try the largest {...} substring containing "slides".
  const m = text.match(/\{[\s\S]*"slides"[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (obj && Array.isArray(obj.slides) && obj.slides.length) return obj.slides;
  } catch (_) {}
  return null;
}

// Hard fallback used only if both the AI and the parser return nothing —
// keeps the UI deterministic on flaky upstreams.
function fallbackDeck(name, st) {
  const ind = st && st.industry ? st.industry : 'القطاع التقني';
  return [
    { type: 'cover',    title: name, subtitle: 'عرض تقديمي للمستثمرين • ' + ind },
    { type: 'standard', title: 'المشكلة', content: 'العملاء يعانون من تجربة بطيئة ومجزّأة وعالية التكلفة في ' + ind + '.', bullets: ['متكرّرة ومكلفة', 'تتفاقم مع رقمنة السوق', 'لا توجد حلول محلّية متكاملة'] },
    { type: 'standard', title: 'الحل', content: 'منتج مُمكَّن بالذكاء الاصطناعي يقدّم القيمة خلال دقائق بدل أسابيع.', bullets: ['تجربة سلسة', 'تكامل مفتوح', 'يعمل بصيغة SaaS'] },
    { type: 'standard', title: 'السوق وحجمه', content: 'سوق كبير ومتنامٍ مع رياح رقمية مساعدة وانتشار حلول الذكاء الاصطناعي.', bullets: ['TAM واسع', 'SAM إقليمي قابل للنفاذ', 'SOM واضح في أول 24 شهرًا'] },
    { type: 'standard', title: 'المنتج', content: 'منصّة بسيطة في البداية وقوية عند التوسّع، تركيز على الجوال أولًا.', bullets: ['وحدات متكاملة', 'أتمتة ذكية', 'تحليلات حيّة'] },
    { type: 'standard', title: 'نموذج الأعمال', content: 'اشتراكات شهرية وسنوية مع طبقات استخدام، وإيرادات شراكات.', bullets: ['ARPU متنامٍ', 'هامش صحي', 'معدل احتفاظ مرتفع'] },
    { type: 'standard', title: 'المنافسة والميزة التنافسية', content: 'الحلول التقليدية بطيئة ومكلفة، ميزتنا الذكاء الاصطناعي والفهم المحلي.', bullets: ['AI-native', 'تكامل محلي', 'تجربة موحَّدة'] },
    { type: 'standard', title: 'الجاذبية والمؤشرات', content: 'تجارب أولية واعدة ونمو أسبوعي قوي بالاستخدام والاحتفاظ.', bullets: ['MAU متنامٍ', 'NPS مرتفع', 'قائمة انتظار فعّالة'] },
    { type: 'standard', title: 'الفريق', content: 'فريق مؤسس بخبرة عميقة في القطاع وقدرة هندسية وتجارية مثبتة.', bullets: ['خبرة قطاعية', 'تنفيذ سريع', 'سجل سابق ناجح'] },
    { type: 'standard', title: 'الطلب التمويلي', content: 'نسعى إلى جولة Seed لتسريع النمو وتوسيع الفريق وبلوغ المرحلة التالية.', bullets: ['تطوير المنتج', 'تسويق وتوسّع', 'توظيف رئيسي'] },
  ];
}

let lastDeckStartup = '';
let lastDeckId = null;

// Render the deck into #pdResult using the semantic schema:
//   <div class="slide cover" data-type="cover">
//     <h1 data-element="title">…</h1>
//     <p  data-element="subtitle">…</p>
//   </div>
//   <div class="slide" data-type="standard">
//     <h2 data-element="title">…</h2>
//     <p  data-element="content">…</p>
//     <ul data-element="list"><li>…</li></ul>
//   </div>
function paintDeck(slides) {
  document.getElementById('pdEmpty').style.display = 'none';
  const wrap = document.getElementById('pdResult');
  wrap.style.display = 'grid';
  const total = slides.length;

  wrap.innerHTML = slides.map(function (s, i) {
    const isCover = s.type === 'cover';
    const num = String(i + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0');
    const inner = isCover
      ? (
          '<div class="slide cover" data-type="cover">' +
            '<div class="cover-eyebrow">عرض تقديمي</div>' +
            '<h1 data-element="title">' + escapeHtml(s.title || '') + '</h1>' +
            (s.subtitle ? '<p data-element="subtitle">' + escapeHtml(s.subtitle) + '</p>' : '') +
            '<div class="cover-footer"><span>NOVA STARTUPOS AI</span><span>' + num + '</span></div>' +
          '</div>'
        )
      : (
          '<div class="slide" data-type="standard">' +
            '<h2 data-element="title">' + escapeHtml(s.title || '') + '</h2>' +
            (s.content ? '<p data-element="content">' + escapeHtml(s.content) + '</p>' : '') +
            (Array.isArray(s.bullets) && s.bullets.length
              ? '<ul data-element="list">' + s.bullets.map(b => '<li>' + escapeHtml(b) + '</li>').join('') + '</ul>'
              : '') +
          '</div>'
        );
    const typeBadge = isCover ? 'COVER' : 'SLIDE';
    return (
      '<div class="ppt-card">' +
        '<div class="ppt-frame">' +
          '<span class="ppt-num">' + num + '</span>' +
          inner +
        '</div>' +
        '<div class="ppt-meta">' +
          '<span class="text-truncate" style="max-width:70%">' + escapeHtml(s.title || '') + '</span>' +
          '<span class="ppt-type">' + typeBadge + '</span>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  // Reveal the toolbar and update its meta.
  const toolbar = document.getElementById('pdToolbar');
  if (toolbar) { toolbar.classList.remove('d-none'); toolbar.classList.add('d-flex'); }
  setText('pdSlideCount', String(total));
  setText('pdActiveStartup', lastDeckStartup ? ('· ' + lastDeckStartup) : '');

  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* --------------------- READINESS ASSESSMENT ---------------------- */
// Deterministic, transparent scoring. No randomness, no fake AI.
// Inputs come from the active startup's fields + saved memory + documents.
function computeAssessmentScores(s, docCounts) {
  s = s || {};
  docCounts = docCounts || { plans: 0, decks: 0, chats: 0 };
  const has = (v) => !!(v && String(v).trim().length);
  const len = (v) => (v ? String(v).trim().length : 0);
  // Stage weight mapping. Higher stages indicate further-along execution.
  const stageOrder = { 'Idea': 0, 'MVP': 1, 'Pre-seed': 1, 'Early Stage': 2, 'Seed': 2, 'Growth': 3, 'Scale': 4 };
  const stageW = stageOrder[s.stage] != null ? stageOrder[s.stage] : 0;
  // ---- Innovation (problem clarity, solution depth, AI-native cues) -
  let innovation = 35;
  innovation += Math.min(20, Math.floor(len(s.problem)  / 20));   // up to +20
  innovation += Math.min(20, Math.floor(len(s.solution) / 20));   // up to +20
  if (/\bai\b|machine learning|llm|agent|automat/i.test(s.solution || '')) innovation += 10;
  innovation += stageW * 3;
  // ---- Scalability (industry tailwinds, market scope) ---------------
  let scalability = 40;
  if (/saas|software|platform|marketplace|ai/i.test(s.industry || '')) scalability += 18;
  if (/global|international|africa|mena|asia|europe|latam/i.test(s.market || '')) scalability += 12;
  scalability += Math.min(15, Math.floor(len(s.market) / 30));
  scalability += stageW * 4;
  // ---- Market (target market depth, country) ------------------------
  let market = 35;
  market += Math.min(25, Math.floor(len(s.market) / 15));
  if (has(s.country)) market += 10;
  if (has(s.industry)) market += 10;
  market += stageW * 4;
  // ---- Investment readiness (artifacts produced, completeness) ------
  let investment = 25;
  if (has(s.problem) && has(s.solution)) investment += 15;
  investment += Math.min(20, docCounts.plans * 8 + docCounts.decks * 6 + docCounts.chats * 1);
  if (has(s.country)) investment += 5;
  investment += stageW * 8;

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  return {
    innovation:  clamp(innovation),
    scalability: clamp(scalability),
    market:      clamp(market),
    investment:  clamp(investment),
  };
}

function buildAssessmentRecommendations(s, scores) {
  const out = [];
  if (scores.innovation < 65) out.push({ level: 'warning', area: 'Innovation', text: 'Sharpen the problem statement and clarify what makes your solution AI-native or technically defensible.' });
  if (scores.scalability < 65) out.push({ level: 'info',    area: 'Scalability', text: 'Spell out the unit economics and how the model expands beyond the first city / vertical.' });
  if (scores.market < 65)      out.push({ level: 'info',    area: 'Market',     text: 'Add a TAM / SAM / SOM breakdown and at least three target customer personas.' });
  if (scores.investment < 65)  out.push({ level: 'warning', area: 'Investment', text: 'Generate a business plan and pitch deck — this raises your investment-readiness score immediately.' });
  if (!s.problem || !s.solution) out.push({ level: 'warning', area: 'Foundations', text: 'Fill in the Problem and Solution fields on your startup profile.' });
  if (!out.length) out.push({ level: 'success', area: 'Strong overall', text: 'You\'re investor-ready. Run a final readiness check before booking calls.' });
  return out;
}

async function runAssessment() {
  setLoading('raBtn', true);
  try {
    const sLocal = NovaStore.getActiveStartup();
    const remoteId = sLocal && remoteMap.startups[sLocal.id];
    if (!sLocal || !remoteId) {
      setLoading('raBtn', false, '<i class="fa-solid fa-rotate me-2"></i>Re-run Assessment');
      novaToast('Create or select a startup first.');
      return;
    }
    // Pull document counts to feed the investment readiness signal.
    let docCounts = { plans: 0, decks: 0, chats: 0 };
    try {
      const docs = await NovaApi.getDocuments(remoteId);
      docs.forEach(d => { if (docCounts[d.doc_type + 's'] != null) docCounts[d.doc_type + 's']++; });
    } catch (_) {}

    const scores = computeAssessmentScores(sLocal, docCounts);
    const recs = buildAssessmentRecommendations(sLocal, scores);

    // Paint the cards.
    Object.entries(scores).forEach(([k, val]) => {
      const el = document.querySelector(`[data-ra="${k}"]`);
      if (el) {
        el.textContent = val;
        const bar = el.parentElement.querySelector('.ra-bar span');
        if (bar) bar.style.width = val + '%';
      }
    });
    initReadinessChart();
    renderRecommendations(recs);

    // Persist to assessments + mirror onto startups.startup_score.
    await NovaApi.runAssessment(remoteId, scores, recs, {
      stage: sLocal.stage, industry: sLocal.industry, country: sLocal.country,
      problem_len: (sLocal.problem || '').length, solution_len: (sLocal.solution || '').length,
      docs: docCounts,
    });
    NovaStore.updateStartup(sLocal.id, { score: Math.round((scores.innovation + scores.scalability + scores.market + scores.investment) / 4), scores });
    novaToast('Assessment saved (composite ' + Math.round((scores.innovation + scores.scalability + scores.market + scores.investment) / 4) + '/100).');
  } catch (e) {
    novaToast('Could not run assessment: ' + (e.message || 'unknown error'));
  } finally {
    setLoading('raBtn', false, '<i class="fa-solid fa-rotate me-2"></i>Re-run Assessment');
  }
}
function renderRecommendations(recs) {
  if (!Array.isArray(recs) || !recs.length) return;
  const host = document.querySelector('#sec-readiness .nova-panel:last-child');
  if (!host) return;
  const colors = { warning: ['#fbbf24', 'fa-triangle-exclamation'], info: ['#60a5fa', 'fa-circle-info'], success: ['#34d399', 'fa-circle-check'] };
  const items = recs.map(r => {
    const [c, icon] = colors[r.level] || colors.info;
    return `<div class="reco-item"><span class="reco-ico" style="background:${hex2rgba(c, .12)};color:${c}"><i class="fa-solid ${icon}"></i></span><div><strong>${escapeHtml(r.area || '')}</strong><p>${escapeHtml(r.text || '')}</p></div></div>`;
  }).join('');
  const btn = '<button class="bgrd btn w-100 py-2 mt-2" onclick="dbNav(\'copilot\',document.querySelector(\'[onclick*=copilot]\'))"><i class="fa-solid fa-robot me-2"></i>Ask Copilot how to improve</button>';
  host.innerHTML = '<h6 class="mb-3"><i class="fa-solid fa-list-check me-2" style="color:#34d399"></i>AI Recommendations</h6>' + items + btn;
}
function rnd(n) { return Math.floor(Math.random() * n); }

/* ----------------------- FUNDING ASSISTANT ----------------------- */
// Funding opportunities come exclusively from the funding_sources table.
// Admins manage the catalog; users see (and can save) what's there.
function renderFunding(type) {
  const list = document.getElementById('fundingList');
  if (!list) return;
  list.innerHTML = '<div class="col-12 text-center" style="color:var(--tx3);padding:30px"><span class="spinner-border spinner-border-sm me-2"></span>Loading opportunities…</div>';
  const params = (type && type !== 'all') ? { type } : {};
  NovaApi.funding(params)
    .then(rows => {
      if (!rows.length) {
        list.innerHTML = '<div class="col-12 text-center" style="color:var(--tx3);padding:30px">No opportunities yet — check back soon.</div>';
        return;
      }
      paintFunding(list, rows.map(mapFunding));
    })
    .catch(err => {
      list.innerHTML = '<div class="col-12 text-center" style="color:#f87171;padding:30px">Could not load opportunities: ' + escapeHtml(err.message || 'unknown error') + '</div>';
    });
}
// Map a backend funding_source row to the card shape.
function mapFunding(r) {
  const icons  = { accelerator: 'fa-rocket',  incubator: 'fa-building', grant: 'fa-landmark', vc: 'fa-chart-pie', angel: 'fa-user-tie' };
  const colors = { accelerator: '#fb651e',    incubator: '#6c5ce7',     grant: '#c0392b',     vc: '#2d3436',      angel: '#e17055' };
  const t = (r.type || 'vc').toLowerCase();
  return {
    type: t, id: r.id,
    name: r.name || 'Funding source',
    loc:  r.country || 'Global',
    amt:  r.ticket_size || '—',
    desc: r.description || ('Opportunity in ' + (r.country || 'global market') + '.'),
    match: 80,
    color: colors[t] || '#8b5cf6',
    icon:  icons[t]  || 'fa-briefcase',
  };
}
function paintFunding(list, items) {
  const typeLabel = { accelerator: 'Accelerator', incubator: 'Incubator', grant: 'Grant', vc: 'VC / Angel', angel: 'Angel' };
  if (!items.length) { list.innerHTML = '<div class="col-12 text-center" style="color:var(--tx3);padding:30px">No opportunities match your filter.</div>'; return; }
  list.innerHTML = items.map(f => `
    <div class="col-md-6 col-xl-4">
      <div class="fund-card">
        <div class="d-flex align-items-start gap-3 mb-3">
          <div class="fund-logo" style="background:${hex2rgba(f.color, .14)};color:${f.color}"><i class="fa-solid ${f.icon}"></i></div>
          <div style="flex:1">
            <div class="fw-semibold">${escapeHtml(f.name)}</div>
            <div style="font-size:.76rem;color:var(--tx3)"><i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(f.loc)}</div>
          </div>
          <span class="fund-tag">${typeLabel[f.type] || f.type}</span>
        </div>
        <p style="font-size:.82rem;color:var(--tx2);min-height:54px">${escapeHtml(f.desc)}</p>
        <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:.78rem"><span style="color:var(--tx3)">Funding</span><strong>${escapeHtml(f.amt)}</strong></div>
        <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:.78rem"><span style="color:var(--tx3)">Match</span><strong style="color:#34d399">${f.match}%</strong></div>
        <div class="match-bar mb-3"><span style="width:${f.match}%"></span></div>
        <button class="bgrd btn w-100 py-2" style="font-size:.82rem" onclick="saveFundingOpp(${f.id || 'null'})"><i class="fa-solid fa-bookmark me-1"></i>Save Opportunity</button>
      </div>
    </div>`).join('');
}
function saveFundingOpp(id) {
  if (!id || id === 'null') { novaToast('No opportunity selected.'); return; }
  NovaApi.saveFundingOpportunity(id)
    .then(() => novaToast('Saved to your opportunities.'))
    .catch(e => novaToast('Could not save: ' + (e.message || 'unknown error')));
}
function renderFundingLegacy(type) {
  const list = document.getElementById('fundingList');
  if (!list) return;
  const items = type === 'all' ? FUNDING : FUNDING.filter(f => f.type === type);
  const typeLabel = { accelerator: 'Accelerator', incubator: 'Incubator', grant: 'Grant', vc: 'VC / Angel' };
  list.innerHTML = items.map(f => `
    <div class="col-md-6 col-xl-4">
      <div class="fund-card">
        <div class="d-flex align-items-start gap-3 mb-3">
          <div class="fund-logo" style="background:${hex2rgba(f.color, .14)};color:${f.color}"><i class="fa-solid ${f.icon}"></i></div>
          <div style="flex:1">
            <div class="fw-semibold">${f.name}</div>
            <div style="font-size:.76rem;color:var(--tx3)"><i class="fa-solid fa-location-dot me-1"></i>${f.loc}</div>
          </div>
          <span class="fund-tag">${typeLabel[f.type]}</span>
        </div>
        <p style="font-size:.82rem;color:var(--tx2);min-height:54px">${f.desc}</p>
        <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:.78rem">
          <span style="color:var(--tx3)">Funding</span><strong>${f.amt}</strong>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:.78rem">
          <span style="color:var(--tx3)">Match</span><strong style="color:#34d399">${f.match}%</strong>
        </div>
        <div class="match-bar mb-3"><span style="width:${f.match}%"></span></div>
        <button class="bgrd btn w-100 py-2" style="font-size:.82rem"><i class="fa-solid fa-paper-plane me-1"></i>Apply with Nova</button>
      </div>
    </div>`).join('');
}
function filterFunding(type, btn) {
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  renderFunding(type);
}

/* ------------------------ VISA ASSISTANT ------------------------- */
// Visa programs come exclusively from the visa_programs table.
const COUNTRY_FLAGS = {
  'France': '\u{1F1EB}\u{1F1F7}', 'Estonia': '\u{1F1EA}\u{1F1EA}', 'Canada': '\u{1F1E8}\u{1F1E6}',
  'UAE':    '\u{1F1E6}\u{1F1EA}', 'Portugal':'\u{1F1F5}\u{1F1F9}', 'Singapore':'\u{1F1F8}\u{1F1EC}',
  'Lithuania':'\u{1F1F1}\u{1F1F9}', 'Spain':'\u{1F1EA}\u{1F1F8}',  'Germany':'\u{1F1E9}\u{1F1EA}',
  'United Kingdom':'\u{1F1EC}\u{1F1E7}', 'Netherlands':'\u{1F1F3}\u{1F1F1}',
};
function flagFor(country) { return COUNTRY_FLAGS[country] || '\u{1F30D}'; }

function renderVisa() {
  const cc = document.getElementById('visaCountries');
  const vl = document.getElementById('visaList');
  if (!cc && !vl) return;
  if (cc) cc.innerHTML = '<div class="col-12 text-center" style="color:var(--tx3);padding:24px"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>';
  if (vl) vl.innerHTML = '<div class="col-12 text-center" style="color:var(--tx3);padding:24px"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>';
  NovaApi.visa()
    .then(rows => {
      if (!rows.length) {
        if (cc) cc.innerHTML = '<div class="col-12 text-center" style="color:var(--tx3);padding:24px">No visa programs configured yet.</div>';
        if (vl) vl.innerHTML = '';
        return;
      }
      // Top countries: distinct countries by best fit_score.
      const byCountry = {};
      rows.forEach(r => {
        const score = r.fit_score != null ? r.fit_score : 0;
        if (!byCountry[r.country] || byCountry[r.country].score < score) {
          byCountry[r.country] = { name: r.country, score, note: r.program_name };
        }
      });
      const top = Object.values(byCountry).sort((a,b) => b.score - a.score).slice(0, 4);
      if (cc) cc.innerHTML = top.map(c => `
        <div class="col-6 col-md-3">
          <div class="fund-card text-center">
            <div style="font-size:2rem">${flagFor(c.name)}</div>
            <div class="fw-semibold mt-1">${escapeHtml(c.name)}</div>
            <div style="font-size:.76rem;color:var(--tx2);min-height:48px;margin:6px 0">${escapeHtml(c.note)}</div>
            <span class="bst son"><i class="fa-solid fa-star me-1"></i>${c.score}% fit</span>
          </div>
        </div>`).join('');
      if (vl) vl.innerHTML = rows.map(p => {
        const score = p.fit_score != null ? p.fit_score : 0;
        return `
        <div class="col-md-6 col-xl-4">
          <div class="fund-card">
            <div class="d-flex align-items-start gap-3 mb-3">
              <div class="fund-logo" style="background:var(--bg3);font-size:1.4rem">${flagFor(p.country)}</div>
              <div style="flex:1">
                <div class="fw-semibold">${escapeHtml(p.program_name || '—')}</div>
                <div style="font-size:.76rem;color:var(--tx3)">${escapeHtml(p.country)}</div>
              </div>
            </div>
            <div class="d-flex justify-content-between align-items-center mb-1" style="font-size:.78rem">
              <span style="color:var(--tx3)">Fit</span><strong style="color:#34d399">${score}%</strong>
            </div>
            <div class="match-bar mb-3"><span style="width:${score}%"></span></div>
            <button class="boc btn w-100 py-2" style="font-size:.82rem"><i class="fa-solid fa-circle-info me-1"></i>View Eligibility</button>
          </div>
        </div>`;
      }).join('');
    })
    .catch(err => {
      const msg = '<div class="col-12 text-center" style="color:#f87171;padding:24px">Could not load visas: ' + escapeHtml(err.message || 'unknown error') + '</div>';
      if (cc) cc.innerHTML = msg;
      if (vl) vl.innerHTML = '';
    });
}

/* ----------------------- AI COPILOT (NovaAI) --------------------- */
let activeConvId = null;
let backendConvId = null;
let aiAbort = null;

function ensureConversation() {
  if (!activeConvId) {
    const c = NovaStore.createConversation();
    activeConvId = c.id;
    renderConvList();
  }
  return activeConvId;
}

async function sendChat() {
  const inp = document.getElementById('chatInp');
  const msg = inp.value.trim();
  if (!msg) return;
  inp.value = ''; inp.style.height = 'auto';
  document.getElementById('copilotPrompts')?.style.setProperty('display', 'none');
  const sendBtn = document.getElementById('chatSendBtn');
  sendBtn.disabled = true;

  // All chat traffic goes through the secure /api/ai-stream proxy.
  // No browser-side AI keys, no demo replies.
  appendMsg(msg, 'user');
  const convId = ensureConversation();
  NovaStore.appendMessage(convId, { role: 'user', content: msg });

  const typingId = appendTyping();
  let bubble = null, acc = '';
  const startup = NovaStore.getActiveStartup();
  const memory = startup ? NovaStore.getMemory(startup.id) : [];
  const systemPrompt = NovaAI.buildSystemPrompt({ startup, memory });
  const startupRemote = remoteMap.startups[NovaStore.raw().activeStartupId] || null;
  aiAbort = new AbortController();

  try {
    await NovaAI.generateStream(
      msg, systemPrompt,
      (delta) => {
        if (!bubble) { removeTyping(typingId); bubble = startStreamBubble(); }
        acc += delta; bubble.innerHTML = mdLite(acc); scrollChat();
      },
      (full) => {
        if (!bubble) { removeTyping(typingId); bubble = startStreamBubble(); }
        bubble.classList.remove('stream-caret');
        bubble.innerHTML = mdLite(full || acc || '…');
        NovaStore.appendMessage(convId, { role: 'assistant', content: full || acc });
        renderConvList();
        // Persist transcript
        const transcript = 'User: ' + msg + '\n\nNova: ' + (full || acc);
        NovaApi.saveDocument({
          startup_id: startupRemote, doc_type: 'chat',
          title: msg.slice(0, 48) + (msg.length > 48 ? '…' : ''),
          content: transcript,
        }).then(() => refreshDocumentsCenter()).catch(() => {});
      },
      (err) => {
        removeTyping(typingId);
        appendMsg('Could not reach the AI service: ' + escapeHtml(err && err.message ? err.message : 'unknown error'), 'ai');
      },
      { signal: aiAbort.signal }
    );
  } finally {
    sendBtn.disabled = false;
    aiAbort = null;
  }
}

function startStreamBubble() {
  const body = document.getElementById('chatBody');
  const wrap = document.createElement('div');
  wrap.className = 'd-flex flex-column gap-1';
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  wrap.innerHTML = `<div class="msg msg-ai stream-caret"></div><div class="msg-time" style="align-self:flex-start;padding:0 4px">Nova Copilot &middot; ${time}</div>`;
  body.appendChild(wrap);
  scrollChat();
  return wrap.querySelector('.msg');
}
function scrollChat() { const b = document.getElementById('chatBody'); b.scrollTop = b.scrollHeight; }

function appendMsg(text, role) {
  const body = document.getElementById('chatBody');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const wrap = document.createElement('div');
  wrap.className = 'd-flex flex-column gap-1';
  wrap.innerHTML = `
    <div class="msg msg-${role}" style="animation:fadeIn .3s ease">${role === 'ai' ? mdLite(text) : escapeHtml(text).replace(/\n/g, '<br>')}</div>
    <div class="msg-time" style="align-self:${role === 'ai' ? 'flex-start' : 'flex-end'};padding:0 4px">${role === 'ai' ? 'Nova Copilot' : 'You'} &middot; ${time}</div>`;
  body.appendChild(wrap);
  scrollChat();
}
let typingCounter = 0;
function appendTyping() {
  const id = 'typ-' + (++typingCounter);
  const body = document.getElementById('chatBody');
  const el = document.createElement('div');
  el.id = id; el.className = 'typing-ind';
  el.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  body.appendChild(el); scrollChat();
  return id;
}
function removeTyping(id) { document.getElementById(id)?.remove(); }

function newConversation() {
  const c = NovaStore.createConversation();
  activeConvId = c.id;
  renderChatWelcome();
  renderConvList();
  document.getElementById('chatInp')?.focus();
}
function loadConversation(id) {
  activeConvId = id;
  const conv = NovaStore.getConversation(id);
  const body = document.getElementById('chatBody');
  body.innerHTML = '';
  if (!conv || !conv.messages.length) { renderChatWelcome(); }
  else conv.messages.forEach(m => appendMsg(m.content, m.role === 'assistant' ? 'ai' : 'user'));
  document.getElementById('copilotPrompts')?.style.setProperty('display', conv && conv.messages.length ? 'none' : 'flex');
  renderConvList();
}
function delConversation(id, e) {
  if (e) e.stopPropagation();
  NovaStore.deleteConversation(id);
  if (activeConvId === id) { activeConvId = null; renderChatWelcome(); }
  renderConvList();
}
function renderConvList() {
  const list = document.getElementById('convList');
  if (!list) return;
  const convs = NovaStore.getConversations();
  if (!convs.length) { list.innerHTML = '<div class="conv-empty">No conversations yet</div>'; return; }
  list.innerHTML = convs.map(c => `
    <div class="conv-item ${c.id === activeConvId ? 'on' : ''}" onclick="loadConversation('${c.id}')">
      <i class="fa-regular fa-message" style="font-size:.75rem"></i>
      <span class="conv-title">${escapeHtml(c.title)}</span>
      <button class="conv-del" onclick="delConversation('${c.id}',event)" aria-label="Delete chat"><i class="fa-solid fa-trash" style="font-size:.72rem"></i></button>
    </div>`).join('');
}
function renderChatWelcome() {
  document.getElementById('chatBody').innerHTML = `
    <div class="d-flex flex-column gap-1">
      <div class="msg msg-ai"><i class="fa-solid fa-rocket me-1" style="color:var(--pur)"></i> Hi! I'm Nova, your AI co-founder. What are you building?</div>
      <div class="msg-time" style="align-self:flex-start;padding-left:4px">Nova Copilot &middot; Just now</div>
    </div>`;
  document.getElementById('copilotPrompts')?.style.setProperty('display', 'flex');
}
function clearChat() {
  if (activeConvId) NovaStore.deleteConversation(activeConvId);
  activeConvId = null;
  renderChatWelcome();
  renderConvList();
}
function quickMsg(msg) { document.getElementById('chatInp').value = msg; sendChat(); }
function escapeHtml(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// Tiny markdown: **bold**, line breaks, bullets
function mdLite(t) {
  return escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}
function updateAIStatus() {
  const live = !!(window.NovaApi && NovaApi.supabase);
  const dot = document.getElementById('aiDot'), txt = document.getElementById('aiStatusText'), badge = document.getElementById('aiModeBadge');
  if (dot) dot.style.background = live ? '#34d399' : '#fbbf24';
  if (txt) txt.textContent = live ? 'Live · secure server proxy' : 'Sign in to use AI Copilot';
  if (badge) {
    badge.textContent = live ? 'Live' : 'Off';
    badge.style.background = live ? '#34d399' : '#fbbf24';
    badge.style.color = live ? '#fff' : '#1a1a1a';
  }
}
document.getElementById('chatInp')?.addEventListener('input', function () {
  this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});

/* ----------------------------- SETTINGS -------------------------- */
function saveSettings(e) {
  if (e) e.preventDefault();
  const name = document.getElementById('profileName').value.trim();
  const email = document.getElementById('profileEmail').value.trim();
  if (currentUser) { currentUser.name = name; currentUser.email = email; }
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('userName').textContent = name;
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('settingsName').textContent = name;
  document.getElementById('settingsEmail').textContent = email;
  document.getElementById('settingsAvatar').textContent = initials;
  document.getElementById('greetName').textContent = name.split(' ')[0];
  const btn = e?.target?.closest('button');
  if (btn) { const old = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-check me-2"></i>Saved!'; setTimeout(() => btn.innerHTML = old, 1600); }
  if (window.NovaApi && NovaApi.updateProfile) {
    NovaApi.updateProfile({ name }).then(() => novaToast('Profile saved.')).catch(err => novaToast('Save failed: ' + (err.message || 'unknown error')));
  }
}

/* --------------------------- DROPDOWNS --------------------------- */
function toggleNotif(e) {
  if (e) e.stopPropagation();
  document.getElementById('profileDropdown').classList.remove('open');
  document.getElementById('profileChevron').style.transform = 'rotate(0deg)';
  document.getElementById('notifDropdown').classList.toggle('open');
}
function markAllRead() {
  document.querySelectorAll('.notif-dot:not(.read)').forEach(d => d.classList.add('read'));
  document.querySelectorAll('.notif-unread').forEach(n => n.classList.remove('notif-unread'));
  const uc = document.getElementById('unreadCount');
  if (uc) { uc.textContent = '0 new'; uc.style.background = 'rgba(139,92,246,.1)'; uc.style.color = '#a78bfa'; }
  const badge = document.getElementById('notifBadge'); if (badge) badge.style.display = 'none';
  if (window.NovaApi && NovaApi.markAllNotificationsRead) {
    NovaApi.markAllNotificationsRead().catch(() => {});
  }
}
function toggleProfile(e) {
  if (e) e.stopPropagation();
  document.getElementById('notifDropdown').classList.remove('open');
  const pd = document.getElementById('profileDropdown');
  pd.classList.toggle('open');
  document.getElementById('profileChevron').style.transform = pd.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
}
document.addEventListener('click', (e) => {
  if (!document.getElementById('notifWrap')?.contains(e.target)) document.getElementById('notifDropdown')?.classList.remove('open');
  if (!document.getElementById('profileWrap')?.contains(e.target)) {
    document.getElementById('profileDropdown')?.classList.remove('open');
    const ch = document.getElementById('profileChevron'); if (ch) ch.style.transform = 'rotate(0deg)';
  }
});

/* --------------------------- UTILITIES --------------------------- */
function hex2rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------- LIVE ACTIVITY ------------------------- */
// Real activity from notifications + recent assessments / documents.
async function refreshLiveActivity() {
  const box = document.getElementById('liveActivity');
  if (!box || !window.NovaApi) return;
  const items = [];
  try {
    const notifs = await NovaApi.notifications();
    notifs.slice(0, 5).forEach(n => items.push([
      n.type && /fail|error|down/.test(n.type) ? '#f87171' : '#34d399',
      n.title + (n.body ? ' — ' + n.body : ''),
      n.created_at
    ]));
  } catch (_) {}
  if (!items.length) { box.innerHTML = '<div style="color:var(--tx3);font-size:.78rem">No recent activity yet — it will appear here as you use Nova.</div>'; return; }
  box.innerHTML = items.map(([color, text, when]) => `
    <div style="display:flex;gap:10px;padding:10px;background:var(--bg3);border-radius:10px;font-size:.78rem">
      <span style="width:7px;height:7px;border-radius:50%;background:${color};margin-top:4px;flex-shrink:0"></span>
      <span style="color:var(--tx2)">${escapeHtml(text)}</span>
      <span style="margin-left:auto;color:var(--tx3);white-space:nowrap">${when ? new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
    </div>`).join('');
}
setInterval(refreshLiveActivity, 60000);

/* --------------------------- NOTIFICATIONS ----------------------- */
async function refreshNotifications() {
  if (!window.NovaApi) return;
  try {
    const list = await NovaApi.notifications();
    const unread = list.filter(n => !n.is_read).length;
    const badge = document.getElementById('notifBadge');
    if (badge) {
      if (unread > 0) { badge.textContent = unread; badge.style.display = ''; }
      else { badge.style.display = 'none'; }
    }
    const uc = document.getElementById('unreadCount');
    if (uc) uc.textContent = unread + ' new';
    refreshLiveActivity();
  } catch (_) {}
}

/* =====================================================================
   NOVA v2 WIRING — store, AI, exports, workspaces, analytics, wizard
   ===================================================================== */

/* ------------------------------ TOAST ---------------------------- */
function novaToast(msg) {
  const box = document.getElementById('novaToastBox');
  if (!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(novaToast._t);
  novaToast._t = setTimeout(() => box.classList.remove('show'), 2800);
}
window.novaToast = novaToast;

/* ----------------------------- EXPORTS --------------------------- */
function exportPlan(fmt) {
  const st = NovaStore.getActiveStartup();
  const name = (st && st.name) || 'Startup';
  if (fmt === 'pdf') return NovaExport.exportPDF(name + ' Business Plan');
  const root = document.getElementById('bpSections');
  const sections = [];
  if (root) root.querySelectorAll('.doc-section').forEach(sec => {
    const h = sec.querySelector('h6'); const heading = h ? h.textContent.trim() : 'Section';
    const body = sec.cloneNode(true); const hh = body.querySelector('h6'); if (hh) hh.remove();
    sections.push({ heading, html: body.innerHTML });
  });
  if (!sections.length) return novaToast('Generate a business plan first.');
  NovaExport.exportDOCX(name.replace(/\s+/g, '-').toLowerCase() + '-business-plan', name + ' — Business Plan', sections);
}
function exportDeck(fmt) {
  const name = lastDeckStartup || (NovaStore.getActiveStartup() && NovaStore.getActiveStartup().name) || 'Startup';
  if (fmt === 'pdf') return NovaExport.exportPDF(name + ' Pitch Deck');

  // PPTX → use the dedicated NovaPpt exporter that reads the semantic
  // schema (.slide[data-type="cover|standard"] with [data-element]).
  if (fmt === 'pptx') {
    if (!window.NovaPpt) return novaToast('Export engine not loaded yet — try again in a moment.');
    const slides = NovaPpt.parseSlides('#pdResult');
    if (!slides.length) return novaToast('Generate a pitch deck first.');
    const fileName = name.replace(/\s+/g, '-').toLowerCase() + '-pitch-deck';
    const btn = document.getElementById('pdExportPptxBtn');
    if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Exporting…'; }
    return NovaPpt.exportDeck({ slides, fileName, title: name + ' — Pitch Deck', author: name })
      .then(() => novaToast('PowerPoint deck exported.'))
      .catch(e => novaToast('Export failed: ' + (e.message || 'unknown error')))
      .finally(() => { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.html || 'Export PPTX'; } });
  }

  // Legacy fallback: HTML deck via NovaExport.
  const wrap = document.getElementById('pdResult');
  const slides = [];
  if (wrap) wrap.querySelectorAll('.slide[data-type]').forEach(d => {
    const t = d.querySelector('[data-element="title"]');
    const p = d.querySelector('[data-element="content"], [data-element="subtitle"]');
    slides.push({ title: t ? t.textContent.trim() : 'Slide', body: p ? p.textContent.trim() : '' });
  });
  if (!slides.length) return novaToast('Generate a pitch deck first.');
  NovaExport.exportPPTX(name.replace(/\s+/g, '-').toLowerCase() + '-pitch-deck', name + ' — Pitch Deck', slides);
}

/* --------------------------- WORKSPACES -------------------------- */
function renderWorkspaceUI() {
  const ws = NovaStore.getActiveWorkspace();
  const startups = NovaStore.getStartups(ws ? ws.id : null);
  const nameEl = document.getElementById('wsName'); if (nameEl && ws) nameEl.textContent = ws.name;
  const metaEl = document.getElementById('wsMeta'); if (metaEl) metaEl.textContent = startups.length + ' startup' + (startups.length === 1 ? '' : 's');
  const count = document.getElementById('navStartupCount'); if (count) count.textContent = startups.length;
  // workspace menu
  const menu = document.getElementById('wsMenu');
  if (menu) {
    const all = NovaStore.getWorkspaces();
    menu.innerHTML = all.map(w => `<button onclick="switchWorkspace('${w.id}',event)"><i class="fa-solid fa-briefcase"></i>${escapeHtml(w.name)}</button>`).join('') +
      `<button onclick="addWorkspace(event)" style="color:#a78bfa"><i class="fa-solid fa-plus"></i>New workspace</button>`;
  }
}
function toggleWsMenu(e) { if (e) e.stopPropagation(); document.getElementById('wsMenu').classList.toggle('open'); }
function switchWorkspace(id, e) {
  if (e) e.stopPropagation();
  NovaStore.setActiveWorkspace(id);
  document.getElementById('wsMenu').classList.remove('open');
  renderWorkspaceUI(); renderStartupCards();
  novaToast('Switched workspace.');
}
function addWorkspace(e) {
  if (e) e.stopPropagation();
  const name = prompt('New workspace name:');
  if (name) { NovaStore.createWorkspace({ name }); renderWorkspaceUI(); novaToast('Workspace created.'); }
  document.getElementById('wsMenu').classList.remove('open');
}
document.addEventListener('click', e => {
  if (!document.getElementById('wsSwitcher')?.contains(e.target)) document.getElementById('wsMenu')?.classList.remove('open');
});

/* -------------------------- STARTUP CARDS ------------------------ */
function renderStartupCards() {
  const ws = NovaStore.getActiveWorkspace();
  const startups = NovaStore.getStartups(ws ? ws.id : null);
  const grid = document.getElementById('startupGrid');
  // refresh deck/plan startup selectors
  const sel = document.getElementById('pdStartup');
  if (sel && startups.length) sel.innerHTML = startups.map(s => `<option>${escapeHtml(s.name)}</option>`).join('');
  if (!grid) return;
  const tile = `
    <div class="col-md-6 col-xl-4">
      <button class="quick-action w-100 h-100 d-flex flex-column align-items-center justify-content-center" style="min-height:220px" onclick="NovaWizard.startWizard()">
        <div class="qa-ico" style="background:rgba(139,92,246,.15);color:#a78bfa"><i class="fa-solid fa-plus"></i></div>
        <div class="fw-semibold">Start a New Startup</div>
        <div style="font-size:.78rem;color:var(--tx3)">Describe your idea and let AI build it</div>
      </button>
    </div>`;
  if (!startups.length) { grid.innerHTML = tile; return; }
  const stageColor = s => s.score >= 75 ? ['son', '#34d399'] : s.score >= 50 ? ['', '#fbbf24'] : ['', '#f87171'];
  grid.innerHTML = startups.map(s => {
    const [cls, col] = stageColor(s);
    return `
    <div class="col-md-6 col-xl-4">
      <div class="agent-card h-100">
        <div class="d-flex align-items-start gap-3 mb-3">
          <div style="width:46px;height:46px;border-radius:14px;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${s.logo ? `<img src="${escapeHtml(s.logo)}" alt="${escapeHtml(s.name)}" style="width:100%;height:100%;object-fit:cover">` : '<i class="fa-solid fa-rocket" style="color:#a78bfa"></i>'}</div>
          <div style="flex:1"><div class="fw-semibold">${escapeHtml(s.name)}</div><div style="font-size:.78rem;color:var(--tx3)">${escapeHtml(s.industry)} &middot; ${escapeHtml(s.stage)}</div></div>
          <span class="bst ${cls}" ${cls ? '' : 'style="background:' + hex2rgba(col, .14) + ';color:' + col + '"'}>Score ${s.score}</span>
        </div>
        <p style="font-size:.82rem;color:var(--tx2);min-height:40px">${escapeHtml(s.problem || 'No description yet.')}</p>
        <div class="d-flex gap-2">
          <button class="boc btn flex-fill py-2" style="font-size:.82rem" onclick="openStartup('${s.id}','plans')"><i class="fa-solid fa-file-lines me-1"></i>Plan</button>
          <button class="bgrd btn flex-fill py-2" style="font-size:.82rem" onclick="openStartup('${s.id}','readiness')"><i class="fa-solid fa-gauge me-1"></i>Assess</button>
          <button class="boc btn py-2 px-2" style="font-size:.82rem" title="Edit startup" onclick="editStartup('${s.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="boc btn py-2 px-2" style="font-size:.82rem;color:#f87171;border-color:rgba(248,113,113,.3)" title="Delete startup" onclick="removeStartup('${s.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('') + tile;
}
function openStartup(id, section) {
  NovaStore.setActiveStartup(id);
  const s = NovaStore.getStartup(id);
  // prefill business plan form
  if (s) {
    setVal('bpName', s.name); setVal('bpCountry', s.country); setVal('bpMarket', s.market);
    setVal('bpProblem', s.problem); setVal('bpSolution', s.solution);
    const ind = document.getElementById('bpIndustry'); if (ind && s.industry) ind.value = s.industry;
  }
  dbNav(section || 'plans', document.querySelector(`[onclick*=${section || 'plans'}]`));
}
function setVal(id, v) { const e = document.getElementById(id); if (e != null && v != null) e.value = v; }
function setText(id, t) { const e = document.getElementById(id); if (e) e.textContent = t; }

/* ---------------------------- ANALYTICS -------------------------- */
let anBar = null, anStage = null;
function initAnalytics() {
  const ws = NovaStore.getActiveWorkspace();
  const startups = NovaStore.getStartups(ws ? ws.id : null);
  const convs = NovaStore.getConversations();
  const docs = startups.reduce((n, s) => n + (s.plan ? 1 : 0) + (s.deck ? 1 : 0), 0);
  const avg = startups.length ? Math.round(startups.reduce((n, s) => n + (s.score || 0), 0) / startups.length) : 0;
  setText('anStartups', startups.length); setText('anAvgScore', avg);
  setText('anDocs', docs); setText('anChats', convs.length);
  // bar chart
  const { grid, ticks } = chartColors();
  const labels = startups.map(s => s.name);
  const data = startups.map(s => s.score || 0);
  if (anBar) anBar.destroy();
  const barCtx = document.getElementById('anBarChart');
  if (barCtx) anBar = new Chart(barCtx, {
    type: 'bar',
    data: { labels: labels.length ? labels : ['No startups'], datasets: [{ label: 'Readiness', data: data.length ? data : [0], backgroundColor: '#8b5cf6', borderRadius: 6 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: ticks, font: { family: 'Space Grotesk' } } }, y: { min: 0, max: 100, grid: { color: grid }, ticks: { color: ticks } } } }
  });
  // stage doughnut
  const stages = {};
  startups.forEach(s => { stages[s.stage] = (stages[s.stage] || 0) + 1; });
  if (anStage) anStage.destroy();
  const stCtx = document.getElementById('anStageChart');
  if (stCtx) anStage = new Chart(stCtx, {
    type: 'doughnut',
    data: { labels: Object.keys(stages).length ? Object.keys(stages) : ['None'], datasets: [{ data: Object.keys(stages).length ? Object.values(stages) : [1], backgroundColor: ['#8b5cf6', '#3b82f6', '#34d399', '#fbbf24', '#f87171', '#60a5fa'] }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: ticks, font: { family: 'Space Grotesk' } } } }, cutout: '62%' }
  });
  // funnel
  const funnel = [
    ['Ideas', startups.length, '#8b5cf6'],
    ['Plans', startups.filter(s => s.plan).length, '#60a5fa'],
    ['Decks', startups.filter(s => s.deck).length, '#fbbf24'],
    ['Investment-ready', startups.filter(s => (s.score || 0) >= 75).length, '#34d399']
  ];
  const fEl = document.getElementById('anFunnel');
  if (fEl) fEl.innerHTML = funnel.map(f => `
    <div class="col-6 col-md-3"><div class="db-stat-card"><div class="db-stat-val" style="color:${f[2]}">${f[1]}</div><div class="db-stat-lbl">${f[0]}</div></div></div>`).join('');
}

/* --------------------------- SETTINGS / AI ----------------------- */
function hydrateSettings() {
  const s = NovaStore.getSettings();
  // Browser-side AI key field is deprecated. If the field exists we
  // disable it and surface a server-managed message, but never read/write.
  const key = document.getElementById('setApiKey');
  if (key) {
    key.value = '';
    key.placeholder = 'Managed by your administrator (server-side).';
    key.disabled = true;
    key.setAttribute('aria-disabled', 'true');
  }
  const demo = document.getElementById('setDemoMode'); if (demo) { demo.checked = false; demo.disabled = true; }
  const sel = document.getElementById('setModel');
  if (sel) {
    sel.innerHTML = NovaAI.MODELS.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
    sel.value = s.model || NovaAI.MODELS[0].id;
  }
  isDark = s.theme !== 'light';
  document.getElementById('htmlRoot').classList.toggle('lm', !isDark);
}
function onDemoToggle() { /* deprecated — server-managed */ }
function saveAISettings(e) {
  if (e) e.preventDefault();
  const sel = document.getElementById('setModel');
  const model = sel ? sel.value : '';
  // Only the model preference is local. Provider keys are server-managed.
  NovaStore.updateSettings({ model, demoMode: false, apiKey: '' });
  updateAIStatus();
  novaToast('Saved. Provider keys are managed server-side.');
}
async function testAI(e) {
  if (e) e.preventDefault();
  const out = document.getElementById('aiTestResult');
  if (!out) return;
  out.innerHTML = '<span style="color:var(--tx3)"><span class="spinner-border spinner-border-sm me-1"></span>Testing…</span>';
  try {
    const reply = await NovaAI.chat([{ role: 'user', content: 'Reply with exactly: Nova online.' }], {});
    out.innerHTML = '<span style="color:#34d399"><i class="fa-solid fa-circle-check me-1"></i>Live: ' + escapeHtml((reply || '').slice(0, 80)) + '</span>';
  } catch (err) {
    out.innerHTML = '<span style="color:#f87171"><i class="fa-solid fa-circle-xmark me-1"></i>' + escapeHtml(err.message || 'Test failed.') + '</span>';
  }
  updateAIStatus();
}

/* ----------------------------- DATA ------------------------------ */
function exportData() {
  const blob = new Blob([JSON.stringify(NovaStore.raw(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nova-data.json';
  document.body.appendChild(a); a.click(); a.remove();
  novaToast('Data exported.');
}
function resetData() {
  if (!confirm('This will erase all workspaces, startups, and chats on this device. Continue?')) return;
  NovaStore.reset(); localStorage.removeItem('nova.onboarded');
  novaToast('All data reset.');
  setTimeout(() => location.reload(), 600);
}
function loadDemoData() {
  let ws = NovaStore.getActiveWorkspace();
  if (!ws) ws = NovaStore.createWorkspace({ name: 'Demo Workspace' });
  const demos = [
    { name: 'FlowHealth', industry: 'HealthTech', country: 'Lithuania', market: 'Clinics & patients in the Baltics', problem: 'Patients wait too long to reach the right care.', solution: 'An AI triage assistant that routes patients instantly.', stage: 'Seed', score: 82, scores: { innovation: 85, scalability: 78, market: 80, investment: 74 } },
    { name: 'Dabba Logistics', industry: 'Logistics', country: 'Morocco', market: 'SMEs needing last-mile delivery', problem: 'Last-mile delivery is fragmented and unreliable.', solution: 'On-demand delivery network with local payments.', stage: 'Pre-seed', score: 67, scores: { innovation: 70, scalability: 72, market: 68, investment: 58 } },
    { name: 'GridSense', industry: 'CleanTech', country: 'Estonia', market: 'Utilities & energy providers', problem: 'Energy grids waste power without predictive control.', solution: 'AI-driven smart grid optimization.', stage: 'Idea', score: 41, scores: { innovation: 60, scalability: 55, market: 45, investment: 30 } }
  ];
  demos.forEach(d => {
    const s = NovaStore.createStartup(Object.assign({ workspaceId: ws.id }, d));
    NovaStore.addMemory(s.id, 'Problem: ' + d.problem);
    NovaStore.addMemory(s.id, 'Solution: ' + d.solution);
  });
  // a couple of demo conversations
  const c1 = NovaStore.createConversation('Help me prepare for investors');
  NovaStore.appendMessage(c1.id, { role: 'user', content: 'Help me prepare for investors' });
  NovaStore.appendMessage(c1.id, { role: 'assistant', content: 'Start with your Readiness Assessment, then generate a 10-slide deck and add 3-year financials. I can match you with accelerators next.' });
  renderWorkspaceUI(); renderStartupCards(); renderConvList();
  novaToast('Demo data loaded — 3 startups added.');
}

/* --------------------- ONBOARDING / WIZARD HOOKS ----------------- */
window.onOnboardingComplete = function () {
  renderWorkspaceUI();
  novaToast('Welcome aboard! Let\'s create your first startup.');
  setTimeout(() => NovaWizard.startWizard(), 500);
};
window.onStartupCreated = function (startup) {
  renderWorkspaceUI(); renderStartupCards();
  novaToast('Startup "' + startup.name + '" created.');
  // Persist to Supabase. Backend session is mandatory in v2.
  if (window.NovaApi) {
    NovaApi.createStartup({
      name: startup.name, industry: startup.industry, country: startup.country,
      current_stage: startup.stage, logoFile: window._wzLogoFile || null,
    }).then(s => {
      remoteMap.startups[startup.id] = s.id;
      NovaStore.updateStartup(startup.id, mapStartupRow(s));
      window._wzLogoFile = null; window._wzLogoData = null;
      renderWorkspaceUI(); renderStartupCards();
    }).catch(e => novaToast('Backend create failed: ' + (e.message || 'unknown error')));
  }
  openStartup(startup.id, 'plans');
};

/* ===================== DOCUMENTS CENTER ========================== */
let docFilter = 'all';
function filterDocuments(type, btn) {
  docFilter = type;
  document.querySelectorAll('#sec-documents .filter-pill').forEach(p => p.classList.remove('on'));
  if (btn) btn.classList.add('on');
  renderDocuments(type);
}
function buildDocList() {
  const ws = NovaStore.getActiveWorkspace();
  const startups = NovaStore.getStartups(ws ? ws.id : null);
  const docs = [];
  startups.forEach(s => {
    if (s.plan) docs.push({ type: 'plan', startupId: s.id, name: (s.plan.name || s.name) + ' — Business Plan', startup: s.name, updated: s.updatedAt || s.createdAt });
    if (s.deck) docs.push({ type: 'deck', startupId: s.id, name: s.name + ' — Pitch Deck', startup: s.name, updated: s.updatedAt || s.createdAt });
  });
  return docs;
}
function renderDocuments(type) {
  type = type || 'all';
  const grid = document.getElementById('docsGrid');
  const empty = document.getElementById('docsEmpty');
  if (!grid || !empty) return;
  if (window.NovaApi && NovaApi.getDocuments) {
    NovaApi.getDocuments().then(rows => paintBackendDocuments(rows, type))
      .catch(e => { grid.style.display = 'none'; empty.style.display = 'flex'; novaToast('Could not load documents: ' + (e.message || 'unknown error')); });
    return;
  }
  paintLocalDocuments(type);
}
// Re-render the Documents Center grid (used after a new doc is saved).
function refreshDocumentsCenter() {
  if (document.getElementById('docsGrid')) renderDocuments(docFilter);
}
const DOC_META = {
  plan: { ico: 'fa-file-lines', color: '#a78bfa', bg: 'rgba(139,92,246,.14)', label: 'Business Plan' },
  deck: { ico: 'fa-chalkboard-user', color: '#fbbf24', bg: 'rgba(245,158,11,.14)', label: 'Pitch Deck' },
  chat: { ico: 'fa-robot', color: '#34d399', bg: 'rgba(52,211,153,.14)', label: 'Copilot Chat' }
};
function paintBackendDocuments(rows, type) {
  const grid = document.getElementById('docsGrid');
  const empty = document.getElementById('docsEmpty');
  let docs = (rows || []).map(r => ({ id: r.id, type: r.doc_type, name: r.title || (DOC_META[r.doc_type] || {}).label || 'Document', updated: r.created_at, backend: true }));
  if (type !== 'all') docs = docs.filter(d => d.type === type);
  if (!docs.length) { grid.style.display = 'none'; empty.style.display = 'flex'; return; }
  empty.style.display = 'none'; grid.style.display = 'flex';
  grid.innerHTML = docs.map(d => {
    const m = DOC_META[d.type] || { ico: 'fa-file', color: '#60a5fa', bg: 'rgba(96,165,250,.14)', label: d.type };
    const when = d.updated ? new Date(d.updated).toLocaleDateString() : '—';
    return `
    <div class="col-md-6 col-xl-4">
      <div class="fund-card h-100">
        <div class="d-flex align-items-start gap-3 mb-3">
          <div class="fund-logo" style="background:${m.bg};color:${m.color}"><i class="fa-solid ${m.ico}"></i></div>
          <div style="flex:1">
            <div class="fw-semibold" style="font-size:.9rem">${escapeHtml(d.name)}</div>
            <div style="font-size:.76rem;color:var(--tx3)"><i class="fa-regular fa-clock me-1"></i>${when}</div>
          </div>
          <span class="fund-tag">${m.label}</span>
        </div>
        <div class="d-flex gap-2">
          <button class="boc btn py-2 px-2" style="font-size:.8rem;margin-left:auto;color:#f87171;border-color:rgba(248,113,113,.3)" title="Delete" onclick="deleteBackendDocument('${d.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function deleteBackendDocument(id) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  NovaApi.deleteDocument(id).then(() => { refreshDocumentsCenter(); novaToast('Document deleted.'); })
    .catch(e => novaToast('Delete failed: ' + e.message));
}
function paintLocalDocuments(type) {
  const grid = document.getElementById('docsGrid');
  const empty = document.getElementById('docsEmpty');
  let docs = buildDocList();
  if (type !== 'all') docs = docs.filter(d => d.type === type);
  if (!docs.length) { grid.style.display = 'none'; empty.style.display = 'flex'; return; }
  empty.style.display = 'none'; grid.style.display = 'flex';
  const meta = DOC_META;
  grid.innerHTML = docs.map(d => {
    const m = meta[d.type];
    const when = d.updated ? new Date(d.updated).toLocaleDateString() : '—';
    return `
    <div class="col-md-6 col-xl-4">
      <div class="fund-card h-100">
        <div class="d-flex align-items-start gap-3 mb-3">
          <div class="fund-logo" style="background:${m.bg};color:${m.color}"><i class="fa-solid ${m.ico}"></i></div>
          <div style="flex:1">
            <div class="fw-semibold" style="font-size:.9rem">${escapeHtml(d.name)}</div>
            <div style="font-size:.76rem;color:var(--tx3)"><i class="fa-regular fa-clock me-1"></i>${when}</div>
          </div>
          <span class="fund-tag">${m.label}</span>
        </div>
        <div class="d-flex gap-2">
          <button class="boc btn flex-fill py-2" style="font-size:.8rem" title="View" onclick="viewDocument('${d.startupId}','${d.type}')"><i class="fa-solid fa-eye me-1"></i>View</button>
          <button class="boc btn py-2 px-2" style="font-size:.8rem" title="Download" onclick="downloadDocument('${d.startupId}','${d.type}')"><i class="fa-solid fa-download"></i></button>
          <button class="boc btn py-2 px-2" style="font-size:.8rem;color:#f87171;border-color:rgba(248,113,113,.3)" title="Delete" onclick="deleteDocument('${d.startupId}','${d.type}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function viewDocument(startupId, type) {
  NovaStore.setActiveStartup(startupId);
  if (type === 'plan') { openStartup(startupId, 'plans'); const s = NovaStore.getStartup(startupId); if (s && s.plan) renderLocalPlan(s.plan.name || s.name, s.plan.industry || s.industry, s.plan.country || s.country, s.plan.market || s.market, s.plan.problem || s.problem, s.plan.solution || s.solution); }
  else { dbNav('decks', document.querySelector('[onclick*=decks]')); paintDeck(DECK_SLIDES); }
}
function downloadDocument(startupId, type) {
  NovaStore.setActiveStartup(startupId);
  if (type === 'plan') exportPlan('pdf'); else { lastDeckStartup = (NovaStore.getStartup(startupId) || {}).name || 'Startup'; exportDeck('pdf'); }
}
function deleteDocument(startupId, type) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  NovaStore.updateStartup(startupId, type === 'plan' ? { plan: null } : { deck: null });
  renderDocuments(docFilter);
  novaToast('Document deleted.');
}

/* ===================== BILLING & UPGRADES ======================== */
const BILLING_PLANS = [
  { id: 'free',    name: 'Free',    price: 0,  yearly: 0,  blurb: 'Validate your idea and explore Nova.',          features: ['1 startup workspace', '1 AI business plan', 'Readiness score', 'Basic Copilot'] },
  { id: 'pro',     name: 'Pro',     price: 39, yearly: 27, blurb: 'For founders actively building & raising.',     features: ['Unlimited business plans', 'Unlimited pitch decks', 'Full assessments', 'Funding & visa matching', 'Unlimited Copilot'], popular: true },
  { id: 'startup', name: 'Startup', price: 99, yearly: 69, blurb: 'For teams scaling toward a round.',             features: ['Everything in Pro', 'Up to 5 team seats', 'Investor-ready exports', 'Priority funding intros', 'Success manager'] }
];

async function renderBilling() {
  const currentPlan = (currentUser && currentUser.plan_tier) ? String(currentUser.plan_tier).toLowerCase() : 'free';

  // History row template (filled in once payments load).
  const t = document.getElementById('billingHistoryTable');
  if (t) t.innerHTML = '<thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody><tr><td colspan="5" style="text-align:center;color:var(--tx3);padding:18px"><span class="spinner-border spinner-border-sm me-2"></span>Loading…</td></tr></tbody>';

  // Upgrade grid (always renders immediately).
  const grid = document.getElementById('billingUpgradeGrid');
  if (grid) grid.innerHTML = BILLING_PLANS.map(p => {
    const isCurrent = p.id === currentPlan;
    return `
    <div class="col-md-4">
      <div class="nova-panel h-100" style="${p.popular ? 'border-color:rgba(139,92,246,.4)' : ''};position:relative">
        ${p.popular ? '<span class="bst son" style="position:absolute;top:14px;right:14px"><i class="fa-solid fa-star me-1"></i>Popular</span>' : ''}
        <div style="font-size:.82rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);margin-bottom:8px">${escapeHtml(p.name)}</div>
        <div class="pamt mb-1"><sup>$</sup>${p.price}<span style="font-size:.85rem;color:var(--tx3)">/mo</span></div>
        <p style="font-size:.82rem;color:var(--tx2);margin:10px 0 14px;padding-bottom:14px;border-bottom:1px solid var(--bd)">${escapeHtml(p.blurb)}</p>
        ${p.features.map(f => `<div class="d-flex align-items-center gap-2 mb-2" style="font-size:.82rem;color:var(--tx2)"><i class="fa-solid fa-check" style="color:#34d399"></i>${escapeHtml(f)}</div>`).join('')}
        <button class="${isCurrent ? 'boc' : 'bgrd'} btn w-100 py-2 mt-3" style="font-size:.85rem" ${isCurrent || p.id === 'free' ? 'disabled' : ''} onclick="selectPlan('${p.id}')">${isCurrent ? 'Current Plan' : (p.id === 'free' ? 'Default' : 'Select Plan')}</button>
      </div>
    </div>`;
  }).join('');

  // Real subscription + history from the database.
  try {
    const sub = await NovaApi.getMySubscription();
    const cp = BILLING_PLANS.find(p => p.id === (sub ? String(sub.plan_tier).toLowerCase() : currentPlan)) || BILLING_PLANS[0];
    setText('billingPlanName', cp.name + ' Plan');
    setText('billingPlanPrice', cp.price);
    const status = document.getElementById('billingPlanStatus');
    if (status) {
      if (sub && sub.cancel_at_period_end) status.textContent = 'Cancels ' + new Date(sub.current_period_end).toLocaleDateString();
      else if (sub) status.textContent = 'Renews ' + (sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString() : '—');
      else status.textContent = 'Free plan';
    }
  } catch (_) {}

  try {
    const payments = await NovaApi.getMyPayments();
    if (t) {
      if (!payments.length) {
        t.innerHTML = '<thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody><tr><td colspan="5" style="text-align:center;color:var(--tx3);padding:18px">No payments yet.</td></tr></tbody>';
      } else {
        t.innerHTML = '<thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>' +
          payments.map(p => {
            const amount = (p.amount_cents / 100).toLocaleString(undefined, { style: 'currency', currency: (p.currency || 'usd').toUpperCase() });
            const dt = new Date(p.created_at).toLocaleDateString();
            const statusBadge = p.status === 'succeeded'
              ? '<span class="bst son">Paid</span>'
              : '<span class="bst" style="background:rgba(248,113,113,.12);color:#f87171">' + escapeHtml(p.status) + '</span>';
            const receipt = p.receipt_url
              ? `<a class="boc btn py-1 px-2" style="font-size:.74rem" target="_blank" rel="noopener" href="${escapeHtml(p.receipt_url)}"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i>View</a>`
              : '<span style="color:var(--tx3)">—</span>';
            return `<tr><td>${dt}</td><td>${escapeHtml(p.description || 'Subscription')}</td><td>${amount}</td><td>${statusBadge}</td><td>${receipt}</td></tr>`;
          }).join('') + '</tbody>';
      }
    }
  } catch (e) {
    if (t) t.innerHTML = '<thead><tr><th colspan="5">Could not load payments</th></tr></thead><tbody></tbody>';
  }
}

async function selectPlan(id) {
  if (id === 'free' || !id) return;
  const cycle = (document.getElementById('ptog') && document.getElementById('ptog').checked) ? 'yearly' : 'monthly';
  const btn = (event && event.target && event.target.closest('button')) || null;
  if (btn) { btn.disabled = true; btn.dataset.html = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Redirecting…'; }
  try {
    const res = await NovaApi.startCheckout(id, cycle);
    if (res && res.url) { window.location.href = res.url; return; }
    novaToast('Could not start checkout.');
  } catch (e) {
    novaToast('Checkout failed: ' + (e.message || 'unknown error'));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.html || 'Select Plan'; }
  }
}

async function cancelPlan() {
  if (!confirm('Cancel your subscription? You will keep access until the end of the billing period.')) return;
  novaToast('Subscription cancellation must be done from your Stripe billing portal — we\'ll set this up shortly.');
  // NOTE: a /api/stripe-portal endpoint is the next step; for now we surface
  // a message rather than fake the cancellation.
}

/* ===================== STARTUP EDIT / DELETE ===================== */
function editStartup(id) {
  const s = NovaStore.getStartup(id);
  if (!s) return;
  NovaStore.setActiveStartup(id);
  // reuse the wizard modal in edit mode via prefill, but simplest: open plans form prefilled
  openStartup(id, 'plans');
  novaToast('Editing "' + s.name + '" — update details and regenerate.');
}
function removeStartup(id) {
  const s = NovaStore.getStartup(id);
  if (!s) return;
  if (!confirm('Delete "' + s.name + '"? All its documents and data will be removed.')) return;
  const remoteId = remoteMap.startups[id];
  const finish = () => {
    NovaStore.deleteStartup(id); delete remoteMap.startups[id];
    renderWorkspaceUI(); renderStartupCards();
    novaToast('Startup deleted.');
  };
  if (window.NovaApi && remoteId) {
    NovaApi.deleteStartup(remoteId).then(finish).catch(e => novaToast('Delete failed: ' + (e.message || 'unknown error')));
  } else { finish(); }
}

/* ===================== WIZARD LOGO PREVIEW ======================= */
function previewWizardLogo(input) {
  const file = input.files && input.files[0];
  const box = document.getElementById('wzLogoPreview');
  if (!file || !box) return;
  // Keep the raw File for Supabase Storage upload, plus a data URL for preview.
  window._wzLogoFile = file;
  const reader = new FileReader();
  reader.onload = e => { box.innerHTML = `<img src="${e.target.result}" alt="logo" style="width:100%;height:100%;object-fit:cover">`; window._wzLogoData = e.target.result; };
  reader.readAsDataURL(file);
}

/* ------------------------------ BOOT ----------------------------- */
function bootDashboardData() {
  hydrateSettings();
  renderWorkspaceUI();
  renderStartupCards();
  renderConvList();
  updateAIStatus();
}
// run once DOM + modules are ready
document.addEventListener('DOMContentLoaded', function () {
  hydrateSettings();
  updateAIStatus();
  // Restore an existing Supabase session (if any) and rehydrate the dashboard.
  if (window.NovaApi && typeof NovaApi.me === 'function') {
    NovaApi.me().then(function (user) {
      if (user) loginSuccess(Object.assign({ backend: true }, user));
    }).catch(function () { /* no active session — stay on landing */ });
  }
});

/* ---------------- REAL-TIME AUTH LIFECYCLE LISTENER ----------------
   Keeps the UI in sync with Supabase auth events: completes OAuth
   (Google/GitHub) redirects, rehydrates on token refresh, and tears the
   dashboard down on sign-out — all without a manual page refresh. */
if (window.NovaApi && NovaApi.supabase) {
  NovaApi.supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
      NovaApi.setToken(session.access_token);
      // If authenticated but the dashboard is hidden, auto-login (no refresh needed).
      if (document.getElementById('dashboard').style.display !== 'block') {
        NovaApi.me().then(user => {
          if (user && typeof loginSuccess === 'function') {
            loginSuccess(Object.assign({ backend: true }, user));
          }
        });
      }
    }
    if (event === 'SIGNED_OUT') {
      if (typeof logoutSuccess === 'function') {
        logoutSuccess();
      } else if (typeof NovaApi.logout === 'function') {
        NovaApi.logout();
      }
    }
  });
}
