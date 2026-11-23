/* ===== Document model, rendering, history, layers, selection ===== */

/* ---------- layer model ---------- */
function makeLayer(name, type = 'raster', w = state.W, h = state.H) {
  const c = mkCanvas(w, h);
  return {
    id: uid(), name, type, canvas: c, ctx: c.getContext('2d'),
    visible: true, locked: false, opacity: 1, blend: 'source-over',
    mask: null, group: null, text: null
  };
}
function makeGroup(name) {
  return {
    id: uid(), name, type: 'group', canvas: null, ctx: null,
    visible: true, locked: false, collapsed: false, opacity: 1,
    blend: 'source-over', mask: null, group: null, text: null
  };
}
const isRaster = l => !!l && l.type !== 'group' && l.type !== 'adjust';
const isAdjust = l => !!l && l.type === 'adjust';   // adjustment layer: no pixels of its own
const cur = () => state.layers[state.active] || null;
/* the layer that is being drawn on: raster layers, or an adjustment layer while its mask is being edited */
const curRaster = () => { const l = cur(); return isRaster(l) || (isAdjust(l) && state.maskEdit && !!l.mask) ? l : null; };
/* the layer a mask belongs to: any pixel layer or adjustment layer */
const maskOwner = () => { const l = cur(); return isRaster(l) || isAdjust(l) ? l : null; };
/* tools that paint through a mask, so they can be used on an adjustment layer's mask */
const MASK_PAINT_TOOLS = new Set(['brush', 'eraser', 'pencil', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'heal', 'colorrep', 'gradient', 'hand', 'zoom']);

/* the chain of groups a layer sits in, innermost first */
function groupChain(l) {
  const out = [];
  let g = l, guard = 0;
  while (g && g.group && guard++ < 64) {
    g = state.layers.find(x => x.id === g.group) || null;
    if (g) out.push(g);
  }
  return out;
}
function isLayerVisible(l) {
  if (!l.visible) return false;
  return groupChain(l).every(g => g.visible);
}
/* opacity inherited from the groups around a layer */
function groupOpacity(l) {
  return groupChain(l).reduce((a, g) => a * (g.opacity ?? 1), 1);
}
/* true if group g is l itself or sits inside l (moving l into g would make a loop) */
function isInside(g, l) {
  return g.id === l.id || groupChain(g).some(x => x.id === l.id);
}

/* Default layer names are stored as translation keys so they follow the language setting */
function nameLayer(l, key, n, ref) {
  l.nameKey = key;
  if (n !== undefined) l.nameN = n;
  if (ref) l.nameRef = ref;
  return l;
}
function layerName(l) {
  if (!l) return '';
  if (!l.nameKey) return l.name;
  const vars = { n: l.nameN };
  if (l.nameRef) {
    const r = state.layers.find(x => x.id === l.nameRef);
    vars.base = r ? layerName(r) : '';
  }
  return t(l.nameKey, vars);
}

function metaOf(l) {
  const { canvas, ctx, mask, ...meta } = l;
  return meta;
}

/* ---------- stage size & rendering ---------- */
function resizeStage() {
  const comp = $('comp'), ov = $('ov'), wrap = $('canvasWrap');
  comp.width = ov.width = state.W;
  comp.height = ov.height = state.H;
  wrap.style.width = state.W + 'px';
  wrap.style.height = state.H + 'px';
}

let _scratch = null;
function scratch() {
  if (!_scratch || _scratch.width !== state.W || _scratch.height !== state.H)
    _scratch = mkCanvas(state.W, state.H);
  return _scratch;
}

function render() {
  const comp = $('comp');
  const x = comp.getContext('2d');
  x.clearRect(0, 0, state.W, state.H);
  drawStack(x, state.layers, true);
  drawOverlay();
  $('docInfo').textContent = infoText(state.W, state.H, state.layers.filter(isRaster).length);
  updateTitle();
}

