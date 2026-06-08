/* =====================================================================
   Nova StartupOS AI — Internationalization Engine (NovaI18n)
   ---------------------------------------------------------------------
   • Loads `locales/{lang}.json` on demand and caches them.
   • Exposes `t(key, vars)` for translation lookups (supports dot paths
     like 'nav.funding_db' and {{var}} placeholders).
   • `switchLanguage(lang)` flips html dir/lang, swaps fonts, applies
     translations to every element with [data-i18n*], and dispatches a
     window event so feature code can re-render any imperatively-built UI.
   • Persists the user's choice in localStorage (key: nova.lang).
   • Does NOT touch the network — locales ship as static files alongside
     the SPA, so they're cached by the browser and the CDN.

   Usage in HTML:
     <span data-i18n="nav.dashboard">Dashboard</span>
     <input data-i18n-attr="placeholder:auth.email" />
     <button data-i18n-html="decks.generate">Generate Deck</button>

   Usage in JS:
     NovaI18n.t('decks.generate');
     NovaI18n.t('billing.renews_at', { date: '2026-08-01' });
     NovaI18n.switchLanguage('ar');
     window.addEventListener('nova:lang-changed', e => { ... });
   ===================================================================== */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'nova.lang';
  const DEFAULT_LANG = 'en';
  const SUPPORTED = ['en', 'ar'];

  const cache = Object.create(null);
  let activeLang = null;
  let activeBundle = {};

  /* ---------------------- Bundle loader ----------------------------- */
  async function loadBundle(lang) {
    if (cache[lang]) return cache[lang];
    try {
      const res = await fetch('locales/' + lang + '.json', { cache: 'force-cache' });
      if (!res.ok) throw new Error('http_' + res.status);
      const data = await res.json();
      cache[lang] = data;
      return data;
    } catch (e) {
      console.warn('[NovaI18n] failed to load', lang, e.message);
      // Fall back to an empty bundle so t() returns the key (graceful).
      cache[lang] = { _meta: { code: lang, dir: lang === 'ar' ? 'rtl' : 'ltr', font: '' } };
      return cache[lang];
    }
  }

  /* ---------------------- Translation lookup ------------------------ */
  function lookup(bundle, key) {
    if (!bundle || !key) return undefined;
    const parts = key.split('.');
    let cur = bundle;
    for (let i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function format(str, vars) {
    if (typeof str !== 'string' || !vars) return str;
    return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, k) {
      return (vars[k] != null) ? String(vars[k]) : '';
    });
  }

  /**
   * Translate a key. Falls back to the English bundle, then to the raw
   * key, so missing translations are visible without breaking the UI.
   */
  function t(key, vars) {
    const direct = lookup(activeBundle, key);
    if (direct != null) return format(direct, vars);
    const fallback = lookup(cache.en || {}, key);
    if (fallback != null) return format(fallback, vars);
    return key;
  }

  /* ---------------------- DOM application --------------------------- */
  /**
   * Apply translations to every `[data-i18n*]` element in `root`.
   *
   * Three attribute flavours are supported:
   *   data-i18n="key"           → element.textContent = t('key')
   *   data-i18n-html="key"      → element.innerHTML  = t('key')   (use only for trusted keys!)
   *   data-i18n-attr="attr:key; attr2:key2"
   *                             → element.setAttribute(attr, t(key)) for each pair
   */
  function applyTranslations(root) {
    const host = root || document;

    host.querySelectorAll('[data-i18n]').forEach(function (el) {
      const k = el.getAttribute('data-i18n');
      const v = t(k);
      if (v !== k) el.textContent = v;
    });

    host.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      const k = el.getAttribute('data-i18n-html');
      const v = t(k);
      if (v !== k) el.innerHTML = v;
    });

    host.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      const spec = el.getAttribute('data-i18n-attr') || '';
      spec.split(';').forEach(function (pair) {
        const idx = pair.indexOf(':');
        if (idx === -1) return;
        const attr = pair.slice(0, idx).trim();
        const key  = pair.slice(idx + 1).trim();
        const v    = t(key);
        if (attr && v !== key) el.setAttribute(attr, v);
      });
    });
  }

  /* ---------------------- Direction & font -------------------------- */
  function applyDirAndFont(meta) {
    const html = document.documentElement;
    const body = document.body;
    const dir  = (meta && meta.dir) || (activeLang === 'ar' ? 'rtl' : 'ltr');
    const font = (meta && meta.font) || '';

    html.setAttribute('dir', dir);
    html.setAttribute('lang', activeLang);
    if (body) {
      // Body class lets CSS provide RTL/LTR-specific tweaks (e.g. icon
      // mirroring) without touching every component.
      body.classList.remove('rtl', 'ltr');
      body.classList.add(dir);
    }
    // Font is applied by attaching to <html> via a CSS variable; falls
    // through to the existing nova.css cascade if the variable is unset.
    if (font) html.style.setProperty('--nova-font', font);
  }

  /* ---------------------- Public switcher --------------------------- */
  /**
   * Activate a language. Resolves once the bundle is loaded and DOM is
   * updated. Idempotent — calling with the same lang is a no-op.
   * @param {'en'|'ar'} lang
   */
  async function switchLanguage(lang) {
    const target = SUPPORTED.indexOf(lang) >= 0 ? lang : DEFAULT_LANG;
    if (activeLang === target) return target;

    const bundle = await loadBundle(target);
    activeLang   = target;
    activeBundle = bundle;
    applyDirAndFont(bundle._meta || {});
    applyTranslations();

    try { localStorage.setItem(STORAGE_KEY, target); } catch (_) {}

    // Notify imperative renderers (admin sidebar, dynamic tables, etc.)
    // so they can rebuild their content with the new language.
    document.dispatchEvent(new CustomEvent('nova:lang-changed', { detail: { lang: target } }));
    window.dispatchEvent(new CustomEvent('nova:lang-changed', { detail: { lang: target } }));

    // Sync any visible language toggle controls.
    document.querySelectorAll('[data-lang-switch]').forEach(function (btn) {
      btn.classList.toggle('on', btn.getAttribute('data-lang-switch') === target);
    });

    return target;
  }

  /* ---------------------- Boot ------------------------------------- */
  // Pick a language from (in order): localStorage → <html lang> → browser → DEFAULT.
  function detectInitialLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) >= 0) return saved;
    } catch (_) {}
    const htmlLang = (document.documentElement.getAttribute('lang') || '').slice(0, 2).toLowerCase();
    if (SUPPORTED.indexOf(htmlLang) >= 0) return htmlLang;
    const nav = (navigator.language || navigator.userLanguage || 'en').slice(0, 2).toLowerCase();
    return SUPPORTED.indexOf(nav) >= 0 ? nav : DEFAULT_LANG;
  }

  function getLanguage()    { return activeLang; }
  function getDirection()   { return (activeBundle && activeBundle._meta && activeBundle._meta.dir) || 'ltr'; }
  function getFontStack()   { return (activeBundle && activeBundle._meta && activeBundle._meta.font) || ''; }
  function isRtl()          { return getDirection() === 'rtl'; }

  // Eagerly preload the English bundle so t() always has a fallback,
  // then switch to the user's preferred language.
  loadBundle('en').then(function () {
    return switchLanguage(detectInitialLang());
  });

  global.NovaI18n = {
    t: t,
    switchLanguage: switchLanguage,
    applyTranslations: applyTranslations,
    getLanguage: getLanguage,
    getDirection: getDirection,
    getFontStack: getFontStack,
    isRtl: isRtl,
    SUPPORTED: SUPPORTED,
  };
  // Convenience global so feature code can write `t('nav.dashboard')`.
  if (typeof global.t === 'undefined') global.t = t;
})(window);
