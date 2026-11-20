/* ===== Text layers: model, rendering, properties dialog, fonts ===== */

const GENERIC_FONTS = ['sans-serif', 'serif', 'monospace'];
const TEXT_FONTS = [
  'sans-serif', 'serif', 'monospace', 'Roboto', 'Noto Sans Arabic', 'Noto Naskh Arabic',
  'Arial', 'Tahoma', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Trebuchet MS', 'Impact'
];
state.userFonts = state.userFonts || [];

function fontCSS(name) {
  if (!name || GENERIC_FONTS.includes(name)) return name || 'sans-serif';
  return `"${name}", sans-serif`;
}

/* Default properties for a new text layer (font and size remember the last choice) */
function defaultTextProps() {
  return {
    str: '',
    font: OPT.textFont || 'sans-serif',
    size: OPT.textSize || 48,
    bold: !!OPT.textBold,
    italic: !!OPT.textItalic,
    rtl: false,
    align: 'left',
    lineH: 1.2,
    track: 0,
    color: state.fg,
    stroke: { on: false, color: '#000000', w: 2 },
    shadow: { on: false, color: '#000000', blur: 6, dx: 4, dy: 4 },
    x: 0, y: 0
  };
}

/* Draw the text layer's properties onto its canvas */
function drawTextLayer(l) {
  const T = l.text; if (!T) return;
  const c = l.ctx;
  c.save();
  c.clearRect(0, 0, l.canvas.width, l.canvas.height);
  c.font = `${T.italic ? 'italic ' : ''}${T.bold ? '700' : '400'} ${T.size}px ${fontCSS(T.font)}`;
  c.textBaseline = 'top';
  c.textAlign = T.align || 'left';
  c.direction = T.rtl ? 'rtl' : 'ltr';
  if ('letterSpacing' in c) c.letterSpacing = (T.track || 0) + 'px';
  const lines = T.str.split('\n');
  const lh = T.size * (T.lineH || 1.2);
  const each = fn => lines.forEach((ln, i) => fn(ln, T.x, T.y + i * lh));

  const sh = T.shadow;
  const shadowOn = sh && sh.on;
  if (T.stroke && T.stroke.on && T.stroke.w > 0) {
    c.lineJoin = 'round';
    c.lineWidth = T.stroke.w * 2;
    c.strokeStyle = T.stroke.color;
    if (shadowOn) setShadow(c, sh);
    each((ln, x, y) => c.strokeText(ln, x, y));
    clearShadow(c);
  }
  c.fillStyle = T.color;
  if (shadowOn && !(T.stroke && T.stroke.on)) setShadow(c, sh);
  each((ln, x, y) => c.fillText(ln, x, y));
  clearShadow(c);
  c.restore();
}
function setShadow(c, sh) {
  c.shadowColor = sh.color; c.shadowBlur = sh.blur;
  c.shadowOffsetX = sh.dx; c.shadowOffsetY = sh.dy;
}
function clearShadow(c) {
  c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
}

/* Keep the layer name in sync with the text content */
function textLayerName(l) {
  l.name = (l.text.str.split('\n')[0] || '').slice(0, 24) || t('Text');
}

/* Font used by the Text options bar */
function fontOptions(selected, extra) {
  const list = [...TEXT_FONTS, ...state.userFonts];
  return list.map(f => `<option value="${esc(f)}"${f === selected ? ' selected' : ''}>${esc(f)}</option>`).join('');
}

/* ---------- properties dialog ---------- */
let onFontLoaded = null;

function openTextDialog(layer, p) {
  let target = layer, created = false;
  if (!target) {
    if (!state.layers.length) newDoc();
    target = makeLayer('', 'text');
    target.text = Object.assign(defaultTextProps(), { x: Math.round(p ? p.x : 40), y: Math.round(p ? p.y : 40) });
    const a = cur();
    target.group = a && a.type === 'group' ? a.id : (a ? a.group : null);
    insertAboveActive(target);
    created = true;
  }
  state.active = state.layers.indexOf(target);
  const T = target.text;
  const before = JSON.stringify(T);
  const beforeName = target.name;
  const apply = () => { textLayerName(target); drawTextLayer(target); render(); refreshLayers(); };
  apply();

  const form = buildTextForm(T, apply);
  const cancel = () => {
    if (created) {
      const i = state.layers.indexOf(target);
      if (i >= 0) state.layers.splice(i, 1);
      state.active = clamp(state.active, 0, state.layers.length - 1);
    } else {
      target.text = JSON.parse(before); target.name = beforeName;
      drawTextLayer(target);
    }
    closeModal(); render(); refreshLayers();
  };
  openModal({
    title: t(created ? 'نص جديد' : 'خصائص النص'),
    body: form,
    buttons: [
      { label: t('إلغاء'), onClick: cancel },
      { label: t('تطبيق'), primary: true, onClick: () => {
        if (!T.str.trim() && created) return cancel();
              textLayerName(target);
        pushHistory(); closeModal(); render(); refreshLayers();
      } }
    ],
    onCancel: cancel
  });
}

