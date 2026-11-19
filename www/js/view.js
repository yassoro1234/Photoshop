/* ===== Zoom & pan ===== */

function applyTransform() {
  $('canvasWrap').style.transform =
    `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  const zi = $('zoomInfo');
  if (zi) zi.textContent = Math.round(state.zoom * 100) + '%';
  drawOverlay();
}

function resetView() {
  const r = $('stage').getBoundingClientRect();
  if (!r.width || !state.W) return;
  const pad = 24;
  state.zoom = Math.min((r.width - pad * 2) / state.W, (r.height - pad * 2) / state.H, 4);
  state.panX = (r.width - state.W * state.zoom) / 2;
  state.panY = (r.height - state.H * state.zoom) / 2;
  applyTransform();
}

/* Zoom by factor keeping the point (cx, cy) in stage coordinates fixed */
function zoomAt(factor, cx, cy) {
  const r = $('stage').getBoundingClientRect();
  if (cx === undefined) { cx = r.width / 2; cy = r.height / 2; }
  const nz = clamp(state.zoom * factor, 0.05, 32);
  const k = nz / state.zoom;
  state.panX = cx - (cx - state.panX) * k;
  state.panY = cy - (cy - state.panY) * k;
  state.zoom = nz;
  applyTransform();
}

function stagePoint(clientX, clientY) {
  const r = $('stage').getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function docPoint(clientX, clientY) {
  const s = stagePoint(clientX, clientY);
  return { x: (s.x - state.panX) / state.zoom, y: (s.y - state.panY) / state.zoom };
}

/* Mouse wheel zoom */
$('stage').addEventListener('wheel', e => {
  e.preventDefault();
  const s = stagePoint(e.clientX, e.clientY);
  zoomAt(e.deltaY < 0 ? 1.1 : 0.9, s.x, s.y);
}, { passive: false });
