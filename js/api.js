/* =====================================================================
   Nova StartupOS AI — Backend API client (NovaApi) v2

   This module is the single network hub. Every call routes through:
     • Supabase JS SDK for Auth, DB CRUD, and Storage (RLS enforced).
     • Vercel serverless functions at /api/* for AI streaming, Stripe
       checkout, the Stripe webhook, and the system-health probe.

   No demo / fake / fallback authentication exists in v2. Login fails
   when Supabase auth fails. No browser-stored AI keys.
   ===================================================================== */
(function (global) {
  'use strict';

  /* ---------------------------- Supabase ----------------------------- */
  const SUPABASE_URL =
       global.SUPABASE_URL
    || localStorage.getItem('nova.supabase_url')
    || '';
  const SUPABASE_ANON_KEY =
       global.SUPABASE_ANON_KEY
    || localStorage.getItem('nova.supabase_anon_key')
    || '';

  let supabase = null;
  if (global.supabase && typeof global.supabase.createClient === 'function'
      && SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } else if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[NovaApi] Supabase URL / anon key not configured. ' +
      'Set window.SUPABASE_URL & window.SUPABASE_ANON_KEY (in index.html) or the matching localStorage entries.');
  } else {
    console.error('[NovaApi] Supabase SDK not loaded. Check the <script> tag for @supabase/supabase-js.');
  }

  // Same-origin in production; configurable for local dev.
  const API_BASE =
       global.NOVA_API_BASE
    || localStorage.getItem('nova.api_base')
    || '';   // empty → same-origin (recommended on Vercel)

  /* ----------------------------- Helpers ----------------------------- */
  function sbErr(error, fallback) {
    const e = new Error((error && error.message) || fallback || 'Supabase request failed.');
    e.status = error && (error.status || error.code);
    return e;
  }

  async function authedFetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {}, { 'Accept': 'application/json' });
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    if (session && session.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;

    const res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string'
            ? JSON.stringify(opts.body) : opts.body,
      signal: opts.signal,
    });

    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : null;
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  /* ---------------------- Auth response normalizer ------------------- */
  // Maps Supabase auth user + profiles row → the user contract main.js expects.
  async function _mapUser(supabaseUser) {
    if (!supabaseUser) return null;
    let profile = null;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('name, role, plan_tier, is_active')
        .eq('id', supabaseUser.id)
        .single();
      profile = data;
    } catch (_) { /* profile may not exist for a brand-new user yet */ }

    if (profile && profile.is_active === false) {
      // The account is disabled — refuse to construct a user object.
      try { await supabase.auth.signOut(); } catch (_) {}
      const e = new Error('Your account is disabled. Contact support.');
      e.status = 403;
      throw e;
    }

    const meta = supabaseUser.user_metadata || {};
    const role = (profile && profile.role) || 'User';
    const isSuperAdmin = role === 'Super Admin';
    const isAdmin = role === 'Admin' || isSuperAdmin;
    const planTier = (profile && profile.plan_tier) || 'Free';
    const name = (profile && profile.name) || meta.display_name || meta.name
      || (supabaseUser.email ? supabaseUser.email.split('@')[0] : 'Founder');

    return {
      id: supabaseUser.id,
      name,
      email: supabaseUser.email,
      plan: /plan$/i.test(planTier) ? planTier : (planTier + ' Plan'),
      plan_tier: planTier,
      is_admin: isAdmin,
      is_super_admin: isSuperAdmin,
      role,
      roles: [role],
    };
  }

  /* ------------------------- Public API surface ---------------------- */
  const NovaApi = {
    base: API_BASE,
    supabase,
    SUPABASE_URL,

    /* ============================== AUTH ============================ */
    async register(name, email, password) {
      if (name && typeof name === 'object') {
        const p = name; name = p.name; email = p.email; password = p.password;
      }
      if (!supabase) throw new Error('Authentication is not configured.');
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { display_name: name, name } },
      });
      if (error) { const e = new Error(error.message); e.status = error.status; throw e; }
      return _mapUser(data.user);
    },

    async login(email, password) {
      if (!supabase) throw new Error('Authentication is not configured.');
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { const e = new Error(error.message); e.status = error.status || 401; throw e; }
      return _mapUser(data.user);
    },

    async quickLogin(provider) {
      if (!supabase) throw new Error('Authentication is not configured.');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: global.location.origin + global.location.pathname },
      });
      if (error) { const e = new Error(error.message); e.status = error.status; throw e; }
      return data;
    },

    async logout() {
      if (supabase) { try { await supabase.auth.signOut(); } catch (_) {} }
      if (global.NovaStore) {
        if (typeof NovaStore.reset === 'function') NovaStore.reset();
      }
    },

    async me() {
      if (!supabase) return null;
      const { data, error } = await supabase.auth.getUser();
      if (error || !data || !data.user) return null;
      return _mapUser(data.user);
    },

    async sendPasswordReset(email) {
      if (!supabase) throw new Error('Authentication is not configured.');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: global.location.origin + global.location.pathname + '?reset=1',
      });
      if (error) throw sbErr(error);
    },

    async updateProfile(payload) {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const patch = {};
      if (payload.name)    patch.name = payload.name;
      // Note: email changes flow through Supabase auth.updateUser separately.
      const { data, error } = await supabase.from('profiles')
        .update(patch).eq('id', uid).select().single();
      if (error) throw sbErr(error);
      return data;
    },

    /* ============================ STARTUPS ========================== */
    async _uploadLogo(file) {
      if (!file || typeof file === 'string') return (typeof file === 'string' ? file : null);
      const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'png';
      const uniq = (global.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
      const path = uniq + '.' + ext;
      const { error: upErr } = await supabase.storage.from('startup-logos').upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw sbErr(upErr);
      const { data } = supabase.storage.from('startup-logos').getPublicUrl(path);
      return data ? data.publicUrl : null;
    },
    _pickLogoFile(d) { return (d && (d.logoFile || d.startup_file || d.logo_file)) || null; },

    async createStartup(startupData) {
      startupData = startupData || {};
      let logo_url = startupData.logo_url || null;
      const file = this._pickLogoFile(startupData);
      if (file) logo_url = await this._uploadLogo(file);
      const uid = (await supabase.auth.getUser()).data.user.id;
      const row = {
        name: startupData.name,
        industry: startupData.industry,
        country: startupData.country,
        current_stage: startupData.current_stage || startupData.stage || null,
        target_market: startupData.target_market || startupData.market || null,
        problem: startupData.problem || null,
        solution: startupData.solution || null,
        logo_url,
        user_id: uid,
      };
      const { data, error } = await supabase.from('startups').insert(row).select().single();
      if (error) throw sbErr(error);
      return data;
    },

    async getStartups() {
      const { data, error } = await supabase
        .from('startups').select('*').order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      return data || [];
    },
    startups() { return this.getStartups(); },

    async startup(id) {
      const { data, error } = await supabase.from('startups').select('*').eq('id', id).single();
      if (error) throw sbErr(error);
      return data;
    },

    async updateStartup(id, updatedData) {
      updatedData = updatedData || {};
      const patch = Object.assign({}, updatedData);
      const file = this._pickLogoFile(updatedData);
      if (file) patch.logo_url = await this._uploadLogo(file);
      delete patch.logoFile; delete patch.startup_file; delete patch.logo_file;
      if (patch.stage && !patch.current_stage) patch.current_stage = patch.stage;
      delete patch.stage;
      if (patch.market && !patch.target_market) patch.target_market = patch.market;
      delete patch.market;
      const { data, error } = await supabase.from('startups').update(patch).eq('id', id).select().single();
      if (error) throw sbErr(error);
      return data;
    },

    async deleteStartup(id) {
      const { error } = await supabase.from('startups').delete().eq('id', id);
      if (error) throw sbErr(error);
      return { success: true, id };
    },

    /* ====================== GENERATED DOCUMENTS ===================== */
    async saveDocument(doc) {
      doc = doc || {};
      const uid = (await supabase.auth.getUser()).data.user.id;
      const row = {
        startup_id: doc.startup_id || null,
        user_id: uid,
        doc_type: doc.doc_type,
        title: doc.title,
        content: typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content),
      };
      const { data, error } = await supabase.from('generated_documents').insert(row).select().single();
      if (error) throw sbErr(error);
      return data;
    },
    async getDocuments(startupId) {
      let q = supabase.from('generated_documents').select('*').order('created_at', { ascending: false });
      if (startupId) q = q.eq('startup_id', startupId);
      const { data, error } = await q;
      if (error) throw sbErr(error);
      return data || [];
    },
    async deleteDocument(id) {
      const { error } = await supabase.from('generated_documents').delete().eq('id', id);
      if (error) throw sbErr(error);
      return { success: true, id };
    },

    /* ============================ FUNDING =========================== */
    async funding(params) {
      let q = supabase.from('funding_sources').select('*').order('created_at', { ascending: false });
      if (params && params.type) q = q.eq('type', params.type);
      if (params && params.country) q = q.ilike('country', '%' + params.country + '%');
      const { data, error } = await q;
      if (error) throw sbErr(error);
      return data || [];
    },
    async saveFundingOpportunity(funding_source_id, notes) {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const { data, error } = await supabase.from('saved_funding')
        .upsert({ user_id: uid, funding_source_id, notes: notes || null }, { onConflict: 'user_id,funding_source_id' })
        .select().single();
      if (error) throw sbErr(error);
      return data;
    },
    async getSavedFunding() {
      const { data, error } = await supabase
        .from('saved_funding')
        .select('id, notes, created_at, funding:funding_sources(*)')
        .order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      return data || [];
    },

    /* ============================== VISA ============================ */
    async visa(params) {
      let q = supabase.from('visa_programs').select('*').order('fit_score', { ascending: false, nullsLast: true });
      if (params && params.country) q = q.ilike('country', '%' + params.country + '%');
      const { data, error } = await q;
      if (error) throw sbErr(error);
      return data || [];
    },

    /* ========================= ASSESSMENTS ========================== */
    async runAssessment(startupId, scores, recommendations, inputs) {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const composite = Math.round((scores.innovation + scores.scalability + scores.market + scores.investment) / 4);
      const row = {
        user_id: uid, startup_id: startupId,
        innovation_score: scores.innovation, scalability_score: scores.scalability,
        market_score: scores.market,         investment_score: scores.investment,
        composite_score: composite,
        recommendations: recommendations || [],
        inputs: inputs || {},
      };
      const { data, error } = await supabase.from('assessments').insert(row).select().single();
      if (error) throw sbErr(error);
      // Mirror onto startups.startup_score for the dashboard chips.
      await supabase.from('startups')
        .update({ startup_score: composite, scores })
        .eq('id', startupId);
      return data;
    },
    async getLatestAssessment(startupId) {
      const { data, error } = await supabase.from('assessments')
        .select('*').eq('startup_id', startupId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw sbErr(error);
      return data;
    },

    /* ========================= AI STREAMING ========================= */
    /**
     * Build a project-aware system prompt that grounds the LLM in this
     * specific startup's architecture (schema, spec) and the active
     * startup's profile fields. Used by the deck/plan generators so the
     * AI never has to guess what tables, modules, or stage values exist.
     *
     * @param {Object} ctx
     * @param {Object} [ctx.startup]   — { name, industry, country, market, problem, solution, stage, score }
     * @param {string} [ctx.audience]  — 'investors' | 'team' | 'visa' (defaults 'investors')
     * @param {string} [ctx.locale]    — 'ar' | 'en' (defaults 'ar')
     * @returns {string} the composed system prompt (server-trusted)
     */
    buildProjectContextPrompt(ctx) {
      ctx = ctx || {};
      const lang = ctx.locale || 'ar';
      const audience = ctx.audience || 'investors';
      const s = ctx.startup || {};
      const intro = lang === 'ar'
        ? 'أنت Nova، شريك ذكاء اصطناعي يساعد المؤسسين على بناء عروض تقديمية وخطط أعمال بمستوى المستثمرين.'
        : 'You are Nova, an AI co-founder building investor-ready pitch decks and business plans.';
      const platformLine = lang === 'ar'
        ? 'منصّة العمل: Nova StartupOS AI — تطبيق صفحة واحدة (SPA) مبني بـ Vanilla JS، يعتمد Supabase Auth + Postgres مع RLS، تخزين Supabase، ووظائف Vercel السيرفرلِس لبثّ الذكاء الاصطناعي والمدفوعات.'
        : 'Platform: Nova StartupOS AI — Vanilla JS SPA on Supabase Auth + Postgres (RLS) + Storage with Vercel serverless functions for AI streaming and Stripe.';
      const schemaSummary = lang === 'ar'
        ? 'الجداول الأساسية: profiles, startups, generated_documents, support_tickets, blog_posts, funding_sources, visa_programs, ai_providers_config, payment_gateways, blocked_ips. والمراحل المعتمدة لجدول startups.current_stage هي: Idea, MVP, Early Stage, Growth, Scale.'
        : 'Core tables: profiles, startups, generated_documents, support_tickets, blog_posts, funding_sources, visa_programs, ai_providers_config, payment_gateways, blocked_ips. startups.current_stage values: Idea, MVP, Early Stage, Growth, Scale.';
      const audienceLine = lang === 'ar'
        ? (audience === 'investors'
            ? 'الجمهور: مستثمرون مرحلة Pre-seed إلى Series A. ركّز على المشكلة، الحل، حجم السوق، نموذج الإيرادات، الجاذبية، الفريق، والطلب التمويلي.'
            : 'الجمهور: ' + audience)
        : 'Audience: pre-seed to Series A investors. Emphasize problem, solution, market size, revenue model, traction, team, ask.';
      const styleLine = lang === 'ar'
        ? 'الأسلوب: عربية فصحى موجزة، جمل قصيرة، أرقام عند توفّرها، تجنّب الإطالة. لا تستخدم أيّ Markdown إلا إذا طُلب JSON صريح.'
        : 'Style: concise, sharp sentences, prefer numbers, avoid filler. No Markdown unless explicit JSON is requested.';
      const profileLines = [];
      if (s.name)     profileLines.push((lang === 'ar' ? '- الاسم: '     : '- Name: ')      + s.name);
      if (s.industry) profileLines.push((lang === 'ar' ? '- القطاع: '    : '- Industry: ')  + s.industry);
      if (s.country)  profileLines.push((lang === 'ar' ? '- الدولة: '    : '- Country: ')   + s.country);
      if (s.market)   profileLines.push((lang === 'ar' ? '- السوق: '     : '- Market: ')    + s.market);
      if (s.problem)  profileLines.push((lang === 'ar' ? '- المشكلة: '   : '- Problem: ')   + s.problem);
      if (s.solution) profileLines.push((lang === 'ar' ? '- الحل: '      : '- Solution: ')  + s.solution);
      if (s.stage)    profileLines.push((lang === 'ar' ? '- المرحلة: '   : '- Stage: ')     + s.stage);
      if (s.score)    profileLines.push((lang === 'ar' ? '- نقاط الجاهزية: ' : '- Readiness: ') + s.score + '/100');
      const profileBlock = profileLines.length
        ? (lang === 'ar' ? '\n\nبيانات الشركة الناشئة:\n' : '\n\nStartup profile:\n') + profileLines.join('\n')
        : '';
      return [intro, platformLine, schemaSummary, audienceLine, styleLine].join(' ') + profileBlock;
    },

    /**
     * Stream a Nova AI generation through the secure /api/ai-stream proxy.
     * No API key ever touches the browser. Auth is the user's Supabase JWT.
     */
    async aiStream(prompt, opts) {
      opts = opts || {};
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      if (!session || !session.access_token) throw new Error('Please sign in to use the AI Copilot.');

      const res = await fetch(API_BASE + '/api/ai-stream', {
        method: 'POST',
        signal: opts.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({
          prompt,
          systemPrompt: opts.systemPrompt || '',
          model: opts.model || '',
        }),
      });

      if (!res.ok || !res.body) {
        let msg;
        try { const j = await res.json(); msg = j.error; } catch (_) { msg = res.statusText; }
        const e = new Error('AI request failed (' + res.status + '): ' + (msg || 'unknown error'));
        e.status = res.status; throw e;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.indexOf('data:') !== 0) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            if (json.error) {
              const e = new Error(json.error); e.upstream = true; throw e;
            }
            const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
            if (delta) { full += delta; if (opts.onChunk) opts.onChunk(delta); }
          } catch (e) {
            if (e && e.upstream) { if (opts.onError) opts.onError(e); }
            // Otherwise: partial JSON across chunks — ignore.
          }
        }
      }
      if (opts.onDone) opts.onDone(full);
      return full;
    },

    /* ========================= STRIPE BILLING ======================= */
    async startCheckout(plan, cycle) {
      // plan: 'pro' | 'startup'    cycle: 'monthly' | 'yearly'
      return authedFetch('/api/stripe-checkout', {
        method: 'POST',
        body: { plan, cycle },
      });
    },
    async getMySubscription() {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const { data, error } = await supabase.from('subscriptions')
        .select('*').eq('user_id', uid)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw sbErr(error);
      return data;
    },
    async getMyPayments() {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const { data, error } = await supabase.from('payments')
        .select('id, amount_cents, currency, status, description, receipt_url, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      return data || [];
    },

    /* ========================= NOTIFICATIONS ======================== */
    async notifications() {
      const { data, error } = await supabase.from('notifications')
        .select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw sbErr(error);
      return data || [];
    },
    async markAllNotificationsRead() {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const { error } = await supabase.from('notifications')
        .update({ is_read: true }).eq('user_id', uid).eq('is_read', false);
      if (error) throw sbErr(error);
    },

    /* ========================= ADMIN (RLS-gated) ==================== */
    async adminGetUsers(search) {
      let q = supabase.from('profiles')
        .select('id, name, email, role, plan_tier, is_active, created_at')
        .order('created_at', { ascending: false });
      if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) throw sbErr(error);
      return data || [];
    },
    async adminUpdateUser(id, payload) {
      const { data, error } = await supabase.from('profiles').update(payload).eq('id', id).select().single();
      if (error) throw sbErr(error);
      return data;
    },
    async adminToggleUser(id) {
      const { data: cur, error: e1 } = await supabase.from('profiles').select('is_active').eq('id', id).single();
      if (e1) throw sbErr(e1);
      const next = !(cur && cur.is_active);
      const { error } = await supabase.from('profiles').update({ is_active: next }).eq('id', id);
      if (error) throw sbErr(error);
      return { is_active: next };
    },
    async adminDeleteUser(id) {
      const { error } = await supabase.from('profiles').delete().eq('id', id);
      if (error) throw sbErr(error);
      return { success: true };
    },

    async adminGetTickets() {
      const { data, error } = await supabase.from('support_tickets')
        .select('*, profile:profiles(name, email)')
        .order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      return (data || []).map(_normTicket);
    },
    async adminReplyToTicket(id, messages, status) {
      const patch = { messages };
      if (status) patch.status = status;
      const { data, error } = await supabase.from('support_tickets')
        .update(patch).eq('id', id).select().single();
      if (error) throw sbErr(error);
      return _normTicket(data);
    },

    async superAdminGetAIConfig() {
      const { data, error } = await supabase.from('ai_providers_config').select('*');
      if (error) throw sbErr(error);
      return (data || []).map(_normAi);
    },
    async superAdminUpdateAIConfig(providerName, fields) {
      // Strip any browser-leaked api_key field — keys live in Vercel env only.
      const safe = Object.assign({}, fields);
      delete safe.api_key;
      const { data, error } = await supabase.from('ai_providers_config')
        .update(safe).eq('provider_name', providerName).select().single();
      if (error) throw sbErr(error);
      return _normAi(data);
    },

    async superAdminGetBlockedIPs() {
      const { data, error } = await supabase.from('blocked_ips')
        .select('*').order('created_at', { ascending: false });
      if (error) throw sbErr(error);
      return data || [];
    },
    async superAdminBlockIP(ip, reason) {
      const uid = (await supabase.auth.getUser()).data.user.id;
      const { data, error } = await supabase.from('blocked_ips')
        .insert({ ip_address: ip, reason: reason || null, created_by: uid })
        .select().single();
      if (error) throw sbErr(error);
      return data;
    },
    async superAdminUnblockIP(id) {
      const { error } = await supabase.from('blocked_ips').delete().eq('id', id);
      if (error) throw sbErr(error);
      return { success: true };
    },

    async superAdminSaveGateway(payload) {
      // Keys land in flat columns; the trigger mirrors them into config jsonb.
      const { data, error } = await supabase.from('payment_gateways')
        .upsert(payload, { onConflict: 'provider' }).select().single();
      if (error) throw sbErr(error);
      return data;
    },
    async superAdminGetGateways() {
      const { data, error } = await supabase.from('payment_gateways').select('*');
      if (error) throw sbErr(error);
      return data || [];
    },

    /* ============== Admin Stats — derived from real tables ========== */
    async adminGetStats() {
      const countOf = async (table, filter) => {
        try {
          let q = supabase.from(table).select('*', { count: 'exact', head: true });
          if (filter) q = filter(q);
          const { count } = await q;
          return count || 0;
        } catch (_) { return 0; }
      };
      const [users, startups, tickets, activeSubs] = await Promise.all([
        countOf('profiles'),
        countOf('startups'),
        countOf('support_tickets'),
        countOf('subscriptions', (q) => q.in('status', ['active', 'trialing'])),
      ]);
      // Real revenue: sum of succeeded payments in cents.
      let revenue = 0;
      try {
        const { data } = await supabase.from('payments')
          .select('amount_cents').eq('status', 'succeeded').limit(1000);
        revenue = ((data || []).reduce((s, p) => s + (p.amount_cents || 0), 0)) / 100;
      } catch (_) { revenue = 0; }
      return { users, startups, tickets, active_subscriptions: activeSubs, revenue };
    },

    async adminGetAuditLogs() {
      const { data, error } = await supabase.from('audit_logs')
        .select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw sbErr(error);
      return data || [];
    },

    async adminGetRevenueHistory() {
      // Last 12 months of succeeded payments, summed in cents per month.
      const since = new Date(); since.setMonth(since.getMonth() - 11); since.setDate(1);
      const { data, error } = await supabase.from('payments')
        .select('amount_cents, created_at, status')
        .eq('status', 'succeeded')
        .gte('created_at', since.toISOString());
      if (error) throw sbErr(error);
      const buckets = {};
      (data || []).forEach((p) => {
        const k = p.created_at.slice(0, 7); // YYYY-MM
        buckets[k] = (buckets[k] || 0) + (p.amount_cents || 0);
      });
      const out = [];
      for (let i = 0; i < 12; i++) {
        const d = new Date(since); d.setMonth(d.getMonth() + i);
        const k = d.toISOString().slice(0, 7);
        out.push({ month: k, total_cents: buckets[k] || 0 });
      }
      return out;
    },

    /* ============================= ADMIN CRUD ======================= */
    admin: {
      async funding() {
        const { data, error } = await supabase.from('funding_sources')
          .select('*').order('created_at', { ascending: false });
        if (error) throw sbErr(error);
        return data || [];
      },
      async saveFunding(payload) {
        const { data, error } = await supabase.from('funding_sources')
          .insert(payload).select().single();
        if (error) throw sbErr(error);
        return data;
      },
      async deleteFunding(id) {
        const { error } = await supabase.from('funding_sources').delete().eq('id', id);
        if (error) throw sbErr(error);
        return { success: true };
      },

      async visa() {
        const { data, error } = await supabase.from('visa_programs')
          .select('*').order('created_at', { ascending: false });
        if (error) throw sbErr(error);
        return (data || []).map((v) => Object.assign({}, v, { fit_score: v.fit_score != null ? v.fit_score : null }));
      },
      async saveVisa(payload) {
        const { data, error } = await supabase.from('visa_programs')
          .insert(payload).select().single();
        if (error) throw sbErr(error);
        return data;
      },
      async deleteVisa(id) {
        const { error } = await supabase.from('visa_programs').delete().eq('id', id);
        if (error) throw sbErr(error);
        return { success: true };
      },

      async blog() {
        const { data, error } = await supabase.from('blog_posts')
          .select('*').order('created_at', { ascending: false });
        if (error) throw sbErr(error);
        return data || [];
      },
      async saveBlog(payload) {
        // Schema has snippet/scheduled_at as canonical; UI uses excerpt/publish_at.
        // The DB trigger keeps both pairs in sync.
        const row = Object.assign({}, payload);
        let res;
        if (row.id) {
          const id = row.id; delete row.id;
          res = await supabase.from('blog_posts').update(row).eq('id', id).select().single();
        } else {
          res = await supabase.from('blog_posts').insert(row).select().single();
        }
        if (res.error) throw sbErr(res.error);
        return res.data;
      },
      async deleteBlog(id) {
        const { error } = await supabase.from('blog_posts').delete().eq('id', id);
        if (error) throw sbErr(error);
        return { success: true };
      },

      async plans() {
        // Aggregate plan stats from active subscriptions.
        const { data, error } = await supabase.from('subscriptions')
          .select('plan_tier, status').in('status', ['active', 'trialing']);
        if (error) throw sbErr(error);
        const counts = {};
        (data || []).forEach((r) => { counts[r.plan_tier] = (counts[r.plan_tier] || 0) + 1; });
        return [
          { name: 'Free',    price_monthly: 0,  price_yearly: 0,    trial_days: 0, is_active: true, subscribers: counts.Free || 0 },
          { name: 'Pro',     price_monthly: 39, price_yearly: 27*12,trial_days: 7, is_active: true, subscribers: counts.Pro || 0 },
          { name: 'Startup', price_monthly: 99, price_yearly: 69*12,trial_days: 14,is_active: true, subscribers: counts.Startup || 0 },
        ];
      },
    },

    /* ===================== SYSTEM HEALTH (Super Admin) ============== */
    async systemHealth() {
      return authedFetch('/api/health', { method: 'GET' });
    },
    async systemEvents(source) {
      let q = supabase.from('system_events').select('*')
        .order('created_at', { ascending: false }).limit(50);
      if (source) q = q.eq('source', source);
      const { data, error } = await q;
      if (error) throw sbErr(error);
      return data || [];
    },

    /* =================== Backwards-compat shims ===================== */
    isAuthed() { return !!(supabase && supabase.auth); },
  };

  /* ----------------------- Internal mappers ------------------------- */
  function _normTicket(r) {
    if (!r) return r;
    const prof = r.profile || r.profiles || null;
    let messages = r.messages;
    if (typeof messages === 'string') { try { messages = JSON.parse(messages); } catch (_) { messages = []; } }
    if (!Array.isArray(messages)) messages = [];
    return Object.assign({}, r, {
      user_name: r.user_name || (prof && prof.name) || (r.user_email ? r.user_email.split('@')[0] : (prof && prof.email ? prof.email.split('@')[0] : 'User')),
      user_email: r.user_email || (prof && prof.email) || '',
      subject: r.subject || r.title || '(no subject)',
      status: r.status || 'open',
      messages,
    });
  }
  function _normAi(r) {
    if (!r) return r;
    return Object.assign({}, r, {
      enabled: r.enabled != null ? r.enabled : false,
      is_default: r.is_default != null ? r.is_default : false,
      default_model: r.default_model || '',
      priority: r.priority != null ? r.priority : null,
      input_cost_per_1k:  r.input_cost_per_1k  != null ? r.input_cost_per_1k  : null,
      output_cost_per_1k: r.output_cost_per_1k != null ? r.output_cost_per_1k : null,
    });
  }

  global.NovaApi = NovaApi;
})(window);
