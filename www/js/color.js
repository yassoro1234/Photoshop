/* ===== Color: fg/bg swatches in the tool rail and a color-wheel picker ===== */

const RECENT_KEY = 'ps-recent-colors';
const WHEEL = { size: 220, c: 110, outer: 108, inner: 84, half: 60 };

/* ---------- conversions ---------- */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToHex(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/* ---------- picker state ---------- */
const picker = { h: 0, s: 1, v: 1, hex: '#000000', old: '#000000', onChange: null, drag: null };

function setPickerFromHex(hex) {
  const hsv = hexToHsv(hex);
  if (hsv.s > 0) picker.h = hsv.h;   // keep hue when the color is grey
  picker.s = hsv.s; picker.v = hsv.v;
  picker.hex = hex;
}

function commitPicker() {
  picker.hex = hsvToHex(picker.h, picker.s, picker.v);
  if (picker.onChange) picker.onChange(picker.hex);
  drawPicker();
}

/* ---------- wheel drawing ---------- */
function drawWheel() {
  const cv = $('cpWheel'); if (!cv) return;
  const x = cv.getContext('2d'), S = WHEEL.size, c = WHEEL.c;
  x.clearRect(0, 0, S, S);

  // hue ring
  const ring = x.createConicGradient ? x.createConicGradient(0, c, c) : null;
  if (ring) {
    for (let i = 0; i <= 6; i++) ring.addColorStop(i / 6, hsvToHex(i * 60 % 360, 1, 1));
    x.fillStyle = ring;
  }
  x.beginPath();
  x.arc(c, c, WHEEL.outer, 0, Math.PI * 2);
  x.arc(c, c, WHEEL.inner, 0, Math.PI * 2, true);
  x.fill('evenodd');

  // saturation / value square
  const hue = hsvToHex(picker.h, 1, 1), H = WHEEL.half, left = c - H, top = c - H;
  x.fillStyle = hue;
  x.fillRect(left, top, H * 2, H * 2);
  const white = x.createLinearGradient(left, 0, left + H * 2, 0);
  white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = white; x.fillRect(left, top, H * 2, H * 2);
  const black = x.createLinearGradient(0, top, 0, top + H * 2);
  black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000');
  x.fillStyle = black; x.fillRect(left, top, H * 2, H * 2);

  // markers
  const a = picker.h * Math.PI / 180, rm = (WHEEL.outer + WHEEL.inner) / 2;
  marker(x, c + Math.cos(a) * rm, c + Math.sin(a) * rm);
  marker(x, left + picker.s * H * 2, top + (1 - picker.v) * H * 2);
}
function marker(x, px, py) {
  x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2);
  x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke();
  x.beginPath(); x.arc(px, py, 6.5, 0, Math.PI * 2);
  x.lineWidth = 1; x.strokeStyle = '#000'; x.stroke();
}

function drawPicker() {
  if (!$('cpick').classList.contains('on')) return;
  drawWheel();
  const hex = hsvToHex(picker.h, picker.s, picker.v);
  const rgb = hexToRgb(hex);
  $('cpHex').value = hex.toUpperCase();
  $('cpR').value = rgb[0]; $('cpG').value = rgb[1]; $('cpB').value = rgb[2];
  $('cpNew').style.background = hex;
  $('cpOld').style.background = picker.old;
}

/* ---------- pointer handling on the wheel ---------- */
function wheelRegion(e) {
  const cv = $('cpWheel'), r = cv.getBoundingClientRect();
  const k = WHEEL.size / r.width;
  const x = (e.clientX - r.left) * k - WHEEL.c, y = (e.clientY - r.top) * k - WHEEL.c;
  const d = Math.hypot(x, y);
  if (d >= WHEEL.inner && d <= WHEEL.outer + 2) return { kind: 'hue', x, y };
  if (Math.abs(x) <= WHEEL.half && Math.abs(y) <= WHEEL.half) return { kind: 'sv', x, y };
  return null;
}
function applyWheel(e) {
  const reg = wheelRegion(e);
  if (!reg) return;
  if (reg.kind === 'hue') {
    picker.h = (Math.atan2(reg.y, reg.x) * 180 / Math.PI + 360) % 360;
  } else {
    picker.s = clamp((reg.x + WHEEL.half) / (WHEEL.half * 2), 0, 1);
    picker.v = clamp(1 - (reg.y + WHEEL.half) / (WHEEL.half * 2), 0, 1);
  }
  commitPicker();
}

