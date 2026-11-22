/* ===== Selection tools: marquee shapes, lasso (free / polygon), magic wand,
   selection modes (new / add / subtract / intersect), feather, marching-ants outline,
   crop aspect ratios ===== */

/* ---------- masks ---------- */
function maskFromShape(shape, r) {
  const m = mkCanvas(state.W, state.H), x = m.getContext('2d');
  x.fillStyle = '#000';
  x.beginPath();
  if (shape === 'ellipse') x.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  else x.rect(r.x, r.y, r.w, r.h);
  x.fill();
  return m;
}
function maskFromPoints(pts) {
  const m = mkCanvas(state.W, state.H), x = m.getContext('2d');
  x.fillStyle = '#000';
  x.beginPath();
  pts.forEach((q, i) => i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y));
  x.closePath(); x.fill();
  return m;
}
/* the rectangle a marquee shape covers while dragging (row/column are one pixel thick) */
function shapeRectFor(shape, a, b) {
  if (shape === 'row') return { x: 0, y: Math.floor(b.y), w: state.W, h: 1 };
  if (shape === 'column') return { x: Math.floor(b.x), y: 0, w: 1, h: state.H };
  return normRect(a, b);
}
/* tight bounding box of the non-empty pixels of a mask, or null when empty */
function maskBox(canvas) {
  const w = canvas.width, h = canvas.height;
  const a = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let minx = w, miny = h, maxx = -1, maxy = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3] > 0) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return null;
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}
/* soft edge: the mask blurred by r pixels */
function featherMask(mask, r) {
  if (r <= 0) return mask;
  const m = mkCanvas(state.W, state.H), x = m.getContext('2d');
  x.filter = `blur(${r}px)`;
  x.drawImage(mask, 0, 0);
  x.filter = 'none';
  return m;
}
/* combines a new mask with the current selection according to the mode option */
function combineSel(newMask) {
  const mode = OPT.selMode || 'new';
  if (mode === 'new' || !state.sel) return newMask;
  const m = mkCanvas(state.W, state.H), x = m.getContext('2d');
  x.drawImage(state.sel.mask, 0, 0);
  x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  x.drawImage(newMask, 0, 0);
  return m;
}
/* the one entry point every selection tool uses: feather, combine, store, draw */
function commitSelection(mask) {
  const f = Math.max(0, optNum('feather', 0));
  const combined = combineSel(featherMask(mask, f));
  const box = maskBox(combined);
  if (!box) { clearSelection(); return; }
  setSelection(combined, null, box);
}
/* marching ants: the outline of the mask, drawn as a black and white dashed line */
function buildEdge(mask) {
  const w = mask.width, h = mask.height;
  const a = mask.getContext('2d').getImageData(0, 0, w, h).data;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 127;
  const out = mkCanvas(w, h), o = out.getContext('2d');
  const img = o.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) continue;
      const k = (y * w + x) * 4, v = ((x + y) >> 2) & 1 ? 255 : 0;
      d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = 255;
    }
  }
  o.putImageData(img, 0, 0);
  return out;
}
/* the mask of contiguous (or global) pixels close in colour to the one under (sx, sy) */
function colorMask(canvas, sx, sy, tol, contig) {
  const w = canvas.width, h = canvas.height;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  let inc;
  if (contig) {
    const reg = floodRegion(canvas, sx, sy, tol);
    if (!reg) return null;
    inc = reg.inc;
  } else {
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const k0 = (sy * w + sx) * 4;
    const r0 = data[k0], g0 = data[k0 + 1], b0 = data[k0 + 2], a0 = data[k0 + 3];
    inc = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      if (Math.abs(data[k] - r0) <= tol && Math.abs(data[k + 1] - g0) <= tol &&
          Math.abs(data[k + 2] - b0) <= tol && Math.abs(data[k + 3] - a0) <= tol) inc[i] = 1;
    }
  }
  const m = mkCanvas(w, h), x = m.getContext('2d');
  const img = x.createImageData(w, h), d = img.data;
  for (let i = 0; i < inc.length; i++) if (inc[i]) d[i * 4 + 3] = 255;
  x.putImageData(img, 0, 0);
  return m;
}

