/* ===== Tools & pointer handling ===== */

const TOOL_LIST = [
  { id: 'move',    name: 'Move',              icon: '✥', img: '01_move.png', key: 'V' },
  { id: 'marquee', name: 'Marquee Selection', icon: '▭', img: '02_rectangular_marquee.png', key: 'M' },
  { id: 'lasso',   name: 'Lasso',             icon: '⌒', img: '04_lasso.png', key: 'L' },
  { id: 'quick',   name: 'Quick Selection',   icon: '✦', img: 'quick_selection_tool.png', key: 'W' },
  { id: 'wand',    name: 'Magic Wand',        icon: '✧', img: '05_magic_wand.png', key: 'Y' },
  { id: 'shape',   name: 'Shape',             icon: '▭', img: '18_rectangle.png', key: 'U' },
  { id: 'crop',    name: 'Crop',              icon: '⌗', img: '06_crop.png', key: 'C' },
  { id: 'brush',   name: 'Brush',             icon: '✎', img: '08_brush.png', key: 'B' },
  { id: 'eraser',  name: 'Eraser',            icon: '⌫', img: '10_eraser.png', key: 'E' },
  { id: 'blur',    name: 'Blur',              icon: '◌', img: '27_blur.png', key: 'R' },
  { id: 'sharpen', name: 'Sharpen',           icon: '◎', img: '28_sharpen.png' },
  { id: 'smudge',  name: 'Smudge',            icon: '☁', img: '29_smudge.png' },
  { id: 'dodge',   name: 'Dodge',             icon: '☀', img: '30_dodge.png', key: 'O' },
  { id: 'burn',    name: 'Burn',              icon: '☾', img: '31_burn.png' },
  { id: 'sponge',  name: 'Sponge',            icon: '●', img: '32_sponge.png' },
  { id: 'pencil',  name: 'Pencil',            icon: '✏', img: '09_pencil.png', key: 'N' },
  { id: 'colorrep', name: 'Color Replacement', icon: '⇄', key: 'X' },
  { id: 'heal',    name: 'Spot Healing',      icon: '✚', img: '26_healing.png', key: 'J' },
  { id: 'patch',   name: 'Patch',             icon: '⊡', key: 'Q' },
  { id: 'clone',   name: 'Clone Stamp',       icon: '⎘', img: '11_clone_stamp.png', key: 'S' },
  { id: 'gradient',name: 'Gradient',          icon: '◧', img: '12_gradient.png', key: 'G' },
  { id: 'bucket',  name: 'Paint Bucket',      icon: '◍', img: '13_paint_bucket.png', key: 'K' },
  { id: 'text',    name: 'Text',              icon: 'T', img: '17_text.png', key: 'T' },
  { id: 'pen',     name: 'Pen',               icon: '✒', img: '14_pen.png', key: 'P' },
  { id: 'eyedrop', name: 'Eyedropper',        icon: '⌖', img: '07_eyedropper.png', key: 'I' },
  { id: 'hand',    name: 'Hand',              icon: '✋', img: '22_hand.png', key: 'H' },
  { id: 'zoom',    name: 'Zoom',              icon: '⌕', img: '23_zoom.png', key: 'Z' }
];

const pointers = new Map();
let drag = null;       // active single-pointer interaction
let gesture = null;    // active pinch gesture

function optNum(id, def) {
  const e = $(id);
  if (e) return parseFloat(e.value) || def;
  return OPT[id] ?? def;
}

function polyBox(pts) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const q of pts) {
    minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x);
    miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
  }
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}

function defTool(id, def) {
  TOOLS[id] = Object.assign({
    cursor: 'default',
    down() {}, move() {}, up() {}, cancel() {}
  }, def);
}
const TOOLS = {};

/* ---------- brush core (shared by brush & eraser) ---------- */
let _strokeSc = null;
function strokeScratch() {
  if (!_strokeSc || _strokeSc.width !== state.W || _strokeSc.height !== state.H)
    _strokeSc = mkCanvas(state.W, state.H);
  return _strokeSc;
}

function paintSeg(a, b, erase) {
  const t = strokeTarget(), l = curRaster();
  if (!t || !l || l.locked) return false;
  const size = optNum('brushSize', 12);
  const alpha = clamp(optNum('brushAlpha', 100), 1, 100) / 100;
  const color = state.maskEdit ? '#ffffff' : state.fg;
  const comp = erase ? 'destination-out' : 'source-over';

  const stroke = (ctx, col, al, cmp) => {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    ctx.strokeStyle = col; ctx.globalAlpha = al;
    ctx.globalCompositeOperation = cmp;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  };

  if (!state.sel) {
    stroke(t.ctx, erase ? '#000' : color, alpha, comp);
  } else {
    const sc = strokeScratch(), sx = sc.getContext('2d');
    sx.clearRect(0, 0, sc.width, sc.height);
    stroke(sx, erase ? '#000' : color, 1, 'source-over');
    sx.globalCompositeOperation = 'destination-in';
    sx.drawImage(state.sel.mask, 0, 0);
    t.ctx.save();
    t.ctx.globalAlpha = alpha;
    t.ctx.globalCompositeOperation = comp;
    t.ctx.drawImage(sc, 0, 0);
    t.ctx.restore();
  }
  render();
  return true;
}

