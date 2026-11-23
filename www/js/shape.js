/* ===== Shape layers: rectangle, ellipse, line and polygon kept as editable shape data.
   The layer's pixels are drawn from that data, so the shape can be changed after saving. ===== */
const SHAPE_LABELS = { rect: 'مستطيل', ellipse: 'إهليلج', line: 'خط', polygon: 'مضلع' };

function rrectPath(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function polyPath(c, S) {
  const cx = S.x + S.w / 2, cy = S.y + S.h / 2, rx = S.w / 2, ry = S.h / 2, n = Math.max(3, S.sides | 0);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    const x = cx + rx * Math.cos(a), y = cy + ry * Math.sin(a);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  }
  c.closePath();
}
/* draws a shape layer's canvas from its shape data */
function drawShapeLayer(l) {
  const S = l.shape;
  if (!S || !l.ctx) return;
  const c = l.ctx;
  c.save();
  c.clearRect(0, 0, l.canvas.width, l.canvas.height);
  c.beginPath();
  if (S.kind === 'ellipse') c.ellipse(S.x + S.w / 2, S.y + S.h / 2, Math.abs(S.w) / 2, Math.abs(S.h) / 2, 0, 0, Math.PI * 2);
  else if (S.kind === 'rect') rrectPath(c, S.x, S.y, S.w, S.h, S.radius || 0);
  else if (S.kind === 'polygon') polyPath(c, S);
  else if (S.kind === 'line') { c.moveTo(S.x, S.y); c.lineTo(S.x + S.w, S.y + S.h); }
  if (S.kind !== 'line' && S.fill) { c.fillStyle = S.fill; c.fill(); }
  if (S.stroke > 0) {
    c.lineWidth = S.stroke; c.lineJoin = 'round';
    c.strokeStyle = S.strokeColor || '#000000';
    c.stroke();
  }
  c.restore();
}
function addShapeLayer(S) {
  const c = mkCanvas(state.W, state.H);
  const l = {
    id: uid(), name: t(SHAPE_LABELS[S.kind] || 'شكل'), type: 'shape', canvas: c, ctx: c.getContext('2d'),
    visible: true, locked: false, opacity: 1, blend: 'source-over', mask: null, group: null, text: null, shape: S
  };
  drawShapeLayer(l);
  insertAboveActive(l);
  pushHistory(); render(); refreshLayers();
}

/* drag to draw a shape; a line runs from the press point to the release point */
defTool('shape', {
  cursor: 'crosshair',
  down(p, e, d) { d.start = p; },
  move(p, e, d) {
    const k = OPT.shapeKind || 'rect';
    if (k === 'line') { state.preview = { kind: 'rect', x: d.start.x, y: d.start.y, w: p.x - d.start.x, h: p.y - d.start.y }; }
    else state.preview = Object.assign({ kind: k === 'ellipse' ? 'ellipse' : 'rect' }, normRect(d.start, p));
    drawOverlay();
  },
  up(p, e, d) {
    state.preview = null;
    const k = OPT.shapeKind || 'rect', col = OPT.shapeColor || '#3a6ea5';
    if (k === 'line') {
      const dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (Math.hypot(dx, dy) < 2) return drawOverlay();
      return addShapeLayer({ kind: 'line', x: d.start.x, y: d.start.y, w: dx, h: dy, fill: null, stroke: 4, strokeColor: col });
    }
    const r = normRect(d.start, p);
    if (r.w < 2 || r.h < 2) return drawOverlay();
    addShapeLayer({ kind: k, x: r.x, y: r.y, w: r.w, h: r.h, fill: col, stroke: 0, strokeColor: col,
      radius: 0, sides: Math.max(3, Math.round(optNum('sides', 6))) });
  },
  cancel() { state.preview = null; drawOverlay(); }
});

/* edits a shape layer's colour, outline, corner radius or sides; Cancel restores the shape it had */
function editShapeLayer() {
  const l = cur();
  if (!l || l.type !== 'shape' || !l.shape) return;
  const S = l.shape, before = JSON.stringify(S);
  const redraw = () => { drawShapeLayer(l); render(); };
  const body = document.createElement('div');
  body.className = 'ctrls';
  const row = (label, el) => {
    const r = document.createElement('div'); r.className = 'row';
    const s = document.createElement('span'); s.textContent = t(label);
    r.append(s, el); body.appendChild(r);
  };
  const range = (val, min, max, onInput) => {
    const el = document.createElement('input');
    el.type = 'range'; el.min = min; el.max = max; el.step = 1; el.value = val;
    el.oninput = () => { onInput(+el.value); redraw(); };
    return el;
  };
  const color = document.createElement('input');
  color.type = 'color';
  color.value = S.strokeColor || S.fill || '#000000';
  color.oninput = () => { S.strokeColor = color.value; if (S.kind !== 'line' && S.fill) S.fill = color.value; redraw(); };
  row('اللون', color);
  row('الحد', range(S.stroke || 0, 0, 60, v => S.stroke = v));
  if (S.kind === 'rect') row('نصف الانحناء', range(S.radius || 0, 0, 200, v => S.radius = v));
  if (S.kind === 'polygon') row('الأضلاع', range(S.sides || 6, 3, 12, v => S.sides = v));
  openModal({
    title: t(SHAPE_LABELS[S.kind] || 'شكل'), body,
    buttons: [
      { label: t('إلغاء'), onClick: () => { l.shape = JSON.parse(before); redraw(); closeModal(); } },
      { label: t('تطبيق'), primary: true, onClick: () => { pushHistory(); refreshLayers(); closeModal(); } }
    ],
    onCancel: () => { l.shape = JSON.parse(before); redraw(); }
  });
}