/* ---------- open / close ---------- */
function openColorPicker({ value, onChange, anchor }) {
  const el = $('cpick');
  setPickerFromHex(value);
  picker.old = value;
  picker.onChange = onChange;
  el.classList.add('on');
  placePicker(anchor);
  drawPicker();
}
function placePicker(anchor) {
  const el = $('cpick');
  const h = el.offsetHeight, w = el.offsetWidth;
  let left = 60, top = innerHeight - h - 40;
  if (anchor) { left = anchor.right + 8; top = anchor.top - 40; }
  left = clamp(left, 6, innerWidth - w - 6);
  top = clamp(top, 6, innerHeight - h - 6);
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
function closeColorPicker() {
  const el = $('cpick');
  if (!el.classList.contains('on')) return;
  el.classList.remove('on');
  pushRecent(picker.hex);
  picker.onChange = null;
}
function pushRecent(hex) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) {}
  list = [hex, ...list.filter(c => c !== hex)].slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  renderRecent();
}
function renderRecent() {
  const box = $('cpRecent'); if (!box) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) {}
  box.innerHTML = '';
  list.forEach(hex => {
    const b = document.createElement('button');
    b.className = 'cpSwatch';
    b.style.background = hex;
    b.title = hex;
    b.onclick = () => { setPickerFromHex(hex); commitPicker(); };
    box.appendChild(b);
  });
}

/* ---------- fg / bg swatches in the tool rail ---------- */
function makeSwatches() {
  const box = document.createElement('div');
  box.id = 'swatches';
  box.innerHTML = `
    <div id="swBg" class="sw sw-bg" title="${esc(t('لون الخلفية'))}"></div>
    <div id="swFg" class="sw sw-fg" title="${esc(t('لون المقدمة'))}"></div>
    <button id="swReset" class="swMini" title="${esc(t('الألوان الافتراضية (D)'))}">◩</button>
    <button id="swSwap" class="swMini" title="${esc(t('تبديل الألوان (X)'))}">⇄</button>`;
  box.querySelector('#swFg').onclick = e => openFor('fg', e.currentTarget);
  box.querySelector('#swBg').onclick = e => openFor('bg', e.currentTarget);
  box.querySelector('#swReset').onclick = resetColors;
  box.querySelector('#swSwap').onclick = swapColors;
  renderSwatches();
  return box;
}
function openFor(target, el) {
  const key = target === 'fg' ? 'fg' : 'bg';
  openColorPicker({
    value: state[key],
    anchor: el.getBoundingClientRect(),
    onChange: hex => { state[key] = hex; renderSwatches(); }
  });
}
function renderSwatches() {
  const f = $('swFg'), b = $('swBg');
  if (f) f.style.background = state.fg;
  if (b) b.style.background = state.bg;
}
function swapColors() {
  [state.fg, state.bg] = [state.bg, state.fg];
  renderSwatches();
}
function resetColors() {
  state.fg = '#000000'; state.bg = '#ffffff';
  renderSwatches();
}
/* kept for callers that used to refresh the old color inputs */
function syncColors() { renderSwatches(); }

/* ---------- wiring ---------- */
(function initPicker() {
  const cv = $('cpWheel');
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    picker.drag = true;
    applyWheel(e);
  });
  cv.addEventListener('pointermove', e => { if (picker.drag) applyWheel(e); });
  cv.addEventListener('pointerup', () => { picker.drag = null; });
  cv.addEventListener('pointercancel', () => { picker.drag = null; });

  $('cpHex').addEventListener('change', e => {
    const m = /^#?([0-9a-f]{6})$/i.exec(e.target.value.trim());
    if (!m) return drawPicker();
    setPickerFromHex('#' + m[1].toLowerCase());
    commitPicker();
  });
  const rgbInput = () => {
    const r = clamp(+$('cpR').value | 0, 0, 255), g = clamp(+$('cpG').value | 0, 0, 255), b = clamp(+$('cpB').value | 0, 0, 255);
    setPickerFromHex(rgbToHex(r, g, b));
    commitPicker();
  };
  ['cpR', 'cpG', 'cpB'].forEach(id => $(id).addEventListener('change', rgbInput));

  $('cpEyedrop').onclick = () => { closeColorPicker(); if (ANIM.open) setAnimTool('eyedrop'); else setTool('eyedrop'); };
  $('cpClose').onclick = closeColorPicker;

  document.addEventListener('pointerdown', e => {
    const el = $('cpick');
    if (!el.classList.contains('on')) return;
    if (el.contains(e.target) || e.target.closest('#swatches')) return;
    closeColorPicker();
  }, true);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('cpick').classList.contains('on')) { e.stopPropagation(); closeColorPicker(); }
  }, true);
  renderRecent();
})();