function makePaintTool(erase) {
  return {
    cursor: 'crosshair',
    down(p, e, d) {
      d.painted = paintSeg(p, p, erase);
      d.last = p;
    },
    move(p, e, d) {
      if (paintSeg(d.last, p, erase)) d.painted = true;
      d.last = p;
    },
    up(p, e, d) {
      if (d.painted) { pushHistory(); refreshLayers(); }
    }
  };
}

/* ---------- tool definitions ---------- */

defTool('move', {
  cursor: 'move',
  down(p, e, d) {
    if (state.ft) {
      // pressing a transform handle, or the layer itself, keeps the transform; anywhere else applies it
      const hit = ftHit(p);
      if (hit) { d.ftHit = hit; d.last = p; return; }
      ftCommit();
    }
    // auto-select: pressing a layer's pixels makes it the active layer
    if (!state.sel) {
      const i = layerAt(p);
      if (i >= 0 && i !== state.active) { state.active = i; refreshLayers(); }
    }
    const l = curRaster();
    if (!l || l.locked) { d.skip = true; return; }
    d.tot = { x: 0, y: 0 }; d.moved = false;
    d.lift = null;
    if (state.sel) {
      // lift selected pixels out of the layer so they can move freely
      const lift = mkCanvas(state.W, state.H), lx = lift.getContext('2d');
      lx.drawImage(l.canvas, 0, 0);
      lx.globalCompositeOperation = 'destination-in';
      lx.drawImage(state.sel.mask, 0, 0);
      l.ctx.save();
      l.ctx.globalCompositeOperation = 'destination-out';
      l.ctx.drawImage(state.sel.mask, 0, 0);
      l.ctx.restore();
      d.lift = lift;
    }
    d.base = cloneC(l.canvas);
  },
  move(p, e, d) {
    if (d.ftHit) return ftMove(p, e, d);
    if (d.skip) return;
    const l = curRaster();
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    d.tot.x += dx; d.tot.y += dy; d.moved = true;
    l.ctx.clearRect(0, 0, state.W, state.H);
    if (d.lift) {
      l.ctx.drawImage(d.base, 0, 0);
      l.ctx.drawImage(d.lift, d.tot.x, d.tot.y);
      const b = state.sel.box;
      state.preview = { kind: 'rect', x: b.x + d.tot.x, y: b.y + d.tot.y, w: b.w, h: b.h };
    } else {
      l.ctx.drawImage(d.base, d.tot.x, d.tot.y);
    }
    d.last = p;
    render();
  },
  up(p, e, d) {
    if (d.ftHit || d.skip) return;
    const l = curRaster();
    state.preview = null;
    if (d.lift) {
      if (d.moved) {
        const sel = state.sel, m = mkCanvas(state.W, state.H);
        m.getContext('2d').drawImage(sel.mask, d.tot.x, d.tot.y);
        state.sel = {
          mask: m,
          poly: sel.poly ? sel.poly.map(q => ({ x: q.x + d.tot.x, y: q.y + d.tot.y })) : null,
          box: { x: sel.box.x + d.tot.x, y: sel.box.y + d.tot.y, w: sel.box.w, h: sel.box.h }
        };
      } else {
        l.ctx.clearRect(0, 0, state.W, state.H);
        l.ctx.drawImage(d.base, 0, 0);
        l.ctx.drawImage(d.lift, 0, 0);
      }
    } else if (d.moved && l.type === 'text' && l.text) {
      l.text.x += d.tot.x; l.text.y += d.tot.y;
    }
    if (d.moved) pushHistory();
    render(); refreshLayers();
  },
  cancel(d) {
    if (d.ftHit || d.skip) return;
    const l = curRaster();
    state.preview = null;
    if (d.base) { l.ctx.clearRect(0, 0, state.W, state.H); l.ctx.drawImage(d.base, 0, 0); }
    if (d.lift) l.ctx.drawImage(d.lift, 0, 0);
    render();
  }
});


defTool('brush', makePaintTool(false));
defTool('eraser', makePaintTool(true));