/* Builds the form; every change is written to `T` and previewed immediately */
function buildTextForm(T, apply) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrls textForm';

  const row = (label, el) => {
    const r = document.createElement('div'); r.className = 'crow';
    const s = document.createElement('span'); s.textContent = t(label);
    r.append(s, el); wrap.appendChild(r); return r;
  };
  const section = label => {
    const h = document.createElement('div'); h.className = 'secHead'; h.textContent = t(label);
    wrap.appendChild(h);
  };
  const num = (value, min, max, step, onInput) => {
    const i = document.createElement('input');
    i.type = 'number'; i.value = value; i.min = min; i.max = max; i.step = step;
    i.oninput = () => { const v = parseFloat(i.value); if (!isNaN(v)) onInput(v); };
    return i;
  };
  const check = (checked, onInput) => {
    const i = document.createElement('input');
    i.type = 'checkbox'; i.checked = checked;
    i.onchange = () => onInput(i.checked);
    return i;
  };
  const colorBtn = (value, onChange) => {
    const b = document.createElement('button');
    b.className = 'colorBtn';
    b.style.background = value;
    b.onclick = () => openColorPicker({
      value: b.dataset.v || value,
      anchor: b.getBoundingClientRect(),
      onChange: hex => { b.dataset.v = hex; b.style.background = hex; onChange(hex); }
    });
    return b;
  };

  /* content */
  const ta = document.createElement('textarea');
  ta.className = 'textArea'; ta.rows = 3; ta.value = T.str;
  ta.placeholder = t('اكتب النص هنا');
  ta.oninput = () => { T.str = ta.value; apply(); };
  wrap.appendChild(ta);

  /* font */
  const fontSel = document.createElement('select');
  fontSel.innerHTML = fontOptions(T.font);
  fontSel.onchange = () => { T.font = fontSel.value; OPT.textFont = fontSel.value; apply(); };
  const upload = document.createElement('button');
  upload.textContent = t('استيراد خط…');
  upload.onclick = () => {
    onFontLoaded = name => {
      fontSel.innerHTML = fontOptions(name);
      T.font = name; OPT.textFont = name; apply();
    };
    $('fontIn').click();
  };
  const fr = document.createElement('div'); fr.className = 'fontRow';
  fr.append(fontSel, upload);
  row('الخط', fr);

  row('الحجم', num(T.size, 4, 800, 1, v => { T.size = v; OPT.textSize = v; apply(); }));
  const styleBox = document.createElement('span'); styleBox.className = 'inline';
  const bold = check(T.bold, v => { T.bold = v; OPT.textBold = v; apply(); });
  const ital = check(T.italic, v => { T.italic = v; OPT.textItalic = v; apply(); });
  const bl = document.createElement('label'); bl.append(bold, document.createTextNode(' ' + t('عريض')));
  const il = document.createElement('label'); il.append(ital, document.createTextNode(' ' + t('مائل')));
  styleBox.append(bl, il);
  row('النمط', styleBox);

  const alignSel = document.createElement('select');
  [['left', 'يسار'], ['center', 'وسط'], ['right', 'يمين']].forEach(([v, l]) => alignSel.add(new Option(t(l), v)));
  alignSel.value = T.align;
  alignSel.onchange = () => { T.align = alignSel.value; apply(); };
  row('المحاذاة', alignSel);

  const rtl = check(T.rtl, v => { T.rtl = v; apply(); });
  const rl = document.createElement('label'); rl.append(rtl, document.createTextNode(' ' + t('من اليمين لليسار')));
  row('الاتجاه', rl);

  row('التباعد بين الأسطر', num(T.lineH, 0.6, 3, 0.05, v => { T.lineH = v; apply(); }));
  row('تباعد الأحرف', num(T.track, -20, 200, 1, v => { T.track = v; apply(); }));

  /* color */
  section('لون النص');
  row('لون النص', colorBtn(T.color, v => { T.color = v; apply(); }));

  /* outline */
  section('حدود النص');
  const strokeOn = check(T.stroke.on, v => { T.stroke.on = v; apply(); });
  const sl = document.createElement('label'); sl.append(strokeOn, document.createTextNode(' ' + t('تفعيل الحدود')));
  row('الحدود', sl);
  row('لون الحدود', colorBtn(T.stroke.color, v => { T.stroke.color = v; apply(); }));
  row('العرض', num(T.stroke.w, 0, 60, 0.5, v => { T.stroke.w = v; apply(); }));

  /* shadow */
  section('ظل النص');
  const shadowOn = check(T.shadow.on, v => { T.shadow.on = v; apply(); });
  const shl = document.createElement('label'); shl.append(shadowOn, document.createTextNode(' ' + t('تفعيل الظل')));
  row('الظل', shl);
  row('لون الظل', colorBtn(T.shadow.color, v => { T.shadow.color = v; apply(); }));
  row('الضبابية', num(T.shadow.blur, 0, 100, 1, v => { T.shadow.blur = v; apply(); }));
  row('إزاحة أفقية', num(T.shadow.dx, -200, 200, 1, v => { T.shadow.dx = v; apply(); }));
  row('إزاحة عمودية', num(T.shadow.dy, -200, 200, 1, v => { T.shadow.dy = v; apply(); }));
  return wrap;
}

/* Font file uploaded from the phone: register it for canvas text */
$('fontIn').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const name = 'UserFont_' + f.name.replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '_');
    const face = new FontFace(name, await f.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    if (!state.userFonts.includes(name)) state.userFonts.push(name);
    if (onFontLoaded) onFontLoaded(name);
    toast(t('تم تحميل الخط'));
  } catch (err) {
    toast(t('تعذر تحميل الخط'));
  }
});

/* Edit the active text layer (menu, Text tool click, or double-click) */
function editTextLayer() {
  const l = curRaster();
  if (!l || l.type !== 'text' || !l.text) return toast(t('اختر طبقة نص'));
  openTextDialog(l);
}
