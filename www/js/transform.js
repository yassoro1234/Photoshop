/* ===== Direct manipulation: pick a layer on the canvas, free transform with handles, eyedropper ===== */

const stageEl2 = $('stage');
const FT_HANDLE_PX = 12;      // hit radius for handles, in screen pixels
const FT_SIGN_X = [-1, 1, 1, -1];
const FT_SIGN_Y = [-1, -1, 1, 1];

/* ---------- hit testing ---------- */
function layerAlphaAt(l, x, y) {
  if (!l.canvas) return 0;
  return l.ctx.getImageData(x, y, 1, 1).data[3];
}

/* Index of the topmost visible pixel layer under point p (or -1) */
function layerAt(p, onlyType) {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= state.W || y >= state.H) return -1;
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i];
    if (!isRaster(l) || !isLayerVisible(l)) continue;
    if (onlyType && l.type !== onlyType) continue;
    if (layerAlphaAt(l, x, y) > 16) return i;
  }
  return -1;
}

/* Tight bounding box of a layer's visible pixels */
function alphaBBox(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let minx = w, miny = h, maxx = -1, maxy = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx < 0) return null;
  return { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 };
}

/* ---------- free transform ---------- */
/* Matrix: translate to center+offset, rotate, scale, translate back */
function ftApply(ctx, ft) {
  const cx = ft.box.x + ft.box.w / 2, cy = ft.box.y + ft.box.h / 2;
  ctx.translate(cx + ft.ox, cy + ft.oy);
  ctx.rotate(ft.rot);
  ctx.scale(ft.sx, ft.sy);
  ctx.translate(-cx, -cy);
}

/* Local (original canvas) point -> document point */
function ftToDoc(ft, lx, ly) {
  const cx = ft.box.x + ft.box.w / 2, cy = ft.box.y + ft.box.h / 2;
  const dx = (lx - cx) * ft.sx, dy = (ly - cy) * ft.sy;
  const c = Math.cos(ft.rot), s = Math.sin(ft.rot);
  return { x: dx * c - dy * s + cx + ft.ox, y: dx * s + dy * c + cy + ft.oy };
}

/* Document point -> offset from the transformed center, rotated back into the layer's frame */
function ftLocalFromDoc(ft, p) {
  const cx = ft.box.x + ft.box.w / 2, cy = ft.box.y + ft.box.h / 2;
  const px = p.x - (cx + ft.ox), py = p.y - (cy + ft.oy);
  const c = Math.cos(-ft.rot), s = Math.sin(-ft.rot);
  return { x: px * c - py * s, y: px * s + py * c };
}

function ftGeometry(ft) {
  const b = ft.box;
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
    .map(([x, y]) => ftToDoc(ft, x, y));
  const cx = b.x + b.w / 2;
  const top = ftToDoc(ft, cx, b.y);
  const center = ftToDoc(ft, cx, b.y + b.h / 2);
  const len = Math.hypot(top.x - center.x, top.y - center.y) || 1;
  const off = 28 / state.zoom;
  const rot = { x: top.x + (top.x - center.x) / len * off, y: top.y + (top.y - center.y) / len * off };
  return { corners, top, rot, center };
}

function ftHit(p) {
  const ft = state.ft, g = ftGeometry(ft), r = FT_HANDLE_PX / state.zoom;
  if (Math.hypot(p.x - g.rot.x, p.y - g.rot.y) <= r) return { mode: 'rot' };
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(p.x - g.corners[i].x, p.y - g.corners[i].y) <= r) return { mode: 'scale', i };
  }
  const l = ftLocalFromDoc(ft, p);
  const hw = ft.box.w / 2 * ft.sx, hh = ft.box.h / 2 * ft.sy;
  if (Math.abs(l.x) <= hw && Math.abs(l.y) <= hh) return { mode: 'move' };
  return null;
}

function ftMove(p, e, d) {
  const ft = state.ft, h = d.ftHit;
  if (!ft || !h) return;
  const cx = ft.box.x + ft.box.w / 2, cy = ft.box.y + ft.box.h / 2;
  if (h.mode === 'move') {
    ft.ox += p.x - d.last.x; ft.oy += p.y - d.last.y;
  } else if (h.mode === 'rot') {
    const cdx = cx + ft.ox, cdy = cy + ft.oy;
    let a = Math.atan2(p.y - cdy, p.x - cdx) + Math.PI / 2;
    if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    ft.rot = a;
  } else if (h.mode === 'scale') {
    const l = ftLocalFromDoc(ft, p);
    const sx = Math.max(0.02, Math.abs(l.x * FT_SIGN_X[h.i] / (ft.box.w / 2)));
    const sy = Math.max(0.02, Math.abs(l.y * FT_SIGN_Y[h.i] / (ft.box.h / 2)));
    if (e.shiftKey) { const s = (sx + sy) / 2; ft.sx = s; ft.sy = s; }
    else { ft.sx = sx; ft.sy = sy; }
  }
  d.last = p;
  render();
}

