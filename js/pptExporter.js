/* =====================================================================
   Nova StartupOS AI — PPTX Exporter (NovaPpt)
   ---------------------------------------------------------------------
   Walks the semantic deck markup rendered into #pdResult and produces a
   PowerPoint file via PptxGenJS. Designed for Arabic content: every text
   box ships with { align: 'right', rtl: true } so glyphs render correctly
   right-to-left without breaking ligatures.

   Slide schema this file consumes (must be produced by main.js paintDeck):

     <div class="slide cover" data-type="cover">
       <h1 data-element="title">…</h1>
       <p  data-element="subtitle">…</p>
     </div>

     <div class="slide" data-type="standard">
       <h2 data-element="title">…</h2>
       <p  data-element="content">…</p>          (optional)
       <ul data-element="list">                  (optional — metrics list)
         <li>…</li>
       </ul>
     </div>

   Visual specification:
     • Cover  → deep slate background  (#0F172A) with vibrant text accents (#6366F1).
     • Standard → clean white background, dark title with a decorative #6366F1
                  underline, readable body and bulleted text.
   ===================================================================== */
(function (global) {
  'use strict';

  // ---- Brand palette (kept here so exports stay consistent) ---------
  const COLORS = {
    coverBg:        '0F172A',
    accent:         '6366F1',
    accentLight:    '818CF8',
    coverTitle:     'FFFFFF',
    coverSubtitle:  'CBD5E1',
    coverFooter:    '64748B',
    standardBg:     'FFFFFF',
    standardTitle:  '0F172A',
    standardBody:   '334155',
    standardMuted:  '64748B',
  };

  // Per-language settings used at export time. The active language is
  // pulled from NovaI18n on each export, so toggling languages between
  // exports flips alignment, RTL, fonts, and the cover eyebrow text.
  const LANG_PROFILES = {
    ar: { rtl: true,  align: 'right', font: 'Cairo',           eyebrow: 'عرض تقديمي' },
    en: { rtl: false, align: 'left',  font: 'Inter',           eyebrow: 'PITCH DECK' },
  };

  function activeLangProfile() {
    var code = (global.NovaI18n && typeof global.NovaI18n.getLanguage === 'function')
      ? global.NovaI18n.getLanguage()
      : (document.documentElement.getAttribute('lang') || 'en').slice(0, 2).toLowerCase();
    return LANG_PROFILES[code] || LANG_PROFILES.en;
  }

  const PPTX_CDN = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  const SLIDE_W  = 13.333; // 16:9 widescreen, inches
  const SLIDE_H  = 7.5;

  /* ---------------------- Lazy-load PptxGenJS ----------------------- */
  function loadPptxGenJS() {
    if (global.PptxGenJS) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-nova-pptx]');
      if (existing) { existing.addEventListener('load', resolve); existing.addEventListener('error', reject); return; }
      var s = document.createElement('script');
      s.src = PPTX_CDN; s.async = true; s.dataset.novaPptx = '1';
      s.onload = resolve; s.onerror = function () { reject(new Error('Failed to load PptxGenJS')); };
      document.head.appendChild(s);
    });
  }

  /* ---------------------- Markup → slide model --------------------- */
  /**
   * Parse the rendered semantic markup inside #pdResult (or any container)
   * into a plain-data array the exporter can consume.
   *
   * @param {Element|string} root The container element or its CSS selector.
   * @returns {Array<{type:'cover'|'standard', title:string, subtitle?:string, content?:string, bullets?:string[]}>}
   */
  function parseSlides(root) {
    var host = (typeof root === 'string') ? document.querySelector(root) : root;
    if (!host) return [];
    var nodes = host.querySelectorAll('.slide[data-type]');
    var out = [];
    nodes.forEach(function (node) {
      var type = node.getAttribute('data-type') === 'cover' ? 'cover' : 'standard';
      var titleEl    = node.querySelector('[data-element="title"]');
      var subtitleEl = node.querySelector('[data-element="subtitle"]');
      var contentEl  = node.querySelector('[data-element="content"]');
      var listEl     = node.querySelector('[data-element="list"]');
      var slide = {
        type: type,
        title: txt(titleEl),
      };
      if (type === 'cover') {
        if (subtitleEl) slide.subtitle = txt(subtitleEl);
      } else {
        if (contentEl) slide.content = txt(contentEl);
        if (listEl) {
          slide.bullets = Array.prototype.map.call(
            listEl.querySelectorAll('li'),
            function (li) { return txt(li); }
          ).filter(Boolean);
        }
      }
      out.push(slide);
    });
    return out;
  }
  function txt(el) { return el ? (el.textContent || '').trim() : ''; }

  /* ----------------------- Default text props ---------------------- */
  // Every text box gets locale-aware alignment + RTL + font. Arabic uses
  // right-aligned RTL with the Cairo font; English uses left-aligned LTR
  // with Inter. The active language is resolved on each export.
  function rtl(props, profile) {
    profile = profile || activeLangProfile();
    var base = { rtl: !!profile.rtl, align: profile.align, fontFace: profile.font };
    if (!props) return base;
    return Object.assign(base, props);
  }

  /* ------------------------- Slide builders ------------------------ */
  function buildCover(pptx, slide, data, footer) {
    const profile = activeLangProfile();
    const isRtl = !!profile.rtl;
    slide.background = { color: COLORS.coverBg };

    // Decorative accent bar across the top — gives the cover a premium feel.
    slide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.18, fill: { color: COLORS.accent } });

    // Soft glowing accent shape behind the title (subtle).
    slide.addShape('ellipse', {
      x: isRtl ? -2.4 : SLIDE_W - 4.0, y: 1.6, w: 6.5, h: 6.5,
      fill: { color: COLORS.accent, transparency: 88 }, line: { type: 'none' },
    });

    // Eyebrow label (locale-aware: "Pitch Deck" / "عرض تقديمي").
    slide.addText(profile.eyebrow, rtl({
      x: 0.7, y: 1.0, w: SLIDE_W - 1.4, h: 0.4,
      fontSize: 14, color: COLORS.accentLight, bold: true, charSpacing: 4,
    }, profile));

    // Title (h1).
    slide.addText(data.title || '', rtl({
      x: 0.7, y: 2.3, w: SLIDE_W - 1.4, h: 1.6,
      fontSize: 54, bold: true, color: COLORS.coverTitle, lineSpacingMultiple: 1.1,
    }, profile));

    // Decorative underline — anchored on the title's edge for either direction.
    slide.addShape('rect', {
      x: isRtl ? (SLIDE_W - 1.8) : 0.7, y: 4.05, w: 1.1, h: 0.06,
      fill: { color: COLORS.accent }, line: { type: 'none' },
    });

    // Subtitle.
    if (data.subtitle) {
      slide.addText(data.subtitle, rtl({
        x: 0.7, y: 4.3, w: SLIDE_W - 1.4, h: 1.4,
        fontSize: 22, color: COLORS.coverSubtitle, lineSpacingMultiple: 1.35,
      }, profile));
    }

    // Footer brand line.
    slide.addText(footer || 'Nova StartupOS AI', rtl({
      x: 0.7, y: SLIDE_H - 0.7, w: SLIDE_W - 1.4, h: 0.35,
      fontSize: 11, color: COLORS.coverFooter, bold: true, charSpacing: 3,
    }, profile));
  }

  function buildStandard(pptx, slide, data, idx, total) {
    const profile = activeLangProfile();
    const isRtl = !!profile.rtl;
    slide.background = { color: COLORS.standardBg };

    // Title (h2).
    slide.addText(data.title || '', rtl({
      x: 0.7, y: 0.55, w: SLIDE_W - 1.4, h: 0.85,
      fontSize: 32, bold: true, color: COLORS.standardTitle,
    }, profile));

    // Decorative colored line under the title — anchored on the leading edge.
    slide.addShape('rect', {
      x: isRtl ? (SLIDE_W - 2.2) : 0.7, y: 1.45, w: 1.5, h: 0.08,
      fill: { color: COLORS.accent }, line: { type: 'none' },
    });

    // Body content + bulleted list (each rendered only when present).
    var cursorY = 1.85;
    var bodyH;

    if (data.content) {
      bodyH = data.bullets && data.bullets.length ? 1.8 : 4.2;
      slide.addText(data.content, rtl({
        x: 0.7, y: cursorY, w: SLIDE_W - 1.4, h: bodyH,
        fontSize: 18, color: COLORS.standardBody, lineSpacingMultiple: 1.45, valign: 'top',
      }, profile));
      cursorY += bodyH + 0.15;
    }

    if (data.bullets && data.bullets.length) {
      var remaining = SLIDE_H - cursorY - 0.9;
      var bulletObjs = data.bullets.map(function (b) {
        return { text: b, options: { bullet: { code: '25CF' } } };
      });
      slide.addText(bulletObjs, rtl({
        x: 0.7, y: cursorY, w: SLIDE_W - 1.4, h: Math.max(1.5, remaining),
        fontSize: 17, color: COLORS.standardBody, lineSpacingMultiple: 1.55, valign: 'top',
        paraSpaceAfter: 8,
      }, profile));
    }

    // Footer: page number + brand. Page number sits on the leading side,
    // brand on the trailing side — flipped automatically for RTL.
    slide.addText(String(idx) + ' / ' + String(total), rtl({
      x: isRtl ? 0.7              : SLIDE_W - 2.0, y: SLIDE_H - 0.55, w: 1.5, h: 0.3,
      fontSize: 10, color: COLORS.standardMuted, align: isRtl ? 'left' : 'right',
    }, profile));
    slide.addText('Nova StartupOS AI', rtl({
      x: isRtl ? SLIDE_W - 4.2    : 0.7,           y: SLIDE_H - 0.55, w: 3.5, h: 0.3,
      fontSize: 10, color: COLORS.standardMuted, bold: true, charSpacing: 2,
    }, profile));
  }

  /* ------------------------- Public API ---------------------------- */
  /**
   * Export a deck to PPTX.
   * @param {Object}  opts
   * @param {string}  [opts.fileName]     - Without extension. Default: "nova-pitch-deck".
   * @param {string}  [opts.title]        - Embedded in metadata.
   * @param {string}  [opts.author]       - Embedded in metadata.
   * @param {Array}   [opts.slides]       - Pre-parsed slide array. If omitted, parses from `root`.
   * @param {string|Element} [opts.root]  - Container with the rendered slides. Default: '#pdResult'.
   * @param {string}  [opts.footer]       - Cover footer text. Default: "Nova StartupOS AI".
   */
  async function exportDeck(opts) {
    opts = opts || {};
    await loadPptxGenJS();
    const PptxGenJSCtor = global.PptxGenJS;
    if (!PptxGenJSCtor) throw new Error('PptxGenJS failed to load.');

    const slides = Array.isArray(opts.slides) && opts.slides.length
      ? opts.slides
      : parseSlides(opts.root || '#pdResult');
    if (!slides.length) throw new Error('No slides to export. Generate a deck first.');

    const pptx = new PptxGenJSCtor();
    pptx.defineLayout({ name: 'NOVA_169', width: SLIDE_W, height: SLIDE_H });
    pptx.layout = 'NOVA_169';
    pptx.author  = opts.author  || 'Nova StartupOS AI';
    pptx.company = 'Nova StartupOS AI';
    pptx.title   = opts.title   || 'Pitch Deck';
    pptx.rtlMode = !!activeLangProfile().rtl; // hint for PowerPoint

    const total = slides.length;
    slides.forEach(function (data, i) {
      const slide = pptx.addSlide();
      if (data.type === 'cover') {
        buildCover(pptx, slide, data, opts.footer);
      } else {
        buildStandard(pptx, slide, data, i + 1, total);
      }
    });

    const fileName = (opts.fileName || 'nova-pitch-deck').replace(/\.pptx$/i, '') + '.pptx';
    await pptx.writeFile({ fileName: fileName });
    return fileName;
  }

  global.NovaPpt = {
    exportDeck: exportDeck,
    parseSlides: parseSlides,
    COLORS: COLORS,
  };
})(window);