/* ---------- marquee ---------- */
defTool('marquee', {
  cursor: 'crosshair',
  down(p, e, d) { d.start = p; },
  move(p, e, d) {
    const shape = OPT.selShape || 'rect';
    const r = shapeRectFor(shape, d.start, p);
    state.preview = Object.assign({ kind: shape === 'ellipse' ? 'ellipse' : 'rect' }, r);
    drawOverlay();
  },
  up(p, e, d) {
    state.preview = null;
    const shape = OPT.selShape || 'rect';
    const r = shapeRectFor(shape, d.start, p);
    if (shape !== 'row' && shape !== 'column' && (r.w < 2 || r.h < 2)) {
      if ((OPT.selMode || 'new') === 'new') clearSelection(); else drawOverlay();
      return;
    }
    commitSelection(maskFromShape(shape, r));
  },
  cancel() { state.preview = null; drawOverlay(); }
});

/* ---------- lasso: free drag, or polygon by taps ---------- */
let polyPts = null;                 // polygon lasso in progress: [{x,y}], or null
let lastPolyTap = { t: 0, p: { x: 0, y: 0 } };
function polyActive() { return !!polyPts; }
function polyFinish() {
  const pts = polyPts;
  polyPts = null; state.preview = null;
  if (pts && pts.length >= 3) commitSelection(maskFromPoints(pts));
  else drawOverlay();
  buildOpts();
}
function polyCancel() {
  polyPts = null; state.preview = null;
  drawOverlay(); buildOpts();
}
function polyDown(p) {
  if (!polyPts) { polyPts = [p]; buildOpts(); }
  else {
    const z = state.zoom, now = performance.now();
    const near = polyPts.length > 2 && Math.hypot(p.x - polyPts[0].x, p.y - polyPts[0].y) < 14 / z;
    const dbl = now - lastPolyTap.t < 350 && Math.hypot(p.x - lastPolyTap.p.x, p.y - lastPolyTap.p.y) < 20 / z;
    lastPolyTap = { t: now, p };
    if (near || dbl) return polyFinish();
    polyPts.push(p);
  }
  state.preview = { kind: 'poly', pts: polyPts.slice() };
  drawOverlay();
}
defTool('lasso', {
  cursor: 'crosshair',
  down(p, e, d) {
    if ((OPT.lassoType || 'free') === 'poly') { d.poly = true; polyDown(p); return; }
    d.pts = [p];
  },
  move(p, e, d) {
    if (d.poly) {
      if (polyPts) { state.preview = { kind: 'poly', pts: polyPts.concat([p]) }; drawOverlay(); }
      return;
    }
    d.pts.push(p);
    state.preview = { kind: 'poly', pts: d.pts };
    drawOverlay();
  },
  up(p, e, d) {
    if (d.poly) return;
    state.preview = null;
    if (d.pts.length < 3) return drawOverlay();
    commitSelection(maskFromPoints(d.pts));
  },
  cancel(d) { if (!d.poly) { state.preview = null; drawOverlay(); } }
});

/* ---------- magic wand ---------- */
defTool('wand', {
  cursor: 'crosshair',
  down(p) {
    const t = strokeTarget();
    if (!t) return;
    const m = colorMask(t.canvas, p.x, p.y, optNum('tolerance', 32), (OPT.wandMode || 'contig') === 'contig');
    if (m) commitSelection(m);
  }
});

/* ---------- crop with an aspect ratio ---------- */
function cropRatio() {
  const v = OPT.cropRatio || 'free';
  if (v === 'free') return 0;
  if (v === 'original') return state.W / state.H;
  const [a, b] = v.split(':').map(Number);
  return a / b;
}
defTool('crop', {
  cursor: 'crosshair',
  down(p, e, d) { d.start = p; },
  move(p, e, d) {
    const r = normRect(d.start, p);
    const ratio = cropRatio();
    if (ratio) {
      r.h = r.w / ratio;
      r.y = p.y < d.start.y ? d.start.y - r.h : d.start.y;
    }
    state.crop = r;
    drawOverlay();
  },
  up() {
    if (!state.crop || state.crop.w < 2 || state.crop.h < 2) state.crop = null;
    buildOpts();
    drawOverlay();
  }
});