/* clone stamp: arm source, then paint with circular dabs sampled from the source */
function cloneDab(x, y, d) {
  const l = curRaster(); if (!l) return;
  const size = optNum('brushSize', 12), r = size / 2;
  const c = l.ctx;
  c.save();
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.clip();
  c.drawImage(d.snap, x + d.off.x - r, y + d.off.y - r, size, size, x - r, y - r, size, size);
  c.restore();
  d.painted = true;
}
defTool('clone', {
  cursor: 'crosshair',
  down(p, e, d) {
    const l = curRaster();
    if (!l) return;
    if (state.cloneArm || e.altKey) {
      state.cloneArm = false;
      state.cloneSrc = { x: p.x, y: p.y };
      toast(t('تم تحديد نقطة المصدر'));
      buildOpts();
      d.skip = true; return;
    }
    if (!state.cloneSrc) { d.skip = true; toast(t('حدّد المصدر أولاً')); return; }
    d.off = { x: state.cloneSrc.x - p.x, y: state.cloneSrc.y - p.y };
    d.snap = cloneC(l.canvas);
    d.painted = false;
    d.last = p;
    cloneDab(p.x, p.y, d);
    render();
  },
  move(p, e, d) {
    if (d.skip) return;
    const size = optNum('brushSize', 12);
    const step = Math.max(1, size * 0.15);
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
    for (let i = 1; i <= n; i++) {
      cloneDab(d.last.x + dx * i / n, d.last.y + dy * i / n, d);
    }
    d.last = p;
    render();
  },
  up(p, e, d) {
    if (d.skip) return;
    if (d.painted) { pushHistory(); refreshLayers(); }
  }
});

defTool('gradient', {
  cursor: 'crosshair',
  down(p, e, d) { d.start = p; },
  move(p, e, d) {
    state.preview = { kind: 'line', a: d.start, b: p };
    drawOverlay();
  },
  up(p, e, d) {
    state.preview = null;
    if (Math.hypot(p.x - d.start.x, p.y - d.start.y) < 2) return drawOverlay();
    const c = mkCanvas(state.W, state.H), x = c.getContext('2d');
    const g = x.createLinearGradient(d.start.x, d.start.y, p.x, p.y);
    g.addColorStop(0, state.fg);
    g.addColorStop(1, state.bg);
    x.fillStyle = g;
    x.fillRect(0, 0, state.W, state.H);
    if (drawOntoLayer(c)) { pushHistory(); render(); refreshLayers(); }
    drawOverlay();
  },
  cancel() { state.preview = null; drawOverlay(); }
});

defTool('bucket', {
  cursor: 'crosshair',
  down(p) {
    const t = strokeTarget(), l = curRaster();
    if (!t || !l || l.locked) return;
    const reg = floodRegion(t.canvas, p.x, p.y, optNum('tolerance', 32));
    if (!reg) return;
    const id = t.ctx.getImageData(0, 0, state.W, state.H), dd = id.data;
    const [r, g, b] = hexToRgb(state.fg);
    const selD = state.sel ? state.sel.mask.getContext('2d').getImageData(0, 0, state.W, state.H).data : null;
    for (let i = 0; i < reg.inc.length; i++) {
      if (!reg.inc[i]) continue;
      if (selD && selD[i * 4 + 3] === 0) continue;
      const k = i * 4;
      dd[k] = r; dd[k + 1] = g; dd[k + 2] = b; dd[k + 3] = 255;
    }
    t.ctx.putImageData(id, 0, 0);
    pushHistory(); render(); refreshLayers();
  }
});

/* Text: click existing text to edit it, or click empty canvas to create a text layer */
defTool('text', {
  cursor: 'text',
  down(p) {
    const i = layerAt(p, 'text');
    if (i >= 0) {
      state.active = i; refreshLayers();
      return openTextDialog(state.layers[i]);
    }
    openTextDialog(null, p);
  }
});

defTool('pen', {
  cursor: 'crosshair',
  down(p, e, d) {
    if (!state.pen) state.pen = { pts: [], closed: false };
    const pen = state.pen;
    // a click near the first anchor closes the path and commits it
    if (pen.pts.length > 2 && Math.hypot(p.x - pen.pts[0].x, p.y - pen.pts[0].y) < 10 / state.zoom) {
      pen.closed = true; return commitPen();
    }
    const a = { x: p.x, y: p.y, ox: p.x, oy: p.y, ix: p.x, iy: p.y };
    pen.pts.push(a);
    d.anchor = a;
    drawOverlay();
  },
  move(p, e, d) {
    const a = d.anchor; if (!a) return;
    if (Math.hypot(p.x - a.x, p.y - a.y) < 3) { a.ox = a.x; a.oy = a.y; a.ix = a.x; a.iy = a.y; }
    else { a.ox = p.x; a.oy = p.y; a.ix = 2 * a.x - p.x; a.iy = 2 * a.y - p.y; }
    drawOverlay();
  },
  up(p, e, d) { d.anchor = null; drawOverlay(); }
});

