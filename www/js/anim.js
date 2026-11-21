/* ===== Animation Studio: stage, keyframe timeline, graph editor, playback, assets ===== */

/* Document model.
   Layers: index 0 is the bottom. A layer's transform is `base` when it has no keyframes,
   otherwise the value is interpolated between its keyframes. Each keyframe stores all
   six properties; its `ease` and `bez` describe the segment that starts at that keyframe. */
const ANIM = {
  open: false, id: null, name: 'Untitled', touched: false, dirty: false,
  W: 1920, H: 1080, bg: '#ffffff', fps: 24, frames: 120,
  frame: 0, playing: false, loop: true,
  sel: null, layers: [], imgs: {},
  zoom: 1, panX: 0, panY: 0, k: 1,
  tool: 'select', graphOpen: false, graphProp: 'x',
  undo: [], redo: []
};
const ASI = {};                      // image cache: key -> HTMLImageElement
const AP_PROPS = ['x', 'y', 'sx', 'sy', 'rot', 'op'];
const AP_LABEL = { x: 'X', y: 'Y', sx: 'العرض %', sy: 'الارتفاع %', rot: 'الدوران °', op: 'الشفافية %' };
const AP_DEF = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, op: 1 };
const AP_PCT = { sx: 1, sy: 1, op: 1 };
const AP_EASE = [['linear', 'خطي'], ['in', 'تسارع'], ['out', 'تباطؤ'], ['inout', 'تسارع ثم تباطؤ'], ['smooth', 'ناعم'], ['bezier', 'منحنى مخصص']];
const CELL = 12, NAME_W = 170;

/* ---------- easing ---------- */
function bezierEase(bez, p) {
  const [x1, y1, x2, y2] = bez;
  const bx = u => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = u => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  let lo = 0, hi = 1, u = p;
  for (let i = 0; i < 40; i++) {
    const cx = bx(u);
    if (Math.abs(cx - p) < 1e-6) break;
    if (cx < p) lo = u; else hi = u;
    u = (lo + hi) / 2;
  }
  return by(u);
}
function easeValue(kf, p) {
  switch (kf.ease) {
    case 'in': return p * p;
    case 'out': return 1 - (1 - p) * (1 - p);
    case 'inout': return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    case 'smooth': return p * p * (3 - 2 * p);
    case 'bezier': return bezierEase(kf.bez || [0.42, 0, 0.58, 1], p);
    default: return p;
  }
}
/* Handle positions shown in the graph editor for each named ease */
function bezFor(kf) {
  if (kf.ease === 'bezier') return kf.bez || [0.42, 0, 0.58, 1];
  return { linear: [0.33, 0.33, 0.67, 0.67], in: [0.42, 0, 1, 1], out: [0, 0, 0.58, 1],
    inout: [0.42, 0, 0.58, 1], smooth: [0, 0, 1, 1] }[kf.ease] || [0.42, 0, 0.58, 1];
}

/* ---------- keyframe evaluation ---------- */
function layerPropsAt(l, frame) {
  const k = l.kfs;
  if (!k.length) return { ...l.base };
  if (frame <= k[0].f) return { ...k[0].p };
  if (frame >= k[k.length - 1].f) return { ...k[k.length - 1].p };
  let i = 0;
  while (i < k.length - 1 && k[i + 1].f <= frame) i++;
  const a = k[i], b = k[i + 1];
  const e = easeValue(a, (frame - a.f) / (b.f - a.f));
  const out = {};
  AP_PROPS.forEach(q => { out[q] = a.p[q] + (b.p[q] - a.p[q]) * e; });
  return out;
}
/* Index of the keyframe segment that contains the frame, or -1 */
function segmentAt(l, frame) {
  const k = l.kfs;
  for (let i = 0; i < k.length - 1; i++) if (frame >= k[i].f && frame < k[i + 1].f) return i;
  return -1;
}
function ensureKey(l, frame) {
  const ex = l.kfs.find(k => k.f === frame);
  if (ex) return ex;
  const kf = { f: frame, p: layerPropsAt(l, frame), ease: 'linear', bez: [0.42, 0, 0.58, 1] };
  l.kfs.push(kf);
  l.kfs.sort((a, b) => a.f - b.f);
  return kf;
}
/* Writes one property: before any keyframe it changes the base value, afterwards it auto-keys */
function setProp(l, prop, val) {
  if (!l.kfs.length) { l.base[prop] = val; return; }
  ensureKey(l, ANIM.frame).p[prop] = val;
}

/* ---------- layers ---------- */
const _measure = document.createElement('canvas').getContext('2d');
function updateTextBox(l) {
  _measure.font = `${l.size}px ${l.font || 'sans-serif'}`;
  const lines = (l.str || ' ').split('\n');
  l.w = Math.max(10, ...lines.map(s => _measure.measureText(s).width));
  l.h = Math.max(l.size, lines.length * l.size * 1.2);
}
function newLayer(type, extra = {}) {
  const names = { image: 'صورة', text: 'نص', rect: 'مستطيل', ellipse: 'دائرة' };
  const l = {
    id: uid(), name: names[type] + ' ' + (ANIM.layers.length + 1), type,
    vis: true, lock: false, w: 300, h: 300, color: '#4f7fb8', key: null,
    str: '', size: 96, font: 'sans-serif',
    base: { x: 0, y: 0, sx: 1, sy: 1, rot: 0, op: 1 }, kfs: [],
    ...extra
  };
  if (type === 'text') { if (!l.str) l.str = t('نص جديد'); updateTextBox(l); }
  return l;
}
function selLayer() { return ANIM.layers.find(l => l.id === ANIM.sel) || null; }
function addLayerObj(l) { ANIM.layers.push(l); ANIM.sel = l.id; }
function animImgLoad(key, src) { return loadImage(src).then(im => { ASI[key] = im; }); }

/* Adds an image layer at the centre; the image is fitted to 60% of the canvas if it is larger */
async function addImageLayer(key, dataURL, name) {
  ANIM.imgs[key] = dataURL;
  await animImgLoad(key, dataURL);
  const im = ASI[key];
  const fit = Math.min(1, (ANIM.W * 0.6) / im.naturalWidth, (ANIM.H * 0.6) / im.naturalHeight);
  pushUndo();
  const l = newLayer('image', { key, w: im.naturalWidth * fit, h: im.naturalHeight * fit });
  if (name) l.name = name;
  addLayerObj(l);
  renderAll();
}

function createAt(type, d) {
  pushUndo();
  const l = newLayer(type, { base: { x: d.x - ANIM.W / 2, y: d.y - ANIM.H / 2, sx: 1, sy: 1, rot: 0, op: 1 } });
  if (type === 'rect' || type === 'ellipse') { l.w = 300; l.h = 200; }
  addLayerObj(l);
  if (type === 'text') renameTextLayer(l);
  renderAll();
}
function renameTextLayer(l) { l.name = (l.str.split('\n')[0] || t('نص')).slice(0, 24); }

