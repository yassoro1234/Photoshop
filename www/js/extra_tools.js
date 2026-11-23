/* ===== Pencil, color replacement, spot healing, patch, and the anchored pen path ===== */

/* ---------- shared stroke wrapper (same pattern as the brush) ---------- */
function makeSegTool(seg, cursor) {
  return {
    cursor: cursor || 'crosshair',
    down(p, e, d) { d.carry = null; d.painted = seg(p, p, d); d.last = p; render(); },
    move(p, e, d) { if (seg(d.last, p, d)) d.painted = true; d.last = p; render(); },
    up(p, e, d) { if (d.painted) { pushHistory(); refreshLayers(); } }
  };
}

/* ---------- pencil: hard-edged, no anti-aliasing ---------- */
function pencilSeg(a, b) {
  const t = strokeTarget(), l = curRaster();
  if (!t || !l || l.locked) return false;
  const size = Math.max(1, Math.round(optNum('brushSize', 12)));
  const alpha = clamp(optNum('brushAlpha', 100), 1, 100) / 100;
  const color = state.maskEdit ? '#ffffff' : state.fg;
  const sc = strokeScratch(), sx = sc.getContext('2d');
  sx.clearRect(0, 0, sc.width, sc.height);
  sx.fillStyle = color;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  const half = Math.floor(size / 2);
  let last = null;
  for (let i = 0; i <= n; i++) {
    const x = Math.round(a.x + (b.x - a.x) * i / n), y = Math.round(a.y + (b.y - a.y) * i / n);
    if (last && last.x === x && last.y === y) continue;
    last = { x, y };
    sx.fillRect(x - half, y - half, size, size);   // whole-pixel squares keep the edge hard
  }
  return drawOntoLayer(sc, alpha) ? true : false;
}

/* ---------- color replacement: paints the fg colour over pixels that match the colour under the first click ---------- */
function colorRepSeg(a, b, d) {
  const t = strokeTarget(), l = curRaster();
  if (!t || !l || l.locked) return false;
  const size = optNum('brushSize', 12);
  const r = Math.max(1, Math.round(size / 2)), rf = Math.max(1, size / 2);
  const tol = clamp(optNum('tolerance', 32), 1, 255);
  const str = clamp(optNum('retStrength', 100), 1, 100) / 100;
  if (!d.srcRGB) {
    const px = l.ctx.getImageData(Math.round(a.x), Math.round(a.y), 1, 1).data;
    d.srcRGB = [px[0], px[1], px[2]];
  }
  const fg = hexToRgb(state.maskEdit ? '#ffffff' : state.fg);
  const [sr, sg, sb] = d.srcRGB;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, size / 6)));
  let touched = false;
  for (let k = 0; k <= n; k++) {
    const cx = a.x + (b.x - a.x) * k / n, cy = a.y + (b.y - a.y) * k / n;
    const rc = retRect(cx, cy, r);
    const img = t.ctx.getImageData(rc.x0, rc.y0, rc.w, rc.h);
    const src = img.data, selA = state.sel
      ? state.sel.mask.getContext('2d').getImageData(rc.x0, rc.y0, rc.w, rc.h).data : null;
    let dab = false;
    for (let py = 0; py < rc.h; py++) for (let px = 0; px < rc.w; px++) {
      const i = (py * rc.w + px) * 4;
      const dx = px + 0.5 - rc.cx, dy = py + 0.5 - rc.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= rf || src[i + 3] === 0) continue;
      const diff = Math.sqrt((src[i] - sr) ** 2 + (src[i + 1] - sg) ** 2 + (src[i + 2] - sb) ** 2) / Math.sqrt(3);
      if (diff > tol) continue;
      let w = str * (1 - (dist / rf) * (dist / rf)) * (1 - diff / tol);
      if (selA) w *= selA[i + 3] / 255;
      if (w <= 0) continue;
      dab = true;
      for (let c = 0; c < 3; c++) src[i + c] = src[i + c] + (fg[c] - src[i + c]) * w;
    }
    if (dab) { t.ctx.putImageData(img, rc.x0, rc.y0); touched = true; }
  }
  return touched;
}
const colorRepTool = {
  cursor: 'crosshair',
  down(p, e, d) { d.srcRGB = null; d.painted = colorRepSeg(p, p, d); d.last = p; render(); },
  move(p, e, d) { if (colorRepSeg(d.last, p, d)) d.painted = true; d.last = p; render(); },
  up(p, e, d) { if (d.painted) { pushHistory(); refreshLayers(); } }
};