/* Eyedropper: the foreground color follows the pointer while it is held down */
defTool('eyedrop', {
  cursor: 'crosshair',
  down(p, e) { eyedropPick(p, e); },
  move(p, e) { eyedropPick(p, e); },
  up() { hideLoupe(); },
  cancel() { hideLoupe(); }
});

defTool('hand', {
  cursor: 'grab',
  move(p, e, d) {
    state.panX += e.clientX - d.sx;
    state.panY += e.clientY - d.sy;
    d.sx = e.clientX; d.sy = e.clientY;
    applyTransform();
  }
});

defTool('zoom', {
  cursor: 'zoom-in',
  down(p, e) {
    const s = stagePoint(e.clientX, e.clientY);
    zoomAt(e.altKey || state.zoomOut ? 0.8 : 1.25, s.x, s.y);
  }
});

/* ---------- pen commit / cancel ---------- */
function commitPen() {
  const pen = state.pen;
  state.pen = null;
  if (!pen) return drawOverlay();
  penClean(pen);
  if (pen.pts.length < 2) return drawOverlay();
  const mode = OPT.penMode ?? 'stroke';          // stroke | fill | both
  const c = mkCanvas(state.W, state.H), x = c.getContext('2d');
  penPath(x, pen);
  if (mode !== 'stroke') { x.fillStyle = state.fg; x.fill(); }
  if (mode !== 'fill') {
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = optNum('brushSize', 12); x.strokeStyle = state.fg;
    x.stroke();
  }
  if (drawOntoLayer(c)) { pushHistory(); render(); refreshLayers(); }
  else drawOverlay();
}
function cancelPen() { state.pen = null; drawOverlay(); }

/* ---------- tool switching ---------- */
function setTool(id) {
  if (state.pen) cancelPen();
  if (polyActive() && id !== 'lasso') polyCancel();
  if (state.ft) ftCommit();
  state.tool = id;
  const tl = TOOL_LIST.find(x => x.id === id);
  $('stage').style.cursor = TOOLS[id].cursor || 'default';
  buildTools();
  buildOpts();
  if (tl) toast(t(tl.name));
}

/* ---------- pointer manager ---------- */
const stageEl = $('stage');

stageEl.addEventListener('pointerdown', e => {
  if (!state.layers.length) return;
  stageEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    if (drag) { drag.tool.cancel(drag); drag = null; }
    const [a, b] = [...pointers.values()];
    const sa = stagePoint(a.x, a.y), sb = stagePoint(b.x, b.y);
    gesture = {
      d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: state.zoom,
      pan: { x: state.panX, y: state.panY },
      mid: { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 }
    };
    return;
  }
  if (pointers.size > 2 || gesture) return;

  const tool = TOOLS[state.spaceDown ? 'hand' : state.tool];
  const p = docPoint(e.clientX, e.clientY);
  drag = { id: e.pointerId, tool, start: p, last: p, sx: e.clientX, sy: e.clientY };
  tool.down(p, e, drag);
});

stageEl.addEventListener('pointermove', e => {
  const p = docPoint(e.clientX, e.clientY);
  $('cursorInfo').textContent = `X: ${Math.floor(p.x)}  Y: ${Math.floor(p.y)}`;
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (gesture && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const nd = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const nz = clamp(gesture.zoom * nd / gesture.d, 0.05, 32);
    const sa = stagePoint(a.x, a.y), sb = stagePoint(b.x, b.y);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    const docX = (gesture.mid.x - gesture.pan.x) / gesture.zoom;
    const docY = (gesture.mid.y - gesture.pan.y) / gesture.zoom;
    state.zoom = nz;
    state.panX = mid.x - docX * nz;
    state.panY = mid.y - docY * nz;
    applyTransform();
    return;
  }
  if (drag && drag.id === e.pointerId) drag.tool.move(p, e, drag);
});

function endPointer(e, cancelled) {
  pointers.delete(e.pointerId);
  if (gesture) { if (pointers.size < 2) gesture = null; return; }
  if (drag && drag.id === e.pointerId) {
    const d = drag; drag = null;
    if (cancelled) d.tool.cancel(d);
    else d.tool.up(docPoint(e.clientX, e.clientY), e, d);
    render();
  }
}
stageEl.addEventListener('pointerup', e => endPointer(e, false));
stageEl.addEventListener('pointercancel', e => endPointer(e, true));
stageEl.addEventListener('dblclick', () => { if (state.tool === 'pen') commitPen(); });
stageEl.addEventListener('contextmenu', e => e.preventDefault());
