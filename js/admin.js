/* =====================================================================
   Nova StartupOS AI - Admin & Super Admin areas (NovaAdmin)
   Adds role-gated sections INTO the existing single-page dashboard, reusing
   the Nova design system. All data comes from the backend /admin APIs.
   Sections are injected into #adminSections and shown via dbNav('a-*').
   ===================================================================== */
(function (global) {
  'use strict';

  let role = { admin: false, superAdmin: false };

  /* ---------------------------------------------------------------- */
  // Canonical role detection — accepts every variant the app has used
  // historically ('Super Admin', 'super_admin', is_super_admin, etc).
  function detectRole(user) {
    if (!user) return 'user';
    const raw = String(user.role || (user.roles && user.roles[0]) || '').toLowerCase().replace(/\s+/g, '_');
    if (raw === 'super_admin' || user.is_super_admin === true) return 'super_admin';
    if (raw === 'admin'       || user.is_admin === true)       return 'admin';
    return 'user';
  }

  /**
   * Apply RBAC to the dashboard sidebar.
   *
   * Single source of truth — driven by `user.role`. The sidebar exposes
   * `data-role` and `data-context` attributes; CSS handles visibility,
   * so there's never a flash of admin/super-admin items for a regular
   * user during JS boot.
   *
   * Roles:
   *   - 'user'        → only #userNavGroup (My Workspace + AI modules)
   *   - 'admin'       → #adminNavGroup, plus a context switcher to flip
   *                     into the personal Workspace view without polluting
   *                     the admin sidebar
   *   - 'super_admin' → #adminNavGroup AND #superAdminNavGroup, plus the
   *                     same context switcher
   */
  function applyRole(user) {
    const detected = detectRole(user);
    role.admin      = detected === 'admin' || detected === 'super_admin';
    role.superAdmin = detected === 'super_admin';

    const sidebar = document.getElementById('dbSidebar');
    if (!sidebar) return;

    // Stamp the role + context. CSS does the rest of the work.
    sidebar.setAttribute('data-role', detected);
    // Default landing context: admins/super-admins start in the admin
    // workflow; users always live in the workspace.
    const startCtx = (detected === 'user') ? 'workspace' : 'admin';
    sidebar.setAttribute('data-context', startCtx);

    // Build privileged nav groups (idempotent — buildNav is a no-op once
    // the groups already exist, with their visibility re-synced).
    buildNav();
    buildSections();
    syncContextButton(startCtx);

    // Choose the landing section for this role.
    if (typeof global.dbNav === 'function') {
      setTimeout(function () {
        if (detected === 'super_admin') global.dbNav('s-ai');
        else if (detected === 'admin')  global.dbNav('a-overview');
        else                            global.dbNav('overview');
      }, 250);
    }
  }

  // Public hook so the user-context switcher can flip between the admin
  // sidebar and the personal "My Workspace" sidebar without reloading.
  function setContext(ctx) {
    const sidebar = document.getElementById('dbSidebar');
    if (!sidebar) return;
    const safe = (ctx === 'workspace') ? 'workspace' : 'admin';
    sidebar.setAttribute('data-context', safe);
    syncContextButton(safe);
    if (typeof global.dbNav === 'function') {
      // Land on a sensible default section in the new context.
      if (safe === 'workspace') global.dbNav('overview');
      else if (role.superAdmin) global.dbNav('s-ai');
      else if (role.admin)      global.dbNav('a-overview');
    }
  }
  function syncContextButton(ctx) {
    document.querySelectorAll('#navContextSwitcher .nav-ctx-btn').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-ctx') === ctx);
    });
  }
  // Window-scoped helper used by the inline onclick on the switcher
  // (kept here so the wiring is co-located with the rest of the RBAC).
  global.setSidebarContext = setContext;

  /* ---- Sidebar nav injection (idempotent) ---- */
  function tt(key, fallback) {
    return (global.NovaI18n && typeof global.NovaI18n.t === 'function')
      ? global.NovaI18n.t(key)
      : fallback;
  }
  function buildNav() {
    const nav = document.querySelector('#dbSidebar .db-nav');
    if (!nav) return;
    // First-time inject. After that, applyRole simply toggles data-role
    // on the sidebar and CSS handles visibility.
    if (!document.getElementById('adminNavGroup') && role.admin) {
      const g = document.createElement('div');
      g.id = 'adminNavGroup';
      g.setAttribute('data-role-only', 'admin');
      g.innerHTML =
        '<div class="db-nav-section" data-i18n="section.administration">Administration</div>' +
        navBtn('a-overview', 'fa-shield-halved',       'nav.admin_dashboard') +
        navBtn('a-users',    'fa-users',               'nav.users') +
        navBtn('a-billing',  'fa-file-invoice-dollar', 'nav.subscriptions') +
        navBtn('a-funding',  'fa-sack-dollar',         'nav.funding_db') +
        navBtn('a-visa',     'fa-passport',            'nav.visa_db') +
        navBtn('a-blog',     'fa-newspaper',           'nav.blog') +
        navBtn('a-cms',      'fa-pen-ruler',           'nav.cms') +
        navBtn('a-support',  'fa-headset',             'nav.support_tickets') +
        navBtn('a-audit',    'fa-clipboard-list',      'nav.audit_logs');
      nav.appendChild(g);
    }
    if (!document.getElementById('superAdminNavGroup') && role.superAdmin) {
      const g = document.createElement('div');
      g.id = 'superAdminNavGroup';
      g.setAttribute('data-role-only', 'super_admin');
      g.innerHTML =
        '<div class="db-nav-section" data-i18n="section.super_admin">Super Admin</div>' +
        navBtn('s-ai',       'fa-robot',     'nav.ai_providers') +
        navBtn('s-gateways', 'fa-plug',      'nav.gateways') +
        navBtn('s-email',    'fa-envelope',  'nav.email_settings') +
        navBtn('s-security', 'fa-lock',      'nav.security') +
        navBtn('s-system',   'fa-server',    'nav.system_health');
      nav.appendChild(g);
    }
    // Apply translations to the freshly-injected groups (no-op if NovaI18n
    // is still loading — it'll re-apply on the nova:lang-changed event).
    if (global.NovaI18n && typeof global.NovaI18n.applyTranslations === 'function') {
      global.NovaI18n.applyTranslations(document.getElementById('dbSidebar'));
    }
  }
  function navBtn(section, icon, key) {
    return '<button class="db-nl" onclick="dbNav(\'' + section + '\',this)"><i class="fa-solid ' + icon + '"></i> <span data-i18n="' + key + '">' + tt(key, key) + '</span></button>';
  }

  // Re-translate any imperatively-rendered admin tables / panels when the
  // user toggles the language. The sidebar buttons use data-i18n and are
  // handled automatically; this hook covers content that was rebuilt in JS.
  document.addEventListener('nova:lang-changed', function () {
    const sidebar = document.getElementById('dbSidebar');
    if (sidebar && global.NovaI18n) {
      global.NovaI18n.applyTranslations(sidebar);
    }
  });

  /* ---- Section container injection ---- */
  function buildSections() {
    let host = document.getElementById('adminSections');
    if (!host) {
      const content = document.querySelector('#dashboard .db-content');
      if (!content) return;
      host = document.createElement('div');
      host.id = 'adminSections';
      content.appendChild(host);
    }
    const sections = [];
    if (role.admin) {
      sections.push(panel('a-overview', 'Admin Dashboard', '<div class="row g-3" id="adminStats"></div><div class="nova-panel mt-3"><div class="d-flex align-items-center justify-content-between mb-3"><h6 class="mb-0"><i class="fa-solid fa-chart-line me-2" style="color:var(--pur)"></i>Revenue (Last 12 Months)</h6><div style="font-size:.75rem;color:var(--tx3)">Mock financial history</div></div><canvas id="adminRevenueChart" height="90"></canvas></div><div class="nova-panel mt-3"><h6 class="mb-3"><i class="fa-solid fa-user-clock me-2" style="color:var(--pur)"></i>Recent Signups</h6><div id="adminRecent"></div></div>'));
      sections.push(panel('a-users', 'Users', '<div class="d-flex gap-2 mb-3"><input class="ninp mb-0" id="adminUserSearch" placeholder="Search users…" style="max-width:280px" oninput="NovaAdmin.searchUsers(this.value)"></div><div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminUsersTable"></table></div>'));
      sections.push(panel('a-billing', 'Subscriptions & Payments', '<div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminBillingTable"></table></div>'));
      sections.push(panel('a-funding', 'Funding Database', '<button class="bgrd btn py-2 px-3 mb-3" onclick="NovaAdmin.newFunding()"><i class="fa-solid fa-plus me-1"></i>Add Source</button><div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminFundingTable"></table></div>'));
      sections.push(panel('a-visa', 'Visa Database', '<button class="bgrd btn py-2 px-3 mb-3" onclick="NovaAdmin.newVisa()"><i class="fa-solid fa-plus me-1"></i>Add Program</button><div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminVisaTable"></table></div>'));
      sections.push(panel('a-blog', 'Blog Management', '<button class="bgrd btn py-2 px-3 mb-3" onclick="NovaAdmin.newBlog()"><i class="fa-solid fa-plus me-1"></i>New Post</button><div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminBlogTable"></table></div>'));
      sections.push(panel('a-cms', 'CMS — Landing Page Content', '<div id="adminCms"></div>'));
      sections.push(panel('a-support', 'Support Tickets', '<div class="d-flex gap-2 flex-wrap mb-3"><button class="filter-pill on" onclick="NovaAdmin.filterTickets(\'all\',this)">All</button><button class="filter-pill" onclick="NovaAdmin.filterTickets(\'open\',this)">Open</button><button class="filter-pill" onclick="NovaAdmin.filterTickets(\'closed\',this)">Closed</button></div><div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminTicketsTable"></table></div>'));
      sections.push(panel('a-audit', 'Audit Logs', '<div class="nova-panel" style="overflow:auto"><table class="nova-table" id="adminAuditTable"></table></div>'));
    }
    if (role.superAdmin) {
      sections.push(panel('s-ai', 'AI Providers', '<div id="superAi"></div>'));
      sections.push(panel('s-gateways', 'Payment Gateways', '<div id="superGateways"></div>'));
      sections.push(panel('s-email', 'Email Settings', '<div id="superEmail"></div>'));
      sections.push(panel('s-security', 'Security & Controls', '<div id="superSecurity"></div>'));
      sections.push(panel('s-system', 'System Health', '<div class="row g-3" id="superSystem"></div><div class="nova-panel mt-3"><h6 class="mb-3"><i class="fa-solid fa-wave-square me-2" style="color:var(--pur)"></i>Real-time System Monitoring</h6><div class="row g-3" id="superMonitors"></div></div>'));
    }
    host.innerHTML = sections.join('');
  }
  function panel(id, title, body) {
    return `<div class="db-section" id="sec-${id}"><div class="mb-4"><h4 style="font-size:1.4rem;font-weight:700;margin-bottom:4px">${title}</h4></div>${body}</div>`;
  }

  /* ---- Loaders (called by dbNav hook) ---- */
  function load(section) {
    if (!global.NovaApi) return;
    switch (section) {
      case 'a-overview': return loadOverview();
      case 'a-users':    return loadUsers();
      case 'a-billing':  return loadBilling();
      case 'a-funding':  return loadFunding();
      case 'a-visa':     return loadVisa();
      case 'a-blog':     return loadBlog();
      case 'a-cms':      return loadCms();
      case 'a-support':  return loadSupport();
      case 'a-audit':    return loadAudit();
      case 's-ai':       return loadAi();
      case 's-gateways': return loadGateways();
      case 's-email':    return loadEmail();
      case 's-security': return loadSecurity();
      case 's-system':   return loadSystem();
    }
  }

  const card = (val, lbl, color) => `<div class="col-6 col-xl-3"><div class="db-stat-card"><div class="db-stat-val" style="color:${color || 'var(--pur)'}">${val}</div><div class="db-stat-lbl">${lbl}</div></div></div>`;
  const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* ---- Generic rich-modal CRUD (replaces prompt()) ---- */
  let crudHandler = null;
  function openCrud(title, fields, onSubmit) {
    crudHandler = onSubmit;
    document.getElementById('adminCrudTitle').innerHTML = '<i class="fa-solid fa-pen-ruler me-2" style="color:var(--pur)"></i>' + esc(title);
    document.getElementById('adminCrudFields').innerHTML = fields.map(f => {
      const val = f.value == null ? '' : esc(f.value);
      if (f.type === 'select') {
        return `<label class="nlbl" for="cf-${f.name}">${esc(f.label)}</label><select class="ninp" id="cf-${f.name}" name="${f.name}">${(f.options || []).map(o => `<option ${o === f.value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      }
      if (f.type === 'textarea') {
        return `<label class="nlbl" for="cf-${f.name}">${esc(f.label)}</label><textarea class="ninp" id="cf-${f.name}" name="${f.name}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${val}</textarea>`;
      }
      return `<label class="nlbl" for="cf-${f.name}">${esc(f.label)}</label><input class="ninp" id="cf-${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${val}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}>`;
    }).join('');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('adminCrudModal')).show();
  }
  function submitCrud(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('adminCrudForm');
    const data = {};
    form.querySelectorAll('[name]').forEach(el => { data[el.name] = el.value.trim(); });
    bootstrap.Modal.getOrCreateInstance(document.getElementById('adminCrudModal')).hide();
    if (crudHandler) crudHandler(data);
  }

  function loadOverview() {
    const apply = d => {
      document.getElementById('adminStats').innerHTML =
        card(d.users, 'Total Users', '#a78bfa') + card(d.active_subscriptions, 'Active Subs', '#34d399') +
        card(d.startups, 'Startups', '#60a5fa') + card('$' + (d.revenue || 0).toLocaleString(), 'Revenue', '#fbbf24');
      const recent = d.recent_users || [];
      document.getElementById('adminRecent').innerHTML = recent.length ? recent.map(u =>
        `<div class="d-flex justify-content-between py-2" style="border-top:1px solid var(--bd);font-size:.85rem"><span>${esc(u.name)} <span style="color:var(--tx3)">${esc(u.email)}</span></span><span style="color:var(--tx3)">${u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}</span></div>`).join('') : '<div style="color:var(--tx3)">No recent signups.</div>';
      drawRevenueChart(d.revenue_history);
    };
    NovaApi.adminGetStats()
      .then(stats => Promise.all([
        NovaApi.adminGetUsers().catch(() => []),
        NovaApi.adminGetRevenueHistory().catch(() => []),
      ]).then(([users, history]) => {
        stats.recent_users = (users || []).slice(0, 6).map(u => ({
          name: u.name || (u.email ? u.email.split('@')[0] : '—'),
          email: u.email || '', created_at: u.created_at,
        }));
        stats.revenue_history = (history || []).map(h => Math.round((h.total_cents || 0) / 100));
        apply(stats);
      }))
      .catch(e => { toastErr(e); drawRevenueChart(null); });
  }
  let revChart = null;
  function drawRevenueChart(history) {
    const ctx = document.getElementById('adminRevenueChart');
    if (!ctx || !global.Chart) return;
    if (revChart) { revChart.destroy(); revChart = null; }
    const labels = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const data = (Array.isArray(history) && history.length === 12) ? history : new Array(12).fill(0);
    const c = ctx.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, 'rgba(139,92,246,0.35)'); g.addColorStop(1, 'rgba(59,130,246,0.02)');
    const isDark = !document.getElementById('htmlRoot').classList.contains('lm');
    const grid = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const ticks = isDark ? '#6b6b8a' : '#7878a0';
    revChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Revenue ($)', data, fill: true, backgroundColor: g, borderColor: '#8b5cf6', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: .4 }] },
      options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => ' $' + x.parsed.y.toLocaleString() } } },
        scales: { x: { grid: { color: grid }, ticks: { color: ticks, font: { family: 'Space Grotesk', size: 11 } } }, y: { grid: { color: grid }, ticks: { color: ticks, font: { family: 'Space Grotesk', size: 11 }, callback: v => '$' + (v / 1000).toFixed(1) + 'k' } } } }
    });
  }
  function loadUsers() { NovaApi.adminGetUsers().then(rows => paintUsers(rows.map(_userRow))).catch(e => toastErr(e)); }
  function _userRow(p) {
    return {
      id: p.id, name: p.name || (p.email ? p.email.split('@')[0] : '—'),
      email: p.email || '', roles: p.role ? [p.role] : [],
      is_active: p.is_active !== false, plan_tier: p.plan_tier,
    };
  }
  function paintUsers(rows) {
    const t = document.getElementById('adminUsersTable');
    t.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map(u => {
        const safe = encodeURIComponent(JSON.stringify({ id: u.id, name: u.name, email: u.email }));
        const idAttr = String(u.id);
        return `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${(u.roles || []).map(r => esc(r.name || r)).join(', ')}</td>
          <td><span class="bst ${u.is_active ? 'son' : ''}" ${u.is_active ? '' : 'style="background:rgba(239,68,68,.12);color:#f87171"'}>${u.is_active ? 'Active' : 'Disabled'}</span></td>
          <td class="d-flex gap-1">
            <button class="boc btn py-1 px-2" style="font-size:.75rem" data-user="${safe}" onclick="NovaAdmin.editUserFromButton(this)">Edit</button>
            <button class="boc btn py-1 px-2" style="font-size:.75rem" onclick="NovaAdmin.toggleUser('${esc(idAttr)}')">${u.is_active ? 'Suspend' : 'Activate'}</button>
            <button class="boc btn py-1 px-2" style="font-size:.75rem;color:#f87171" onclick="NovaAdmin.delUser('${esc(idAttr)}')">Delete</button>
          </td></tr>`;
      }).join('') +
      '</tbody>';
  }
  function editUserFromButton(btn) {
    try { const u = JSON.parse(decodeURIComponent(btn.getAttribute('data-user'))); editUser(u); } catch (_) {}
  }
  function editUser(u) {
    openCrud('Edit User', [
      { name: 'name',  label: 'Full name', value: u.name,  required: true },
      { name: 'email', label: 'Email',     type: 'email', value: u.email, required: true },
    ], data => {
      NovaApi.adminUpdateUser(u.id, data)
        .then(() => { loadUsers(); novaToast('User updated.'); })
        .catch(e => toastErr(e));
    });
  }
  function delUser(id) {
    if (!confirm('Delete this user account? This cannot be undone.')) return;
    NovaApi.adminDeleteUser(id).then(() => { loadUsers(); novaToast('User deleted.'); }).catch(e => toastErr(e));
  }
  function searchUsers(q) { NovaApi.adminGetUsers(q).then(rows => paintUsers(rows.map(_userRow))).catch(() => {}); }
  function toggleUser(id) { NovaApi.adminToggleUser(id).then(() => { loadUsers(); global.novaToast && novaToast('User updated.'); }).catch(e => toastErr(e)); }

  function loadBilling() {
    NovaApi.admin.plans().then(plans => {
      const t = document.getElementById('adminBillingTable');
      t.innerHTML = '<thead><tr><th>Plan</th><th>Monthly</th><th>Yearly</th><th>Trial</th><th>Subscribers</th></tr></thead><tbody>' +
        plans.map(p => `<tr><td>${esc(p.name)}</td><td>$${p.price_monthly}</td><td>$${p.price_yearly}</td><td>${p.trial_days}d</td><td>${p.subscribers || 0}</td></tr>`).join('') + '</tbody>';
    }).catch(e => toastErr(e));
  }

  function loadFunding() {
    NovaApi.admin.funding().then(rows => {
      const t = document.getElementById('adminFundingTable');
      t.innerHTML = '<thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Ticket</th><th></th></tr></thead><tbody>' +
        rows.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.type)}</td><td>${esc(f.country)}</td><td>${esc(f.ticket_size)}</td>
          <td><button class="boc btn py-1 px-2" style="font-size:.75rem;color:#f87171" onclick="NovaAdmin.delFunding('${esc(String(f.id))}')">Delete</button></td></tr>`).join('') + '</tbody>';
    }).catch(e => toastErr(e));
  }
  function newFunding() {
    openCrud('Add Funding Source', [
      { name: 'name',        label: 'Funding source name', required: true },
      { name: 'type',        label: 'Type', type: 'select', options: ['accelerator', 'incubator', 'grant', 'vc', 'angel'], value: 'accelerator' },
      { name: 'country',     label: 'Country' },
      { name: 'ticket_size', label: 'Ticket size', placeholder: 'e.g. $100K' }
    ], data => {
      if (!data.name) return;
      NovaApi.admin.saveFunding(data).then(() => { loadFunding(); novaToast('Funding source added.'); }).catch(e => toastErr(e));
    });
  }
  function delFunding(id) { if (confirm('Delete this funding source?')) NovaApi.admin.deleteFunding(id).then(() => loadFunding()).catch(e => toastErr(e)); }

  function loadVisa() {
    NovaApi.admin.visa().then(rows => {
      const t = document.getElementById('adminVisaTable');
      t.innerHTML = '<thead><tr><th>Country</th><th>Program</th><th>Fit</th><th></th></tr></thead><tbody>' +
        rows.map(v => `<tr><td>${esc(v.country)}</td><td>${esc(v.program_name)}</td><td>${v.fit_score != null ? v.fit_score : '—'}</td>
          <td><button class="boc btn py-1 px-2" style="font-size:.75rem;color:#f87171" onclick="NovaAdmin.delVisa('${esc(String(v.id))}')">Delete</button></td></tr>`).join('') + '</tbody>';
    }).catch(e => toastErr(e));
  }
  function newVisa() {
    openCrud('Add Visa Program', [
      { name: 'country',      label: 'Country', required: true },
      { name: 'program_name', label: 'Program name', required: true },
      { name: 'fit_score',    label: 'Fit score (0-100)', type: 'number', value: '80' }
    ], data => {
      if (!data.country || !data.program_name) return;
      NovaApi.admin.saveVisa({
        country: data.country,
        program_name: data.program_name,
        fit_score: parseInt(data.fit_score) || 80,
        suitability_score: String(data.fit_score || 80),
      })
        .then(() => { loadVisa(); novaToast('Visa program added.'); }).catch(e => toastErr(e));
    });
  }
  function delVisa(id) { if (confirm('Delete this visa program?')) NovaApi.admin.deleteVisa(id).then(() => loadVisa()).catch(e => toastErr(e)); }

  function loadBlog() {
    NovaApi.admin.blog().then(rows => {
      const t = document.getElementById('adminBlogTable');
      t.innerHTML = '<thead><tr><th>Title</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>' +
        rows.map(b => {
          const safe = encodeURIComponent(JSON.stringify(b));
          return `<tr><td>${esc(b.title)}</td><td><span class="bst ${b.status === 'published' ? 'son' : ''}">${esc(b.status)}</span></td><td style="color:var(--tx3)">${b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}</td>
            <td class="d-flex gap-1">
              <button class="boc btn py-1 px-2" style="font-size:.75rem" data-blog="${safe}" onclick="NovaAdmin.editBlogFromButton(this)">Edit</button>
              <button class="boc btn py-1 px-2" style="font-size:.75rem;color:#f87171" onclick="NovaAdmin.delBlog('${esc(String(b.id))}')">Delete</button>
            </td></tr>`;
        }).join('') + '</tbody>';
    }).catch(e => toastErr(e));
  }
  function editBlogFromButton(btn) {
    try { const b = JSON.parse(decodeURIComponent(btn.getAttribute('data-blog'))); editBlog(b); } catch (_) {}
  }
  function editBlog(b) {
    openCrud('Edit Blog Post', [
      { name: 'title',      label: 'Post title', value: b.title, required: true },
      { name: 'excerpt',    label: 'Excerpt', type: 'textarea', rows: 2, value: b.excerpt || b.snippet || '' },
      { name: 'body',       label: 'Body', type: 'textarea', rows: 5, value: b.body },
      { name: 'status',     label: 'Status', type: 'select', options: ['draft', 'published', 'scheduled'], value: b.status || 'published' },
      { name: 'publish_at', label: 'Schedule date (if scheduled)', type: 'datetime-local', value: b.publish_at || b.scheduled_at },
    ], data => {
      const payload = { id: b.id, title: data.title, excerpt: data.excerpt, body: data.body, status: data.status };
      if (data.publish_at) payload.publish_at = new Date(data.publish_at).toISOString();
      NovaApi.admin.saveBlog(payload).then(() => { loadBlog(); novaToast('Post updated.'); }).catch(e => toastErr(e));
    });
  }
  function newBlog() {
    openCrud('New Blog Post', [
      { name: 'title',      label: 'Post title', required: true },
      { name: 'excerpt',    label: 'Excerpt', type: 'textarea', rows: 2 },
      { name: 'body',       label: 'Body', type: 'textarea', rows: 5 },
      { name: 'status',     label: 'Status', type: 'select', options: ['draft', 'published', 'scheduled'], value: 'published' },
      { name: 'publish_at', label: 'Schedule date (if scheduled)', type: 'datetime-local' },
    ], data => {
      if (!data.title) return;
      const payload = { title: data.title, excerpt: data.excerpt, body: data.body, status: data.status };
      if (data.publish_at) payload.publish_at = new Date(data.publish_at).toISOString();
      NovaApi.admin.saveBlog(payload).then(() => { loadBlog(); novaToast('Post saved.'); }).catch(e => toastErr(e));
    });
  }
  function delBlog(id) { if (confirm('Delete this post?')) NovaApi.admin.deleteBlog(id).then(() => loadBlog()).catch(e => toastErr(e)); }

  function loadCms() {
    // CMS is not yet backed by a server table — show informational state.
    const host = document.getElementById('adminCms');
    if (host) host.innerHTML =
      '<div class="nova-panel"><div style="color:var(--tx2);font-size:.9rem">' +
      '<i class="fa-solid fa-circle-info me-2" style="color:var(--pur)"></i>' +
      'CMS for landing-page content is not yet enabled in this deployment. ' +
      'Edit copy directly in <code>index.html</code>, or open a ticket with engineering to schedule the CMS rollout.' +
      '</div></div>';
  }
  function saveCms() { /* CMS not yet enabled */ }

  /* ---- Support Tickets (Supabase: `support_tickets`) ---- */
  let ticketFilter = 'all';
  let ticketCache = [];
  let activeTicket = null;
  // Normalize a Supabase ticket row to the shape the renderer/modal use.
  function normTicket(r) {
    let messages = r.messages;
    if (typeof messages === 'string') { try { messages = JSON.parse(messages); } catch (e) { messages = []; } }
    if (!Array.isArray(messages)) messages = [];
    return {
      id: r.id,
      user: r.user_name || r.user || (r.user_email ? r.user_email.split('@')[0] : '—'),
      email: r.user_email || r.email || '',
      subject: r.subject || '(no subject)',
      status: r.status || 'open',
      date: r.created_at || r.date,
      messages,
    };
  }
  function loadSupport() {
    NovaApi.adminGetTickets()
      .then(rows => { ticketCache = (rows || []).map(normTicket); paintTickets(); })
      .catch(e => { ticketCache = []; paintTickets(); toastErr(e); });
  }
  function filterTickets(f, btn) {
    ticketFilter = f;
    document.querySelectorAll('#sec-a-support .filter-pill').forEach(p => p.classList.remove('on'));
    if (btn) btn.classList.add('on');
    paintTickets();
  }
  function paintTickets() {
    const t = document.getElementById('adminTicketsTable');
    if (!t) return;
    let rows = ticketCache;
    if (ticketFilter !== 'all') rows = rows.filter(r => r.status === ticketFilter);
    t.innerHTML = '<thead><tr><th>Ticket ID</th><th>User</th><th>Subject</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map((r, i) => `<tr><td><strong>${esc(String(r.id).slice(0, 8))}</strong></td><td>${esc(r.user)}</td><td>${esc(r.subject)}</td>
        <td><span class="bst ${r.status === 'open' ? 'son' : ''}" ${r.status === 'open' ? '' : 'style="background:rgba(248,113,113,.12);color:#f87171"'}>${r.status === 'open' ? 'Open' : 'Closed'}</span></td>
        <td style="white-space:nowrap">${r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
        <td><button class="boc btn py-1 px-2" style="font-size:.75rem" onclick="NovaAdmin.openTicket(${i})"><i class="fa-solid fa-reply me-1"></i>Respond</button></td></tr>`).join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:24px">No tickets in this view.</td></tr>') + '</tbody>';
  }
  function openTicket(index) {
    // Resolve from the (possibly filtered) view back to the cached object.
    let rows = ticketCache;
    if (ticketFilter !== 'all') rows = rows.filter(r => r.status === ticketFilter);
    const t = rows[index];
    if (!t) return;
    activeTicket = t;
    document.getElementById('ticketModalId').textContent = String(t.id).slice(0, 8);
    document.getElementById('ticketModalUser').textContent = t.user + (t.email ? ' · ' + t.email : '');
    document.getElementById('ticketModalDate').textContent = t.date ? new Date(t.date).toLocaleDateString() : '—';
    document.getElementById('ticketModalSubject').textContent = t.subject;
    // Render the existing conversation from the messages JSONB array.
    const body = document.getElementById('ticketModalBody');
    if (t.messages.length) {
      body.innerHTML = t.messages.map(m =>
        `<div style="margin-bottom:8px"><span style="font-size:.72rem;font-weight:700;color:${m.role === 'admin' ? 'var(--pur)' : 'var(--tx3)'}">${m.role === 'admin' ? 'Support' : esc(t.user)}</span>
         <div style="font-size:.85rem;color:var(--tx2)">${esc(m.content)}</div></div>`).join('');
    } else { body.textContent = '—'; }
    document.getElementById('ticketReply').value = '';
    document.getElementById('ticketCloseOnReply').checked = false;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('ticketModal')).show();
  }
  function sendTicketReply() {
    if (!activeTicket) return;
    const reply = document.getElementById('ticketReply').value.trim();
    if (!reply) return novaToast('Type a response first.');
    const close = document.getElementById('ticketCloseOnReply').checked;
    const messages = (activeTicket.messages || []).concat([{ role: 'admin', content: reply, at: new Date().toISOString() }]);
    const status = close ? 'closed' : 'open';
    NovaApi.adminReplyToTicket(activeTicket.id, messages, status)
      .then(() => {
        activeTicket.messages = messages; activeTicket.status = status;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('ticketModal')).hide();
        paintTickets();
        novaToast('Reply sent to ' + activeTicket.user + (close ? ' · ticket closed.' : '.'));
      })
      .catch(e => toastErr(e));
  }

  function loadAudit() {
    NovaApi.adminGetAuditLogs().then(paintAudit).catch(e => { paintAudit([]); toastErr(e); });
  }
  function paintAudit(rows) {
    const t = document.getElementById('adminAuditTable');
    if (!t) return;
    t.innerHTML = '<thead><tr><th>When</th><th>User</th><th>Action</th><th>Resource</th><th>IP</th></tr></thead><tbody>' +
      ((rows || []).length
        ? rows.map(l => `<tr><td>${l.created_at ? new Date(l.created_at).toLocaleString() : '—'}</td><td>${esc(l.user_name || (l.user && l.user.name) || 'system')}</td><td>${esc(l.action)}</td><td>${esc((l.resource ? l.resource : '') + (l.resource_id ? ('#' + l.resource_id) : ''))}</td><td>${esc(l.ip_address || '—')}</td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center;color:var(--tx3);padding:24px">No audit events yet.</td></tr>') + '</tbody>';
  }

  /* ---- Super admin ---- */
  const AI_PROVIDERS = ['openrouter', 'openai', 'anthropic', 'gemini', 'deepseek'];
  function loadAi() {
    NovaApi.superAdminGetAIConfig()
      .then(rows => paintAi(rowsToSettings(rows)))
      .catch(e => toastErr(e));
  }
  // Convert ai_providers_config rows into the { provider, model, costs, configured } shape.
  function rowsToSettings(rows) {
    const costs = {}, configured = {};
    let provider = 'openrouter', model = '';
    (rows || []).forEach(r => {
      const name = r.provider_name;
      costs[name] = { priority: r.priority, input: r.input_cost_per_1k, output: r.output_cost_per_1k };
      configured[name] = !!r.enabled;
      if (r.is_default) { provider = name; model = r.default_model || model; }
      if (!model && r.default_model) model = r.default_model;
    });
    return { provider, model, costs, configured };
  }
  function paintAi(s) {
    s = s || {};
    const host = document.getElementById('superAi');
    const costs = s.costs || {};
    const provOpts = AI_PROVIDERS.map(p => `<option ${s.provider === p ? 'selected' : ''}>${p}</option>`).join('');
    const provRow = p => {
      const c = costs[p] || {};
      const configured = (s.configured || {})[p];
      return `<div class="nova-panel mb-3" style="padding:16px">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <div class="d-flex align-items-center gap-2"><strong style="text-transform:capitalize">${p}</strong>
              <span class="bst ${configured ? 'son' : ''}" ${configured ? '' : 'style="background:rgba(248,113,113,.12);color:#f87171"'}>${configured ? 'Connected' : 'Not set'}</span></div>
            <label class="nova-switch"><input type="checkbox" id="en-${p}" ${configured ? 'checked' : ''}><span></span></label>
          </div>
          <div class="row g-2">
            <div class="col-md-6"><label class="nlbl">${p} key (server)</label><input class="ninp" type="text" disabled placeholder="Set ${p.toUpperCase()}_API_KEY in Vercel env"></div>
            <div class="col-md-2"><label class="nlbl">Priority</label><input class="ninp" type="number" id="prio-${p}" value="${c.priority != null ? c.priority : ''}" placeholder="1"></div>
            <div class="col-md-2"><label class="nlbl">In $/1K</label><input class="ninp" type="number" step="0.0001" id="cin-${p}" value="${c.input != null ? c.input : ''}" placeholder="0.0005"></div>
            <div class="col-md-2"><label class="nlbl">Out $/1K</label><input class="ninp" type="number" step="0.0001" id="cout-${p}" value="${c.output != null ? c.output : ''}" placeholder="0.0015"></div>
          </div>
        </div>`;
    };
    host.innerHTML = `<div class="nova-panel mb-3">
        <div class="row g-3">
          <div class="col-md-6"><label class="nlbl">Default Provider</label><select class="ninp" id="aiProv">${provOpts}</select></div>
          <div class="col-md-6"><label class="nlbl">Default Model</label><input class="ninp" id="aiModel" value="${esc(s.model)}"></div>
        </div>
        <div class="mt-2" style="font-size:.78rem;color:var(--tx3)"><i class="fa-solid fa-shield-halved me-1"></i>Provider API keys are stored as environment variables on the server. You toggle providers here; you set keys in your Vercel project settings.</div>
      </div>
      <h6 class="mb-2"><i class="fa-solid fa-microchip me-2" style="color:var(--pur)"></i>Providers, Costs &amp; Priority</h6>
      ${AI_PROVIDERS.map(provRow).join('')}
      <div class="d-flex gap-2 mt-1"><button class="bgrd btn py-2 px-4" onclick="NovaAdmin.saveAi()"><i class="fa-solid fa-floppy-disk me-1"></i>Save</button>
      <button class="boc btn py-2 px-3" onclick="NovaAdmin.testAi()"><i class="fa-solid fa-vial me-1"></i>Test</button></div>
      <div id="aiTestOut" style="font-size:.82rem;margin-top:10px"></div>`;
  }
  function saveAi() {
    const defaultProvider = document.getElementById('aiProv').value;
    const defaultModel    = document.getElementById('aiModel').value;
    const ops = AI_PROVIDERS.map(p => {
      const prio = document.getElementById('prio-' + p);
      const cin  = document.getElementById('cin-' + p);
      const cout = document.getElementById('cout-' + p);
      const en   = document.getElementById('en-' + p);
      const fields = {
        enabled: !!(en && en.checked),
        priority: prio && prio.value !== '' ? parseInt(prio.value) : null,
        input_cost_per_1k:  cin  && cin.value  !== '' ? parseFloat(cin.value)  : null,
        output_cost_per_1k: cout && cout.value !== '' ? parseFloat(cout.value) : null,
        is_default: p === defaultProvider,
      };
      if (p === defaultProvider) fields.default_model = defaultModel;
      return NovaApi.superAdminUpdateAIConfig(p, fields);
    });
    Promise.all(ops)
      .then(() => { novaToast('AI provider config saved.'); loadAi(); })
      .catch(e => toastErr(e));
  }
  async function testAi() {
    const out = document.getElementById('aiTestOut');
    out.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Testing…';
    try {
      const reply = await NovaAI.chat([{ role: 'user', content: 'Reply with exactly: Nova online.' }], {});
      out.innerHTML = '<span style="color:#34d399"><i class="fa-solid fa-circle-check me-1"></i>' + esc((reply || '').slice(0, 80)) + '</span>';
    } catch (e) {
      out.innerHTML = '<span style="color:#f87171">' + esc(e.message || 'Test failed.') + '</span>';
    }
  }
  function loadEmail() {
    const host = document.getElementById('superEmail');
    if (!host) return;
    host.innerHTML =
      '<div class="nova-panel"><div style="color:var(--tx2);font-size:.9rem">' +
      '<i class="fa-solid fa-envelope-circle-check me-2" style="color:var(--pur)"></i>' +
      'Email is delivered through Supabase Auth\'s built-in mailer. To customize subject/body or wire a third-party provider (Resend / SendGrid), configure it in Supabase Dashboard → Authentication → Emails. ' +
      'A self-service editor will land here in a future release.</div></div>';
  }
  function testEmail() { /* not enabled yet */ }
  /* ---- Payment Gateways ---- */
  function loadGateways() {
    const host = document.getElementById('superGateways');
    if (!host) return;
    NovaApi.superAdminGetGateways().then(rows => {
      const cur = {};
      (rows || []).forEach(r => { cur[r.provider] = r; });
      host.innerHTML = renderGatewayForm(cur);
    }).catch(() => { host.innerHTML = renderGatewayForm({}); });
  }
  function renderGatewayForm(cur) {
    const stripe = cur.stripe || {};
    const paypal = cur.paypal || {};
    const valFor = v => esc(v == null ? '' : String(v));
    const gw = (title, icon, color, fields) => `<div class="nova-panel mb-3">
      <div class="d-flex align-items-center justify-content-between mb-3">
        <h6 class="mb-0"><i class="fa-brands ${icon} me-2" style="color:${color}"></i>${title}</h6>
        <label class="d-flex align-items-center gap-2" style="font-size:.8rem;color:var(--tx2)">Sandbox<label class="nova-switch mb-0"><input type="checkbox" id="gw-${title.toLowerCase()}-live" ${(title === 'Stripe' ? stripe.live : paypal.live) ? 'checked' : ''}><span></span></label>Live</label>
      </div>
      <div class="row g-3">${fields.map(f => `<div class="col-md-6"><label class="nlbl">${f.label}</label><input class="ninp" type="${f.type || 'text'}" id="${f.id}" value="${valFor(f.value)}" placeholder="${esc(f.ph || '')}" autocomplete="off"></div>`).join('')}</div>
      <button class="bgrd btn py-2 px-4 mt-3" onclick="NovaAdmin.saveGateway('${title}')"><i class="fa-solid fa-floppy-disk me-1"></i>Save ${title}</button>
    </div>`;
    return gw('Stripe', 'fa-stripe-s', '#635bff', [
      { label: 'Publishable Key',     id: 'stripe-pk',    value: stripe.publishable_key, ph: 'pk_live_...' },
      { label: 'Secret Key',          id: 'stripe-sk',    value: stripe.secret_key,      ph: 'sk_live_... (server only)', type: 'password' },
      { label: 'Webhook Endpoint',    id: 'stripe-wh',    value: stripe.webhook_url,     ph: 'https://your-domain/api/stripe-webhook' },
      { label: 'Webhook Signing Secret', id: 'stripe-whsec', value: stripe.webhook_secret, ph: 'whsec_...', type: 'password' },
    ]) + gw('PayPal', 'fa-paypal', '#00457c', [
      { label: 'Client ID',     id: 'paypal-id',     value: paypal.client_id,     ph: 'Axx...' },
      { label: 'Client Secret', id: 'paypal-secret', value: paypal.client_secret, ph: 'ELx...', type: 'password' },
      { label: 'Webhook URL',   id: 'paypal-wh',     value: paypal.webhook_url,   ph: 'https://your-domain/api/paypal-webhook' },
      { label: 'Webhook ID',    id: 'paypal-whid',   value: paypal.webhook_id,    ph: 'WH-...' },
    ]);
  }
  function saveGateway(name) {
    const key = name.toLowerCase();
    const get = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    const liveEl = document.getElementById('gw-' + key + '-live');
    let payload;
    if (key === 'stripe') {
      payload = {
        provider: 'stripe',
        publishable_key: get('stripe-pk'),
        secret_key:      get('stripe-sk'),
        webhook_url:     get('stripe-wh'),
        webhook_secret:  get('stripe-whsec'),
        live: !!(liveEl && liveEl.checked),
      };
    } else {
      payload = {
        provider: 'paypal',
        client_id:     get('paypal-id'),
        client_secret: get('paypal-secret'),
        webhook_url:   get('paypal-wh'),
        webhook_id:    get('paypal-whid'),
        live: !!(liveEl && liveEl.checked),
      };
    }
    NovaApi.superAdminSaveGateway(payload)
      .then(() => novaToast(name + ' gateway saved.'))
      .catch(e => toastErr(e));
  }

  /* ---- Security & Controls ---- */
  let blockedIps = [];
  function loadSecurity() {
    const host = document.getElementById('superSecurity');
    if (!host) return;
    host.innerHTML = `
      <div class="nova-panel mb-3">
        <h6 class="mb-3"><i class="fa-solid fa-ban me-2" style="color:#f87171"></i>Blocked IP Addresses</h6>
        <div class="d-flex gap-2 mb-3" style="max-width:520px">
          <input class="ninp mb-0" id="newIpInput" placeholder="e.g. 203.0.113.10">
          <input class="ninp mb-0" id="newIpReason" placeholder="Reason (optional)">
          <button class="bgrd btn py-2 px-3" style="white-space:nowrap" onclick="NovaAdmin.addBlockedIp()"><i class="fa-solid fa-plus me-1"></i>Block</button>
        </div>
        <div style="overflow:auto"><table class="nova-table" id="blockedIpTable"></table></div>
      </div>
      <div class="nova-panel">
        <h6 class="mb-3"><i class="fa-solid fa-gauge-high me-2" style="color:var(--pur)"></i>Rate Limiting</h6>
        <p style="font-size:.8rem;color:var(--tx3);margin-bottom:14px">The AI streaming endpoint enforces a daily per-user quota set by the <code>AI_DAILY_LIMIT</code> environment variable on the server. Update it in your Vercel project settings.</p>
        <div class="row g-3">
          <div class="col-md-6">
            <div style="font-weight:600;font-size:.85rem;margin-bottom:6px">AI Daily Limit (per user)</div>
            <label class="nlbl">Current value</label><input class="ninp" type="text" id="rlAiDaily" disabled placeholder="Set AI_DAILY_LIMIT in Vercel">
          </div>
          <div class="col-md-6">
            <div style="font-weight:600;font-size:.85rem;margin-bottom:6px">Max prompt tokens</div>
            <label class="nlbl">Current value</label><input class="ninp" type="text" id="rlAiMaxTokens" disabled placeholder="Set AI_MAX_TOKENS in Vercel">
          </div>
        </div>
      </div>`;
    NovaApi.superAdminGetBlockedIPs().then(rows => { blockedIps = rows || []; paintBlockedIps(); }).catch(e => { blockedIps = []; paintBlockedIps(); toastErr(e); });
  }
  function paintBlockedIps() {
    const t = document.getElementById('blockedIpTable');
    if (!t) return;
    t.innerHTML = '<thead><tr><th>IP Address</th><th>Reason</th><th>Blocked</th><th></th></tr></thead><tbody>' +
      (blockedIps.length ? blockedIps.map(r => `<tr><td><code>${esc(r.ip_address)}</code></td><td style="color:var(--tx2)">${esc(r.reason || '—')}</td>
        <td style="color:var(--tx3)">${r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Active'}</td>
        <td><button class="boc btn py-1 px-2" style="font-size:.75rem;color:#34d399" onclick="NovaAdmin.unblockIp('${esc(String(r.id))}')">Unblock</button></td></tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--tx3);padding:20px">No blocked IPs.</td></tr>') + '</tbody>';
  }
  function addBlockedIp() {
    const inp = document.getElementById('newIpInput');
    const reasonEl = document.getElementById('newIpReason');
    const ip = inp.value.trim();
    const reason = reasonEl ? reasonEl.value.trim() : '';
    if (!ip) return;
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !/^[\da-fA-F:]+$/.test(ip)) return novaToast('Enter a valid IP address.');
    if (blockedIps.some(r => r.ip_address === ip)) return novaToast('IP already blocked.');
    NovaApi.superAdminBlockIP(ip, reason).then(row => {
      blockedIps.unshift(row); inp.value = ''; if (reasonEl) reasonEl.value = '';
      paintBlockedIps(); novaToast('IP added to blocklist.');
    }).catch(e => toastErr(e));
  }
  function unblockIp(id) {
    NovaApi.superAdminUnblockIP(id).then(() => {
      blockedIps = blockedIps.filter(r => String(r.id) !== String(id));
      paintBlockedIps(); novaToast('IP unblocked.');
    }).catch(e => toastErr(e));
  }
  function saveRateLimits() { /* server-managed via env vars */ }

  function loadSystem() {
    const apply = d => {
      document.getElementById('superSystem').innerHTML =
        card(d.users, 'Users', '#a78bfa') + card(d.startups, 'Startups', '#60a5fa') +
        card(d.ai_requests || 0, 'AI Requests (24h)', '#34d399') + card(d.active_subscriptions, 'Active Subs', '#fbbf24');
    };
    Promise.all([NovaApi.adminGetStats(), aiRequestsLast24h()])
      .then(([stats, ai]) => apply(Object.assign({}, stats, { ai_requests: ai })))
      .catch(e => { toastErr(e); apply({}); });
    // Health probes (real).
    NovaApi.systemHealth().then(h => drawHealthMonitors(h.probes || [])).catch(() => drawHealthMonitors([]));
  }
  async function aiRequestsLast24h() {
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count } = await NovaApi.supabase.from('ai_requests')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', since);
      return count || 0;
    } catch (_) { return 0; }
  }
  const monitorCharts = {};
  function drawHealthMonitors(probes) {
    const host = document.getElementById('superMonitors');
    if (!host) return;
    if (!probes.length) {
      host.innerHTML = '<div class="col-12" style="color:var(--tx3);font-size:.82rem">Health probes unavailable.</div>';
      return;
    }
    const COLORS = { database: '#a78bfa', ai: '#34d399', storage: '#60a5fa', stripe: '#fbbf24' };
    const STATUS_COLOR = { ok: '#34d399', degraded: '#fbbf24', down: '#f87171' };
    host.innerHTML = probes.map(p => {
      const c = STATUS_COLOR[p.status] || '#6b6b8a';
      return `
        <div class="col-6 col-xl-3">
          <div class="db-stat-card">
            <div class="d-flex align-items-center justify-content-between mb-2">
              <span style="font-size:.8rem;font-weight:600;text-transform:capitalize">${esc(p.source)}</span>
              <span class="bst" style="background:${c}22;color:${c};font-size:.66rem"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${c};margin-right:4px"></span>${esc(p.status)}</span>
            </div>
            <div style="font-size:1.6rem;font-weight:700;color:${COLORS[p.source] || '#a78bfa'}">${esc(String(p.latency_ms))}<span style="font-size:.7rem;color:var(--tx3);margin-left:4px">ms</span></div>
            <div style="font-size:.7rem;color:var(--tx3)">Latest probe</div>
          </div>
        </div>`;
    }).join('');
  }

  function toastErr(e) {
    const msg = (e && e.status === 403) ? 'You do not have permission for this action.' : (e && e.message) || 'Request failed.';
    if (global.novaToast) novaToast(msg);
  }

  global.NovaAdmin = {
    applyRole, load, setContext,
    detectRole,
    searchUsers, toggleUser, editUser, editUserFromButton, delUser,
    newFunding, delFunding,
    newVisa, delVisa,
    newBlog, editBlog, editBlogFromButton, delBlog,
    saveCms,
    saveAi, testAi, testEmail,
    submitCrud,
    filterTickets, openTicket, sendTicketReply,
    saveGateway,
    addBlockedIp, unblockIp, saveRateLimits,
    isAdmin: () => role.admin, isSuperAdmin: () => role.superAdmin,
  };
})(window);