/* ---------- spot healing: replaces the dab with the surrounding average, keeping its texture ---------- */
function healDab(p) {
  const t = strokeTarget(), l = curRaster();
  if (!t || !l || l.locked) return false;
  const size = optNum('brushSize', 12);
  const r = Math.max(1, Math.round(size / 2)), rf = Math.max(1, size / 2);
  const R = 2 * r + 2;
  const x0 = Math.round(p.x) - R, y0 = Math.round(p.y) - R, w = 2 * R + 1, h = w;
  const cx = p.x - x0, cy = p.y - y0;
  const img = t.ctx.getImageData(x0, y0, w, h);
  const o = Float32Array.from(img.data);
  const low = retBlur(retBlur(o, w, h), w, h);
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const i = (py * w + px) * 4;
    const dist = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
    if (dist >= r && dist < 2 * r && o[i + 3] > 0) { sr += o[i]; sg += o[i + 1]; sb += o[i + 2]; cnt++; }
  }
  if (!cnt) return false;
  sr /= cnt; sg /= cnt; sb /= cnt;
  const str = clamp(optNum('retStrength', 50), 1, 100) / 100;
  const selA = state.sel ? state.sel.mask.getContext('2d').getImageData(x0, y0, w, h).data : null;
  const out = Float32Array.from(o);
  let touched = false;
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const i = (py * w + px) * 4;
    const dist = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
    if (dist >= rf) continue;
    let a = str * (1 - (dist / rf) * (dist / rf));
    if (selA) a *= selA[i + 3] / 255;
    if (a <= 0) continue;
    touched = true;
    const target = [sr + o[i] - low[i], sg + o[i + 1] - low[i + 1], sb + o[i + 2] - low[i + 2]];
    for (let c = 0; c < 3; c++) out[i + c] = o[i + c] + (target[c] - o[i + c]) * a;
  }
  if (!touched) return false;
  img.data.set(out);
  t.ctx.putImageData(img, x0, y0);
  return true;
}
const healTool = makeSegTool((a, b) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, optNum('brushSize', 12) / 6)));
  let any = false;
  for (let k = 0; k <= n; k++) if (healDab({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n })) any = true;
  return any;
}, 'crosshair');

