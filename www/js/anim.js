/* ===== Animation Studio: stage, keyframe timeline, graph editor, playback, assets ===== */

/* Document model.
   Layers: index 0 is the bottom. A layer's transform is `base` when it has no keyframes,
   otherwise the value is interpolated between its keyframes. Each keyframe stores all
   six properties; its `ease` and `bez` describe the segment that starts at that keyframe. */
const ANIM = {
  brush: { size: 24, color: '#000000' },
  pen: null,                      // open path being drawn: { pts: [{x,y}] } in document units
  rulers: false,
  guides: { v: [], h: [] },       // guide positions in document units (view only, not saved)
  open: false, id: null, name: 'Untitled', touched: false, dirty: false,
  W: 1920, H: 1080, bg: '#ffffff', fps: 24, frames: 120,
  frame: 0, playing: false, loop: true,
  sel: null, layers: [], imgs: {},
  zoom: 1, panX: 0, panY: 0, k: 1,
  tool: 'select', graphOpen: false, graphProp: 'x',
  onion: { on: false, before: 2, after: 1, opacity: 0.4 },   // onion skin: view only, not saved
  cam: { kfs: [] },               // camera keys: { f, x, y, z, ease }; x/y move the view centre, z is zoom
  undo: [], redo: []
};
const ANIM_ICON = {"select": "01_move.png", "hand": "22_hand.png", "zoom": "23_zoom.png", "text": "17_text.png", "rect": "18_rectangle.png", "ellipse": "19_ellipse.png", "brush": "08_brush.png", "eraser": "10_eraser.png", "pen": "14_pen.png", "bucket": "13_paint_bucket.png", "eyedrop": "07_eyedropper.png"};   // tool id -> icon file in www/icons
const ASI = {};
const LIVE = {};                      // live stroke canvas of a draw layer: id -> canvas                      // image cache: key -> HTMLImageElement
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
  if (b.blank) return { ...a.p };
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
/* A blank keyframe hides the layer from its frame until the next keyframe */
function layerShownAt(l, frame) {
  if (!l.vis) return false;
  let cur = null;
  for (const k of l.kfs) { if (k.f <= frame) cur = k; else break; }
  return !(cur && cur.blank);
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
  const names = { image: 'صورة', text: 'نص', rect: 'مستطيل', ellipse: 'دائرة', draw: 'طبقة رسم' };
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
  if (!layerShownAt(l, frame) || p.op <= 0) return;
  c.save();
  c.globalAlpha = clamp(p.op, 0, 1);
  c.translate(ANIM.W / 2 + p.x, ANIM.H / 2 + p.y);
  c.rotate(p.rot * Math.PI / 180);
  c.scale(p.sx, p.sy);
  if (l.type === 'image' || l.type === 'draw') {
    const im = LIVE[l.id] || ASI[l.key];
    if (im && (im.complete ?? true)) c.drawImage(im, -l.w / 2, -l.h / 2, l.w, l.h);
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
/* camera: the view centre moves to (W/2 + x, H/2 + y) and the view is zoomed by z, interpolated between keys */
function camAt(frame) {
  const k = (ANIM.cam && ANIM.cam.kfs) || [];
  if (!k.length) return { x: 0, y: 0, z: 1 };
  if (frame <= k[0].f) return { x: k[0].x, y: k[0].y, z: k[0].z };
  const last = k[k.length - 1];
  if (frame >= last.f) return { x: last.x, y: last.y, z: last.z };
  let i = 0;
  while (i < k.length - 2 && k[i + 1].f <= frame) i++;
  const a = k[i], b = k[i + 1];
  const e = easeValue(a, (frame - a.f) / (b.f - a.f));
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
}
function applyCam(c, frame) {
  const v = camAt(frame);
  c.translate(ANIM.W / 2, ANIM.H / 2);
  c.scale(v.z, v.z);
  c.translate(-(ANIM.W / 2 + v.x), -(ANIM.H / 2 + v.y));
}
function drawScene(c, frame) {
  c.save();
  applyCam(c, frame);
  c.fillStyle = ANIM.bg || '#ffffff';
  c.fillRect(0, 0, ANIM.W, ANIM.H);
  ANIM.layers.forEach(l => drawLayer(c, l, frame));
  c.restore();
}
/* camera key at the playhead: sets x, y and zoom for this frame */
function camKeyHere() {
  const v = camAt(ANIM.frame), P = { x: v.x, y: v.y, z: v.z * 100 };
  const body = el('div', 'ctrls');
  [
    { k: 'x', label: t('إزاحة أفقية'), min: -ANIM.W * 2, max: ANIM.W * 2, step: 1, val: P.x },
    { k: 'y', label: t('إزاحة عمودية'), min: -ANIM.H * 2, max: ANIM.H * 2, step: 1, val: P.y },
    { k: 'z', label: t('التكبير %'), min: 10, max: 800, step: 1, val: P.z }
  ].forEach(c => body.appendChild(controlRow(c, val => { P[c.k] = val; })));
  openModal({
    title: t('مفتاح الكاميرا'), body,
    buttons: [
      { label: t('إلغاء'), onClick: closeModal },
      { label: t('تطبيق'), primary: true, onClick: () => {
        pushUndo();
        const kfs = (ANIM.cam.kfs || []).filter(k => k.f !== ANIM.frame);
        kfs.push({ f: ANIM.frame, x: P.x, y: P.y, z: P.z / 100, ease: 'inout' });
        kfs.sort((a, b) => a.f - b.f);
        ANIM.cam = { kfs };
        closeModal(); renderAll();
      } }
    ]
  });
}
function camClear() {
  if (!ANIM.cam.kfs.length) return;
  pushUndo();
  ANIM.cam = { kfs: [] };
  renderAll();
}

/* exports every frame as an animated GIF, scaled to at most 640 px wide */
async function exportAnimGif() {
  if (!ANIM.open || !ANIM.layers.length) return toast(t('لا توجد طبقات للتصدير'));
  try {
    toast(t('جاري تصدير GIF…'));
    const scale = Math.min(1, 640 / ANIM.W);
    const w = Math.max(1, Math.round(ANIM.W * scale)), h = Math.max(1, Math.round(ANIM.H * scale));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    const delay = Math.max(2, Math.round(100 / (ANIM.fps || 24)));   // GIF delays are in centiseconds
    const frames = [];
    for (let f = 0; f < ANIM.frames; f++) {
      c.setTransform(scale, 0, 0, scale, 0, 0);
      drawScene(c, f);
      frames.push({ indices: gifIndices(c.getImageData(0, 0, w, h).data), delay });
      if (f % 4 === 3) await new Promise(r => setTimeout(r, 0));   // keep the page responsive
    }
    const bytes = encodeGif(w, h, frames, ANIM.loop);
    await saveBlob(new Blob([bytes], { type: 'image/gif' }), `${ANIM.name || 'animation'}.gif`);
  } catch (e) {
    toast(t('فشل التصدير'));
  }
}

/* exports all frames as one PNG grid (sprite sheet) plus a JSON file with each frame's rectangle */
async function exportAnimSheet() {
  if (!ANIM.open || !ANIM.layers.length) return toast(t('لا توجد طبقات للتصدير'));
  try {
    toast(t('جاري تصدير صورة الأوراق…'));
    const n = ANIM.frames, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const s = Math.min(1, 2048 / (cols * ANIM.W));          // keep the sheet at most 2048 px wide
    const cw = Math.max(1, Math.round(ANIM.W * s)), ch = Math.max(1, Math.round(ANIM.H * s));
    const sheet = document.createElement('canvas');
    sheet.width = cols * cw; sheet.height = rows * ch;
    const sc = sheet.getContext('2d');
    const meta = { format: 'photostudio-sheet', cols, rows, cellW: cw, cellH: ch, fps: ANIM.fps, frames: [] };
    const tmp = document.createElement('canvas'); tmp.width = cw; tmp.height = ch;
    const tc = tmp.getContext('2d');
    for (let f = 0; f < n; f++) {
      tc.setTransform(s, 0, 0, s, 0, 0);
      drawScene(tc, f);
      const x = (f % cols) * cw, y = Math.floor(f / cols) * ch;
      sc.drawImage(tmp, x, y);
      meta.frames.push({ f, x, y, w: cw, h: ch });
      if (f % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }
    const png = await new Promise(r => sheet.toBlob(r, 'image/png'));
    const name = ANIM.name || 'animation';
    await saveBlob(png, `${name}-sheet.png`);
    await saveBlob(new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }), `${name}-sheet.json`);
  } catch (e) {
    toast(t('فشل التصدير'));
  }
}

/* onion skin: the neighbouring frames drawn as tinted ghosts under the current frame (earlier red, later blue) */
let ONION_CV = null;
function drawOnion(c, frame) {
  const o = ANIM.onion;
  if (!o || !o.on) return;
  if (!ONION_CV || ONION_CV.width !== ANIM.W || ONION_CV.height !== ANIM.H) {
    ONION_CV = document.createElement('canvas'); ONION_CV.width = ANIM.W; ONION_CV.height = ANIM.H;
  }
  const sx = ONION_CV.getContext('2d');
  const ghost = (f, tint) => {
    sx.setTransform(1, 0, 0, 1, 0, 0);
    sx.clearRect(0, 0, ONION_CV.width, ONION_CV.height);
    ANIM.layers.forEach(l => drawLayer(sx, l, f));
    sx.globalCompositeOperation = 'source-atop';
    sx.fillStyle = tint;
    sx.fillRect(0, 0, ONION_CV.width, ONION_CV.height);
    sx.globalCompositeOperation = 'source-over';
    c.globalAlpha = o.opacity;
    c.drawImage(ONION_CV, 0, 0);
    c.globalAlpha = 1;
  };
  for (let d = o.before; d >= 1; d--) if (frame - d >= 0) ghost(frame - d, 'rgba(255,70,70,0.6)');
  for (let d = o.after; d >= 1; d--) if (frame + d < ANIM.frames) ghost(frame + d, 'rgba(70,140,255,0.6)');
}
function toggleOnion() {
  ANIM.onion.on = !ANIM.onion.on;
  toast(ANIM.onion.on ? t('ورق البصل مفعّل') : t('ورق البصل متوقف'));
  renderStage();
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
  c.save();
  applyCam(c, ANIM.frame);
  c.fillStyle = ANIM.bg || '#ffffff';
  c.fillRect(0, 0, ANIM.W, ANIM.H);
  drawOnion(c, ANIM.frame);
  ANIM.layers.forEach(l => drawLayer(c, l, ANIM.frame));
  const sl = selLayer();
  if (sl) drawSelection(c, sl, k);
  if (ANIM.pen && ANIM.pen.pts.length) drawPenPreview(c, k);
  c.restore();
  drawGuides(c, k);
  if (ANIM.rulers) drawRulers(c, r, k);
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
    if (!layerShownAt(l, frame)) continue;
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
  return JSON.stringify({ layers: ANIM.layers, sel: ANIM.sel, cam: ANIM.cam });
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
  ANIM.layers = s.layers; ANIM.sel = s.sel; ANIM.cam = s.cam || { kfs: [] };
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
function blankKeyHere() {
  const l = selLayer();
  if (!l) return toast(t('اختر طبقة أولاً'));
  if (l.lock) return toast(t('الطبقة مقفلة'));
  pushUndo();
  const k = ensureKey(l, ANIM.frame);
  if (k.blank) delete k.blank; else k.blank = true;
  renderAll();
}
let keyClip = null;
function copyKeyHere() {
  const l = selLayer();
  if (!l) return toast(t('اختر طبقة أولاً'));
  const k = keyAtFrame(l);
  keyClip = k
    ? { p: { ...k.p }, ease: k.ease, bez: k.bez ? k.bez.slice() : null, blank: !!k.blank }
    : { p: layerPropsAt(l, ANIM.frame), ease: 'linear', bez: null, blank: false };
  toast(t('تم نسخ المفتاح'));
}
function pasteKeyHere() {
  const l = selLayer();
  if (!l) return toast(t('اختر طبقة أولاً'));
  if (!keyClip) return toast(t('لا يوجد مفتاح منسوخ'));
  if (l.lock) return toast(t('الطبقة مقفلة'));
  pushUndo();
  const k = ensureKey(l, ANIM.frame);
  k.p = { ...keyClip.p };
  k.ease = keyClip.ease;
  if (keyClip.bez) k.bez = keyClip.bez.slice();
  if (keyClip.blank) k.blank = true; else delete k.blank;
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
  const tl = $('asTl');
  if (!tl) return;
  const x = NAME_W + ANIM.frame * CELL;
  if (!ANIM.scrubbing) {
    const shown = x - tl.scrollLeft;
    if (shown < NAME_W + 12 || shown > tl.clientWidth - 24) {
      tl.scrollLeft = Math.max(0, x - NAME_W - tl.clientWidth / 3);
    }
  }
  syncPlayheadVisible();
}
/* the playhead lives only over the frame track: hide it when it would sit on the layer names */
function syncPlayheadVisible() {
  const ph = $('asPlayhead'), tl = $('asTl');
  if (!ph || !tl) return;
  ph.style.display = (NAME_W + ANIM.frame * CELL - tl.scrollLeft < NAME_W) ? 'none' : '';
}
/* dragging the ruler or the playhead moves the frame without rebuilding the timeline */
function scrubFrame(e) {
  const host = document.querySelector('#asTlBody .tlRuler .tlTrack');
  if (!host) return;
  const r = host.getBoundingClientRect();
  ANIM.frame = clamp(Math.round((e.clientX - r.left) / CELL), 0, ANIM.frames - 1);
  updatePlayhead();
  updateFrameLabel();
  renderStage();
}
function startScrub(e) {
  e.preventDefault();
  ANIM.scrubbing = true;
  const move = ev => scrubFrame(ev);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    ANIM.scrubbing = false;
    renderAll();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  scrubFrame(e);
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
  rt.style.touchAction = 'none';
  rt.onpointerdown = startScrub;
  const step = ANIM.frames > 120 ? 10 : 5;
  for (let f = 0; f < ANIM.frames; f += step) {
    const n = el('span', 'tick', String(f + 1));
    n.style.left = f * CELL + 'px';
    rt.appendChild(n);
  }
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
    l.kfs.forEach((kf, idx) => {
      const nx = l.kfs[idx + 1];
      if (kf.tween && nx) {
        const bar = el('div', 'tweenBar');
        bar.style.left = (kf.f * CELL) + 'px';
        bar.style.width = ((nx.f - kf.f) * CELL) + 'px';
        tr.appendChild(bar);
      }
      const d = el('div', 'kf' + (kf.ease !== 'linear' ? ' eased' : '') + (kf.blank ? ' blank' : ''));
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
  ph.onpointerdown = startScrub;
  body.appendChild(ph);
  updatePlayhead();
}

/* Drag a keyframe to another frame */
function startKeyDrag(e, l, kf) {
  e.stopPropagation(); e.preventDefault();
  selectLayer(l.id);
  pushUndo();
  const dia = e.currentTarget;
  const startX = e.clientX, f0 = kf.f;
  ANIM.scrubbing = true;
  const move = ev => {
    const nf = clamp(f0 + Math.round((ev.clientX - startX) / CELL), 0, ANIM.frames - 1);
    if (nf !== kf.f && !l.kfs.some(k => k !== kf && k.f === nf)) {
      kf.f = nf;
      l.kfs.sort((a, b) => a.f - b.f);
      dia.style.left = (kf.f * CELL) + 'px';
      ANIM.frame = kf.f;
      updatePlayhead();
      updateFrameLabel();
      renderStage();
    }
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    ANIM.scrubbing = false;
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
/* a swatch that opens the shared color picker; the first change makes one undo step */
function colorSwatch(value, disabled, apply) {
  const b = document.createElement('button');
  b.className = 'swatchBtn';
  b.style.background = value;
  b.disabled = disabled;
  let cur = value;
  b.onclick = () => {
    let started = false;
    openColorPicker({
      value: cur,
      anchor: b.getBoundingClientRect(),
      onChange: hex => {
        if (!started) { started = true; pushUndo(); }
        cur = hex;
        b.style.background = hex;
        apply(hex);
      }
    });
  };
  return b;
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
    const col = colorSwatch(l.color, locked, hex => { l.color = hex; renderStage(); });
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

/* ---------- brush and eraser (paint onto a draw layer) ---------- */
function imgDims(im) { return { w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }; }
/* point in the layer's own units, origin at its centre, before scale and rotation */
function layerLocal(l, p, d) {
  const a = -p.rot * Math.PI / 180;
  const vx = d.x - (ANIM.W / 2 + p.x), vy = d.y - (ANIM.H / 2 + p.y);
  const ux = vx * Math.cos(a) - vy * Math.sin(a), uy = vx * Math.sin(a) + vy * Math.cos(a);
  return { x: ux / p.sx, y: uy / p.sy };
}
function newDrawLayer() {
  pushUndo();
  const c = document.createElement('canvas');
  c.width = ANIM.W; c.height = ANIM.H;
  const key = uid();
  ANIM.imgs[key] = c.toDataURL('image/png');
  ASI[key] = c;
  const l = newLayer('draw', { key, w: ANIM.W, h: ANIM.H });
  addLayerObj(l);
  return l;
}
function paintStart(d) {
  let l = selLayer();
  // the eraser only removes pixels from an existing drawing layer; it never creates one
  if (ANIM.tool === 'eraser' && (!l || l.type !== 'draw')) return toast(t('اختر طبقة رسم أولاً'));
  if (ANIM.tool === 'eraser' && l.lock) return toast(t('الطبقة مقفلة'));
  if (!l || l.type !== 'draw' || l.lock) l = newDrawLayer();
  else if (l.lock) return toast(t('الطبقة مقفلة'));
  pushUndo();
  const im = ASI[l.key];
  const dim = imgDims(im);
  const c = document.createElement('canvas');
  c.width = dim.w; c.height = dim.h;
  c.getContext('2d').drawImage(im, 0, 0);
  LIVE[l.id] = c;
  const st = { mode: 'paint', l, c, p: layerPropsAt(l, ANIM.frame), erase: ANIM.tool === 'eraser', last: null };
  stageDrag = st;
  paintTo(st, d, true);
}
function paintTo(st, d, first) {
  const lp = layerLocal(st.l, st.p, d);
  const bp = { x: (lp.x + st.l.w / 2) * st.c.width / st.l.w, y: (lp.y + st.l.h / 2) * st.c.height / st.l.h };
  const scale = Math.sqrt(Math.abs(st.p.sx * st.p.sy)) || 1;
  const width = Math.max(1, ANIM.brush.size / scale * st.c.width / st.l.w);
  const x = st.c.getContext('2d');
  x.save();
  x.lineCap = 'round'; x.lineJoin = 'round';
  x.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
  x.strokeStyle = ANIM.brush.color; x.fillStyle = ANIM.brush.color; x.lineWidth = width;
  if (first) {
    x.beginPath(); x.arc(bp.x, bp.y, width / 2, 0, Math.PI * 2); x.fill();
  } else {
    x.beginPath(); x.moveTo(st.last.x, st.last.y); x.lineTo(bp.x, bp.y); x.stroke();
  }
  x.restore();
  st.last = bp;
  renderStage();
}
async function paintEnd() {
  const st = stageDrag;
  stageDrag = null;
  if (!st) return;
  const url = st.c.toDataURL('image/png');
  const key = uid();
  ANIM.imgs[key] = url;
  await animImgLoad(key, url);
  st.l.key = key;          // the undo snapshot taken at the start still points at the old bitmap
  delete LIVE[st.l.id];
  renderAll();
  scheduleAnimSave();
}

/* ---------- rulers and guides ---------- */
const RULER = 18;
function drawGuides(c, k) {
  const g = ANIM.guides;
  if (!g.v.length && !g.h.length) return;
  c.save();
  c.strokeStyle = '#00d4ff';
  c.lineWidth = 1 / k;
  c.beginPath();
  g.v.forEach(x => { c.moveTo(x, -ANIM.H * 4); c.lineTo(x, ANIM.H * 5); });
  g.h.forEach(y => { c.moveTo(-ANIM.W * 4, y); c.lineTo(ANIM.W * 5, y); });
  c.stroke();
  c.restore();
}
function drawRulers(c, r, k) {
  const dpr = window.devicePixelRatio || 1;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = r.width / 2 + ANIM.panX, cy = r.height / 2 + ANIM.panY;
  const dx0 = (RULER - cx) / k + ANIM.W / 2, dx1 = (r.width - cx) / k + ANIM.W / 2;
  const dy0 = (RULER - cy) / k + ANIM.H / 2, dy1 = (r.height - cy) / k + ANIM.H / 2;
  // ticks are at least 60 screen pixels apart
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * k >= 60) || 2000;
  c.fillStyle = '#2b2b2b';
  c.fillRect(0, 0, r.width, RULER);
  c.fillRect(0, 0, RULER, r.height);
  c.strokeStyle = '#8a8a8a';
  c.fillStyle = '#cfcfcf';
  c.font = '9px sans-serif';
  c.lineWidth = 1;
  c.beginPath();
  for (let d = Math.ceil(dx0 / step) * step; d <= dx1; d += step) {
    const sx = cx + (d - ANIM.W / 2) * k;
    if (sx < RULER) continue;
    c.moveTo(sx + 0.5, RULER - 6); c.lineTo(sx + 0.5, RULER);
    c.fillText(String(Math.round(d)), sx + 2, 9);
  }
  for (let d = Math.ceil(dy0 / step) * step; d <= dy1; d += step) {
    const sy = cy + (d - ANIM.H / 2) * k;
    if (sy < RULER) continue;
    c.moveTo(RULER - 6, sy + 0.5); c.lineTo(RULER, sy + 0.5);
    c.save(); c.translate(9, sy + 2); c.rotate(-Math.PI / 2); c.fillText(String(Math.round(d)), 0, 0); c.restore();
  }
  c.stroke();
  c.fillStyle = '#00d4ff';
  ANIM.guides.v.forEach(x => { const sx = cx + (x - ANIM.W / 2) * k; if (sx >= RULER) c.fillRect(sx - 0.5, 0, 1, RULER); });
  ANIM.guides.h.forEach(y => { const sy = cy + (y - ANIM.H / 2) * k; if (sy >= RULER) c.fillRect(0, sy - 0.5, RULER, 1); });
}
/* a guide is made by dragging from a ruler; dragging it back onto the ruler removes it */
/* an existing guide under the pointer (within 6 px), so it can be moved or removed */
function guideHit(e, r) {
  const lx = e.clientX - r.left, ly = e.clientY - r.top;
  const cx = r.width / 2 + ANIM.panX, cy = r.height / 2 + ANIM.panY;
  let best = null, bd = 6;
  ANIM.guides.v.forEach((g, i) => {
    const dd = Math.abs(lx - (cx + (g - ANIM.W / 2) * ANIM.k));
    if (dd <= bd) { bd = dd; best = { orient: 'v', idx: i }; }
  });
  ANIM.guides.h.forEach((g, i) => {
    const dd = Math.abs(ly - (cy + (g - ANIM.H / 2) * ANIM.k));
    if (dd <= bd) { bd = dd; best = { orient: 'h', idx: i }; }
  });
  return best;
}
function guideStart(e, r, d) {
  const lx = e.clientX - r.left, ly = e.clientY - r.top;
  const hit = guideHit(e, r);
  if (hit && lx >= RULER && ly >= RULER) {
    stageDrag = { mode: 'guide', orient: hit.orient, idx: hit.idx };
    return true;
  }
  if (ly < RULER && lx >= RULER) {
    ANIM.guides.h.push(d.y);
    stageDrag = { mode: 'guide', orient: 'h', idx: ANIM.guides.h.length - 1 };
    renderStage();
    return true;
  }
  if (lx < RULER && ly >= RULER) {
    ANIM.guides.v.push(d.x);
    stageDrag = { mode: 'guide', orient: 'v', idx: ANIM.guides.v.length - 1 };
    renderStage();
    return true;
  }
  return false;
}
function guideEnd(e, st) {
  const r = $('asCv').getBoundingClientRect();
  const lx = e.clientX - r.left, ly = e.clientY - r.top;
  const onRuler = st.orient === 'h' ? ly < RULER : lx < RULER;
  if (onRuler) ANIM.guides[st.orient].splice(st.idx, 1);
  renderStage();
}
/* moves a dragged layer so its centre or edges line up with a guide when they are close */
function snapToGuides(l, nx, ny) {
  if (!ANIM.guides.v.length && !ANIM.guides.h.length) return { x: nx, y: ny };
  const p = layerPropsAt(l, ANIM.frame);
  const hw = l.w * p.sx / 2, hh = l.h * p.sy / 2;
  const tol = 6 / ANIM.k;
  let bx = null, by = null;
  ANIM.guides.v.forEach(g => [0, -hw, hw].forEach(o => {
    const dd = g - (ANIM.W / 2 + nx + o);
    if (Math.abs(dd) < tol && (bx === null || Math.abs(dd) < Math.abs(bx))) bx = dd;
  }));
  ANIM.guides.h.forEach(g => [0, -hh, hh].forEach(o => {
    const dd = g - (ANIM.H / 2 + ny + o);
    if (Math.abs(dd) < tol && (by === null || Math.abs(dd) < Math.abs(by))) by = dd;
  }));
  return { x: nx + (bx || 0), y: ny + (by || 0) };
}

/* ---------- motion tween ---------- */
function tweenDialog() {
  const input = document.createElement('input');
  input.type = 'number'; input.min = 1; input.max = 600; input.value = 24;
  const body = el('div', 'ctrls'); body.append(input);
  openModal({
    title: t('إنشاء حركة'), body,
    buttons: [{ label: t('إلغاء'), onClick: closeModal }, { label: t('إنشاء'), primary: true, onClick: () => {
      const n = Math.round(+input.value) || 24;
      closeModal();
      createTween(n);
    } }]
  });
}
/* a tween joins the playhead frame and the frame len later; change the pose at the end to animate */
function createTween(len) {
  const l = selLayer();
  if (!l) return toast(t('اختر طبقة أولاً'));
  if (l.lock) return toast(t('الطبقة مقفلة'));
  const start = ANIM.frame, end = Math.min(ANIM.frames - 1, start + Math.max(1, len));
  if (end <= start) return toast(t('لا يوجد مكان لإنشاء الحركة'));
  pushUndo();
  const a = ensureKey(l, start);
  a.ease = 'inout';
  a.tween = true;
  ensureKey(l, end);
  setFrame(end);
  renderAll();
}

/* ---------- frame copy and paste ---------- */
let frameClip = null;
function copyFrame() {
  const items = [];
  ANIM.layers.forEach(l => {
    const k = l.kfs.find(x => x.f === ANIM.frame);
    if (k) items.push({ id: l.id, k: { p: { ...k.p }, ease: k.ease, bez: k.bez ? k.bez.slice() : null, blank: !!k.blank } });
  });
  if (!items.length) return toast(t('لا توجد مفاتيح في هذا الإطار'));
  frameClip = items;
  toast(t('تم نسخ الإطار') + ' (' + items.length + ')');
}
function pasteFrame() {
  if (!frameClip) return toast(t('لا يوجد إطار منسوخ'));
  pushUndo();
  let n = 0;
  frameClip.forEach(it => {
    const l = ANIM.layers.find(x => x.id === it.id);
    if (!l || l.lock) return;
    const k = ensureKey(l, ANIM.frame);
    k.p = { ...it.k.p };
    k.ease = it.k.ease;
    if (it.k.bez) k.bez = it.k.bez.slice();
    if (it.k.blank) k.blank = true; else delete k.blank;
    n++;
  });
  renderAll();
  toast(t('تم لصق الإطار') + ' (' + n + ')');
}

/* ---------- pen, bucket and eyedropper ---------- */
function drawPenPreview(c, k) {
  const pts = ANIM.pen.pts;
  c.save();
  c.strokeStyle = ANIM.brush.color;
  c.lineWidth = 2 / k;
  c.setLineDash([6 / k, 4 / k]);
  c.beginPath();
  pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = '#fff';
  pts.forEach((q, i) => {
    c.beginPath(); c.arc(q.x, q.y, (i === 0 ? 7 : 5) / k, 0, Math.PI * 2); c.fill(); c.stroke();
  });
  c.restore();
}
function ensureDrawTarget() {
  const l = selLayer();
  if (l && l.type === 'draw' && !l.lock) return l;
  return newDrawLayer();
}
/* stores a finished bitmap as a new image key, so undo keeps the old one */
async function commitCanvas(l, c) {
  const url = c.toDataURL('image/png');
  const key = uid();
  ANIM.imgs[key] = url;
  await animImgLoad(key, url);
  l.key = key;
  renderAll();
  scheduleAnimSave();
}
function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/* flood fill of the draw layer from the clicked point, similar colors within a tolerance */
async function bucketAt(d) {
  const cur = selLayer();
  if (cur && cur.lock) return toast(t('الطبقة مقفلة'));
  const l = ensureDrawTarget();
  pushUndo();
  const im = ASI[l.key];
  const dim = imgDims(im), W = dim.w, H = dim.h;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const lp = layerLocal(l, layerPropsAt(l, ANIM.frame), d);
  const px = Math.floor((lp.x + l.w / 2) * W / l.w), py = Math.floor((lp.y + l.h / 2) * H / l.h);
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  const img = x.getImageData(0, 0, W, H), data = img.data;
  const si = (py * W + px) * 4;
  const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
  const [fr, fg, fb] = hexRGB(ANIM.brush.color);
  if (tr === fr && tg === fg && tb === fb && ta === 255) return;
  const tol = 40;
  const match = i => Math.abs(data[i] - tr) + Math.abs(data[i + 1] - tg) + Math.abs(data[i + 2] - tb) + Math.abs(data[i + 3] - ta) <= tol;
  const seen = new Uint8Array(W * H);
  const stack = [py * W + px];
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!match(i)) continue;
    data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255;
    const xx = p % W, yy = (p - xx) / W;
    if (xx > 0) stack.push(p - 1);
    if (xx < W - 1) stack.push(p + 1);
    if (yy > 0) stack.push(p - W);
    if (yy < H - 1) stack.push(p + W);
  }
  x.putImageData(img, 0, 0);
  await commitCanvas(l, c);
}
/* samples the composed scene at the clicked point, then returns to the brush */
function pickColorAt(d) {
  const px = Math.floor(d.x), py = Math.floor(d.y);
  if (px < 0 || py < 0 || px >= ANIM.W || py >= ANIM.H) return;
  const c = document.createElement('canvas');
  c.width = ANIM.W; c.height = ANIM.H;
  const x = c.getContext('2d');
  drawScene(x, ANIM.frame);
  const [r, g, b] = x.getImageData(px, py, 1, 1).data;
  ANIM.brush.color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  $('asBrushColor').style.background = ANIM.brush.color;
  setAnimTool('brush');
  toast(ANIM.brush.color);
}
/* pen: each click adds a point; a click near the first point closes the path */
function penClick(d) {
  if (!ANIM.pen) ANIM.pen = { pts: [] };
  const pts = ANIM.pen.pts;
  if (pts.length > 2 && Math.hypot(d.x - pts[0].x, d.y - pts[0].y) <= 16 / ANIM.k) return penFinish(true);
  pts.push({ x: d.x, y: d.y });
  renderStage();
}
async function penFinish(closed) {
  const pen = ANIM.pen;
  ANIM.pen = null;
  if (!pen || pen.pts.length < 2) { renderStage(); return; }
  const l = ensureDrawTarget();
  pushUndo();
  const p = layerPropsAt(l, ANIM.frame);
  const im = ASI[l.key];
  const dim = imgDims(im);
  const c = document.createElement('canvas');
  c.width = dim.w; c.height = dim.h;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const scale = Math.sqrt(Math.abs(p.sx * p.sy)) || 1;
  const width = Math.max(1, ANIM.brush.size / scale * dim.w / l.w);
  const bp = pen.pts.map(q => {
    const lp = layerLocal(l, p, q);
    return { x: (lp.x + l.w / 2) * dim.w / l.w, y: (lp.y + l.h / 2) * dim.h / l.h };
  });
  x.save();
  x.lineCap = 'round'; x.lineJoin = 'round';
  x.strokeStyle = ANIM.brush.color; x.lineWidth = width;
  x.beginPath();
  x.moveTo(bp[0].x, bp[0].y);
  bp.slice(1).forEach(q => x.lineTo(q.x, q.y));
  if (closed) x.closePath();
  x.stroke();
  x.restore();
  await commitCanvas(l, c);
}
function penCancel() {
  ANIM.pen = null;
  renderStage();
}

/* ---------- stage interaction ---------- */
let stageDrag = null;
function bindStage() {
  const cv = $('asCv');
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const d = stageToDoc(e.clientX, e.clientY);
    if (ANIM.rulers && guideStart(e, cv.getBoundingClientRect(), d)) return;
    if (ANIM.tool === 'hand') { stageDrag = { mode: 'pan', x: e.clientX, y: e.clientY, px: ANIM.panX, py: ANIM.panY }; return; }
    if (ANIM.tool === 'zoom') { zoomBy(e.altKey ? 1 / 1.25 : 1.25); return; }
    if (['text', 'rect', 'ellipse'].includes(ANIM.tool)) {
      createAt(ANIM.tool, d);
      setAnimTool('select');
      return;
    }
    if (ANIM.tool === 'brush' || ANIM.tool === 'eraser') { paintStart(d); return; }
    if (ANIM.tool === 'bucket') { bucketAt(d); return; }
    if (ANIM.tool === 'eyedrop') { pickColorAt(d); return; }
    if (ANIM.tool === 'pen') { penClick(d); return; }
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
    if (stageDrag.mode === 'guide') {
      ANIM.guides[stageDrag.orient][stageDrag.idx] = stageDrag.orient === 'v' ? d.x : d.y;
      renderStage();
      return;
    }
    if (stageDrag.mode === 'paint') { paintTo(stageDrag, d, false); return; }
    if (stageDrag.mode === 'handle') { handleDrag(stageDrag, d); renderAll(); return; }
    const { l, p0 } = stageDrag;
    const sn = snapToGuides(l, p0.x + d.x - stageDrag.sx, p0.y + d.y - stageDrag.sy);
    setProp(l, 'x', sn.x);
    setProp(l, 'y', sn.y);
    renderAll();
  });
  const end = e => {
    if (stageDrag && stageDrag.mode === 'paint') return paintEnd();
    if (stageDrag && stageDrag.mode === 'guide') { const st = stageDrag; stageDrag = null; return guideEnd(e, st); }
    stageDrag = null;
  };
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
function bottomRange() {
  // phone in landscape: a shorter minimum so the stage keeps most of the height
  return { min: innerHeight < 500 ? 130 : 150, max: Math.max(170, Math.round(innerHeight - 140)) };
}
function setBottomHeight(h, save) {
  const { min, max } = bottomRange();
  const v = clamp(Math.round(h), min, max);
  $('asBottom').style.height = v + 'px';
  if (save) { try { localStorage.setItem('cs-anim-bottom', String(v)); } catch (_) {} }
  return v;
}
/* the grip above the timeline drags the bottom panel taller or shorter */
function bindGrip() {
  const g = $('asGrip'), bottom = $('asBottom');
  let st = null, saved = 0;
  try { saved = +localStorage.getItem('cs-anim-bottom') || 0; } catch (_) {}
  setBottomHeight(saved || innerHeight * (innerHeight < 500 ? 0.3 : 0.38), false);
  g.addEventListener('pointerdown', e => {
    g.setPointerCapture(e.pointerId);
    st = { y: e.clientY, h: bottom.offsetHeight };
  });
  g.addEventListener('pointermove', e => {
    if (!st) return;
    setBottomHeight(st.h + (st.y - e.clientY), true);
    renderStage();
    renderGraph();
  });
  const end = () => { st = null; };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
  // rotating the phone changes the room available: keep the panel inside it
  window.addEventListener('resize', () => {
    if (!ANIM.open) return;
    setBottomHeight(bottom.offsetHeight, false);
    renderStage();
    renderGraph();
  });
}
function zoomBy(f) {
  ANIM.zoom = clamp(ANIM.zoom * f, 0.2, 8);
  renderStage();
}
function setAnimTool(id) {
  if (id !== ANIM.tool) ANIM.brushBarHidden = false;   // choosing a tool brings its settings back
  ANIM.tool = id;
  document.querySelectorAll('#asTools button').forEach(b => b.classList.toggle('on', b.dataset.tool === id));
  const bb = $('asBrushBar');
  if (id !== 'pen') ANIM.pen = null;
  if (bb) bb.classList.toggle('on', !ANIM.brushBarHidden && ['brush', 'eraser', 'pen', 'bucket'].includes(id));
  if (bb) bb.classList.toggle('pen', id === 'pen');
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
function pruneImgs() {
  const used = new Set(ANIM.layers.map(l => l.key));
  const snaps = ANIM.undo.concat(ANIM.redo);
  Object.keys(ANIM.imgs).forEach(k => {
    if (!used.has(k) && !snaps.some(s => s.includes(k))) delete ANIM.imgs[k];
  });
}
function animData() {
  pruneImgs();
  return {
    format: 'photostudio-anim', version: 1, name: ANIM.name,
    W: ANIM.W, H: ANIM.H, bg: ANIM.bg, fps: ANIM.fps, frames: ANIM.frames,
    frame: ANIM.frame, layers: ANIM.layers, imgs: ANIM.imgs, cam: ANIM.cam
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
  ANIM.cam = d.cam && Array.isArray(d.cam.kfs) ? d.cam : { kfs: [] };
  ANIM.sel = null; ANIM.undo = []; ANIM.redo = []; ANIM.touched = false; ANIM.dirty = false;
  ANIM.zoom = 1; ANIM.panX = 0; ANIM.panY = 0;
  await Promise.all(Object.entries(ANIM.imgs).map(([k, src]) => animImgLoad(k, src)));
  renderAll();
}
function resetAnim(opts) {
  Object.assign(ANIM, {
    id: null, name: opts.name, W: opts.W, H: opts.H, bg: opts.bg, fps: opts.fps, frames: opts.frames,
    frame: 0, playing: false, sel: null, layers: [], imgs: {}, zoom: 1, panX: 0, panY: 0,
    undo: [], redo: [], touched: false, dirty: false, cam: { kfs: [] }
  });
  Object.keys(ASI).forEach(k => delete ASI[k]);
  ANIM.guides = { v: [], h: [] };
  ANIM.pen = null;
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
      { label: 'تصدير GIF', fn: exportAnimGif },
      { label: 'تصدير صورة الأوراق', fn: exportAnimSheet },
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
      { label: 'ملاءمة الشاشة', fn: () => { ANIM.zoom = 1; ANIM.panX = 0; ANIM.panY = 0; renderStage(); } },
      { label: 'ورق البصل (تبديل)', fn: toggleOnion },
      { label: 'المساطر', fn: () => { ANIM.rulers = !ANIM.rulers; renderStage(); } },
      { label: 'مسح الأدلة', fn: () => { ANIM.guides = { v: [], h: [] }; renderStage(); } }
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
      { label: 'مفتاح الكاميرا عند المؤشر…', fn: camKeyHere },
      { label: 'حذف مفاتيح الكاميرا', fn: camClear },
      { label: 'حذف المفتاح عند المؤشر', fn: deleteKeyHere },
      { label: 'تشغيل / إيقاف', fn: () => animPlay(!ANIM.playing) },
      { label: 'إيقاف وإرجاع للبداية', fn: animStop },
      { label: 'تكرار التشغيل', fn: () => { ANIM.loop = !ANIM.loop; toast(ANIM.loop ? t('التكرار مفعّل') : t('التكرار متوقف')); } },
      { label: 'المنحنيات', fn: toggleGraph },
      { label: 'نسخ الإطار', fn: copyFrame },
      { label: 'لصق الإطار', fn: pasteFrame },
      { label: 'إنشاء حركة بين الإطارات…', fn: tweenDialog }
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
  if (ANIM.graphOpen) {
    const want = innerHeight < 500 ? innerHeight * 0.7 : innerHeight * 0.5;
    setBottomHeight(Math.max($('asBottom').offsetHeight, want), true);
  }
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
        <button id="asBlank" title="${t('مفتاح فارغ: يخفي الطبقة من هذا الإطار')}">□</button>
        <button id="asCopyKey" title="${t('نسخ المفتاح')}">⧉</button>
        <button id="asPasteKey" title="${t('لصق المفتاح')}">📋</button>
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
   ['text', 'T', 'نص'], ['rect', '▭', 'مستطيل'], ['ellipse', '◯', 'دائرة'], ['brush', '🖌', 'فرشاة'], ['eraser', '⌫', 'ممحاة'], ['pen', '✒', 'قلم'], ['bucket', '🪣', 'تعبئة'], ['eyedrop', '💧', 'قطارة الألوان']].forEach(([id, ic, lab]) => {
    const b = el('button', 'asTool', '');
    if (ANIM_ICON[id]) b.innerHTML = `<img src="icons/${ANIM_ICON[id]}" alt="">`;
    else b.textContent = ic;
    b.dataset.tool = id; b.title = t(lab);
    b.onclick = () => setAnimTool(id);
    tools.appendChild(b);
  });
  setAnimTool('select');

  const bar = el('div', '');
  bar.id = 'asBrushBar';
  bar.innerHTML = `<label>${t('حجم')} <input type="range" id="asBrushSize" min="2" max="200" value="${ANIM.brush.size}"> <span id="asBrushVal">${ANIM.brush.size}</span></label><label>${t('لون')} <button id="asBrushColor" class="swatchBtn" style="background:${ANIM.brush.color}"></button></label><button id="asPenDone" class="penOnly">✓ ${t('إنهاء')}</button><button id="asPenCancel" class="penOnly">✕ ${t('إلغاء')}</button><button id="asBrushClose" title="${t('إخفاء')}">⌄</button>`;
  $('asStageWrap').appendChild(bar);
  $('asBrushClose').onclick = () => { ANIM.brushBarHidden = true; bar.classList.remove('on'); };
  $('asBrushSize').oninput = e => { ANIM.brush.size = +e.target.value; $('asBrushVal').textContent = e.target.value; };
  $('asBrushColor').onclick = () => openColorPicker({
    value: ANIM.brush.color,
    anchor: $('asBrushColor').getBoundingClientRect(),
    onChange: hex => { ANIM.brush.color = hex; $('asBrushColor').style.background = hex; }
  });
  $('asPenDone').onclick = () => penFinish(false);
  $('asPenCancel').onclick = penCancel;

  $('asTl').addEventListener('scroll', syncPlayheadVisible);
  $('asHome').onclick = () => closeAnimScreen();
  $('asName').onclick = renameAnim;
  $('asPanelBtn').onclick = () => $('asSide').classList.toggle('open');
  $('asPlay').onclick = () => animPlay(!ANIM.playing);
  $('asStop').onclick = animStop;
  $('asKey').onclick = addKeyHere;
  $('asDelKey').onclick = deleteKeyHere;
  $('asBlank').onclick = blankKeyHere;
  $('asCopyKey').onclick = copyKeyHere;
  $('asPasteKey').onclick = pasteKeyHere;
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
  if (k === 'b') return setAnimTool('brush');
  if (k === 'e') return setAnimTool('eraser');
  if (k === 'p') return setAnimTool('pen');
  if (k === 'g') return setAnimTool('bucket');
  if (k === 'i') return setAnimTool('eyedrop');
}