/* Preview handles on the overlay (document coordinates) */
function drawFtHandles(x) {
  const ft = state.ft; if (!ft) return;
  const g = ftGeometry(ft), z = state.zoom;
  x.save();
  x.setLineDash([]);
  x.strokeStyle = '#4f9cff';
  x.lineWidth = 1.5 / z;
  x.beginPath();
  g.corners.forEach((c, i) => i ? x.lineTo(c.x, c.y) : x.moveTo(c.x, c.y));
  x.closePath(); x.stroke();
  x.beginPath(); x.moveTo(g.top.x, g.top.y); x.lineTo(g.rot.x, g.rot.y); x.stroke();
  const hs = 8 / z;
  x.fillStyle = '#fff';
  g.corners.forEach(c => x.fillRect(c.x - hs / 2, c.y - hs / 2, hs, hs));
  x.beginPath(); x.arc(g.rot.x, g.rot.y, hs / 2 + 1 / z, 0, Math.PI * 2); x.fill();
  x.restore();
}

function ftStart(l) {
  if (!l || !isRaster(l)) return;
  if (l.locked) return toast(t('الطبقة مقفلة'));
  const box = alphaBBox(l.canvas);
  if (!box) return toast(t('لا توجد بكسلات في هذه الطبقة'));
  state.ft = { id: l.id, src: cloneC(l.canvas), box, sx: 1, sy: 1, rot: 0, ox: 0, oy: 0 };
  toast(t('تحويل الطبقة (Enter للتطبيق، Esc للإلغاء)'));
  buildOpts(); render();
}
function freeTransformCurrent() {
  const l = curRaster();
  if (!l) return toast(t('اختر طبقة بكسل أولاً'));
  ftStart(l);
}

function ftCommit() {
  const ft = state.ft; if (!ft) return;
  state.ft = null;
  const l = state.layers.find(x => x.id === ft.id);
  if (l) {
    l.ctx.clearRect(0, 0, l.canvas.width, l.canvas.height);
    l.ctx.save();
    ftApply(l.ctx, ft);
    l.ctx.drawImage(ft.src, 0, 0);
    l.ctx.restore();
    if (l.type === 'text') { l.type = 'raster'; l.text = null; }   // transformed text becomes pixels
    pushHistory();
  }
  buildOpts(); render(); refreshLayers();
}
function ftCancel() {
  if (!state.ft) return;
  state.ft = null;
  buildOpts(); render();
}

/* ---------- eyedropper ---------- */
function eyedropColor(p) {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (x < 0 || y < 0 || x >= state.W || y >= state.H) return null;
  const src = ($('sampleSrc') && $('sampleSrc').value === 'layer' && curRaster()) ? curRaster().canvas : $('comp');
  const v = src.getContext('2d', { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
  if (v[3] === 0) return null;
  return rgbToHex(v[0], v[1], v[2]);
}

function showLoupe(clientX, clientY, p, hex) {
  const el = $('loupe');
  el.classList.add('on');
  const cv = $('loupeCv'), g = cv.getContext('2d');
  const src = ($('sampleSrc') && $('sampleSrc').value === 'layer' && curRaster()) ? curRaster().canvas : $('comp');
  const N = 11, cell = cv.width / N, px = Math.floor(p.x) - 5, py = Math.floor(p.y) - 5;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#222'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(src, px, py, N, N, 0, 0, cv.width, cv.height);
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
  g.strokeRect(5 * cell, 5 * cell, cell, cell);
  $('loupeHex').textContent = hex ? hex.toUpperCase() : '—';
  $('loupeHex').style.background = hex || 'transparent';
  const r = el.getBoundingClientRect();
  let left = clientX + 24, top = clientY - r.height - 16;
  if (left + r.width > innerWidth - 4) left = clientX - r.width - 24;
  if (top < 4) top = clientY + 24;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
function hideLoupe() { $('loupe').classList.remove('on'); }

/* Eyedropper: sample while dragging and set the foreground color live */
function eyedropPick(p, e) {
  const hex = eyedropColor(p);
  if (hex) { state.fg = hex; renderSwatches(); }
  showLoupe(e.clientX, e.clientY, p, hex);
}

/* ---------- pointer hooks ---------- */
/* Alt+click on a painting tool samples the foreground color without changing tools */
stageEl2.addEventListener('pointerdown', e => {
  if (!e.altKey || !state.layers.length) return;
  if (!['brush', 'bucket', 'gradient', 'pen', 'text'].includes(state.tool)) return;
  e.stopImmediatePropagation();
  const hex = eyedropColor(docPoint(e.clientX, e.clientY));
  if (hex) { state.fg = hex; renderSwatches(); toast(t('تم أخذ اللون')); }
}, true);

stageEl2.addEventListener('pointermove', e => {
  if (state.tool !== 'eyedrop' || !state.layers.length) return;
  if (e.buttons) return;             // dragging is handled by the eyedropper tool itself
  const p = docPoint(e.clientX, e.clientY);
  showLoupe(e.clientX, e.clientY, p, eyedropColor(p));
});
stageEl2.addEventListener('pointerleave', hideLoupe);

/* Double-click with the Move tool: text opens its dialog, pixels enter free transform */
stageEl2.addEventListener('dblclick', e => {
  if (state.tool !== 'move' || !state.layers.length || state.ft) return;
  const p = docPoint(e.clientX, e.clientY);
  const i = layerAt(p);
  if (i < 0) return;
  state.active = i;
  refreshLayers();
  const l = state.layers[i];
  if (l.type === 'text' && l.text) return openTextDialog(l);
  ftStart(l);
});