/* reusable scratch canvases, one per name, sized to the document */
const _tmp = {};
function tmpCanvas(key) {
  let c = _tmp[key];
  if (!c || c.width !== state.W || c.height !== state.H) c = _tmp[key] = mkCanvas(state.W, state.H);
  return c;
}
/* a raster layer's pixels with its mask applied, drawn with the context's current composite settings */
function drawLayerPixels(x, l) {
  if (l.mask) {
    const s = tmpCanvas('mask'), sx = s.getContext('2d');
    sx.globalCompositeOperation = 'source-over';
    sx.clearRect(0, 0, s.width, s.height);
    sx.drawImage(l.canvas, 0, 0);
    sx.globalCompositeOperation = 'destination-in';
    sx.drawImage(l.mask, 0, 0);
    x.drawImage(s, 0, 0);
  } else {
    x.drawImage(l.canvas, 0, 0);
  }
}
/* Draws the visible raster layers in order. A layer marked clip is drawn only where the layer
   below it (its base) has pixels; the base and its clipped layers form one group. */
function drawStack(x, layers, live) {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!(isRaster(l) || isAdjust(l)) || !isLayerVisible(l)) continue;
    if (isAdjust(l)) { applyAdjustLayer(x, l); continue; }   // filters everything drawn so far
    if (l.clip) continue;
    x.globalAlpha = l.opacity * groupOpacity(l);
    x.globalCompositeOperation = l.blend;
    if (live && state.ft && state.ft.id === l.id) {     // live preview of a free transform
      x.save(); ftApply(x, state.ft); x.drawImage(state.ft.src, 0, 0); x.restore();
      continue;
    }
    const clipped = [];
    for (let j = i + 1; j < layers.length && layers[j].clip && isRaster(layers[j]); j++) {
      if (isLayerVisible(layers[j])) clipped.push(layers[j]);
    }
    if (!clipped.length) { drawLayerPixels(x, l); continue; }
    const g = tmpCanvas('group'), gx = g.getContext('2d');
    const base = tmpCanvas('base'), bx = base.getContext('2d');
    gx.clearRect(0, 0, g.width, g.height);
    gx.globalAlpha = 1; gx.globalCompositeOperation = 'source-over';
    drawLayerPixels(gx, l);
    bx.clearRect(0, 0, base.width, base.height);
    bx.drawImage(g, 0, 0);
    for (const c of clipped) {
      const t = tmpCanvas('clip'), tx = t.getContext('2d');
      tx.clearRect(0, 0, t.width, t.height);
      tx.globalAlpha = 1; tx.globalCompositeOperation = 'source-over';   // the scratch context keeps its last settings
      drawLayerPixels(tx, c);
      tx.globalCompositeOperation = 'destination-in';
      tx.drawImage(base, 0, 0);
      gx.globalAlpha = c.opacity;
      gx.globalCompositeOperation = c.blend;
      gx.drawImage(t, 0, 0);
    }
    x.drawImage(g, 0, 0);
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
}

/* ---------- overlay: selection, crop, previews ---------- */
function drawOverlay() {
  const ov = $('ov'), x = ov.getContext('2d');
  x.clearRect(0, 0, ov.width, ov.height);
  const z = state.zoom;
  x.lineWidth = 1 / z;
  if (QMASK && state.sel) {
    // quick mask: the selected area is tinted red, the rest is clear
    const tint = mkCanvas(state.W, state.H), tx = tint.getContext('2d');
    tx.fillStyle = 'rgba(255,40,40,0.5)';
    tx.fillRect(0, 0, state.W, state.H);
    tx.globalCompositeOperation = 'destination-in';
    tx.drawImage(state.sel.mask, 0, 0);
    x.drawImage(tint, 0, 0);
  }

  const dashed = () => { x.setLineDash([5 / z, 4 / z]); };

  if (state.sel) {
    if (!state.sel.edge) state.sel.edge = buildEdge(state.sel.mask);   // marching-ants outline, built once per selection
    x.save(); x.imageSmoothingEnabled = false;
    x.drawImage(state.sel.edge, 0, 0);
    x.restore();
  }

  const p = state.preview;
  if (p) {
    x.save(); dashed(); x.strokeStyle = '#7fb6ff';
    if (p.kind === 'rect') x.strokeRect(p.x, p.y, p.w, p.h);
    if (p.kind === 'ellipse') { x.beginPath(); x.ellipse(p.x + p.w / 2, p.y + p.h / 2, p.w / 2, p.h / 2, 0, 0, Math.PI * 2); x.stroke(); }
    if (p.kind === 'line') { x.beginPath(); x.moveTo(p.a.x, p.a.y); x.lineTo(p.b.x, p.b.y); x.stroke(); }
    if (p.kind === 'poly' && p.pts.length > 1) {
      x.beginPath();
      p.pts.forEach((q, i) => i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y));
      x.stroke();
    }
    x.restore();
  }

  if (state.pen && state.pen.pts.length) drawPenOverlay(x, state.pen, z);

  if (state.crop) {
    const c = state.crop;
    x.save();
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.fillRect(0, 0, ov.width, ov.height);
    x.clearRect(c.x, c.y, c.w, c.h);
    x.setLineDash([]);
    x.strokeStyle = '#fff'; x.lineWidth = 1.5 / z;
    x.strokeRect(c.x, c.y, c.w, c.h);
    x.restore();
  }

  if (state.ft) drawFtHandles(x);
}