/* ---------- drawing ---------- */
function drawLayer(c, l, frame) {
  const p = layerPropsAt(l, frame);
  if (!l.vis || p.op <= 0) return;
  c.save();
  c.globalAlpha = clamp(p.op, 0, 1);
  c.translate(ANIM.W / 2 + p.x, ANIM.H / 2 + p.y);
  c.rotate(p.rot * Math.PI / 180);
  c.scale(p.sx, p.sy);
  if (l.type === 'image') {
    const im = ASI[l.key];
    if (im && im.complete) c.drawImage(im, -l.w / 2, -l.h / 2, l.w, l.h);
  } else if (l.type === 'rect') {
    c.fillStyle = l.color; c.fillRect(-l.w / 2, -l.h / 2, l.w, l.h);
  } else if (l.type === 'ellipse') {
    c.fillStyle = l.color; c.beginPath(); c.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, Math.PI * 2); c.fill();
  } else if (l.type === 'text') {
    c.fillStyle = l.color;
    c.font = `${l.size}px ${l.font || 'sans-serif'}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const lines = l.str.split('\n');
    lines.forEach((ln, i) => c.fillText(ln, 0, (i - (lines.length - 1) / 2) * l.size * 1.2));
  }
  c.restore();
}
function drawScene(c, frame) {
  c.fillStyle = ANIM.bg || '#ffffff';
  c.fillRect(0, 0, ANIM.W, ANIM.H);
  ANIM.layers.forEach(l => drawLayer(c, l, frame));
}

function renderStage() {
  const cv = $('asCv'), wrap = $('asStageWrap');
  const r = wrap.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) {
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  }
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#161616';
  c.fillRect(0, 0, r.width, r.height);
  const k = Math.min((r.width - 48) / ANIM.W, (r.height - 48) / ANIM.H) * ANIM.zoom;
  ANIM.k = k;
  c.translate(r.width / 2 + ANIM.panX, r.height / 2 + ANIM.panY);
  c.scale(k, k);
  c.translate(-ANIM.W / 2, -ANIM.H / 2);
  drawScene(c, ANIM.frame);
  const sl = selLayer();
  if (sl) drawSelection(c, sl, k);
  c.setTransform(1, 0, 0, 1, 0, 0);
}
function drawSelection(c, l, k) {
  const p = layerPropsAt(l, ANIM.frame);
  const hs = handleList(l, p);
  // outline in document space, so its width does not grow with the layer's scale
  const corners = hs.filter(h => h.kind === 'corner');
  c.save();
  c.strokeStyle = '#4f9cff';
  c.lineWidth = 1.5 / k;
  c.setLineDash([6 / k, 4 / k]);
  c.beginPath();
  corners.forEach((h, i) => (i ? c.lineTo(h.x, h.y) : c.moveTo(h.x, h.y)));
  c.closePath();
  c.stroke();
  c.restore();

  const top = hs.find(h => h.kind === 'edge' && h.iy === -1 && h.ix === 0);
  const rot = hs.find(h => h.kind === 'rot');
  c.save();
  c.strokeStyle = '#4f9cff';
  c.lineWidth = 1.5 / k;
  c.beginPath(); c.moveTo(top.x, top.y); c.lineTo(rot.x, rot.y); c.stroke();
  c.fillStyle = '#fff';
  c.beginPath(); c.arc(rot.x, rot.y, 7 / k, 0, Math.PI * 2); c.fill(); c.stroke();
  const s = 11 / k;
  hs.filter(h => h.kind !== 'rot').forEach(h => {
    c.fillStyle = '#fff';
    c.fillRect(h.x - s / 2, h.y - s / 2, s, s);
    c.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
  });
  c.restore();
}
/* handles in document space: corners and edges stretch the layer, the round one rotates it */
function handleList(l, p) {
  const a = p.rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a);
  const cx = ANIM.W / 2 + p.x, cy = ANIM.H / 2 + p.y;
  const at = (ix, iy) => {
    const lx = ix * l.w / 2 * p.sx, ly = iy * l.h / 2 * p.sy;
    return { x: cx + lx * co - ly * si, y: cy + lx * si + ly * co };
  };
  const out = [];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([ix, iy]) => out.push({ ix, iy, kind: 'corner', ...at(ix, iy) }));
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([ix, iy]) => out.push({ ix, iy, kind: 'edge', ...at(ix, iy) }));
  const t = at(0, -1), off = 40 / ANIM.k;
  out.push({ ix: 0, iy: -1, kind: 'rot', x: t.x + si * off, y: t.y - co * off });
  return out;
}
function handleAt(l, d) {
  const p = layerPropsAt(l, ANIM.frame);
  const r = 24 / ANIM.k;
  let best = null, bd = r;
  handleList(l, p).forEach(h => {
    const dd = Math.hypot(d.x - h.x, d.y - h.y);
    if (dd <= bd) { bd = dd; best = h; }
  });
  return best;
}
function handleDrag(st, d) {
  const { l, h, p0, cx, cy } = st;
  if (h.kind === 'rot') {
    const ang = Math.atan2(d.x - cx, -(d.y - cy)) * 180 / Math.PI;
    let dd = ang - st.a0;
    if (dd > 180) dd -= 360;
    if (dd < -180) dd += 360;
    let r = p0.rot + dd;
    const sn = Math.round(r / 15) * 15;
    if (Math.abs(r - sn) < 3) r = sn;
    setProp(l, 'rot', r);
    return;
  }
  if (h.kind === 'corner') {
    const f = Math.max(0.05, Math.hypot(d.x - cx, d.y - cy) / st.r0);
    setProp(l, 'sx', p0.sx * f);
    setProp(l, 'sy', p0.sy * f);
    return;
  }
  // edge: stretch along one local axis so the edge follows the pointer
  const a = -p0.rot * Math.PI / 180, vx = d.x - cx, vy = d.y - cy;
  const ux = vx * Math.cos(a) - vy * Math.sin(a), uy = vx * Math.sin(a) + vy * Math.cos(a);
  if (h.ix) setProp(l, 'sx', Math.max(0.02, Math.abs(ux) / (l.w / 2)));
  if (h.iy) setProp(l, 'sy', Math.max(0.02, Math.abs(uy) / (l.h / 2)));
}

/* ---------- coordinates and hit testing ---------- */
function stageToDoc(clientX, clientY) {
  const r = $('asCv').getBoundingClientRect();
  return {
    x: (clientX - r.left - r.width / 2 - ANIM.panX) / ANIM.k + ANIM.W / 2,
    y: (clientY - r.top - r.height / 2 - ANIM.panY) / ANIM.k + ANIM.H / 2
  };
}
function hitLayer(d, frame) {
  for (let i = ANIM.layers.length - 1; i >= 0; i--) {
    const l = ANIM.layers[i];
    if (!l.vis) continue;
    const p = layerPropsAt(l, frame);
    const dx = d.x - (ANIM.W / 2 + p.x), dy = d.y - (ANIM.H / 2 + p.y);
    const a = -p.rot * Math.PI / 180;
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / (p.sx || 1e-6);
    const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (p.sy || 1e-6);
    if (Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2) return l;
  }
  return null;
}

/* ---------- undo ---------- */
function snapshotAnim() {
  return JSON.stringify({ layers: ANIM.layers, sel: ANIM.sel });
}
function pushUndo() {
  ANIM.undo.push(snapshotAnim());
  if (ANIM.undo.length > 60) ANIM.undo.shift();
  ANIM.redo = [];
  ANIM.touched = true; ANIM.dirty = true;
  scheduleAnimSave();
}
function animUndo(redo) {
  const from = redo ? ANIM.redo : ANIM.undo, to = redo ? ANIM.undo : ANIM.redo;
  if (!from.length) return;
  to.push(snapshotAnim());
  const s = JSON.parse(from.pop());
  ANIM.layers = s.layers; ANIM.sel = s.sel;
  renderAll();
}

/* ---------- selection and frame ---------- */
function selectLayer(id) { ANIM.sel = id; renderAll(); }
function setFrame(f) {
  ANIM.frame = clamp(Math.round(f), 0, ANIM.frames - 1);
  renderAll();
}

/* ---------- playback ---------- */
let animRaf = 0, animLast = 0, animAcc = 0;
function animPlay(on) {
  if (on === ANIM.playing) return;
  ANIM.playing = on;
  cancelAnimationFrame(animRaf);
  if (on) {
    if (ANIM.frame >= ANIM.frames - 1) ANIM.frame = 0;
    animLast = performance.now(); animAcc = 0;
    animRaf = requestAnimationFrame(animTick);
  }
  updatePlayButtons();
}
function animTick(now) {
  if (!ANIM.playing) return;
  const step = 1000 / ANIM.fps;
  animAcc += now - animLast; animLast = now;
  while (animAcc >= step) {
    animAcc -= step;
    ANIM.frame++;
    if (ANIM.frame >= ANIM.frames) {
      if (ANIM.loop) ANIM.frame = 0;
      else { ANIM.frame = ANIM.frames - 1; animPlay(false); renderAll(); return; }
    }
  }
  renderStage(); updateFrameLabel(); updatePlayhead();
  animRaf = requestAnimationFrame(animTick);
}
function animStop() { animPlay(false); ANIM.frame = 0; renderAll(); }

/* ---------- keyframe operations ---------- */
function keyAtFrame(l) { return l ? l.kfs.find(k => k.f === ANIM.frame) || null : null; }
function addKeyHere() {
  const l = selLayer();
  if (!l) return toast(t('اختر طبقة أولاً'));
  if (l.lock) return toast(t('الطبقة مقفلة'));
  pushUndo();
  ensureKey(l, ANIM.frame);
  renderAll();
}
function deleteKeyHere() {
  const l = selLayer(), k = keyAtFrame(l);
  if (!k) return toast(t('لا يوجد مفتاح عند هذا الإطار'));
  pushUndo();
  l.kfs = l.kfs.filter(x => x !== k);
  renderAll();
}

/* ---------- timeline ---------- */
function updatePlayhead() {
  const ph = $('asPlayhead');
  if (ph) ph.style.left = (NAME_W + ANIM.frame * CELL) + 'px';
}
function updateFrameLabel() {
  $('asFrameLabel').textContent = `${ANIM.frame + 1} / ${ANIM.frames}`;
}
function updatePlayButtons() {
  $('asPlay').textContent = ANIM.playing ? '❚❚' : '▶';
  $('asPlay').title = ANIM.playing ? t('إيقاف مؤقت') : t('تشغيل');
}

function renderTimeline() {
  const body = $('asTlBody');
  body.innerHTML = '';
  const trackW = ANIM.frames * CELL;

  const ruler = el('div', 'tlRow tlRuler');
  ruler.append(el('div', 'tlName', t('الإطارات')));
  const rt = el('div', 'tlTrack');
  rt.style.width = trackW + 'px';
  const step = ANIM.frames > 120 ? 10 : 5;
  for (let f = 0; f < ANIM.frames; f += step) {
    const n = el('span', 'tick', String(f + 1));
    n.style.left = f * CELL + 'px';
    rt.appendChild(n);
  }
  rt.onpointerdown = e => {
    const r = rt.getBoundingClientRect();
    setFrame((e.clientX - r.left) / CELL);
    rt.setPointerCapture(e.pointerId);
    const move = ev => setFrame((ev.clientX - r.left) / CELL);
    rt.onpointermove = move;
    rt.onpointerup = () => { rt.onpointermove = null; rt.onpointerup = null; };
  };
  ruler.append(rt);
  body.appendChild(ruler);

  ANIM.layers.slice().reverse().forEach(l => {
    const row = el('div', 'tlRow' + (l.id === ANIM.sel ? ' sel' : ''));
    const nm = el('div', 'tlName');
    const eye = el('button', 'tlBtn', l.vis ? '👁' : '∅');
    eye.title = t('إظهار / إخفاء');
    eye.onclick = e => { e.stopPropagation(); pushUndo(); l.vis = !l.vis; renderAll(); };
    const lock = el('button', 'tlBtn', l.lock ? '🔒' : '·');
    lock.title = t('قفل');
    lock.onclick = e => { e.stopPropagation(); pushUndo(); l.lock = !l.lock; renderAll(); };
    const label = el('span', 'tlLabel', l.name);
    label.onclick = () => selectLayer(l.id);
    nm.append(eye, lock, label);
    row.append(nm);

    const tr = el('div', 'tlTrack');
    tr.style.width = trackW + 'px';
    tr.onpointerdown = e => {
      if (e.target !== tr) return;
      selectLayer(l.id);
      const r = tr.getBoundingClientRect();
      setFrame((e.clientX - r.left) / CELL);
    };
    l.kfs.forEach(kf => {
      const d = el('div', 'kf' + (kf.ease !== 'linear' ? ' eased' : ''));
      d.style.left = (kf.f * CELL) + 'px';
      d.title = `${kf.f + 1}`;
      d.onpointerdown = e => startKeyDrag(e, l, kf);
      tr.appendChild(d);
    });
    row.append(tr);
    body.appendChild(row);
  });

  const ph = el('div', 'playhead');
  ph.id = 'asPlayhead';
  body.appendChild(ph);
  updatePlayhead();
}

/* Drag a keyframe to another frame */
function startKeyDrag(e, l, kf) {
  e.stopPropagation(); e.preventDefault();
  selectLayer(l.id);
  setFrame(kf.f);
  pushUndo();
  const startX = e.clientX, f0 = kf.f;
  const move = ev => {
    const nf = clamp(f0 + Math.round((ev.clientX - startX) / CELL), 0, ANIM.frames - 1);
    if (nf !== kf.f && !l.kfs.some(k => k !== kf && k.f === nf)) {
      kf.f = nf;
      l.kfs.sort((a, b) => a.f - b.f);
      renderAll();
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    setFrame(kf.f);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/* ---------- properties panel ---------- */
function formRowA(label, control) {
  const r = el('div', 'crow');
  r.append(el('span', null, label), control);
  return r;
}
function renderProps() {
  const body = $('asPropsBody');
  body.innerHTML = '';
  const l = selLayer();
  if (!l) { body.append(el('p', 'empty', t('اختر طبقة من المشهد أو القائمة'))); return; }
  const locked = l.lock;

  const name = document.createElement('input');
  name.type = 'text'; name.value = l.name; name.maxLength = 40; name.disabled = locked;
  name.onchange = () => { pushUndo(); l.name = name.value.trim() || l.name; renderAll(); };
  body.append(formRowA(t('الاسم'), name));

  const p = layerPropsAt(l, ANIM.frame);
  AP_PROPS.forEach(q => {
    const pct = !!AP_PCT[q];
    const inp = mkNumber(+(p[q] * (pct ? 100 : 1)).toFixed(2), pct ? -10000 : -100000, pct ? 10000 : 100000, 'any');
    inp.disabled = locked;
    inp.onchange = () => {
      const v = +inp.value; if (isNaN(v)) return;
      pushUndo(); setProp(l, q, pct ? v / 100 : v); renderAll();
    };
    body.append(formRowA(t(AP_LABEL[q]), inp));
  });

  if (l.type === 'text') {
    const ta = document.createElement('textarea');
    ta.className = 'textArea'; ta.rows = 2; ta.value = l.str; ta.disabled = locked;
    ta.onchange = () => { pushUndo(); l.str = ta.value; updateTextBox(l); renderAll(); };
    body.append(formRowA(t('النص'), ta));
    const size = mkNumber(l.size, 4, 800, 1);
    size.disabled = locked;
    size.onchange = () => { pushUndo(); l.size = clamp(+size.value | 0, 4, 800); updateTextBox(l); renderAll(); };
    body.append(formRowA(t('الحجم'), size));
  }
  if (l.type !== 'image') {
    const col = document.createElement('input');
    col.type = 'color'; col.value = l.color; col.disabled = locked;
    col.onchange = () => { pushUndo(); l.color = col.value; renderAll(); };
    body.append(formRowA(t('اللون'), col));
  }

  /* easing of the segment that starts at the last keyframe at or before the playhead */
  const i = segmentAt(l, ANIM.frame);
  if (i >= 0) {
    const sel = document.createElement('select');
    AP_EASE.forEach(([v, lab]) => sel.add(new Option(t(lab), v)));
    sel.value = l.kfs[i].ease;
    sel.disabled = locked;
    sel.onchange = () => { pushUndo(); l.kfs[i].ease = sel.value; renderAll(); };
    body.append(formRowA(t('التخفيف للمقطع'), sel));
  }

  const row = el('div', 'btnRow');
  const bk = el('button', '', t('+ مفتاح عند المؤشر'));
  bk.onclick = addKeyHere;
  const bd = el('button', '', t('حذف المفتاح'));
  bd.onclick = deleteKeyHere;
  row.append(bk, bd);
  body.append(row);
}

/* ---------- layers panel ---------- */
function renderLayers() {
  const body = $('asLayersBody');
  body.innerHTML = '';
  if (!ANIM.layers.length) { body.append(el('p', 'empty', t('لا توجد طبقات بعد'))); return; }
  ANIM.layers.slice().reverse().forEach(l => {
    const row = el('div', 'lyRow' + (l.id === ANIM.sel ? ' sel' : ''));
    const label = el('span', 'lyName', l.name + (l.kfs.length ? '  ◆' + l.kfs.length : ''));
    label.onclick = () => selectLayer(l.id);
    const vis = el('button', 'tlBtn', l.vis ? '👁' : '∅');
    vis.onclick = () => { pushUndo(); l.vis = !l.vis; renderAll(); };
    row.append(label, vis);
    body.append(row);
  });
}

/* ---------- library panel (assets shared with Photo Studio) ---------- */
async function renderLibrary() {
  const body = $('asLibBody');
  body.innerHTML = '';
  let list = [];
  try { list = await libAssetAll(); } catch (e) { body.append(el('p', 'empty', t('تعذر تحميل المكتبة'))); return; }
  if (!list.length) { body.append(el('p', 'empty', t('استورد صورة أو أرسل صورة من Photo Studio'))); return; }
  list.sort((a, b) => b.created - a.created).forEach(a => {
    const row = el('div', 'asRow');
    const im = new Image(); im.src = a.dataURL; im.alt = '';
    const nm = el('span', 'lyName', docLabel(a.name));
    const add = el('button', '', t('إضافة'));
    add.onclick = () => addAssetToScene(a);
    const del = el('button', 'tlBtn', '✕');
    del.title = t('حذف من المكتبة');
    del.onclick = () => libAssetDelete(a.id).then(renderLibrary).catch(() => toast(t('تعذر حذف المكتبة')));
    row.append(im, nm, add, del);
    body.append(row);
  });
}
function addAssetToScene(a) {
  addImageLayer(a.id, a.dataURL, docLabel(a.name)).catch(() => toast(t('تعذر فتح الصورة')));
}

/* Images picked from the device are also stored in the shared library for reuse */
function importImages(files) {
  [...files].forEach(f => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataURL = reader.result, id = uid();
      try {
        await libAssetPut({ id, name: f.name.replace(/\.[^.]+$/, ''), dataURL, created: Date.now() });
      } catch (e) { /* the layer is still added even if the library write fails */ }
      addImageLayer(id, dataURL, f.name.replace(/\.[^.]+$/, '')).then(renderLibrary)
        .catch(() => toast(t('تعذر فتح الصورة')));
    };
    reader.readAsDataURL(f);
  });
}

/* ---------- graph editor ---------- */
function graphSeg() {
  const l = selLayer();
  if (!l || l.kfs.length < 2) return null;
  let i = segmentAt(l, ANIM.frame);
  if (i < 0) i = 0;
  return { l, i, a: l.kfs[i], b: l.kfs[i + 1] };
}
const GRAPH_PAD = 28;
function graphMap(W, H) {
  return {
    X: x => GRAPH_PAD + x * (W - 2 * GRAPH_PAD),
    Y: y => (H - GRAPH_PAD) - (y + 0.4) / 1.8 * (H - 2 * GRAPH_PAD),
    inv: (px, py) => ({ x: (px - GRAPH_PAD) / (W - 2 * GRAPH_PAD), y: ((H - GRAPH_PAD) - py) / (H - 2 * GRAPH_PAD) * 1.8 - 0.4 })
  };
}
function renderGraph() {
  const cv = $('asGraph');
  if (!ANIM.graphOpen) return;
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, M = graphMap(W, H);
  c.fillStyle = '#161616'; c.fillRect(0, 0, W, H);
  c.strokeStyle = '#2e2e2e'; c.lineWidth = 1;
  [0, 0.5, 1].forEach(v => {
    c.beginPath(); c.moveTo(M.X(0), M.Y(v)); c.lineTo(M.X(1), M.Y(v)); c.stroke();
    c.beginPath(); c.moveTo(M.X(v), M.Y(-0.4)); c.lineTo(M.X(v), M.Y(1.4)); c.stroke();
  });
  const g = graphSeg();
  $('asGraphInfo').textContent = '';
  if (!g) {
    c.fillStyle = '#8c8c8c'; c.font = '13px sans-serif'; c.textAlign = 'center';
    c.fillText(t('أضف مفتاحين على الأقل لهذه الطبقة لعرض المنحنى'), W / 2, H / 2);
    return;
  }
  const { a, b, l } = g;
  const p0 = a.p[ANIM.graphProp], p1 = b.p[ANIM.graphProp];
  $('asGraphInfo').textContent = `${a.f + 1} → ${b.f + 1}  ·  ${AP_LABEL[ANIM.graphProp]}`;
  const bz = bezFor(a);
  c.strokeStyle = '#4f9cff'; c.lineWidth = 2;
  c.beginPath();
  for (let s = 0; s <= 120; s++) {
    const pr = s / 120, v = easeValue(a, pr);
    s ? c.lineTo(M.X(pr), M.Y(v)) : c.moveTo(M.X(pr), M.Y(v));
  }
  c.stroke();
  if (a.ease === 'bezier' || a.ease === 'linear') {
    c.strokeStyle = '#666'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(M.X(0), M.Y(0)); c.lineTo(M.X(bz[0]), M.Y(bz[1]));
    c.moveTo(M.X(1), M.Y(1)); c.lineTo(M.X(bz[2]), M.Y(bz[3])); c.stroke();
    [[bz[0], bz[1]], [bz[2], bz[3]]].forEach(([x, y]) => {
      c.fillStyle = '#4f9cff'; c.beginPath(); c.arc(M.X(x), M.Y(y), 6, 0, Math.PI * 2); c.fill();
    });
  }
  /* speed readout: the steepest point of the progress curve relative to its average slope */
  let maxSlope = 0; const N = 200;
  for (let s = 0; s < N; s++) {
    const d = (easeValue(a, (s + 1) / N) - easeValue(a, s / N)) * N;
    if (d > maxSlope) maxSlope = d;
  }
  $('asGraphInfo').textContent += `  ·  ${t('أقصى سرعة')}: ${maxSlope.toFixed(2)}×`;
  void p0; void p1;
}
function graphHandleAt(e) {
  const g = graphSeg(); if (!g) return null;
  const cv = $('asGraph'), r = cv.getBoundingClientRect();
  const M = graphMap(r.width, r.height);
  const bz = bezFor(g.a);
  const px = e.clientX - r.left, py = e.clientY - r.top;
  for (const [idx, x, y] of [[0, bz[0], bz[1]], [2, bz[2], bz[3]]]) {
    if (Math.hypot(px - M.X(x), py - M.Y(y)) <= 14) return { g, idx, M, r };
  }
  return null;
}

/* ---------- stage interaction ---------- */
let stageDrag = null;
function bindStage() {
  const cv = $('asCv');
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const d = stageToDoc(e.clientX, e.clientY);
    if (ANIM.tool === 'hand') { stageDrag = { mode: 'pan', x: e.clientX, y: e.clientY, px: ANIM.panX, py: ANIM.panY }; return; }
    if (ANIM.tool === 'zoom') { zoomBy(e.altKey ? 1 / 1.25 : 1.25); return; }
    if (['text', 'rect', 'ellipse'].includes(ANIM.tool)) {
      createAt(ANIM.tool, d);
      setAnimTool('select');
      return;
    }
    const sl = selLayer();
    if (ANIM.tool === 'select' && sl && !sl.lock) {
      const h = handleAt(sl, d);
      if (h) {
        pushUndo();
        const p0 = layerPropsAt(sl, ANIM.frame);
        const cx = ANIM.W / 2 + p0.x, cy = ANIM.H / 2 + p0.y;
        stageDrag = { mode: 'handle', l: sl, h, p0, cx, cy,
          a0: Math.atan2(d.x - cx, -(d.y - cy)) * 180 / Math.PI,
          r0: Math.max(1e-3, Math.hypot(d.x - cx, d.y - cy)) };
        return;
      }
    }
    const hit = hitLayer(d, ANIM.frame);
    if (!hit) { selectLayer(null); return; }
    selectLayer(hit.id);
    if (hit.lock) return;
    pushUndo();
    stageDrag = { mode: 'move', l: hit, sx: d.x, sy: d.y, p0: layerPropsAt(hit, ANIM.frame) };
  });
  cv.addEventListener('pointermove', e => {
    if (!stageDrag) return;
    if (stageDrag.mode === 'pan') {
      ANIM.panX = stageDrag.px + e.clientX - stageDrag.x;
      ANIM.panY = stageDrag.py + e.clientY - stageDrag.y;
      renderStage();
      return;
    }
    const d = stageToDoc(e.clientX, e.clientY);
    if (stageDrag.mode === 'handle') { handleDrag(stageDrag, d); renderAll(); return; }
    const { l, p0 } = stageDrag;
    setProp(l, 'x', p0.x + d.x - stageDrag.sx);
    setProp(l, 'y', p0.y + d.y - stageDrag.sy);
    renderAll();
  });
  const end = () => { stageDrag = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

  const gc = $('asGraph');
  let gh = null;
  gc.addEventListener('pointerdown', e => {
    gh = graphHandleAt(e);
    if (gh) { gc.setPointerCapture(e.pointerId); pushUndo(); }
  });
  gc.addEventListener('pointermove', e => {
    if (!gh) return;
    const r = gc.getBoundingClientRect();
    const v = graphMap(r.width, r.height).inv(e.clientX - r.left, e.clientY - r.top);
    const a = gh.g.a;
    const bz = (a.ease === 'bezier' ? (a.bez || bezFor(a)) : bezFor(a)).slice();
    const x = clamp(v.x, 0, 1);
    if (gh.idx === 0) { bz[0] = x; bz[1] = v.y; } else { bz[2] = x; bz[3] = v.y; }
    a.ease = 'bezier'; a.bez = bz;
    renderAll();
  });
  const gEnd = () => { gh = null; };
  gc.addEventListener('pointerup', gEnd);
  gc.addEventListener('pointercancel', gEnd);
  bindGrip();
}
/* the grip above the timeline drags the bottom panel taller or shorter */
function bindGrip() {
  const g = $('asGrip'), bottom = $('asBottom');
  let st = null;
  try { const saved = +localStorage.getItem('cs-anim-bottom'); if (saved) bottom.style.height = saved + 'px'; } catch (_) {}
  g.addEventListener('pointerdown', e => {
    g.setPointerCapture(e.pointerId);
    st = { y: e.clientY, h: bottom.offsetHeight };
  });
  g.addEventListener('pointermove', e => {
    if (!st) return;
    const h = clamp(st.h + (st.y - e.clientY), 150, Math.round(window.innerHeight * 0.7));
    bottom.style.height = h + 'px';
    renderStage();
    renderGraph();
    try { localStorage.setItem('cs-anim-bottom', String(h)); } catch (_) {}
  });
  const end = () => { st = null; };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
}
function zoomBy(f) {
  ANIM.zoom = clamp(ANIM.zoom * f, 0.2, 8);
  renderStage();
}
function setAnimTool(id) {
  ANIM.tool = id;
  document.querySelectorAll('#asTools button').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  $('asCv').style.cursor = id === 'hand' ? 'grab' : id === 'zoom' ? 'zoom-in' : 'crosshair';
}

/* ---------- save, load, thumbnail ---------- */
function animThumb() {
  const max = 320, k = Math.min(1, max / Math.max(ANIM.W, ANIM.H));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(ANIM.W * k)); c.height = Math.max(1, Math.round(ANIM.H * k));
  const x = c.getContext('2d');
  x.scale(k, k);
  drawScene(x, 0);
  return c.toDataURL('image/png');
}
function animData() {
  return {
    format: 'photostudio-anim', version: 1, name: ANIM.name,
    W: ANIM.W, H: ANIM.H, bg: ANIM.bg, fps: ANIM.fps, frames: ANIM.frames,
    frame: ANIM.frame, layers: ANIM.layers, imgs: ANIM.imgs
  };
}
async function animSave(explicit, silent) {
  if (!ANIM.open && !explicit) return false;
  if (!ANIM.id) ANIM.id = uid();
  const id = ANIM.id, now = Date.now(), name = ANIM.name;
  const data = animData(), thumb = animThumb();
  ANIM.dirty = false;
  try {
    const old = await libMeta(id);
    await libRun('data', 'readwrite', s => s.put({ id, data }));
    await libRun('meta', 'readwrite', s => s.put({
      id, name, type: 'anim', created: old ? old.created : now, updated: now,
      saved: explicit || !!(old && old.saved), thumb
    }));
    if (!silent) toast(t('تم حفظ المشروع'));
    return true;
  } catch (e) {
    ANIM.dirty = true;
    if (!silent) toast(t('فشل الحفظ'));
    return false;
  }
}
let animSaveTimer = null;
function scheduleAnimSave() {
  const s = getSettings();
  if (!s.autosave) return;
  clearTimeout(animSaveTimer);
  animSaveTimer = setTimeout(() => { if (ANIM.touched) animSave(false, true); }, s.autosaveDelay);
}

async function loadAnimData(d, id, name) {
  if (!d || d.format !== 'photostudio-anim' || !Array.isArray(d.layers)) throw new Error('invalid');
  ANIM.id = id; ANIM.name = name || d.name || 'Untitled';
  ANIM.W = d.W; ANIM.H = d.H; ANIM.bg = d.bg || '#ffffff';
  ANIM.fps = d.fps || 24; ANIM.frames = d.frames || 120;
  ANIM.frame = clamp(d.frame || 0, 0, ANIM.frames - 1);
  ANIM.layers = d.layers; ANIM.imgs = d.imgs || {};
  ANIM.sel = null; ANIM.undo = []; ANIM.redo = []; ANIM.touched = false; ANIM.dirty = false;
  ANIM.zoom = 1; ANIM.panX = 0; ANIM.panY = 0;
  await Promise.all(Object.entries(ANIM.imgs).map(([k, src]) => animImgLoad(k, src)));
  renderAll();
}
function resetAnim(opts) {
  Object.assign(ANIM, {
    id: null, name: opts.name, W: opts.W, H: opts.H, bg: opts.bg, fps: opts.fps, frames: opts.frames,
    frame: 0, playing: false, sel: null, layers: [], imgs: {}, zoom: 1, panX: 0, panY: 0,
    undo: [], redo: [], touched: false, dirty: false
  });
  Object.keys(ASI).forEach(k => delete ASI[k]);
}

/* Opens an existing animation project from the library */
async function openAnimationProject(meta, rec) {
  await loadAnimData(rec.data, meta.id || rec.id, meta.name);
  openAnimScreen();
}

function openAnimScreen() {
  ANIM.open = true;
  $('anim').classList.add('on');
  hideHome();
  renderAll();
  renderLibrary();
}
async function closeAnimScreen() {
  animPlay(false);
  clearTimeout(animSaveTimer);
  if (ANIM.touched) await animSave(false, true);
  ANIM.open = false;
  $('anim').classList.remove('on');
  showHome();
}

/* ---------- new animation project ---------- */
function openAnimNewDialog(opts = {}) {
  const body = el('div', 'ctrls newProj');
  const nameIn = document.createElement('input');
  nameIn.type = 'text'; nameIn.maxLength = 80; nameIn.value = 'Animation ' + (ANIM.layers.length + 1);
  body.append(formRowA(t('اسم المشروع'), nameIn));
  const preset = mkSelect([
    ['custom', t('مخصص')], ['1920x1080', 'Full HD 1920×1080'], ['1280x720', 'HD 1280×720'],
    ['1080x1920', t('عمودي 1080×1920')], ['1080x1080', t('مربع 1080×1080')]
  ], '1920x1080');
  body.append(formRowA(t('قالب جاهز'), preset));
  const wIn = mkNumber(1920, 1, 8000, 1), hIn = mkNumber(1080, 1, 8000, 1);
  body.append(formRowA(t('العرض (px)'), wIn), formRowA(t('الارتفاع (px)'), hIn));
  const fpsIn = mkNumber(24, 1, 120, 1);
  body.append(formRowA(t('الإطارات في الثانية (FPS)'), fpsIn));
  const secIn = mkNumber(5, 0.5, 600, 0.5);
  body.append(formRowA(t('المدة (ثانية)'), secIn));
  const bgIn = document.createElement('input');
  bgIn.type = 'color'; bgIn.value = '#ffffff';
  body.append(formRowA(t('لون الخلفية'), bgIn));
  const info = el('div', 'pxInfo');
  body.append(info);
  const refresh = () => {
    const frames = Math.round((+secIn.value || 0) * (+fpsIn.value || 0));
    info.textContent = `${frames} ${t('إطار')}`;
  };
  preset.onchange = () => {
    if (preset.value === 'custom') return;
    const [w, h] = preset.value.split('x');
    wIn.value = w; hIn.value = h;
  };
  [fpsIn, secIn].forEach(i => { i.oninput = refresh; });
  refresh();
  openModal({
    title: t('مشروع رسوم متحركة جديد'), body,
    buttons: [
      { label: t('إلغاء'), onClick: closeModal },
      { label: t('إنشاء'), primary: true, onClick: () => {
        const W = clamp(+wIn.value | 0, 1, 8000), H = clamp(+hIn.value | 0, 1, 8000);
        const fps = clamp(+fpsIn.value | 0, 1, 120);
        const frames = clamp(Math.round((+secIn.value || 1) * fps), 1, 36000);
        closeModal();
        resetAnim({ name: nameIn.value.trim() || 'Untitled', W, H, bg: bgIn.value, fps, frames });
        openAnimScreen();
        if (opts.assetId) libAssetGet(opts.assetId).then(a => a && addAssetToScene(a));
        setFrame(0);
      } }
    ]
  });
}

/* Photo Studio → Animation Studio: the flattened image keeps its transparency */
async function sendToAnimation() {
  try {
    const cv = flattenedCanvas(false);
    const id = uid();
    await libAssetPut({ id, name: docLabel(state.docName), dataURL: cv.toDataURL('image/png'), created: Date.now() });
    openAnimNewDialog({ assetId: id });
  } catch (e) {
    toast(t('تعذر إرسال الصورة'));
  }
}

/* ---------- menus ---------- */
function animMenuDefs() {
  return {
    'ملف': [
      { label: 'الصفحة الرئيسية', fn: () => closeAnimScreen() },
      { label: 'مشروع جديد…', fn: () => openAnimNewDialog() },
      { label: 'حفظ المشروع', fn: () => animSave(true, false) },
      { label: 'إعادة التسمية', fn: () => renameAnim() }
    ],
    'تحرير': [
      { label: 'تراجع', fn: () => animUndo(false) },
      { label: 'إعادة', fn: () => animUndo(true) },
      { label: 'تكرار الطبقة', fn: dupLayer },
      { label: 'حذف الطبقة', fn: delLayer }
    ],
    'عرض': [
      { label: 'تكبير', fn: () => zoomBy(1.25) },
      { label: 'تصغير', fn: () => zoomBy(1 / 1.25) },
      { label: 'ملاءمة الشاشة', fn: () => { ANIM.zoom = 1; ANIM.panX = 0; ANIM.panY = 0; renderStage(); } }
    ],
    'إدراج': [
      { label: 'صورة من الجهاز…', fn: () => $('asFileIn').click() },
      { label: 'نص', fn: () => setAnimTool('text') },
      { label: 'مستطيل', fn: () => setAnimTool('rect') },
      { label: 'دائرة', fn: () => setAnimTool('ellipse') }
    ],
    'تعديل': [
      { label: 'للأعلى', fn: () => moveLayerUI(1) },
      { label: 'للأسفل', fn: () => moveLayerUI(-1) },
      { label: 'إظهار / إخفاء', fn: () => { const l = selLayer(); if (l) { pushUndo(); l.vis = !l.vis; renderAll(); } } }
    ],
    'الرسوم المتحركة': [
      { label: 'إضافة مفتاح عند المؤشر', fn: addKeyHere },
      { label: 'حذف المفتاح عند المؤشر', fn: deleteKeyHere },
      { label: 'تشغيل / إيقاف', fn: () => animPlay(!ANIM.playing) },
      { label: 'إيقاف وإرجاع للبداية', fn: animStop },
      { label: 'تكرار التشغيل', fn: () => { ANIM.loop = !ANIM.loop; toast(ANIM.loop ? t('التكرار مفعّل') : t('التكرار متوقف')); } },
      { label: 'المنحنيات', fn: toggleGraph }
    ],
    'نافذة': [
      { label: 'الخط الزمني', fn: () => { if (ANIM.graphOpen) toggleGraph(); } },
      { label: 'محرر المنحنيات', fn: () => { if (!ANIM.graphOpen) toggleGraph(); } },
      { label: 'المكتبة', fn: () => { $('asLibBody').scrollIntoView(); renderLibrary(); } }
    ],
    'مساعدة': [
      { label: 'Space: تشغيل/إيقاف · ←/→: إطار · K: مفتاح · Delete: حذف · Ctrl+Z: تراجع', fn: () => {} }
    ]
  };
}
function showAnimMenu(name) {
  const body = el('div', 'menuList');
  animMenuDefs()[name].forEach(it => {
    const b = el('button', 'menuItem', t(it.label));
    b.onclick = () => { closeModal(); it.fn(); };
    body.append(b);
  });
  openModal({ title: t(name), body, buttons: [{ label: t('إغلاق'), primary: true, onClick: closeModal }] });
}
function renameAnim() {
  const input = document.createElement('input');
  input.type = 'text'; input.value = ANIM.name; input.maxLength = 80;
  const body = el('div', 'ctrls'); body.append(input);
  openModal({
    title: t('إعادة التسمية'), body,
    buttons: [{ label: t('إلغاء'), onClick: closeModal }, { label: t('حفظ'), primary: true, onClick: () => {
      ANIM.name = input.value.trim() || ANIM.name; closeModal(); renderAll();
    } }]
  });
}
function toggleGraph() {
  ANIM.graphOpen = !ANIM.graphOpen;
  $('asGraphPanel').classList.toggle('on', ANIM.graphOpen);
  $('asTlBody').parentElement.classList.toggle('short', ANIM.graphOpen);
  renderAll();
}
function dupLayer() {
  const l = selLayer(); if (!l) return toast(t('اختر طبقة أولاً'));
  pushUndo();
  const c = JSON.parse(JSON.stringify(l));
  c.id = uid(); c.name = l.name + ' ' + t('(نسخة)');
  ANIM.layers.push(c); ANIM.sel = c.id;
  renderAll();
}
function delLayer() {
  const l = selLayer(); if (!l) return toast(t('اختر طبقة أولاً'));
  pushUndo();
  ANIM.layers = ANIM.layers.filter(x => x !== l);
  ANIM.sel = null;
  renderAll();
}
function moveLayerUI(dir) {
  const i = ANIM.layers.findIndex(l => l.id === ANIM.sel);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ANIM.layers.length) return;
  pushUndo();
  [ANIM.layers[i], ANIM.layers[j]] = [ANIM.layers[j], ANIM.layers[i]];
  renderAll();
}

/* ---------- drawing the screen ---------- */
function renderAll() {
  if (!ANIM.open) return;
  if (document.activeElement !== $('asFps')) $('asFps').value = ANIM.fps;
  if (document.activeElement !== $('asFrames')) $('asFrames').value = ANIM.frames;
  $('asLoop').classList.toggle('on', ANIM.loop);
  const g = graphSeg();
  if (g) $('asGraphEase').value = g.a.ease;
  renderStage();
  renderTimeline();
  renderProps();
  renderLayers();
  renderGraph();
  updateFrameLabel();
  updatePlayButtons();
  $('asName').textContent = ANIM.name;
  $('asStatus').textContent = `${ANIM.W} × ${ANIM.H} px  ·  ${ANIM.fps} FPS  ·  ${ANIM.frames} ${t('إطار')}`;
  const ph = $('asGraphProp');
  if (ph && !ph.options.length) AP_PROPS.forEach(q => ph.add(new Option(t(AP_LABEL[q]), q)));
  if (ph) ph.value = ANIM.graphProp;
}

/* ---------- build the screen once ---------- */
function buildAnimUI() {
  const root = $('anim');
  root.innerHTML = `
    <div id="asTop">
      <button id="asHome" class="gear" title="الصفحة الرئيسية">⌂</button>
      <div id="asName" class="asName" title="إعادة التسمية"></div>
      <nav id="asMenus"></nav>
      <button id="asPanelBtn" class="asMini" title="الخصائص">☰</button>
    </div>
    <div id="asMain">
      <div id="asTools"></div>
      <div id="asStageWrap"><canvas id="asCv"></canvas></div>
      <aside id="asSide">
        <section class="asSec"><header class="asSecHead">${t('الخصائص')}</header><div id="asPropsBody" class="asBody"></div></section>
        <section class="asSec"><header class="asSecHead">${t('الطبقات')}</header><div id="asLayersBody" class="asBody"></div></section>
        <section class="asSec"><header class="asSecHead">${t('المكتبة')}</header><div id="asLibBody" class="asBody"></div></section>
      </aside>
    </div>
      <div id="asBottom">
      <div id="asGrip" title="${t('اسحب لتغيير الارتفاع')}"><span></span></div>
      <div id="asTlBar">
        <button id="asStop" title="${t('إيقاف وإرجاع للبداية')}">■</button>
        <button id="asPlay" title="${t('تشغيل')}">▶</button>
        <span id="asFrameLabel" class="asFrame">1 / 1</span>
        <button id="asKey" title="${t('إضافة مفتاح عند المؤشر')}">◆ ${t('مفتاح')}</button>
        <button id="asDelKey" title="${t('حذف المفتاح عند المؤشر')}">◇</button>
        <button id="asLoop" class="on" title="${t('تكرار التشغيل')}">⟳</button>
        <label class="asField">FPS <input id="asFps" type="number" min="1" max="120" step="1"></label>
        <label class="asField">${t('الإطارات')} <input id="asFrames" type="number" min="1" max="36000" step="1"></label>
        <button id="asGraphBtn" title="${t('المنحنيات')}">〜 ${t('المنحنيات')}</button>
      </div>
      <div id="asTl"><div id="asTlBody"></div></div>
      <div id="asGraphPanel">
        <div class="asGraphBar">
          <select id="asGraphProp"></select>
          <select id="asGraphEase"></select>
          <span id="asGraphInfo"></span>
        </div>
        <canvas id="asGraph"></canvas>
      </div>
    </div>
    <div id="asStatus"></div>
    <input type="file" id="asFileIn" accept="image/*" multiple>`;

  /* menus */
  const menus = $('asMenus');
  Object.keys(animMenuDefs()).forEach(name => {
    const b = el('button', 'asMenuBtn', t(name));
    b.onclick = () => showAnimMenu(name);
    menus.appendChild(b);
  });

  /* tools */
  const tools = $('asTools');
  [['select', '↖', 'تحديد'], ['hand', '✋', 'يد'], ['zoom', '🔍', 'تكبير'],
   ['text', 'T', 'نص'], ['rect', '▭', 'مستطيل'], ['ellipse', '◯', 'دائرة']].forEach(([id, ic, lab]) => {
    const b = el('button', 'asTool', ic);
    b.dataset.tool = id; b.title = t(lab);
    b.onclick = () => setAnimTool(id);
    tools.appendChild(b);
  });
  setAnimTool('select');

  $('asHome').onclick = () => closeAnimScreen();
  $('asName').onclick = renameAnim;
  $('asPanelBtn').onclick = () => $('asSide').classList.toggle('open');
  $('asPlay').onclick = () => animPlay(!ANIM.playing);
  $('asStop').onclick = animStop;
  $('asKey').onclick = addKeyHere;
  $('asDelKey').onclick = deleteKeyHere;
  $('asLoop').onclick = () => { ANIM.loop = !ANIM.loop; $('asLoop').classList.toggle('on', ANIM.loop); };
  $('asGraphBtn').onclick = toggleGraph;
  $('asFps').onchange = () => { pushUndo(); ANIM.fps = clamp(+$('asFps').value | 0, 1, 120); renderAll(); };
  $('asFrames').onchange = () => {
    pushUndo();
    ANIM.frames = clamp(+$('asFrames').value | 0, 1, 36000);
    ANIM.layers.forEach(l => { l.kfs = l.kfs.filter(k => k.f < ANIM.frames); });
    ANIM.frame = Math.min(ANIM.frame, ANIM.frames - 1);
    renderAll();
  };
  $('asFileIn').onchange = e => { if (e.target.files.length) importImages(e.target.files); e.target.value = ''; };

  $('asGraphProp').onchange = () => { ANIM.graphProp = $('asGraphProp').value; renderGraph(); };
  $('asGraphEase').onchange = () => {
    const g = graphSeg(); if (!g) return;
    pushUndo();
    const v = $('asGraphEase').value;
    g.a.ease = v;
    if (v === 'bezier') g.a.bez = g.a.bez || [0.42, 0, 0.58, 1];
    renderAll();
  };
  AP_EASE.forEach(([v, lab]) => $('asGraphEase').add(new Option(t(lab), v)));

  document.querySelectorAll('#asSide .asSecHead').forEach(h => { h.onclick = () => h.parentElement.classList.toggle('collapsed'); });
  bindStage();
  window.addEventListener('resize', () => { if (ANIM.open) renderAll(); });
  window.addEventListener('keydown', animKeys);
  document.addEventListener('visibilitychange', () => { if (document.hidden && ANIM.touched) animSave(false, true); });
}

function animKeys(e) {
  if (!ANIM.open) return;
  const typing = e.target.closest && e.target.closest('input, textarea, select');
  if (typing) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); return animUndo(e.shiftKey); }
    if (k === 'y') { e.preventDefault(); return animUndo(true); }
    if (k === 's') { e.preventDefault(); return animSave(true, false); }
    return;
  }
  if (k === ' ') { e.preventDefault(); return animPlay(!ANIM.playing); }
  if (k === 'arrowleft') return setFrame(ANIM.frame - 1);
  if (k === 'arrowright') return setFrame(ANIM.frame + 1);
  if (k === 'home') return setFrame(0);
  if (k === 'end') return setFrame(ANIM.frames - 1);
  if (k === 'k') return addKeyHere();
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); return delLayer(); }
  if (k === 'escape') { ANIM.sel = null; return renderAll(); }
  if (k === 'v') return setAnimTool('select');
  if (k === 'h') return setAnimTool('hand');
  if (k === 'z') return setAnimTool('zoom');
  if (k === 't') return setAnimTool('text');
  if (k === 'r') return setAnimTool('rect');
  if (k === 'o') return setAnimTool('ellipse');
}

