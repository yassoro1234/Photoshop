/* ===== Image & layer transforms, crop, canvas size, text layers ===== */

/* Applies a transform function (canvas -> canvas) to every raster layer
   and optionally resizes the document. */
function transformAll(newW, newH, fn) {
  const oldW = state.W, oldH = state.H;
  state.W = newW; state.H = newH;
  state.layers.forEach(l => {
    if (!isRaster(l)) return;
    const c = fn(l.canvas, l, oldW, oldH);
    l.canvas = c; l.ctx = c.getContext('2d');
    if (l.mask) l.mask = fn(l.mask, l, oldW, oldH);
    if (l.type === 'text' && l.text) { /* text props keep their own coords */ }
  });
  state.sel = null;
  state.crop = null;
  resizeStage();
  resetView();
  render(); refreshLayers();
}

/* Resample the whole document */
function imageSizeDialog() {
  const body = document.createElement('div');
  body.className = 'ctrls';
  const w = numRow(t('العرض (px)'), state.W), h = numRow(t('الارتفاع (px)'), state.H);
  body.append(w.row, h.row);
  openModal({
    title: t('حجم الصورة'), body,
    buttons: [
      { label: t('إلغاء'), onClick: closeModal },
      { label: t('تطبيق'), primary: true, onClick: () => {
        const nw = Math.max(1, +w.input.value | 0), nh = Math.max(1, +h.input.value | 0);
        transformAll(nw, nh, (c) => {
          const out = mkCanvas(nw, nh);
          out.getContext('2d').drawImage(c, 0, 0, nw, nh);
          return out;
        });
        pushHistory(); closeModal();
      } }
    ]
  });
}

/* Change canvas dimensions, anchored in the center */
function canvasSizeDialog() {
  const body = document.createElement('div');
  body.className = 'ctrls';
  const w = numRow(t('العرض (px)'), state.W), h = numRow(t('الارتفاع (px)'), state.H);
  body.append(w.row, h.row);
  openModal({
    title: t('حجم اللوحة'), body,
    buttons: [
      { label: t('إلغاء'), onClick: closeModal },
      { label: t('تطبيق'), primary: true, onClick: () => {
        const nw = Math.max(1, +w.input.value | 0), nh = Math.max(1, +h.input.value | 0);
        const ox = Math.round((nw - state.W) / 2), oy = Math.round((nh - state.H) / 2);
        transformAll(nw, nh, c => {
          const out = mkCanvas(nw, nh);
          out.getContext('2d').drawImage(c, ox, oy);
          return out;
        });
        pushHistory(); closeModal();
      } }
    ]
  });
}

function numRow(label, val) {
  const row = document.createElement('div');
  row.className = 'crow';
  const lab = document.createElement('span'); lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'number'; input.min = 1; input.max = 8000; input.value = val;
  row.append(lab, input);
  return { row, input };
}

/* Rotate / flip the whole document (90° steps) */
function rotateDoc(deg) {
  const swap = deg % 180 !== 0;
  const nw = swap ? state.H : state.W, nh = swap ? state.W : state.H;
  transformAll(nw, nh, c => {
    const out = mkCanvas(nw, nh), x = out.getContext('2d');
    x.translate(nw / 2, nh / 2);
    x.rotate(deg * Math.PI / 180);
    x.drawImage(c, -c.width / 2, -c.height / 2);
    return out;
  });
  pushHistory();
}
function flipDoc(horizontal) {
  transformAll(state.W, state.H, c => {
    const out = mkCanvas(c.width, c.height), x = out.getContext('2d');
    x.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
    x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    x.drawImage(c, 0, 0);
    return out;
  });
  pushHistory();
}

/* Free transform for the active layer, with live preview */
function layerTransformDialog() {
  const l = curRaster();
  if (!l) return toast(t('اختر طبقة بكسل أولاً'));
  if (l.locked) return toast(t('الطبقة مقفلة'));
  const orig = cloneC(l.canvas);
  const P = { s: 100, r: 0, ox: 0, oy: 0 };
  const make = p => src => {
    const out = mkCanvas(state.W, state.H), x = out.getContext('2d');
    const s = p.s / 100;
    x.translate(state.W / 2 + p.ox, state.H / 2 + p.oy);
    x.rotate(p.r * Math.PI / 180);
    x.scale(s, s);
    x.drawImage(src, -state.W / 2, -state.H / 2);
    return out;
  };
  let raf = 0;
  const apply = () => { raf = 0; writeLayer(orig, make(P)(orig)); render(); };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  const controls = [
    { k: 's', label: t('الحجم %'), min: 10, max: 300, val: 100 },
    { k: 'r', label: t('الدوران °'), min: -180, max: 180, val: 0 },
    { k: 'ox', label: t('إزاحة أفقية'), min: -state.W, max: state.W, val: 0 },
    { k: 'oy', label: t('إزاحة عمودية'), min: -state.H, max: state.H, val: 0 }
  ];
  const body = document.createElement('div');
  body.className = 'ctrls';
  controls.forEach(c => body.appendChild(controlRow(c, v => { P[c.k] = v; schedule(); })));

  const cancel = () => { if (raf) cancelAnimationFrame(raf); writeLayer(orig, orig); render(); };
  openModal({
    title: t('تحويل الطبقة'), body,
    buttons: [
      { label: t('إلغاء'), onClick: () => { cancel(); closeModal(); } },
      { label: t('تطبيق'), primary: true, onClick: () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        writeLayer(orig, make(P)(orig));
        pushHistory(); render(); refreshLayers();
        closeModal();
      } }
    ],
    onCancel: cancel
  });
  apply();
}

/* Flip / rotate just the active layer */
function flipLayer(horizontal) {
  const l = canAdjust(); if (!l) return;
  const orig = cloneC(l.canvas);
  const out = mkCanvas(state.W, state.H), x = out.getContext('2d');
  x.translate(horizontal ? state.W : 0, horizontal ? 0 : state.H);
  x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
  x.drawImage(orig, 0, 0);
  writeLayer(orig, out);
  pushHistory(); render(); refreshLayers();
}

/* ---------- crop ---------- */
function applyCrop() {
  const c = state.crop;
  if (!c || c.w < 1 || c.h < 1) return cancelCrop();
  const rx = Math.round(c.x), ry = Math.round(c.y);
  const nw = Math.max(1, Math.round(c.w)), nh = Math.max(1, Math.round(c.h));
  transformAll(nw, nh, src => {
    const out = mkCanvas(nw, nh);
    out.getContext('2d').drawImage(src, -rx, -ry);
    return out;
  });
  state.layers.forEach(l => {
    if (l.type === 'text' && l.text) { l.text.x -= rx; l.text.y -= ry; }
  });
  state.crop = null;
  pushHistory(); render(); refreshLayers();
  buildOpts();
  resetView();
}
function cancelCrop() {
  state.crop = null;
  buildOpts();
  render();
}

/* Text layers live in text.js */
