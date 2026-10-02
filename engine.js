/* engine.js: turns any picture into a flat, one-colour glyph, and paints it on a tile.
   Plain script (no modules, so it works from file://), one global: window.Glyph.

   The pipeline has three stages, cached separately so a drag costs almost nothing:
     A  shape   picture -> yes/no mask      (read-from, threshold, smoothing, simplify, invert)   cached per source params
     B  stroke  mask -> glyph alpha         (solid / outline / lines, line width)                 cached per style + scale
     C  tile    glyph alpha -> coloured tile (position, size, rotation, colours, opacity)          every frame

   Stage B works from a signed distance field, so a line has the same width everywhere,
   with round ends and joins, at any size. That is what makes the result look drawn by one hand. */
(function (root) {
  'use strict';

  var INF = 1e20;

  /* ---------- Euclidean distance transform (Felzenszwalb & Huttenlocher) ---------- */

  /* Squared distance from every cell to the nearest cell where `feature[i]` is 1.
     Scratch arrays are shared and the two passes are written out in full: this runs several times per frame. */
  var scratch = { v: null, z: null, col: null };
  function line1d(a, start, stride, len) {
    var v = scratch.v, z = scratch.z, col = scratch.col, k = 0, q, s, fq, fv;
    for (q = 0; q < len; q++) col[q] = a[start + q * stride];
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (q = 1; q < len; q++) {
      fq = col[q] + q * q;
      s = (fq - (col[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (fq - (col[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      fv = q - v[k];
      a[start + q * stride] = fv * fv + col[v[k]];
    }
  }
  function edt2(feature, w, h) {
    var n = w * h, f = new Float32Array(n), i, x, y, m = Math.max(w, h) + 2;
    if (!scratch.v || scratch.v.length < m) { scratch.v = new Int32Array(m); scratch.z = new Float32Array(m + 1); scratch.col = new Float32Array(m); }
    for (i = 0; i < n; i++) f[i] = feature[i] ? 0 : INF;
    for (x = 0; x < w; x++) line1d(f, x, w, h);
    for (y = 0; y < h; y++) line1d(f, y * w, 1, w);
    return f;
  }

  function distTo(feature, w, h) {
    var d = edt2(feature, w, h);
    for (var i = 0; i < d.length; i++) d[i] = d[i] >= INF / 2 ? 1e6 : Math.sqrt(d[i]);
    return d;
  }

  function invert(a) { var o = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] ? 0 : 1; return o; }

  /* Grow / shrink a mask by r pixels (round structuring element). */
  function dilate(mask, w, h, r) {
    if (r <= 0) return mask;
    var d = distTo(mask, w, h), o = new Uint8Array(mask.length);
    for (var i = 0; i < o.length; i++) o[i] = d[i] <= r ? 1 : 0;
    return o;
  }
  function erode(mask, w, h, r) {
    if (r <= 0) return mask;
    var d = distTo(invert(mask), w, h), o = new Uint8Array(mask.length);
    for (var i = 0; i < o.length; i++) o[i] = mask[i] && d[i] > r ? 1 : 0;
    return o;
  }

  /* Signed distance to the edge: negative inside, positive outside, zero on the line. */
  function sdf(mask, w, h) {
    var dOut = distTo(mask, w, h), dIn = distTo(invert(mask), w, h), o = new Float32Array(mask.length);
    for (var i = 0; i < o.length; i++) o[i] = mask[i] ? -(dIn[i] - 0.5) : (dOut[i] - 0.5);
    return o;
  }

  /* ---------- Blur (three box passes ~ gaussian) ---------- */

  function boxBlur(src, w, h, r) {
    r = Math.round(r);
    if (r < 1) return src;
    var a = new Float32Array(src), b = new Float32Array(src.length), p;
    for (p = 0; p < 3; p++) {
      blurH(a, b, w, h, r); blurV(b, a, w, h, r);
    }
    return a;
  }
  function blurH(s, d, w, h, r) {
    var k = 1 / (2 * r + 1), x, y, acc, row;
    for (y = 0; y < h; y++) {
      row = y * w; acc = 0;
      for (x = -r; x <= r; x++) acc += s[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        d[row + x] = acc * k;
        acc += s[row + Math.min(w - 1, x + r + 1)] - s[row + Math.max(0, x - r)];
      }
    }
  }
  function blurV(s, d, w, h, r) {
    var k = 1 / (2 * r + 1), x, y, acc;
    for (x = 0; x < w; x++) {
      acc = 0;
      for (y = -r; y <= r; y++) acc += s[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        d[y * w + x] = acc * k;
        acc += s[Math.min(h - 1, y + r + 1) * w + x] - s[Math.max(0, y - r) * w + x];
      }
    }
  }

  /* ---------- Stage 0: read the picture at working size ---------- */

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }

  /* The picture drawn into a (G + 2*margin) square-ish grid, longest side G, with room around it
     so closing and dilating never clip at the border. Cached on the image by size. */
  function prepare(img, G) {
    if (img.__prep && img.__prep.G === G) return img.__prep;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var k = G / Math.max(iw, ih), sw = Math.max(1, Math.round(iw * k)), sh = Math.max(1, Math.round(ih * k));
    var m = Math.round(G * 0.1), w = sw + 2 * m, h = sh + 2 * m;
    var c = makeCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, m, m, sw, sh);
    var d = x.getImageData(0, 0, w, h).data, n = w * h, i, translucent = 0, inner = 0;
    /* the margin is empty by construction, so count translucency only inside the picture */
    for (var yy = m; yy < m + sh; yy++) for (var xx = m; xx < m + sw; xx++) { inner++; if (d[(yy * w + xx) * 4 + 3] < 250) translucent++; }
    /* background colour: the average of the four corner patches of the picture (opaque pixels only) */
    var sum = [0, 0, 0], cnt = 0, pr = Math.max(2, Math.round(Math.min(sw, sh) * 0.02)), cx, cy, px, py, o;
    [[m, m], [m + sw - pr, m], [m, m + sh - pr], [m + sw - pr, m + sh - pr]].forEach(function (p) {
      for (py = 0; py < pr; py++) for (px = 0; px < pr; px++) {
        o = ((p[1] + py) * w + p[0] + px) * 4;
        if (d[o + 3] > 200) { sum[0] += d[o]; sum[1] += d[o + 1]; sum[2] += d[o + 2]; cnt++; }
      }
    });
    var bg = cnt ? [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt] : [255, 255, 255];
    var prep = { G: G, w: w, h: h, m: m, sw: sw, sh: sh, data: d, hasAlpha: translucent / inner > 0.02, bg: bg, n: n };
    img.__prep = prep;
    return prep;
  }

  /* ---------- Stage A: shape ---------- */

  /* How much each pixel belongs to the glyph, 0..1. */
  function strength(p, read) {
    var d = p.data, n = p.n, s = new Float32Array(n), i, o, a, l, r, g, b, bgl;
    if (read === 'auto') read = p.hasAlpha ? 'alpha' : 'diff';
    bgl = p.bg;
    for (i = 0; i < n; i++) {
      o = i * 4; a = d[o + 3] / 255; r = d[o] / 255; g = d[o + 1] / 255; b = d[o + 2] / 255;
      l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (read === 'alpha') s[i] = a;
      else if (read === 'dark') s[i] = a * (1 - l);
      else if (read === 'light') s[i] = a * l;
      else { /* diff: how far from the corner colour; the empty margin is background by definition */
        if (a === 0) { s[i] = 0; continue; }
        var dr = r - bgl[0] / 255, dg = g - bgl[1] / 255, db = b - bgl[2] / 255;
        s[i] = a * Math.min(1, Math.sqrt((dr * dr + dg * dg + db * db) / 3) * 2.4);
      }
    }
    return s;
  }

  /* Luminance on the background colour, for the edge finder. */
  function luminance(p) {
    var d = p.data, n = p.n, L = new Float32Array(n), i, o, a, bg = p.bg, bl = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    if (p.hasAlpha) bl = 1;
    for (i = 0; i < n; i++) {
      o = i * 4; a = d[o + 3] / 255;
      L[i] = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255 * a + bl * (1 - a);
    }
    return L;
  }

  function sobel(L, w, h, thr) {
    var e = new Uint8Array(w * h), x, y, i, gx, gy, m;
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      gx = -L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1] + L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1];
      gy = -L[i - w - 1] - 2 * L[i - w] - L[i - w + 1] + L[i + w - 1] + 2 * L[i + w] + L[i + w + 1];
      m = Math.sqrt(gx * gx + gy * gy) / 4;
      e[i] = m >= thr ? 1 : 0;
    }
    return e;
  }

  /* shape(img, src, G) -> { w, h, mask, edges, bbox, centroid } or null when nothing is left. */
  function shape(img, src, G) {
    var p = prepare(img, G), w = p.w, h = p.h, n = p.n, i;
    var s = strength(p, src.read);
    if (src.invert) for (i = 0; i < n; i++) s[i] = 1 - s[i];
    var blurPx = (src.smooth / 100) * 0.03 * G;
    var sb = boxBlur(s, w, h, blurPx);
    var t = src.threshold / 100, mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = sb[i] >= t ? 1 : 0;
    /* simplify = close small gaps, then drop small specks and thin whiskers */
    var r = (src.simplify / 100) * 0.04 * G;
    if (r >= 0.75) { mask = erode(dilate(mask, w, h, r), w, h, r); mask = dilate(erode(mask, w, h, r), w, h, r); }

    /* bounding box and centre of mass */
    var x0 = w, y0 = h, x1 = -1, y1 = -1, x, y, cnt = 0, sx = 0, sy = 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; cnt++; sx += x; sy += y; }
    }
    if (!cnt) return null;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    /* mean thickness of the shape = 2 * area / perimeter; a drawing made of lines is only a few pixels thick */
    var per = 0;
    for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) {
      i = y * w + x;
      if (mask[i] && (!mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w])) per++;
    }
    var thickness = per ? 2 * cnt / per / Math.max(bw, bh) : 1;

    /* edges for the "lines" style: where the picture changes, inside a halo of the shape */
    var L = luminance(p), Lb = boxBlur(L, w, h, Math.max(1, (src.smooth / 100) * 0.012 * G + 0.002 * G));
    var thr = 0.015 + (1 - src.detail / 100) * 0.22;
    var edges = sobel(Lb, w, h, thr);
    var halo = dilate(mask, w, h, Math.max(3, 0.01 * G));
    for (i = 0; i < n; i++) if (!halo[i]) edges[i] = 0;

    return { w: w, h: h, mask: mask, edges: edges, bbox: [x0, y0, bw, bh], centroid: [sx / cnt - x0 - bw / 2, sy / cnt - y0 - bh / 2], thickness: thickness, G: G };
  }

  /* ---------- Stage B: stroke ---------- */

  /* styleOf(shape, style, unit) -> { canvas, pad, bw, bh } ; `unit` = tile fractions per glyph pixel,
     so the line width (a fraction of the tile) becomes pixels in the glyph's own grid. */
  function stroke(sh, style, unit) {
    var wpx = Math.max(1.2, style.width / unit);
    var pad = Math.ceil(wpx / 2) + 3, bw = sh.bbox[2], bh = sh.bbox[3];
    var gw = bw + 2 * pad, gh = bh + 2 * pad, n = gw * gh, x, y, i;
    var mask = new Uint8Array(n), edges = new Uint8Array(n), ox = sh.bbox[0], oy = sh.bbox[1];
    for (y = 0; y < bh; y++) for (x = 0; x < bw; x++) {
      i = (y + pad) * gw + x + pad;
      mask[i] = sh.mask[(y + oy) * sh.w + x + ox];
      edges[i] = sh.edges[(y + oy) * sh.w + x + ox];
    }
    var a = new Uint8ClampedArray(n * 4), half = wpx / 2, v, sd, de, c, mode = style.mode;
    var sdist = (mode === 'solid' || mode === 'outline' || mode === 'both') ? sdf(mask, gw, gh) : null;
    var edist = (mode === 'lines' || mode === 'both') ? distTo(edges, gw, gh) : null;
    var off = style.position === 'inside' ? -half : style.position === 'outside' ? half : 0;
    for (i = 0; i < n; i++) {
      v = 0;
      if (mode === 'solid') { v = 0.5 - sdist[i]; }
      else {
        if (sdist) { sd = sdist[i] - off; v = 0.5 + half - Math.abs(sd); }
        if (edist) { de = edist[i]; c = 0.5 + half - de; if (c > v) v = c; }
      }
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = Math.round(v * 255);
    }
    var cv = makeCanvas(gw, gh), cx = cv.getContext('2d');
    cx.putImageData(new ImageData(a, gw, gh), 0, 0);
    return { canvas: cv, pad: pad, bw: bw, bh: bh, tint: null };
  }

  /* ---------- Stage C: tile ---------- */

  function rgba(hex, alpha) {
    var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h, 16) || 0;
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* The glyph canvas painted in one colour. Cached on the stroke result. */
  function tinted(st, color) {
    if (st.tint && st.tint.color === color) return st.tint.canvas;
    var c = makeCanvas(st.canvas.width, st.canvas.height), x = c.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(st.canvas, 0, 0);
    st.tint = { color: color, canvas: c };
    return c;
  }

  /* Where the glyph's bounding box lands on the tile, in tile fractions, for snapping.
     Returns half extents of the rotated box and the centre-of-mass offset from its centre. */
  function footprint(sh, lay) {
    var u = lay.scale / Math.max(sh.bbox[2], sh.bbox[3]), hw = sh.bbox[2] * u / 2, hh = sh.bbox[3] * u / 2;
    var t = lay.rotate * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
    var cx = sh.centroid[0] * u * (lay.flipH ? -1 : 1), cy = sh.centroid[1] * u * (lay.flipV ? -1 : 1);
    var co = Math.cos(t), si = Math.sin(t);
    return { u: u, hw: hw * c + hh * s, hh: hw * s + hh * c, weightX: cx * co - cy * si, weightY: cx * si + cy * co };
  }

  /* paint(ctx, size, sh, st, s) draws the finished tile into the top-left size x size of ctx.
     `s` is the whole settings object; `opts.transparentBg` skips the tile (used for the knock-out test). */
  function paint(ctx, size, sh, st, s) {
    var col = s.color, lay = s.layout;
    ctx.save();
    if (col.bgOn) {
      ctx.fillStyle = rgba(col.bg, col.bgOpacity / 100);
      roundRect(ctx, 0, 0, size, size, col.radius / 100 * size);
      ctx.fill();
    }
    if (sh && st) {
      var u = lay.scale / Math.max(sh.bbox[2], sh.bbox[3]);
      ctx.translate(size / 2 + lay.x * size, size / 2 + lay.y * size);
      ctx.rotate(lay.rotate * Math.PI / 180);
      ctx.scale(lay.flipH ? -1 : 1, lay.flipV ? -1 : 1);
      ctx.scale(u * size, u * size);
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = col.fgOpacity / 100;
      var img;
      if (col.knockout && col.bgOn) { ctx.globalCompositeOperation = 'destination-out'; img = st.canvas; }
      else img = tinted(st, col.fg);
      ctx.drawImage(img, -(st.pad + st.bw / 2), -(st.pad + st.bh / 2));
    }
    ctx.restore();
  }

  root.Glyph = { shape: shape, stroke: stroke, paint: paint, footprint: footprint, roundRect: roundRect, rgba: rgba, makeCanvas: makeCanvas };
})(window);