/* ---------- reselect, expand / contract, smooth, saved selections ---------- */
function reselect() {
  const s = state.lastSel;
  if (!s) return toast(t('لا يوجد تحديد سابق'));
  setSelection(s.mask, s.poly, s.box);
}
/* one horizontal or vertical pass of a square max (dilate) or min (erode) filter, using prefix sums */
function slidePass(src, w, h, r, dilate, horiz) {
  const dst = new Uint8Array(w * h);
  const lines = horiz ? h : w, len = horiz ? w : h, win = 2 * r + 1;
  const pre = new Int32Array(len + 1);
  for (let l = 0; l < lines; l++) {
    const at = i => horiz ? l * w + i : i * w + l;
    pre[0] = 0;
    for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[at(i)];
    for (let i = 0; i < len; i++) {
      const lo = Math.max(0, i - r), hi = Math.min(len - 1, i + r), cnt = pre[hi + 1] - pre[lo];
      dst[at(i)] = dilate ? (cnt > 0 ? 1 : 0) : (i - r >= 0 && i + r < len && cnt === win ? 1 : 0);
    }
  }
  return dst;
}
/* expands (dilate) or contracts (erode) a mask by r pixels */
function morphMask(mask, r, dilate) {
  const w = mask.width, h = mask.height;
  const a = mask.getContext('2d').getImageData(0, 0, w, h).data;
  let cur = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) cur[i] = a[i * 4 + 3] > 127 ? 1 : 0;
  cur = slidePass(cur, w, h, r, dilate, true);
  cur = slidePass(cur, w, h, r, dilate, false);
  const out = mkCanvas(w, h), x = out.getContext('2d');
  const img = x.createImageData(w, h), d = img.data;
  for (let i = 0; i < w * h; i++) if (cur[i]) d[i * 4 + 3] = 255;
  x.putImageData(img, 0, 0);
  return out;
}
/* removes jagged edges: blur, then a hard threshold at 50% */
function smoothMask(mask, r) {
  const w = mask.width, h = mask.height;
  const m = mkCanvas(w, h), x = m.getContext('2d');
  x.filter = `blur(${r}px)`;
  x.drawImage(mask, 0, 0);
  x.filter = 'none';
  const img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = d[i + 3] >= 128 ? 255 : 0; }
  x.putImageData(img, 0, 0);
  return m;
}
function applyMaskOp(m) {
  const box = maskBox(m);
  if (!box) return clearSelection();
  setSelection(m, null, box);
}
function growSel(dilate) {
  if (!state.sel) return toast(t('لا يوجد تحديد'));
  applyMaskOp(morphMask(state.sel.mask, Math.max(1, Math.round(optNum('growPx', 2))), dilate));
}
function smoothSel() {
  if (!state.sel) return toast(t('لا يوجد تحديد'));
  applyMaskOp(smoothMask(state.sel.mask, Math.max(1, optNum('growPx', 2))));
}
/* saved selections live in state.selections (name -> mask canvas) and are written into the project file */
function saveSelection() {
  if (!state.sel) return toast(t('لا يوجد تحديد'));
  let name = t('تحديد') + ' ' + (Object.keys(state.selections).length + 1);
  while (state.selections[name]) name += '+';
  state.selections[name] = cloneC(state.sel.mask);
  state.dirty = true;
  buildOpts();
  toast(t('تم حفظ التحديد'));
}
function loadSelection() {
  const e = $('selSaved'), c = e && state.selections[e.value];
  if (!c) return;
  applyMaskOp(cloneC(c));
}
function deleteSelection() {
  const e = $('selSaved');
  if (!e || !state.selections[e.value]) return;
  delete state.selections[e.value];
  state.dirty = true;
  buildOpts();
}