/* ---------- selection ---------- */
function setSelection(mask, poly, box) {
  state.sel = { mask, poly: poly || null, box };
  drawOverlay();
}
function clearSelection() {
  if (state.sel) state.lastSel = state.sel;
  state.sel = null;
  drawOverlay();
}
function rectMask(r) {
  const m = mkCanvas(state.W, state.H);
  const x = m.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(r.x, r.y, r.w, r.h);
  return m;
}
function normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/* Draws src onto the current layer (or its mask in mask-edit mode),
   clipped to the active selection if any. */
function strokeTarget() {
  const l = curRaster();
  if (!l) return null;
  if (state.maskEdit && l.mask) return { ctx: l.mask.getContext('2d'), canvas: l.mask };
  return { ctx: l.ctx, canvas: l.canvas };
}
function drawOntoLayer(src, alpha = 1, comp = 'source-over') {
  const t = strokeTarget(), l = curRaster();
  if (!t || l.locked) return false;
  let s = src;
  if (state.sel) {
    s = mkCanvas(state.W, state.H);
    const sc = s.getContext('2d');
    sc.drawImage(src, 0, 0);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(state.sel.mask, 0, 0);
  }
  t.ctx.save();
  t.ctx.globalAlpha = alpha;
  t.ctx.globalCompositeOperation = comp;
  t.ctx.drawImage(s, 0, 0);
  t.ctx.restore();
  return true;
}

/* Flood region on a canvas starting at (sx,sy); returns included mask + bbox */
function floodRegion(canvas, sx, sy, tol) {
  const w = canvas.width, h = canvas.height;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const k0 = (sy * w + sx) * 4;
  const r0 = data[k0], g0 = data[k0 + 1], b0 = data[k0 + 2], a0 = data[k0 + 3];
  const seen = new Uint8Array(w * h);
  const inc = new Uint8Array(w * h);
  const stack = [sx, sy];
  let minx = w, miny = h, maxx = -1, maxy = -1;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    const idx = y * w + x;
    if (seen[idx]) continue;
    seen[idx] = 1;
    const k = idx * 4;
    if (Math.abs(data[k] - r0) > tol || Math.abs(data[k + 1] - g0) > tol ||
        Math.abs(data[k + 2] - b0) > tol || Math.abs(data[k + 3] - a0) > tol) continue;
    inc[idx] = 1;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }
  return { inc, w, h, box: { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 } };
}

/* ---------- history (undo stores full snapshots, capped) ---------- */
function snapshot() {
  return {
    W: state.W, H: state.H, active: state.active,
    sel: state.sel ? { mask: cloneC(state.sel.mask), poly: state.sel.poly, box: state.sel.box } : null,
    layers: state.layers.map(l => ({
      meta: metaOf(l),
      canvas: l.canvas ? cloneC(l.canvas) : null,
      mask: l.mask ? cloneC(l.mask) : null
    }))
  };
}
function restoreSnap(s) {
  state.ft = null;
  state.W = s.W; state.H = s.H;
  resizeStage();
  state.layers = s.layers.map(e => {
    const l = { ...e.meta };
    if (e.canvas) { l.canvas = cloneC(e.canvas); l.ctx = l.canvas.getContext('2d'); }
    l.mask = e.mask ? cloneC(e.mask) : null;
    return l;
  });
  state.active = clamp(s.active, 0, state.layers.length - 1);
  state.sel = s.sel ? { mask: cloneC(s.sel.mask), poly: s.sel.poly, box: s.sel.box } : null;
  render(); refreshLayers();
}
function pushHistory() {
  state.undo.push(snapshot());
  if (state.undo.length > 25) state.undo.shift();
  state.redo = [];
  state.dirty = true;
  updateTitle();
  scheduleAutosave();
}
function undo() {
  if (state.undo.length < 2) return;
  state.redo.push(state.undo.pop());
  restoreSnap(state.undo[state.undo.length - 1]);
}
function redo() {
  if (!state.redo.length) return;
  const s = state.redo.pop();
  state.undo.push(s);
  restoreSnap(s);
}

