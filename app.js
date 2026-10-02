/* app.js: Glyphs. The interface around engine.js.
   Plain script, one IIFE. State lives in `S` (the current picture's settings); everything the screen shows is
   derived from it, and every control writes back through set(). Controls are bound by data-k="group.key". */
(function () {
  'use strict';

  var SG = window.SG, Glyph = window.Glyph;
  var doc = document, root = doc.documentElement;
  function $(s, r) { return (r || doc).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || doc).querySelectorAll(s)); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function toast(message, status, action) { try { SG.toast.show({ message: message, status: status || 'success', action: action }); } catch (e) { SG.announce(message); } }

  /* ------------------------------------------------------------------ settings */

  var DEFAULTS = {
    source: { read: 'auto', threshold: 50, smooth: 18, simplify: 0, invert: false, detail: 55 },
    style: { mode: 'outline', width: 2.2, position: 'center' },
    layout: { scale: 52, x: 0, y: 0, rotate: 0, flipH: false, flipV: false },
    color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: true, bg: '#1c1c1c', bgOpacity: 100, knockout: false, radius: 0 },
    view: { mask: 'ios', safe: false, guides: false, snap: true, grid: 0 },
  };

  /* Built from the owner's gray home-screen icons: a #1c1c1c tile, a #e5e5e5 mark, a ~2% line, round ends. */
  var BUILTIN = [
    { id: 'b-line', name: 'Gray line', note: 'The home-screen set', settings: { style: { mode: 'outline', width: 2.2, position: 'center' }, color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: true, bg: '#1c1c1c', bgOpacity: 100, knockout: false, radius: 0 }, layout: { scale: 52 } } },
    { id: 'b-solid', name: 'Gray solid', note: 'Filled marks like Phone and Peace', settings: { style: { mode: 'solid', width: 2.2, position: 'center' }, color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: true, bg: '#1c1c1c', bgOpacity: 100, knockout: false, radius: 0 }, layout: { scale: 46 } } },
    { id: 'b-detail', name: 'Gray detail', note: 'Inner lines, like Maps', settings: { style: { mode: 'both', width: 1.8, position: 'center' }, color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: true, bg: '#1c1c1c', bgOpacity: 100, knockout: false, radius: 0 }, layout: { scale: 56 } } },
    { id: 'b-thin', name: 'Gray hairline', note: 'A quieter weight', settings: { style: { mode: 'outline', width: 1.2, position: 'center' }, color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: true, bg: '#1c1c1c', bgOpacity: 100, knockout: false, radius: 0 }, layout: { scale: 56 } } },
    { id: 'b-cream', name: 'Cream line', note: 'Dark mark on a light tile', settings: { style: { mode: 'outline', width: 2.2, position: 'center' }, color: { fg: '#1c1c1c', fgOpacity: 100, bgOn: true, bg: '#ece9e2', bgOpacity: 100, knockout: false, radius: 0 }, layout: { scale: 52 } } },
    { id: 'b-cut', name: 'Cut-out', note: 'The mark is a hole in the tile', settings: { style: { mode: 'solid', width: 2.2, position: 'center' }, color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: true, bg: '#1c1c1c', bgOpacity: 100, knockout: true, radius: 22 }, layout: { scale: 50 } } },
    { id: 'b-clear', name: 'See-through', note: 'No tile, just the line', settings: { style: { mode: 'outline', width: 2.2, position: 'center' }, color: { fg: '#e5e5e5', fgOpacity: 100, bgOn: false, bg: '#1c1c1c', bgOpacity: 100, knockout: false, radius: 0 }, layout: { scale: 80 } } },
  ];

  var SWATCHES = [['#1c1c1c', 'Ink'], ['#000000', 'Black'], ['#e5e5e5', 'Mist'], ['#ffffff', 'White'], ['#ece9e2', 'Cream'], ['#e8453c', 'Coral'], ['#a8bfa0', 'Sage']];
  var MODE_NAMES = { solid: 'Solid', outline: 'Outline', lines: 'Lines', both: 'Outline and lines' };

  var SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><path fill-rule="evenodd" d="M84 90H428A44 44 0 0 1 472 134V378A44 44 0 0 1 428 422H84A44 44 0 0 1 40 378V134A44 44 0 0 1 84 90ZM132 200a38 38 0 1 0 76 0a38 38 0 1 0 -76 0ZM72 378L170 268L262 352L352 250L440 378Z"/></svg>';

  /* ------------------------------------------------------------------ state */

  var S = clone(DEFAULTS);          // settings of the current picture
  var items = [];                    // { id, name, img, url, state, thumb }
  var cur = -1;
  var prefs = SG.storage.get('glyphs:prefs', null) || { applyLayout: true, applySource: false };
  var userPresets = SG.storage.get('glyphs:presets', null) || [];
  var activePreset = null;           // id of the last applied preset
  var shapeCache = null, strokeCache = null, tile = null;
  var dirty = { A: true, B: true, C: true, thumbs: true };
  var raf = 0, guides = [];
  var PREVIEW_G = 400, VIEW_PX = 720;

  function item() { return items[cur] || null; }

  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'), last = ks.pop(), t = ks.reduce(function (a, k) { return a[k]; }, o); t[last] = v; }
  function merged(base, over) { var o = clone(base); Object.keys(over || {}).forEach(function (g) { if (typeof over[g] === 'object') o[g] = Object.assign(o[g] || {}, over[g]); }); return o; }

  /* Engine settings: the engine thinks in fractions of the tile, the interface in percent. */
  function E(st) {
    st = st || S;
    return { layout: { scale: st.layout.scale / 100, x: st.layout.x / 100, y: st.layout.y / 100, rotate: st.layout.rotate, flipH: st.layout.flipH, flipV: st.layout.flipV }, color: st.color };
  }
  function strokeStyle(st) { return { mode: st.style.mode, width: st.style.width / 100, position: st.style.position }; }
  function unitFor(sh, st) { return (st.layout.scale / 100) / Math.max(sh.bbox[2], sh.bbox[3]); }

  /* ------------------------------------------------------------------ history */

  var hist = [], hi = -1, histTimer = 0;
  function snapshot() { return JSON.stringify(S); }
  function pushHist() {
    var s = snapshot();
    if (hist[hi] === s) return;
    hist = hist.slice(0, hi + 1); hist.push(s);
    if (hist.length > 100) hist.shift();
    hi = hist.length - 1;
    updateUndo();
  }
  function resetHist() { hist = [snapshot()]; hi = 0; updateUndo(); }
  function updateUndo() {
    var u = $('#undo'), r = $('#redo');
    u.disabled = hi <= 0; r.disabled = hi >= hist.length - 1;
  }
  function restore(json) {
    S = JSON.parse(json);
    if (item()) item().state = S;
    invalidate('A'); syncUI(); updateUndo();
  }
  function undo() { clearTimeout(histTimer); pushHist(); if (hi > 0) { hi--; restore(hist[hi]); SG.announce('Undone'); } }
  function redo() { clearTimeout(histTimer); if (hi < hist.length - 1) { hi++; restore(hist[hi]); SG.announce('Redone'); } }

  /* ------------------------------------------------------------------ change plumbing */

  function invalidate(level) {
    if (level === 'A') { dirty.A = dirty.B = true; dirty.thumbs = true; }
    else if (level === 'B') dirty.B = true;
    dirty.C = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  var persistTimer = 0;
  function touched() {
    clearTimeout(histTimer); histTimer = setTimeout(pushHist, 400);
    clearTimeout(persistTimer); persistTimer = setTimeout(function () { SG.storage.set('glyphs:state', S); }, 500);
    updatePresetCurrent();
  }

  function set(path, value, opts) {
    var old = getPath(S, path);
    if (old === value) return;
    setPath(S, path, value);
    var g = path.split('.')[0];
    invalidate(g === 'source' ? 'A' : (g === 'style' || path === 'layout.scale') ? 'B' : 'C');
    touched();
    syncUI(opts && opts.from);
  }

  /* ------------------------------------------------------------------ building the controls */

  function endLabel(v, fmt, unit) {
    var s = String(v).replace('-', '−');
    return fmt === 'percent' ? s + '%' : unit === 'degree' ? s + '°' : s;
  }
  function slider(k, label, min, max, step, fmt, hint, unit) {
    var id = 'c-' + k.replace(/\./g, '-');
    return '<div class="slider" data-sg-slider data-format="' + fmt + '"' + (unit ? ' data-unit="' + unit + '"' : '') + '>' +
      '<div class="slider__head"><label class="slider__label" for="' + id + '">' + label + '</label><output class="slider__value" for="' + id + '" aria-live="off"></output></div>' +
      '<div class="slider__row">' +
      '<button class="btn" type="button" data-shape="circle" data-size="sm" data-sg-nudge="-1" aria-label="Decrease ' + label.toLowerCase() + '" aria-controls="' + id + '"><span class="ic ic--minus" aria-hidden="true"></span></button>' +
      '<div class="slider__track"><input class="slider__input" id="' + id + '" data-k="' + k + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + min + '"><div class="slider__scale" aria-hidden="true"><span>' + endLabel(min, fmt, unit) + '</span><span>' + endLabel(max, fmt, unit) + '</span></div></div>' +
      '<button class="btn" type="button" data-shape="circle" data-size="sm" data-sg-nudge="1" aria-label="Increase ' + label.toLowerCase() + '" aria-controls="' + id + '"><span class="ic ic--plus" aria-hidden="true"></span></button>' +
      '</div>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
  }
  function chips(k, label, opts, num, hint) {
    return '<fieldset class="group"><legend class="t-label">' + label + '</legend><div class="chips">' + opts.map(function (o) {
      return '<label class="chip"><input class="chip__input" type="radio" name="' + k + '" data-k="' + k + '"' + (num ? ' data-t="num"' : '') + ' value="' + o[0] + '">' + o[1] + '</label>';
    }).join('') + '</div>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</fieldset>';
  }
  function segmented(k, label, opts, num) {
    return '<fieldset class="group"><legend class="t-label">' + label + '</legend><fieldset class="segmented" data-block><legend class="sr-only">' + label + '</legend>' + opts.map(function (o) {
      return '<label class="segmented__opt"><input type="radio" name="' + k + '" data-k="' + k + '"' + (num ? ' data-t="num"' : '') + ' value="' + o[0] + '"><span class="segmented__label">' + o[1] + '</span></label>';
    }).join('') + '</fieldset></fieldset>';
  }
  function sw(k, label, hint, needs) {
    return '<label class="switch"><input type="checkbox" role="switch" data-k="' + k + '"' + (needs ? ' data-needs="' + needs + '"' : '') + '><span class="switch__label">' + label + (hint ? '<span class="switch__hint">' + hint + '</span>' : '') + '</span><span class="switch__state" aria-hidden="true"><span data-on>On</span><span data-off>Off</span></span></label>';
  }
  function colour(k, label, needs) {
    var id = 'c-' + k.replace(/\./g, '-');
    return '<fieldset class="group"' + (needs ? ' data-when="' + needs + ':true"' : '') + '><legend class="t-label">' + label + '</legend>' +
      '<div class="colorrow"><input class="well" type="color" id="' + id + '" data-k="' + k + '" aria-label="' + label + ' colour picker">' +
      '<div class="field"><label class="field__label sr-only" for="' + id + '-hex">' + label + ' as a hex code</label><input class="input hexin" id="' + id + '-hex" data-k="' + k + '" data-t="hex" type="text" maxlength="7" spellcheck="false" autocapitalize="none" autocomplete="off" inputmode="text"></div></div>' +
      '<fieldset class="swatch-set"><legend class="sr-only">' + label + ' quick colours</legend><div class="swatch-set__list">' + SWATCHES.map(function (s) {
        return '<label class="swatch-set__opt" style="--swatch: ' + s[0] + '"><input type="radio" name="sw-' + k + '" data-k="' + k + '" value="' + s[0] + '"><span class="swatch-set__chip"><span class="ic ic--check" aria-hidden="true"></span></span><span class="swatch-set__name">' + s[1] + '</span></label>';
      }).join('') + '</div></fieldset></fieldset>';
  }
  function btn(act, icon, label, extra) {
    return '<button class="btn" type="button" data-act="' + act + '"' + (extra || '') + '>' + (icon ? '<span class="ic ic--' + icon + '" aria-hidden="true"></span>' : '') + label + '</button>';
  }
  function when(expr, html) { return '<div class="group" data-when="' + expr + '">' + html + '</div>'; }

  function buildPanels() {
    $('#p-shape').innerHTML =
      chips('source.read', 'Read the shape from', [['auto', 'Automatic'], ['alpha', 'Transparency'], ['dark', 'Dark parts'], ['light', 'Light parts'], ['diff', 'Not the corner colour']], false,
        'Automatic uses the picture’s transparency when it has any, and otherwise whatever differs from its corner colour.') +
      slider('source.threshold', 'Threshold', 1, 99, 1, 'percent', 'Higher keeps only the strongest parts of the picture.') +
      slider('source.smooth', 'Smoothing', 0, 100, 1, 'percent', 'Blurs before cutting: softer edges, less noise.') +
      slider('source.simplify', 'Simplify', 0, 100, 1, 'percent', 'Fills tiny gaps and removes specks and hairs, and rounds the corners a little.') +
      sw('source.invert', 'Swap shape and background', 'For a picture where the mark is the empty part.');

    $('#p-style').innerHTML =
      chips('style.mode', 'Draw it as', [['outline', 'Outline'], ['solid', 'Solid'], ['lines', 'Lines'], ['both', 'Outline and lines']], false,
        'Outline traces the edge. Lines trace the edges inside the picture too.') +
      when('style.mode:outline|lines|both', slider('style.width', 'Line width', 0.4, 10, 0.1, 'percent', 'As a share of the icon’s width. The gray set uses about 2%.')) +
      when('style.mode:outline|both', segmented('style.position', 'The outline sits', [['center', 'On the edge'], ['inside', 'Inside'], ['outside', 'Outside']])) +
      when('style.mode:lines|both', slider('source.detail', 'Detail', 0, 100, 1, 'percent', 'How many inner edges become lines.'));

    $('#p-layout').innerHTML =
      slider('layout.scale', 'Size', 5, 100, 0.5, 'percent', 'The longest side of the mark, as a share of the icon.') +
      slider('layout.x', 'Across', -50, 50, 0.5, 'percent') +
      slider('layout.y', 'Down', -50, 50, 0.5, 'percent') +
      slider('layout.rotate', 'Turn', -180, 180, 1, 'unit', null, 'degree') +
      '<div class="cluster" data-gap="2">' +
      btn('center', 'focus', 'Centre') + btn('weight', 'target', 'Centre by weight') + btn('fit', 'maximize', 'Fit safe zone') + btn('rot90', 'rotate-cw', 'Turn 90°') +
      '</div>' +
      '<div class="chips" role="group" aria-label="Flip">' +
      '<button class="chip" type="button" data-act="flipH" aria-pressed="false"><span class="ic ic--flip-horizontal chip__icon" aria-hidden="true"></span>Flip across</button>' +
      '<button class="chip" type="button" data-act="flipV" aria-pressed="false"><span class="ic ic--chevrons-up-down chip__icon" aria-hidden="true"></span>Flip down</button></div>' +
      sw('view.snap', 'Snap to guides', 'While you drag, the mark clicks to the centre, its centre of weight, and the 10% and 20% margins.') +
      segmented('view.grid', 'Nudge in steps of', [[0, 'Off'], [1, '1%'], [2.5, '2.5%'], [5, '5%']], true) +
      segmented('view.mask', 'Preview shape', [['none', 'Square'], ['ios', 'iOS'], ['circle', 'Circle']]) +
      sw('view.guides', 'Show guides') + sw('view.safe', 'Show the maskable safe zone', 'Android may crop to a circle this wide. The PNG itself is not changed.');

    $('#p-colour').innerHTML =
      colour('color.fg', 'Mark') +
      slider('color.fgOpacity', 'Mark opacity', 0, 100, 1, 'percent') +
      sw('color.bgOn', 'Draw a tile', 'Off gives a see-through PNG with just the mark.') +
      colour('color.bg', 'Tile', 'color.bgOn') +
      when('color.bgOn:true', slider('color.bgOpacity', 'Tile opacity', 0, 100, 1, 'percent')) +
      when('color.bgOn:true', sw('color.knockout', 'Cut the mark out of the tile', 'The mark becomes a hole, so whatever is behind the icon shows through it.')) +
      when('color.bgOn:true', slider('color.radius', 'Tile corner radius', 0, 50, 1, 'percent', 'Baked into the PNG. Keep it at 0 for iOS and Android: they round the icon themselves.')) +
      '<div class="cluster">' + btn('swap', 'refresh-cw', 'Swap mark and tile') + '</div>';

    $('#p-presets').innerHTML =
      '<div class="cluster" data-gap="2" id="preset-save">' +
      btn('preset-new', 'plus', 'Save as preset', ' data-variant="primary"') +
      '<button class="btn" type="button" data-act="preset-update" id="preset-update" hidden><span class="ic ic--rotate-cw" aria-hidden="true"></span><span id="preset-update-label">Update preset</span></button>' +
      '</div>' +
      '<fieldset class="group"><legend class="t-label">When I apply a preset, also use its</legend>' +
      sw('prefs.applyLayout', 'Size and placement', 'Off keeps this picture where it is.') +
      sw('prefs.applySource', 'Shape settings', 'Threshold, smoothing and the rest. Usually picture-specific.') + '</fieldset>' +
      '<div class="group"><h3 class="t-label" id="ph-yours">Yours</h3><ul class="presets" id="list-yours" role="list" aria-labelledby="ph-yours"></ul><p class="hint" id="yours-empty">Nothing saved yet. Set the picture up the way you like, then Save as preset.</p></div>' +
      '<div class="group"><h3 class="t-label" id="ph-built">Built in</h3><ul class="presets" id="list-built" role="list" aria-labelledby="ph-built"></ul></div>' +
      '<div class="cluster" data-gap="2" id="preset-misc">' +
      btn('apply-all', 'layers', 'Use this look on every picture', ' id="apply-all" hidden') +
      btn('preset-export', 'download', 'Export presets') + btn('preset-import', 'upload', 'Import presets') + '</div>';
  }

  /* ------------------------------------------------------------------ binding */

  function stateFor(path) { return path.indexOf('prefs.') === 0 ? getPath({ prefs: prefs }, path) : getPath(S, path); }

  function syncUI(from) {
    $$('[data-k]').forEach(function (el) {
      var path = el.getAttribute('data-k'), v = stateFor(path);
      if (el === from) { if (el.type === 'range') SG.slider && SG.slider.update(el.closest('[data-sg-slider]')); return; }
      if (el.type === 'range') { el.value = v; SG.slider.update(el.closest('[data-sg-slider]')); }
      else if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'radio') el.checked = String(v) === el.value;
      else if (el.type === 'color') el.value = v;
      else if (el.getAttribute('data-t') === 'hex') { if (doc.activeElement !== el) { el.value = String(v).toUpperCase(); el.removeAttribute('aria-invalid'); } }
    });
    $$('[data-needs]').forEach(function (el) { el.disabled = !stateFor(el.getAttribute('data-needs')); });
    $$('[data-when]').forEach(function (el) {
      var parts = el.getAttribute('data-when').split(':');
      el.hidden = parts[1].split('|').indexOf(String(stateFor(parts[0]))) < 0;
    });
    $$('[data-act="flipH"]').forEach(function (b) { b.setAttribute('aria-pressed', String(S.layout.flipH)); });
    $$('[data-act="flipV"]').forEach(function (b) { b.setAttribute('aria-pressed', String(S.layout.flipV)); });
    readout();
  }

  function onControl(e) {
    var el = e.target, path = el.getAttribute && el.getAttribute('data-k');
    if (!path) return;
    var t = el.getAttribute('data-t'), v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'range') v = parseFloat(el.value);
    else if (el.type === 'radio') { if (!el.checked) return; v = t === 'num' ? parseFloat(el.value) : el.value; }
    else if (t === 'hex') {
      var h = el.value.trim(); if (h[0] !== '#') h = '#' + h;
      if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h.slice(1).replace(/./g, '$&$&');
      if (!/^#[0-9a-f]{6}$/i.test(h)) { el.setAttribute('aria-invalid', 'true'); return; }
      el.removeAttribute('aria-invalid'); v = h.toLowerCase();
    } else v = el.value;
    if (path.indexOf('prefs.') === 0) { prefs[path.slice(6)] = v; SG.storage.set('glyphs:prefs', prefs); return; }
    if (el.type === 'color') v = v.toLowerCase();
    set(path, v, { from: el.type === 'range' || t === 'hex' ? el : null });
    if (path === 'color.bgOn' || path === 'color.fg' || path === 'color.bg') updateFlatHint();
  }

  /* ------------------------------------------------------------------ rendering */

  var tok = {};
  function readTokens() {
    ['--paper-2', '--paper-3', '--line', '--ink', '--accent', '--ink-faint', '--canvas'].forEach(function (n) { tok[n] = SG.tokenToHex(n); });
  }

  function frame() {
    raf = 0;
    var it = item();
    if (!it) return;
    if (dirty.A) {
      shapeCache = Glyph.shape(it.img, S.source, PREVIEW_G);
      dirty.A = false; dirty.B = true;
    }
    if (dirty.B) {
      strokeCache = shapeCache ? Glyph.stroke(shapeCache, strokeStyle(S), unitFor(shapeCache, S)) : null;
      dirty.B = false;
    }
    if (dirty.C) { drawPreview(); dirty.C = false; }
    if (dirty.thumbs && !$('#p-presets').hidden) { dirty.thumbs = false; renderPresetThumbs(); }
    $('#suggest').hidden = !(shapeCache && shapeCache.thickness < 0.09 && S.style.mode !== 'solid');
    var emp = !shapeCache;
    $('#readout').textContent = emp ? 'Nothing found. Try a lower threshold or another way to read the shape.' : readoutText();
  }

  function readoutText() {
    var l = S.layout, w = S.style.mode === 'solid' ? '' : ' \u00b7 ' + S.style.width.toFixed(1) + '% line';
    return MODE_NAMES[S.style.mode] + w + ' \u00b7 ' + (Math.round(l.scale * 10) / 10) + '% size';
  }
  function readout() { if (shapeCache) $('#readout').textContent = readoutText(); }

  function maskPath(ctx, size) {
    var m = S.view.mask;
    ctx.beginPath();
    if (m === 'ios') { Glyph.roundRect(ctx, 0, 0, size, size, size * 0.2237); }
    else if (m === 'circle') ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    else ctx.rect(0, 0, size, size);
  }

  function checker(ctx, size) {
    var n = 30, s = size / n, i, j;
    ctx.fillStyle = tok['--paper-2']; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = tok['--paper-3'];
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if ((i + j) & 1) ctx.fillRect(i * s, j * s, s, s);
  }

  function drawPreview() {
    var cv = $('#view'), ctx = cv.getContext('2d'), size = cv.width;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    maskPath(ctx, size); ctx.clip();
    if (!S.color.bgOn || S.color.bgOpacity < 100 || S.color.radius > 0 || S.color.knockout) checker(ctx, size);
    Glyph.paint(ctx, size, shapeCache, strokeCache, E());
    ctx.restore();

    ctx.save();
    ctx.lineWidth = Math.max(2, size / 360);
    if (S.view.mask !== 'none') { ctx.strokeStyle = tok['--line']; maskPath(ctx, size); ctx.stroke(); }
    if (S.view.guides) {
      ctx.strokeStyle = tok['--ink-faint']; ctx.setLineDash([size / 80, size / 80]);
      ctx.beginPath();
      ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
      [0.2, 0.8].forEach(function (g) { ctx.moveTo(g * size, 0); ctx.lineTo(g * size, size); ctx.moveTo(0, g * size); ctx.lineTo(size, g * size); });
      ctx.stroke();
    }
    if (S.view.safe) {
      ctx.strokeStyle = tok['--ink']; ctx.setLineDash([size / 50, size / 50]);
      ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2); ctx.stroke();
    }
    if (guides.length) {
      ctx.setLineDash([]); ctx.strokeStyle = tok['--accent']; ctx.lineWidth = Math.max(3, size / 240);
      ctx.beginPath();
      guides.forEach(function (g) { if (g.axis === 'x') { ctx.moveTo(g.at * size, 0); ctx.lineTo(g.at * size, size); } else { ctx.moveTo(0, g.at * size); ctx.lineTo(size, g.at * size); } });
      ctx.stroke();
    }
    ctx.restore();

    /* the small previews and the picture's own thumbnail share one render of the tile */
    if (!tile) tile = Glyph.makeCanvas(240, 240);
    var tx = tile.getContext('2d'); tx.clearRect(0, 0, 240, 240);
    Glyph.paint(tx, 240, shapeCache, strokeCache, E());
    $$('#homes canvas').forEach(function (c) {
      var x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high';
      x.drawImage(tile, 0, 0, c.width, c.height);
    });
    var it = item();
    if (it && it.thumb) { var tc = it.thumb.getContext('2d'); tc.clearRect(0, 0, 112, 112); tc.drawImage(tile, 0, 0, 112, 112); }
  }

  /* ------------------------------------------------------------------ moving the mark: drag, pinch, keys, snapping */

  var ptrs = new Map(), drag = null, pinch = null;

  function candidates(hw, weight) {
    var c = [{ v: 0, g: 0.5 }, { v: -weight, g: 0.5 }];
    [0.1, 0.2].forEach(function (m) {
      if (hw < 0.5 - m) { c.push({ v: -0.5 + m + hw, g: m }); c.push({ v: 0.5 - m - hw, g: 1 - m }); }
    });
    return c;
  }
  function snapAxis(v, cands, grid) {
    var best = null, d, T = 0.012;
    if (S.view.snap) cands.forEach(function (c) { d = Math.abs(c.v - v); if (d <= T && (!best || d < best.d)) best = { d: d, c: c }; });
    if (best) return { v: best.c.v, g: best.c.g };
    if (grid > 0) return { v: Math.round(v * 100 / grid) * grid / 100 };
    return { v: v };
  }
  function snapPos(xp, yp) {
    var out = { x: xp, y: yp, g: [] };
    if (!shapeCache) return out;
    var fp = Glyph.footprint(shapeCache, E().layout);
    var sx = snapAxis(xp / 100, candidates(fp.hw, fp.weightX), S.view.grid);
    var sy = snapAxis(yp / 100, candidates(fp.hh, fp.weightY), S.view.grid);
    out.x = round1(sx.v * 100); out.y = round1(sy.v * 100);
    if (sx.g != null) out.g.push({ axis: 'x', at: sx.g });
    if (sy.g != null) out.g.push({ axis: 'y', at: sy.g });
    return out;
  }
  function moveTo(xp, yp) {
    var s = snapPos(xp, yp);
    guides = s.g;
    setPath(S, 'layout.x', clamp(s.x, -50, 50)); setPath(S, 'layout.y', clamp(s.y, -50, 50));
    invalidate('C'); touched(); syncUI();
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function bindStage() {
    var v = $('#view');
    v.addEventListener('pointerdown', function (e) {
      if (!shapeCache) return;
      v.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) drag = { sx: e.clientX, sy: e.clientY, ox: S.layout.x, oy: S.layout.y };
      else if (ptrs.size === 2) { var p = Array.from(ptrs.values()); drag = null; pinch = { d: dist(p[0], p[1]), s: S.layout.scale }; }
    });
    v.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size >= 2) {
        var p = Array.from(ptrs.values());
        set('layout.scale', clamp(round1(pinch.s * dist(p[0], p[1]) / pinch.d), 5, 100));
      } else if (drag) {
        var r = v.getBoundingClientRect();
        moveTo(drag.ox + (e.clientX - drag.sx) / r.width * 100, drag.oy + (e.clientY - drag.sy) / r.height * 100);
      }
    });
    function up(e) {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 1) { var p = Array.from(ptrs.values())[0]; drag = { sx: p.x, sy: p.y, ox: S.layout.x, oy: S.layout.y }; }
      if (!ptrs.size) { drag = null; if (guides.length) { guides = []; invalidate('C'); } }
    }
    v.addEventListener('pointerup', up); v.addEventListener('pointercancel', up);
    v.addEventListener('keydown', function (e) {
      var step = (S.view.grid > 0 ? S.view.grid : 1) * (e.shiftKey ? 5 : 1), dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step; else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step; else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === '+' || e.key === '=') { set('layout.scale', clamp(S.layout.scale + (e.shiftKey ? 5 : 1), 5, 100)); e.preventDefault(); return; }
      else if (e.key === '-' || e.key === '_') { set('layout.scale', clamp(S.layout.scale - (e.shiftKey ? 5 : 1), 5, 100)); e.preventDefault(); return; }
      else return;
      e.preventDefault();
      setPath(S, 'layout.x', clamp(round1(S.layout.x + dx), -50, 50)); setPath(S, 'layout.y', clamp(round1(S.layout.y + dy), -50, 50));
      invalidate('C'); touched(); syncUI();
      SG.announce('Across ' + S.layout.x + ' percent, down ' + S.layout.y + ' percent');
    });
  }

  function act(name) {
    var l = S.layout;
    if (name === 'center') { setPath(S, 'layout.x', 0); setPath(S, 'layout.y', 0); }
    else if (name === 'weight' && shapeCache) { var fp = Glyph.footprint(shapeCache, E().layout); setPath(S, 'layout.x', round1(-fp.weightX * 100)); setPath(S, 'layout.y', round1(-fp.weightY * 100)); }
    else if (name === 'fit' && shapeCache) {
      var f = Glyph.footprint(shapeCache, E().layout), half = Math.hypot(f.hw, f.hh);
      setPath(S, 'layout.scale', clamp(round1(l.scale * 0.4 / half), 5, 100)); setPath(S, 'layout.x', 0); setPath(S, 'layout.y', 0);
    }
    else if (name === 'rot90') { var r = l.rotate + 90; setPath(S, 'layout.rotate', r > 180 ? r - 360 : r); }
    else if (name === 'flipH') setPath(S, 'layout.flipH', !l.flipH);
    else if (name === 'flipV') setPath(S, 'layout.flipV', !l.flipV);
    else if (name === 'use-solid') { setPath(S, 'style.mode', 'solid'); invalidate('B'); }
    else if (name === 'swap') { var a = S.color.fg; setPath(S, 'color.fg', S.color.bg); setPath(S, 'color.bg', a); }
    else return false;
    invalidate(name === 'fit' ? 'B' : 'C'); touched(); syncUI();
    if (name === 'fit') dirty.B = true;
    if (name === 'use-solid') SG.announce('Drawn solid');
    return true;
  }

  /* ------------------------------------------------------------------ pictures */

  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { if (!img.naturalWidth) { img.width = 512; img.height = 512; } res(img); };
      img.onerror = function () { rej(new Error('That file could not be read as a picture.')); };
      img.src = src;
    });
  }

  function freshState(from) {
    var s = clone(from || S);
    s.source = clone(DEFAULTS.source);
    s.layout.x = 0; s.layout.y = 0; s.layout.rotate = 0; s.layout.flipH = false; s.layout.flipV = false;
    return s;
  }

  var uid = 0;
  function addItem(img, url, name, state) {
    var it = { id: ++uid, name: name, img: img, url: url, state: state, thumb: Glyph.makeCanvas(112, 112) };
    items.push(it);
    return it;
  }

  function select(i) {
    clearTimeout(histTimer); if (item()) pushHist();
    cur = i; S = items[i].state; resetHist();
    shapeCache = strokeCache = null;
    invalidate('A'); syncUI(); renderReel();
  }

  function renderReel() {
    var wrap = $('#reel-wrap'), list = $('#reel');
    wrap.hidden = items.length < 2;
    list.innerHTML = '';
    items.forEach(function (it, i) {
      var li = doc.createElement('li'); li.className = 'reel__item';
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'reel__pick';
      b.setAttribute('aria-label', it.name + ', picture ' + (i + 1) + ' of ' + items.length);
      if (i === cur) b.setAttribute('aria-current', 'true');
      b.appendChild(it.thumb); b.addEventListener('click', function () { if (i !== cur) select(i); });
      var x = doc.createElement('button'); x.type = 'button'; x.className = 'reel__x'; x.setAttribute('aria-label', 'Remove ' + it.name);
      x.innerHTML = '<span class="ic ic--x" aria-hidden="true"></span>';
      x.addEventListener('click', function () { removeItem(i); });
      li.appendChild(b); li.appendChild(x); list.appendChild(li);
    });
    $('#apply-all').hidden = items.length < 2;
    updateSaveLabel();
  }

  function removeItem(i) {
    var it = items[i]; if (it.url) URL.revokeObjectURL(it.url);
    items.splice(i, 1);
    if (!items.length) { loadSample().then(function () { select(0); }); return; }
    select(Math.min(cur >= i ? Math.max(0, cur - (cur === i ? 0 : 1)) : cur, items.length - 1));
    SG.announce(it.name + ' removed. ' + items.length + ' left.');
  }

  function loadSample() {
    return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SAMPLE_SVG)).then(function (img) {
      var st = SG.storage.get('glyphs:state', null);
      addItem(img, null, 'Sample', st ? merged(DEFAULTS, st) : clone(DEFAULTS));
      items[items.length - 1].sample = true;
      cur = items.length - 1; S = items[cur].state; resetHist();
      invalidate('A'); syncUI(); renderReel();
    });
  }

  function addFiles(files) {
    files = Array.prototype.filter.call(files, function (f) { return /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(f.name); });
    if (!files.length) { toast('Those files are not pictures.', 'warning'); return; }
    var chain = Promise.resolve(), added = 0;
    files.forEach(function (f) {
      chain = chain.then(function () {
        var url = URL.createObjectURL(f);
        return loadImage(url).then(function (img) {
          if (items.length === 1 && items[0].sample) { items.shift(); cur = -1; }
          var base = cur >= 0 ? S : (SG.storage.get('glyphs:state', null) ? merged(DEFAULTS, SG.storage.get('glyphs:state', null)) : DEFAULTS);
          addItem(img, url, f.name.replace(/\.[^.]+$/, '') || 'Picture', freshState(base));
          added++;
          if (added === 1) select(items.length - 1); else renderItemThumb(items[items.length - 1]);
        }, function () { URL.revokeObjectURL(url); toast('Could not read ' + f.name + '.', 'danger'); });
      });
    });
    chain.then(function () {
      if (added > 1) { select(items.length - added); }
      renderReel();
      if (added) SG.announce(added + (added === 1 ? ' picture' : ' pictures') + ' added');
    });
  }

  /* ------------------------------------------------------------------ presets */

  function allPresets() { return BUILTIN.concat(userPresets); }
  function presetById(id) { return allPresets().filter(function (p) { return p.id === id; })[0] || null; }
  function savePresets() { SG.storage.set('glyphs:presets', userPresets); }

  function look(st) { return { style: clone(st.style), color: clone(st.color), layout: clone(st.layout), source: clone(st.source) }; }

  function presetResult(p) {
    var o = p.settings, s = clone(S);
    if (o.style) s.style = Object.assign(s.style, o.style);
    if (o.color) s.color = Object.assign(s.color, o.color);
    if (prefs.applyLayout && o.layout) s.layout = Object.assign(s.layout, o.layout);
    if (prefs.applySource && o.source) s.source = Object.assign(s.source, o.source);
    return s;
  }

  function applyPreset(p) {
    clearTimeout(histTimer); pushHist();
    var r = presetResult(p);
    S.style = r.style; S.color = r.color; S.layout = r.layout; S.source = r.source;
    activePreset = p.id;
    invalidate('A'); touched(); syncUI(); updatePresetCurrent();
    SG.announce(p.name + ' applied'); clearTimeout(histTimer); pushHist();
  }

  function sameLook(p) {
    var o = p.settings;
    return ['style', 'color'].every(function (g) { return !o[g] || Object.keys(o[g]).every(function (k) { return S[g][k] === o[g][k]; }); }) &&
      (!o.layout || !prefs.applyLayout || o.layout.scale == null || S.layout.scale === o.layout.scale);
  }

  function describe(p) {
    var o = p.settings, st = o.style || {}, c = o.color || {}, bits = [MODE_NAMES[st.mode] || ''];
    if (st.mode !== 'solid' && st.width) bits.push(st.width + '%');
    bits.push((c.fg || '').toUpperCase() + (c.bgOn === false ? ' on nothing' : ' on ' + (c.bg || '').toUpperCase()));
    return bits.join(' · ');
  }

  function renderPresetList() {
    function row(p, mine) {
      var current = activePreset === p.id, edited = current && !sameLook(p);
      return '<li class="preset" data-id="' + esc(p.id) + '" data-current="' + current + '">' +
        '<button class="preset__pick" type="button" data-act="preset-apply"' + (current ? ' aria-current="true"' : '') + '>' +
        '<span class="preset__thumb" aria-hidden="true"><canvas width="96" height="96"></canvas></span>' +
        '<span class="preset__text"><span class="preset__name">' + esc(p.name) + '</span><span class="preset__meta">' + (current ? (edited ? 'Applied, then edited' : 'Applied') + ' · ' : '') + esc(p.note || describe(p)) + '</span></span></button>' +
        '<div class="preset__acts">' +
        (mine ? '<button class="btn" data-shape="circle" data-size="sm" type="button" data-act="preset-rename" aria-label="Rename ' + esc(p.name) + '"><span class="ic ic--pencil" aria-hidden="true"></span></button>' : '') +
        '<button class="btn" data-shape="circle" data-size="sm" type="button" data-act="preset-dup" aria-label="Duplicate ' + esc(p.name) + '"><span class="ic ic--copy" aria-hidden="true"></span></button>' +
        (mine ? '<button class="btn" data-shape="circle" data-size="sm" type="button" data-act="preset-del" aria-label="Delete ' + esc(p.name) + '"><span class="ic ic--trash-2" aria-hidden="true"></span></button>' : '') +
        '</div></li>';
    }
    $('#list-yours').innerHTML = userPresets.map(function (p) { return row(p, true); }).join('');
    $('#list-built').innerHTML = BUILTIN.map(function (p) { return row(p, false); }).join('');
    $('#yours-empty').hidden = userPresets.length > 0;
    dirty.thumbs = true;
    updatePresetCurrent();
    if (raf === 0) raf = requestAnimationFrame(frame);
  }

  function updatePresetCurrent() {
    var p = activePreset && presetById(activePreset), upd = $('#preset-update');
    if (!upd) return;
    var mine = p && userPresets.indexOf(p) >= 0, edited = p && !sameLook(p);
    upd.hidden = !(mine && edited);
    if (mine) $('#preset-update-label').textContent = 'Update “' + p.name + '”';
    $$('.preset').forEach(function (li) {
      var q = presetById(li.getAttribute('data-id')), cur2 = q && q.id === activePreset, ed = cur2 && !sameLook(q);
      li.setAttribute('data-current', String(!!cur2));
      var pick = $('.preset__pick', li);
      if (cur2) pick.setAttribute('aria-current', 'true'); else pick.removeAttribute('aria-current');
      $('.preset__meta', li).textContent = (cur2 ? (ed ? 'Applied, then edited' : 'Applied') + ' · ' : '') + (q.note || describe(q));
    });
  }

  /* Each preset's thumbnail is the current picture drawn in that preset, at a small working size. */
  function renderPresetThumbs() {
    var it = item(); if (!it) return;
    var sh = Glyph.shape(it.img, S.source, 192);
    $$('.preset').forEach(function (li) {
      var p = presetById(li.getAttribute('data-id')), c = $('canvas', li); if (!p || !c) return;
      var x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
      if (!sh) return;
      var r = presetResult(p), stk = Glyph.stroke(sh, strokeStyle(r), unitFor(sh, r));
      Glyph.paint(x, c.width, sh, stk, E(r));
    });
  }

  function askName(title, initial, mode, id) {
    var dlg = $('#name-dlg');
    $('#name-t').textContent = title; $('#name-in').value = initial;
    dlg.dataset.mode = mode; dlg.dataset.id = id || '';
    dlg.returnValue = '';
    SG.dialog.open(dlg);
    setTimeout(function () { $('#name-in').focus(); $('#name-in').select(); }, 60);
  }
  function uniqueName(n) {
    var names = allPresets().map(function (p) { return p.name; }), out = n, i = 2;
    while (names.indexOf(out) >= 0) out = n + ' ' + i++;
    return out;
  }
  function newPresetId() { return 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  function onNameClosed() {
    var dlg = $('#name-dlg'); if (dlg.returnValue !== 'save') return;
    var name = $('#name-in').value.trim().slice(0, 40); if (!name) return;
    var mode = dlg.dataset.mode, id = dlg.dataset.id;
    if (mode === 'new') {
      var p = { id: newPresetId(), name: uniqueName(name), settings: look(S) };
      userPresets.push(p); activePreset = p.id; toast('“' + p.name + '” saved');
    } else if (mode === 'rename') {
      var q = presetById(id); if (q) { q.name = name; toast('Renamed to “' + name + '”'); }
    } else if (mode === 'dup') {
      var src = presetById(id);
      if (src) { var d = { id: newPresetId(), name: uniqueName(name), settings: clone(src.settings) }; userPresets.push(d); toast('“' + d.name + '” saved'); }
    }
    savePresets(); renderPresetList();
  }

  var pendingDelete = null;
  function onDelClosed() {
    var dlg = $('#del-dlg');
    if (dlg.returnValue === 'delete' && pendingDelete) {
      var i = userPresets.map(function (p) { return p.id; }).indexOf(pendingDelete);
      if (i >= 0) { var n = userPresets[i].name; userPresets.splice(i, 1); if (activePreset === pendingDelete) activePreset = null; savePresets(); renderPresetList(); toast('“' + n + '” deleted'); }
    }
    pendingDelete = null;
  }

  function exportPresets() {
    var blob = new Blob([JSON.stringify({ app: 'glyphs', version: 1, presets: userPresets }, null, 2)], { type: 'application/json' });
    download(blob, 'glyphs-presets.json'); toast(userPresets.length ? 'Presets exported' : 'No saved presets yet. Exported an empty file.', userPresets.length ? 'success' : 'info');
  }
  function importPresets(file) {
    file.text().then(function (t) {
      var j = JSON.parse(t), list = Array.isArray(j) ? j : j.presets, n = 0;
      if (!Array.isArray(list)) throw new Error('bad');
      list.forEach(function (p) {
        if (!p || !p.name || !p.settings || typeof p.settings !== 'object') return;
        userPresets.push({ id: newPresetId(), name: uniqueName(String(p.name).slice(0, 40)), settings: clone(p.settings) }); n++;
      });
      savePresets(); renderPresetList(); toast(n + (n === 1 ? ' preset imported' : ' presets imported'), n ? 'success' : 'warning');
    }).catch(function () { toast('That file is not a Glyphs presets file.', 'danger'); });
  }

  /* ------------------------------------------------------------------ saving */

  function download(blob, name) {
    var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function updateSaveLabel() {
    var many = items.length > 1;
    $('#save-label').textContent = IOS ? 'Save or share PNG' : 'Save PNG';
    $('#save').setAttribute('aria-label', many ? $('#save-label').textContent + ' (this picture)' : $('#save-label').textContent);
  }
  function updateFlatHint() { /* the flatten switch only matters when the tile is see-through */ }

  function renderTile(it, size, flat) {
    var st = it.state, Gx = size > 512 ? 1024 : 640, sh = Glyph.shape(it.img, st.source, Gx);
    if (!sh) return null;
    var stk = Glyph.stroke(sh, strokeStyle(st), unitFor(sh, st));
    var out = Glyph.makeCanvas(size, size), ctx = out.getContext('2d');
    var t = Glyph.makeCanvas(size, size);
    Glyph.paint(t.getContext('2d'), size, sh, stk, E(st));
    if (flat) { ctx.fillStyle = st.color.bg; ctx.fillRect(0, 0, size, size); }
    ctx.drawImage(t, 0, 0);
    return out;
  }
  function toBlob(cv) { return new Promise(function (r) { cv.toBlob(r, 'image/png'); }); }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'icon'; }

  function save() {
    clearTimeout(histTimer); pushHist();
    var size = parseInt(($('input[name="x-size"]:checked') || {}).value || '1024', 10);
    var which = ($('input[name="x-which"]:checked') || {}).value || 'current';
    var flat = $('#x-flat').checked;
    var list = which === 'all' ? items.slice() : [item()];
    var btnSave = $('#save'); btnSave.setAttribute('aria-busy', 'true'); btnSave.disabled = true;
    $('#save-label').textContent = 'Rendering…';
    var files = [];
    var chain = Promise.resolve();
    list.forEach(function (it) {
      chain = chain.then(function () { return new Promise(function (r) { setTimeout(r, 20); }); }).then(function () {
        var cv = renderTile(it, size, flat);
        if (!cv) return null;
        return toBlob(cv).then(function (b) { files.push(new File([b], slug(it.name) + '-glyph-' + size + '.png', { type: 'image/png' })); });
      });
    });
    chain.then(function () {
      if (!files.length) { toast('Nothing to save. The shape came out empty.', 'warning'); return; }
      if (IOS && navigator.canShare && navigator.canShare({ files: files })) {
        return navigator.share({ files: files, title: 'Glyphs' }).then(function () { toast(files.length + (files.length === 1 ? ' icon' : ' icons') + ' ready'); }, function (e) { if (e && e.name !== 'AbortError') toast('Sharing failed.', 'danger'); });
      }
      files.forEach(function (f, i) { setTimeout(function () { download(f, f.name); }, i * 350); });
      toast(files.length === 1 ? 'Saved ' + files[0].name : 'Saving ' + files.length + ' icons');
    }).catch(function () { toast('Could not save that.', 'danger'); }).then(function () {
      btnSave.removeAttribute('aria-busy'); btnSave.disabled = false; updateSaveLabel();
    });
  }

  /* ------------------------------------------------------------------ app shell: install, offline, appearance */

  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('#install').hidden = false; });
  window.addEventListener('appinstalled', function () { $('#install').hidden = true; deferredInstall = null; toast('Glyphs is installed'); });

  function registerWorker() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (!reloading && window.__swHadController) { reloading = true; location.reload(); } });
    window.__swHadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function offer(w) {
        toast('An update is ready.', 'info', { label: 'Reload', onClick: function () { w.postMessage({ type: 'SKIP_WAITING' }); } });
      }
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        w && w.addEventListener('statechange', function () { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
      });
    }).catch(function () { /* offline use is a bonus */ });
  }

  function initAppearance() {
    $$('input[name="a-theme"]').forEach(function (r) { r.checked = r.value === SG.prefs.get('theme'); });
    $$('input[name="a-corners"]').forEach(function (r) { r.checked = r.value === SG.prefs.get('corners'); });
    $('#a-contrast').checked = SG.prefs.get('contrast') === 'more';
    doc.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'a-theme' && t.checked) SG.prefs.set('theme', t.value);
      else if (t.name === 'a-corners' && t.checked) SG.prefs.set('corners', t.value);
      else if (t.id === 'a-contrast') SG.prefs.set('contrast', t.checked ? 'more' : 'system');
    });
  }

  /* ------------------------------------------------------------------ wiring */

  function wire() {
    var controls = $('#controls');
    controls.addEventListener('input', onControl);
    controls.addEventListener('change', onControl);
    controls.addEventListener('focusout', function (e) {   /* leave a hex field tidy */
      if (e.target.getAttribute && e.target.getAttribute('data-t') === 'hex') { e.target.value = String(getPath(S, e.target.getAttribute('data-k'))).toUpperCase(); e.target.removeAttribute('aria-invalid'); }
    });
    doc.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
      var a = b.getAttribute('data-act'), li = b.closest('.preset'), id = li && li.getAttribute('data-id'), p = id && presetById(id);
      if (act(a)) return;
      if (a === 'preset-apply' && p) applyPreset(p);
      else if (a === 'preset-new') askName('Name this preset', uniqueName('My preset'), 'new');
      else if (a === 'preset-update' && activePreset) { var q = presetById(activePreset); if (q && userPresets.indexOf(q) >= 0) { q.settings = look(S); savePresets(); updatePresetCurrent(); dirty.thumbs = true; invalidate('C'); toast('“' + q.name + '” updated'); } }
      else if (a === 'preset-rename' && p) askName('Rename preset', p.name, 'rename', p.id);
      else if (a === 'preset-dup' && p) askName('Name the copy', uniqueName(p.name + ' copy'), 'dup', p.id);
      else if (a === 'preset-del' && p) { pendingDelete = p.id; $('#del-t').textContent = 'Delete “' + p.name + '”?'; $('#del-dlg').returnValue = ''; SG.dialog.open($('#del-dlg')); }
      else if (a === 'preset-export') exportPresets();
      else if (a === 'preset-import') $('#import').click();
      else if (a === 'apply-all') {
        var n = 0; items.forEach(function (it) { if (it.state !== S) { it.state.style = clone(S.style); it.state.color = clone(S.color); it.state.layout.scale = S.layout.scale; n++; } });
        toast('This look is on all ' + items.length + ' pictures'); items.forEach(function (it) { if (it !== item()) renderItemThumb(it); });
      }
    });
    $('#name-dlg').addEventListener('close', onNameClosed);
    $('#del-dlg').addEventListener('close', onDelClosed);
    $('#add').addEventListener('click', function () { $('#file').click(); });
    $('#file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
    $('#import').addEventListener('change', function (e) { if (e.target.files[0]) importPresets(e.target.files[0]); e.target.value = ''; });
    $('#undo').addEventListener('click', undo); $('#redo').addEventListener('click', redo);
    $('#save').addEventListener('click', function () { save(); });
    $('#export-go').addEventListener('click', function () { setTimeout(save, 120); });
    $('#install').addEventListener('click', function () { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } });
    $('#tabs').addEventListener('click', function () { setTimeout(function () { if (!$('#p-presets').hidden) { dirty.thumbs = true; invalidate('C'); } }, 0); });
    doc.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key) && !/INPUT|TEXTAREA/.test((doc.activeElement || {}).tagName || '')) {
        e.preventDefault(); if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
      }
    });

    /* drop and paste */
    var frameEl = $('#drop');
    ['dragenter', 'dragover'].forEach(function (n) { window.addEventListener(n, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); frameEl.setAttribute('data-drop', 'over'); } }); });
    ['dragleave', 'drop'].forEach(function (n) { window.addEventListener(n, function (e) { if (n === 'drop' || e.target === doc || !e.relatedTarget) frameEl.removeAttribute('data-drop'); }); });
    window.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
    window.addEventListener('paste', function (e) {
      var fs = e.clipboardData && e.clipboardData.files; if (fs && fs.length) { addFiles(fs); e.preventDefault(); }
    });

    new MutationObserver(function () { readTokens(); invalidate('C'); }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-palette', 'data-contrast'] });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readTokens(); invalidate('C'); });
  }

  function renderItemThumb(it) {
    var sh = Glyph.shape(it.img, it.state.source, 160); if (!sh) return;
    var stk = Glyph.stroke(sh, strokeStyle(it.state), unitFor(sh, it.state));
    var x = it.thumb.getContext('2d'); x.clearRect(0, 0, 112, 112);
    var t = Glyph.makeCanvas(112, 112); Glyph.paint(t.getContext('2d'), 112, sh, stk, E(it.state)); x.drawImage(t, 0, 0);
  }

  function init() {
    buildPanels();
    renderPresetList();
    wire(); bindStage(); initAppearance();
    readTokens();
    SG.slider.init(doc);
    loadSample().then(function () { syncUI(); });
    registerWorker();
    window.__glyphs = { get state() { return S; }, items: items, set: set, act: act, applyPreset: applyPreset, presets: allPresets, shape: function () { return shapeCache; } };
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