/* ---------- patch: drag inside a selection to a source area, the selection takes that content ---------- */
function commitPatch(dx, dy) {
  const l = curRaster();
  if (!l || l.locked || !state.sel || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return false;
  const tmp = mkCanvas(state.W, state.H);
  tmp.getContext('2d').drawImage(l.canvas, -Math.round(dx), -Math.round(dy));
  if (!drawOntoLayer(tmp)) return false;
  pushHistory(); render(); refreshLayers();
  return true;
}
defTool('patch', {
  cursor: 'move',
  down(p, e, d) {
    const box = state.sel && state.sel.box;
    if (box && p.x >= box.x && p.x < box.x + box.w && p.y >= box.y && p.y < box.y + box.h) {
      d.patchStart = p; d.patchDelta = { x: 0, y: 0 };
    } else {
      d.marq = true; TOOLS.marquee.down(p, e, d);
    }
  },
  move(p, e, d) {
    if (d.patchStart) { d.patchDelta = { x: p.x - d.patchStart.x, y: p.y - d.patchStart.y }; }
    else if (d.marq) TOOLS.marquee.move(p, e, d);
  },
  up(p, e, d) {
    if (d.patchStart) commitPatch(d.patchDelta.x, d.patchDelta.y);
    else if (d.marq) TOOLS.marquee.up(p, e, d);
    d.patchStart = null;
  }
});

/* ---------- history brush: paints the pixels of an earlier document state ---------- */
function historySource(l) {
  const i = clamp(+(OPT.hbIndex ?? 0), 0, state.undo.length - 1);
  const snap = state.undo[i];
  if (!snap) return null;
  const e = snap.layers.find(x => x.meta.id === l.id);
  return e && e.canvas ? e.canvas : null;
}
function historySeg(a, b) {
  const t = strokeTarget(), l = curRaster();
  if (!t || !l || l.locked) return false;
  const src = historySource(l);
  if (!src) return toast(t('لا توجد حالة سابقة لهذه الطبقة')) || false;
  const sc = strokeScratch(), sx = sc.getContext('2d');
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.globalCompositeOperation = 'source-over'; sx.globalAlpha = 1;
  sx.clearRect(0, 0, sc.width, sc.height);
  sx.lineCap = 'round'; sx.lineJoin = 'round';
  sx.lineWidth = optNum('brushSize', 12); sx.strokeStyle = '#000';
  sx.beginPath(); sx.moveTo(a.x, a.y); sx.lineTo(b.x, b.y); sx.stroke();
  sx.globalCompositeOperation = 'source-in';   // keep the source pixels only where the stroke is
  sx.drawImage(src, 0, 0);
  sx.globalCompositeOperation = 'source-over';
  return drawOntoLayer(sc, clamp(optNum('brushAlpha', 100), 1, 100) / 100) ? true : false;
}
defTool('history', makeSegTool(historySeg, 'crosshair'));

/* ---------- tool registration ---------- */

defTool('pencil', makeSegTool(pencilSeg, 'crosshair'));
defTool('colorrep', colorRepTool);
defTool('heal', healTool);

/* ---------- anchored pen path: each anchor has an out handle and a mirrored in handle ---------- */
function penPath(x, pen) {
  const pts = pen.pts;
  x.beginPath();
  pts.forEach((q, i) => {
    if (!i) { x.moveTo(q.x, q.y); return; }
    const pr = pts[i - 1];
    x.bezierCurveTo(pr.ox, pr.oy, q.ix, q.iy, q.x, q.y);
  });
  if (pen.closed && pts.length > 2) {
    const f = pts[0], l = pts[pts.length - 1];
    x.bezierCurveTo(l.ox, l.oy, f.ix, f.iy, f.x, f.y);
    x.closePath();
  }
}

/* Removes consecutive duplicate anchors (a double click adds two at the same spot) */
function penClean(pen) {
  pen.pts = pen.pts.filter((q, i, arr) => !i || Math.hypot(q.x - arr[i - 1].x, q.y - arr[i - 1].y) > 1);
}

/* Draws the path while it is being built: curve, anchors, and handles */
function drawPenOverlay(x, pen, z) {
  x.save();
  x.strokeStyle = state.fg; x.lineWidth = 2 / z;
  penPath(x, pen); x.stroke();
  pen.pts.forEach(q => {
    if (Math.hypot(q.ox - q.x, q.oy - q.y) > 1) {
      x.strokeStyle = '#7fb6ff'; x.lineWidth = 1 / z;
      x.beginPath(); x.moveTo(q.ix, q.iy); x.lineTo(q.ox, q.oy); x.stroke();
      x.beginPath(); x.arc(q.ox, q.oy, 3 / z, 0, Math.PI * 2); x.fillStyle = '#7fb6ff'; x.fill();
    }
  });
  pen.pts.forEach(q => {
    x.beginPath(); x.arc(q.x, q.y, 4 / z, 0, Math.PI * 2);
    x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#333'; x.lineWidth = 1 / z; x.stroke();
  });
  x.restore();
}