/* ---------- document lifecycle ---------- */
function newDoc(w = 1280, h = 800, bg = null, name = 'Untitled') {
  state.W = w; state.H = h;
  state.layers = []; state.active = -1;
  state.undo = []; state.redo = [];
  state.sel = null; state.crop = null; state.preview = null; state.pen = null; state.ft = null; state.selections = {};
  state.docName = name; state.dirty = false; state.projectId = null;
  const l = nameLayer(makeLayer(''), 'Background');
  if (bg) { l.ctx.fillStyle = bg; l.ctx.fillRect(0, 0, w, h); }
  state.layers.push(l);
  state.active = 0;
  resizeStage();
  pushHistory();
  resetView();
  render(); refreshLayers();
}

/* ---------- layer operations ---------- */
function insertAboveActive(l) {
  state.layers.splice(state.active + 1, 0, l);
  state.active++;
}
function addLayer() {
  if (!state.layers.length) return newDoc();
  const a = cur();
  const l = nameLayer(makeLayer(''), 'Layer {n}', uid());
  l.group = a && a.type === 'group' ? a.id : (a ? a.group : null);
  insertAboveActive(l);
  pushHistory(); render(); refreshLayers();
}
function addGroup() {
  if (!state.layers.length) return newDoc();
  insertAboveActive(nameLayer(makeGroup(''), 'Group {n}', uid()));
  pushHistory(); render(); refreshLayers();
}
function deleteLayer() {
  const l = cur(); if (!l) return;
  if (l.type === 'group') {
    state.layers.forEach(x => { if (x.group === l.id) x.group = l.group; });
  } else if (state.layers.filter(isRaster).length <= 1) {
    return toast(t('لا يمكن حذف آخر طبقة'));
  }
  state.layers.splice(state.active, 1);
  state.active = clamp(state.active, 0, state.layers.length - 1);
  pushHistory(); render(); refreshLayers();
}
function duplicateLayer() {
  const src = curRaster(); if (!src) return;
  const l = nameLayer(makeLayer('', src.type, state.W, state.H), 'Copy of {base}', undefined, src.id);
  l.ctx.drawImage(src.canvas, 0, 0);
  Object.assign(l, { opacity: src.opacity, blend: src.blend, group: src.group, text: src.text ? { ...src.text } : null });
  if (src.mask) l.mask = cloneC(src.mask);
  insertAboveActive(l);
  pushHistory(); render(); refreshLayers();
}
function renameLayer() {
  const l = cur(); if (!l) return;
  const n = prompt(t('اسم الطبقة'), layerName(l));
  if (n && n.trim()) { l.name = n.trim(); delete l.nameKey; delete l.nameN; delete l.nameRef; pushHistory(); refreshLayers(); }
}
function moveLayer(dir) {
  const i = state.active, j = i + dir;
  if (j < 0 || j >= state.layers.length) return;
  [state.layers[i], state.layers[j]] = [state.layers[j], state.layers[i]];
  state.active = j;
  pushHistory(); render(); refreshLayers();
}
function moveLayerTo(from, to) {
  if (from === to || from < 0 || to < 0) return;
  const [m] = state.layers.splice(from, 1);
  state.layers.splice(to, 0, m);
  state.active = to;
  pushHistory(); render(); refreshLayers();
}
function mergeDown() {
  const i = state.active, top = cur(), below = state.layers[i - 1];
  if (!isRaster(top) || !isRaster(below)) return toast(t('يجب أن تكون الطبقتان بكسل'));
  below.ctx.save();
  below.ctx.globalAlpha = top.opacity;
  below.ctx.globalCompositeOperation = top.blend;
  below.ctx.drawImage(top.mask ? maskedCopy(top) : top.canvas, 0, 0);
  below.ctx.restore();
  state.layers.splice(i, 1);
  state.active = i - 1;
  pushHistory(); render(); refreshLayers();
}
function flattenAll() {
  const r = state.layers.filter(l => isRaster(l) || isAdjust(l));
  if (r.length < 2) return;
  const out = nameLayer(makeLayer(''), 'Flattened');
  drawStack(out.ctx, r, false);
  state.layers = [out]; state.active = 0;
  pushHistory(); render(); refreshLayers();
}
/* merges every visible raster layer into one, keeping hidden layers where they are */
function mergeVisible() {
  const vis = state.layers.filter(l => (isRaster(l) || isAdjust(l)) && isLayerVisible(l));
  if (vis.length < 2) return toast(t('لا توجد طبقات مرئية كافية للدمج'));
  const out = nameLayer(makeLayer(''), 'Merged');
  drawStack(out.ctx, vis, false);
  let top = -1;
  state.layers.forEach((l, i) => { if (vis.includes(l)) top = i; });
  const before = state.layers.slice(0, top).filter(l => !vis.includes(l)).length;
  const rest = state.layers.filter(l => !vis.includes(l));
  rest.splice(before, 0, out);
  state.layers = rest; state.active = before;
  pushHistory(); render(); refreshLayers();
}
/* a clipped layer uses the raster layer directly below it as its base */
function toggleClip() {
  const l = cur(); if (!isRaster(l)) return toast(t('الطبقة يجب أن تكون بكسل'));
  if (!l.clip) {
    const below = state.layers[state.active - 1];
    if (!isRaster(below)) return toast(t('الطبقة التي تحتها يجب أن تكون بكسل'));
  }
  l.clip = !l.clip;
  pushHistory(); render(); refreshLayers();
}
/* removes a group and keeps its layers */
function ungroup() {
  const g = cur();
  if (!g || g.type !== 'group') return toast(t('اختر مجموعة'));
  state.layers.forEach(x => { if (x.group === g.id) x.group = g.group; });
  state.layers.splice(state.active, 1);
  state.active = clamp(state.active, 0, state.layers.length - 1);
  pushHistory(); render(); refreshLayers();
}
function maskedCopy(l) {
  const c = cloneC(l.canvas), x = c.getContext('2d');
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(l.mask, 0, 0);
  return c;
}
function toggleVisibility(i) {
  const l = state.layers[i]; if (!l) return;
  l.visible = !l.visible;
  pushHistory(); render(); refreshLayers();
}
function toggleLock(i) {
  const l = state.layers[i]; if (!l) return;
  l.locked = !l.locked; refreshLayers();
}
function addMask() {
  const l = maskOwner(); if (!l) return;
  if (l.mask) return toast(t('القناع موجود بالفعل'));
  l.mask = mkCanvas(state.W, state.H);
  const x = l.mask.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, state.W, state.H);
  pushHistory(); render(); refreshLayers();
}
function removeMask() {
  const l = maskOwner(); if (!l || !l.mask) return;
  l.mask = null; state.maskEdit = false;
  pushHistory(); render(); refreshLayers();
}
function toggleMaskEdit() {
  const l = maskOwner();
  if (!l || !l.mask) return toast(t('أضف قناعاً أولاً'));
  state.maskEdit = !state.maskEdit;
  toast(state.maskEdit ? t('تحرير القناع: الفرشاة تُظهر، الممحاة تُخفي') : t('تحرير الطبقة'));
  buildOpts(); refreshLayers();
}
/* leave mask-editing mode (exit button, Escape, or selecting another layer) */
function exitMaskEdit() {
  if (!state.maskEdit) return;
  state.maskEdit = false;
  toast(t('تم الخروج من تحرير القناع'));
  buildOpts(); refreshLayers();
}
function setGroupOf(i, groupId) {
  const l = state.layers[i];
  if (!l) return;
  if (groupId) {
    const g = state.layers.find(x => x.id === groupId);
    if (!g || isInside(g, l)) return toast(t('لا يمكن نقل المجموعة داخل نفسها'));
  }
  l.group = groupId;
  pushHistory(); render(); refreshLayers();
}

/* ---------- title / status ---------- */
function updateTitle() {
  document.title = (state.dirty ? '● ' : '') + docLabel(state.docName) + ' — CREATIVE STUDIO';
}
