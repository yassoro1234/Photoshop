/* ===== UI: menus, tool rail, options bar, layers panel, dialogs, shortcuts ===== */

/* ---------- selection helpers used by menus ---------- */
function selectAll() {
  const r = { x: 0, y: 0, w: state.W, h: state.H };
  setSelection(rectMask(r), null, r);
}
function invertSelection() {
  if (!state.sel) return selectAll();
  const m = mkCanvas(state.W, state.H), x = m.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, state.W, state.H);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(state.sel.mask, 0, 0);
  setSelection(m, null, { x: 0, y: 0, w: state.W, h: state.H });
}
function deleteSelectionContent() {
  const t = strokeTarget();
  if (!t || !state.sel) return toast('لا يوجد تحديد');
  if (curRaster().locked) return toast('الطبقة مقفلة');
  t.ctx.save();
  t.ctx.globalCompositeOperation = 'destination-out';
  t.ctx.drawImage(state.sel.mask, 0, 0);
  t.ctx.restore();
  pushHistory(); render(); refreshLayers();
}

/* ---------- modal dialogs ---------- */
let modalCancel = null;
function openModal({ title, body, buttons, onCancel }) {
  $('mTitle').textContent = title;
  const b = $('mBody'); b.innerHTML = ''; b.appendChild(body);
  const f = $('mFoot'); f.innerHTML = '';
  buttons.forEach(bt => {
    const btn = document.createElement('button');
    btn.textContent = bt.label;
    if (bt.primary) btn.className = 'pri';
    btn.onclick = bt.onClick;
    f.appendChild(btn);
  });
  modalCancel = onCancel || null;
  $('modal').classList.add('on');
}
function closeModal() {
  $('modal').classList.remove('on');
  modalCancel = null;
}
function dismissModal() {
  const c = modalCancel;
  closeModal();
  if (c) c();
}
$('mClose').onclick = dismissModal;
$('modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') dismissModal(); });

const PRESETS = [
  { v: '1280x800', label: 'مخصص 1280×800' },
  { v: '1920x1080', label: 'Full HD 1920×1080' },
  { v: '1080x1080', label: 'مربع 1080×1080' },
  { v: '1080x1920', label: 'ستوري 1080×1920' },
  { v: '2480x3508', label: 'A4 (300dpi)' },
  { v: '512x512', label: 'أيقونة 512×512' }
];

function newDocDialog() {
  const body = document.createElement('div');
  body.className = 'ctrls';
  const pre = document.createElement('select');
  PRESETS.forEach(p => pre.add(new Option(p.label, p.v)));
  const preRow = document.createElement('div'); preRow.className = 'crow';
  preRow.innerHTML = '<span>المقاس</span>'; preRow.appendChild(pre);

  const w = numRow('العرض (px)', 1280), h = numRow('الارتفاع (px)', 800);
  const bg = document.createElement('select');
  [['transparent', 'شفاف'], ['#ffffff', 'أبيض'], ['#000000', 'أسود']].forEach(([v, l]) => bg.add(new Option(l, v)));
  const bgRow = document.createElement('div'); bgRow.className = 'crow';
  bgRow.innerHTML = '<span>الخلفية</span>'; bgRow.appendChild(bg);

  pre.onchange = () => {
    const [pw, ph] = pre.value.split('x');
    w.input.value = pw; h.input.value = ph;
  };
  body.append(preRow, w.row, h.row, bgRow);
  openModal({
    title: 'مستند جديد', body,
    buttons: [
      { label: 'إلغاء', onClick: closeModal },
      { label: 'إنشاء', primary: true, onClick: () => {
        const nw = clamp(+w.input.value | 0, 1, 8000), nh = clamp(+h.input.value | 0, 1, 8000);
        const b = bg.value === 'transparent' ? null : bg.value;
        closeModal();
        newTab(nw, nh, b, 'Untitled ' + (state.docs.length + 1));
      } }
    ]
  });
}
function newTabDialog() { newDocDialog(); }

function showShortcuts() {
  const body = document.createElement('div');
  body.className = 'ctrls shortcuts';
  body.innerHTML = `
    <p><b>الأدوات:</b> V نقل · M تحديد مستطيل · L لاسو · W تحديد سريع · C قص · B فرشاة · E ممحاة · S ختم · G تدرج · K دلو · T نص · P قلم · I قطارة · H يد · Z تكبير</p>
    <p><b>عام:</b> Ctrl+Z تراجع · Ctrl+Shift+Z إعادة · Ctrl+N جديد · Ctrl+O فتح · Ctrl+S حفظ · Ctrl+J تكرار · Ctrl+A تحديد الكل · Ctrl+D إلغاء التحديد</p>
    <p><b>العرض:</b> Ctrl+0 ملاءمة · Ctrl+= تكبير · Ctrl+- تصغير · عجلة الفأرة للتكبير · Space + سحب للتحريك</p>
    <p><b>القص والقلم:</b> Enter للتطبيق · Esc للإلغاء · نقر مزدوج لإنهاء القلم</p>`;
  openModal({ title: 'اختصارات لوحة المفاتيح', body, buttons: [{ label: 'إغلاق', primary: true, onClick: closeModal }] });
}

/* ---------- menus ---------- */
const MENUS = [
  { label: 'File', items: [
    { label: 'جديد…', key: 'Ctrl+N', fn: newDocDialog },
    { label: 'فتح صورة…', key: 'Ctrl+O', fn: openFileDialog },
    { label: 'فتح مشروع…', fn: () => $('projIn').click() },
    { sep: 1 },
    { label: 'حفظ المشروع', key: 'Ctrl+S', fn: () => saveProject(false) },
    { label: 'حفظ باسم…', fn: () => saveProject(true) },
    { sep: 1 },
    { label: 'تصدير PNG', key: 'Ctrl+Shift+E', fn: () => exportAs('png') },
    { label: 'تصدير JPG', fn: () => exportAs('jpg') },
    { label: 'تصدير WebP', fn: () => exportAs('webp') }
  ]},
  { label: 'Edit', items: [
    { label: 'تراجع', key: 'Ctrl+Z', fn: undo },
    { label: 'إعادة', key: 'Ctrl+Shift+Z', fn: redo },
    { sep: 1 },
    { label: 'تحويل الطبقة…', fn: layerTransformDialog },
    { label: 'حذف المحتوى المحدد', key: 'Del', fn: deleteSelectionContent }
  ]},
  { label: 'Image', items: [
    { label: 'حجم الصورة…', fn: imageSizeDialog },
    { label: 'حجم اللوحة…', fn: canvasSizeDialog },
    { sep: 1 },
    { label: 'تدوير 90° مع الساعة', fn: () => rotateDoc(90) },
    { label: 'تدوير 90° عكس الساعة', fn: () => rotateDoc(-90) },
    { label: 'قلب أفقي للمستند', fn: () => flipDoc(true) },
    { label: 'قلب عمودي للمستند', fn: () => flipDoc(false) },
    { sep: 1 },
    { label: 'تطبيق القص', key: 'Enter', fn: applyCrop },
    { label: 'إلغاء القص', key: 'Esc', fn: cancelCrop }
  ]},
  { label: 'Layer', items: [
    { label: 'طبقة جديدة', key: 'Ctrl+Shift+N', fn: addLayer },
    { label: 'مجموعة جديدة', fn: addGroup },
    { label: 'تكرار الطبقة', key: 'Ctrl+J', fn: duplicateLayer },
    { label: 'حذف الطبقة', fn: deleteLayer },
    { label: 'إعادة تسمية…', fn: renameLayer },
    { sep: 1 },
    { label: 'نقل للأعلى', fn: () => moveLayer(1) },
    { label: 'نقل للأسفل', fn: () => moveLayer(-1) },
    { label: 'دمج مع ما تحتها', fn: mergeDown },
    { label: 'تسطيح الكل', fn: flattenAll },
    { sep: 1 },
    { label: 'إضافة قناع', fn: addMask },
    { label: 'حذف القناع', fn: removeMask },
    { label: 'تحرير القناع (تبديل)', fn: toggleMaskEdit },
    { sep: 1 },
    { label: 'قلب أفقي للطبقة', fn: () => flipLayer(true) },
    { label: 'قلب عمودي للطبقة', fn: () => flipLayer(false) },
    { label: 'تعديل النص…', fn: editTextLayer }
  ]},
  { label: 'Select', items: [
    { label: 'تحديد الكل', key: 'Ctrl+A', fn: selectAll },
    { label: 'إلغاء التحديد', key: 'Ctrl+D', fn: clearSelection },
    { label: 'عكس التحديد', fn: invertSelection }
  ]},
  { label: 'Filter', items: [
    { label: 'السطوع والتباين…', fn: () => runFilter('brightness') },
    { label: 'التعريض…', fn: () => runFilter('exposure') },
    { label: 'الصبغة والتشبع…', fn: () => runFilter('hue') },
    { label: 'درجة الحرارة…', fn: () => runFilter('temperature') },
    { label: 'توازن الألوان…', fn: () => runFilter('colorBalance') },
    { label: 'المستويات…', fn: () => runFilter('levels') },
    { label: 'المنحنيات…', fn: openCurves },
    { sep: 1 },
    { label: 'طمس غاوسي…', fn: () => runFilter('gaussianBlur') },
    { label: 'تحديد الحواف…', fn: () => runFilter('sharpen') },
    { label: 'ضوضاء…', fn: () => runFilter('noise') },
    { label: 'تدرج الرمادي', fn: () => runFilter('grayscale') },
    { label: 'عكس الألوان', fn: () => runFilter('invert') },
    { label: 'تظليل الحواف…', fn: () => runFilter('vignette') }
  ]},
  { label: 'View', items: [
    { label: 'ملاءمة للشاشة', key: 'Ctrl+0', fn: resetView },
    { label: 'تكبير', key: 'Ctrl+=', fn: () => zoomAt(1.25) },
    { label: 'تصغير', key: 'Ctrl+-', fn: () => zoomAt(0.8) },
    { label: '100%', fn: () => { state.zoom = 1; applyTransform(); } },
    { sep: 1 },
    { label: 'إظهار/إخفاء اللوحة الجانبية', fn: togglePanel },
    { label: 'الوضع الفاتح/الداكن', fn: toggleTheme }
  ]},
  { label: 'Window', items: [
    { label: 'مستند جديد (تبويب)', fn: newDocDialog },
    { label: 'إغلاق التبويب الحالي', fn: () => closeTab(state.docIndex) }
  ]},
  { label: 'Help', items: [
    { label: 'اختصارات لوحة المفاتيح', fn: showShortcuts },
    { label: 'حول التطبيق', fn: () => toast('Photo Studio — تطبيق مستقل، غير تابع لـ Adobe') }
  ]}
];

function buildMenus() {
  const bar = $('menubar');
  bar.innerHTML = '';
  MENUS.forEach(m => {
    const top = document.createElement('div');
    top.className = 'm';
    top.textContent = m.label;
    const dd = document.createElement('div');
    dd.className = 'dd';
    m.items.forEach(it => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; dd.appendChild(s); return; }
      const row = document.createElement('div');
      row.innerHTML = `${esc(it.label)}${it.key ? `<span>${esc(it.key)}</span>` : ''}`;
      row.onclick = e => { e.stopPropagation(); closeMenus(); it.fn(); };
      dd.appendChild(row);
    });
    top.appendChild(dd);
    top.onclick = e => {
      e.stopPropagation();
      const open = top.classList.contains('open');
      closeMenus();
      if (!open) top.classList.add('open');
    };
    top.onmouseenter = () => { if (document.querySelector('#menubar .m.open')) { closeMenus(); top.classList.add('open'); } };
    bar.appendChild(top);
  });
  const t = document.createElement('div');
  t.className = 'title';
  t.id = 'appTitle';
  t.textContent = 'Photo Studio';
  bar.appendChild(t);
}
function closeMenus() { document.querySelectorAll('#menubar .m.open').forEach(m => m.classList.remove('open')); }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menubar')) closeMenus(); hideCtx(); });

/* ---------- tool rail ---------- */
function buildTools() {
  const box = $('tools');
  box.innerHTML = '';
  TOOL_LIST.forEach(t => {
    const d = document.createElement('div');
    d.className = 'tool' + (state.tool === t.id ? ' on' : '');
    d.dataset.tip = `${t.name} (${t.key})`;
    d.textContent = t.icon;
    d.onclick = () => setTool(t.id);
    box.appendChild(d);
  });
}

/* ---------- options bar ---------- */
function buildOpts() {
  const bar = $('opts');
  const t = TOOL_LIST.find(x => x.id === state.tool);
  const bounded = (id, label, min, max, val) =>
    `${label} <input type="number" id="${id}" min="${min}" max="${max}" value="${OPT[id] ?? val}">`;
  let html = `<span class="tname">${esc(t ? t.name : '')}</span>`;

  switch (state.tool) {
    case 'brush': case 'eraser':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('brushAlpha', 'الشفافية %', 1, 100, 100);
      break;
    case 'clone':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('brushAlpha', 'الشفافية %', 1, 100, 100);
      html += `<button id="cloneArm">${state.cloneArm ? 'انقر على المصدر…' : 'تحديد المصدر'}</button>`;
      html += `<span class="hint">${state.cloneSrc ? 'المصدر محدد' : 'لم يُحدد المصدر'}</span>`;
      break;
    case 'quick': case 'bucket':
      html += bounded('tolerance', 'التسامح', 0, 255, 32);
      break;
    case 'text':
      html += bounded('textSize', 'الحجم', 6, 400, 48);
      html += `<span class="hint">انقر على اللوحة لإضافة نص</span>`;
      break;
    case 'pen':
      html += bounded('brushSize', 'سُمك الخط', 1, 200, 12);
      html += `<button id="penDone">إنهاء المسار</button><button id="penCancel">إلغاء</button>`;
      break;
    case 'crop':
      if (state.crop) html += `<button id="cropApply" class="pri">تطبيق (Enter)</button><button id="cropCancel">إلغاء (Esc)</button>`;
      else html += `<span class="hint">اسحب لتحديد منطقة القص</span>`;
      break;
    case 'zoom':
      html += `<button id="zoomOutToggle" class="${state.zoomOut ? 'on' : ''}">تصغير</button>`;
      break;
    case 'marquee': case 'lasso': case 'quick':
      html += `<button id="selAll">الكل</button><button id="selNone">إلغاء التحديد</button><button id="selInv">عكس</button>`;
      break;
    case 'move':
      html += `<span class="hint">اسحب الطبقة، أو المحدد إن وُجد</span>`;
      break;
    default:
      break;
  }

  html += `<span class="sp"></span>
    <span class="colors">
      <input type="color" id="fgColor" value="${state.fg}" title="لون المقدمة">
      <input type="color" id="bgColor" value="${state.bg}" title="لون الخلفية">
      <button id="swapColors" title="تبديل الألوان">⇄</button>
    </span>
    <span id="zoomInfo">${Math.round(state.zoom * 100)}%</span>
    <button id="fitBtn">ملاءمة</button>
    <button id="panelBtn" class="mobileOnly">الطبقات</button>`;
  bar.innerHTML = html;
  bindOpts();
}

function syncColors() {
  const f = $('fgColor'), b = $('bgColor');
  if (f) f.value = state.fg;
  if (b) b.value = state.bg;
}

function bindOpts() {
  ['brushSize', 'brushAlpha', 'tolerance', 'textSize'].forEach(id => {
    const e = $(id); if (!e) return;
    e.oninput = () => { OPT[id] = parseFloat(e.value) || OPT[id]; };
  });
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on('cloneArm', () => { state.cloneArm = !state.cloneArm; buildOpts(); toast(state.cloneArm ? 'انقر على نقطة المصدر' : 'أُلغي'); });
  on('penDone', commitPen);
  on('penCancel', cancelPen);
  on('cropApply', applyCrop);
  on('cropCancel', cancelCrop);
  on('zoomOutToggle', () => { state.zoomOut = !state.zoomOut; buildOpts(); });
  on('selAll', selectAll);
  on('selNone', clearSelection);
  on('selInv', invertSelection);
  on('fitBtn', resetView);
  on('panelBtn', togglePanel);
  on('swapColors', () => { [state.fg, state.bg] = [state.bg, state.fg]; syncColors(); });
  const fg = $('fgColor'), bg = $('bgColor');
  if (fg) fg.oninput = () => { state.fg = fg.value; };
  if (bg) bg.oninput = () => { state.bg = bg.value; };
}

/* ---------- layers panel ---------- */
function thumbFor(l) {
  const tc = mkCanvas(34, 26), x = tc.getContext('2d');
  const s = Math.min(34 / state.W, 26 / state.H);
  x.drawImage(l.canvas, 0, 0, state.W * s, state.H * s);
  return tc;
}

function refreshLayers() {
  const box = $('layers');
  box.innerHTML = '';
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const l = state.layers[i];
    if (l.type !== 'group' && l.group) {
      const g = state.layers.find(x => x.id === l.group);
      if (g && g.collapsed) continue;
    }
    box.appendChild(layerRow(i));
  }
  syncLayerCtl();
  $('docInfo').textContent = `${state.W} × ${state.H} px · ${state.layers.filter(isRaster).length} layers`;
  $('appTitle') && ($('appTitle').textContent = 'Photo Studio');
  updateTitle();
  if (window.renderTabs) renderTabs();
}

function layerRow(i) {
  const l = state.layers[i];
  const row = document.createElement('div');
  row.className = 'layer' + (i === state.active ? ' sel' : '') + (l.group ? ' child' : '') + (l.type === 'group' ? ' grp' : '');
  row.draggable = true;

  const eye = document.createElement('span');
  eye.className = 'eye';
  eye.textContent = l.visible ? '◉' : '○';
  eye.title = 'إظهار / إخفاء';
  eye.onclick = e => { e.stopPropagation(); toggleVisibility(i); };
  row.appendChild(eye);

  if (l.type === 'group') {
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.textContent = l.collapsed ? '▸' : '▾';
    caret.onclick = e => { e.stopPropagation(); l.collapsed = !l.collapsed; refreshLayers(); };
    row.appendChild(caret);
  } else {
    const th = document.createElement('div');
    th.className = 'thumb';
    th.appendChild(thumbFor(l));
    row.appendChild(th);
  }

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = (l.type === 'group' ? '📁 ' : '') + l.name;
  row.appendChild(name);

  const badges = [];
  if (l.type === 'text') badges.push('T');
  if (l.mask) badges.push(state.maskEdit && i === state.active ? '▣*' : '▣');
  if (l.locked) badges.push('🔒');
  if (badges.length) {
    const b = document.createElement('span');
    b.className = 'badges';
    b.textContent = badges.join(' ');
    row.appendChild(b);
  }

  row.onclick = () => { state.active = i; state.maskEdit = state.maskEdit && !!l.mask; refreshLayers(); };
  row.ondblclick = () => { state.active = i; l.type === 'text' ? editTextLayer() : renameLayer(); };
  row.oncontextmenu = e => {
    e.preventDefault();
    state.active = i; refreshLayers();
    showCtx(e.clientX, e.clientY, layerMenuItems(i));
  };

  row.ondragstart = e => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; };
  row.ondragover = e => { e.preventDefault(); row.classList.add('dropT'); };
  row.ondragleave = () => row.classList.remove('dropT');
  row.ondrop = e => {
    e.preventDefault();
    row.classList.remove('dropT');
    const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(from) || from === i) return;
    const target = state.layers[i];
    if (target.type === 'group') { setGroupOf(from, target.id); return; }
    const [m] = state.layers.splice(from, 1);
    const to = from < i ? i - 1 : i;
    state.layers.splice(to, 0, m);
    m.group = target.group;
    state.active = to;
    pushHistory(); render(); refreshLayers();
  };
  return row;
}

function syncLayerCtl() {
  const l = cur();
  if (!l) return;
  const isR = isRaster(l);
  $('opacity').value = Math.round(l.opacity * 100);
  $('opVal').textContent = Math.round(l.opacity * 100) + '%';
  $('blend').value = l.blend || 'source-over';
  $('opacity').disabled = $('blend').disabled = !isR;
}
function setOpacity(v) {
  const l = cur(); if (!l) return;
  l.opacity = v / 100;
  $('opVal').textContent = v + '%';
  render();
}
function commitOpacity() { pushHistory(); }
function setBlend(v) {
  const l = cur(); if (!l) return;
  l.blend = v; pushHistory(); render(); refreshLayers();
}

/* ---------- context menus ---------- */
function showCtx(x, y, items) {
  const m = $('ctx');
  m.innerHTML = '';
  items.forEach(it => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; m.appendChild(s); return; }
    const r = document.createElement('div');
    r.textContent = it.label;
    r.onclick = e => { e.stopPropagation(); hideCtx(); it.fn(); };
    m.appendChild(r);
  });
  m.style.display = 'block';
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, window.innerWidth - w - 6) + 'px';
  m.style.top = Math.min(y, window.innerHeight - h - 6) + 'px';
}
function hideCtx() { $('ctx').style.display = 'none'; }

function layerMenuItems(i) {
  const l = state.layers[i];
  const items = [
    { label: 'تكرار الطبقة', fn: duplicateLayer },
    { label: 'إعادة تسمية…', fn: renameLayer },
    { label: 'دمج مع ما تحتها', fn: mergeDown },
    { sep: 1 },
    { label: 'طبقة جديدة', fn: addLayer },
    { label: 'مجموعة جديدة', fn: addGroup },
    { label: l.mask ? 'حذف القناع' : 'إضافة قناع', fn: l.mask ? removeMask : addMask },
    { label: 'قلب أفقي', fn: () => flipLayer(true) },
    { sep: 1 },
    { label: 'حذف', fn: deleteLayer }
  ];
  if (l.type === 'text') items.unshift({ label: 'تعديل النص…', fn: editTextLayer });
  if (l.type !== 'group' && state.layers.find(g => g.type === 'group')) {
    items.push({ sep: 1 });
    state.layers.filter(g => g.type === 'group').forEach(g =>
      items.push({ label: `نقل إلى «${g.name}»`, fn: () => setGroupOf(i, g.id) }));
    if (l.group) items.push({ label: 'إخراج من المجموعة', fn: () => setGroupOf(i, null) });
  }
  return items;
}

function stageMenuItems() {
  const items = [
    { label: 'تحديد الكل', fn: selectAll },
    { label: 'إلغاء التحديد', fn: clearSelection },
    { label: 'حذف المحتوى المحدد', fn: deleteSelectionContent },
    { sep: 1 },
    { label: 'تحويل الطبقة…', fn: layerTransformDialog },
    { label: 'تكرار الطبقة', fn: duplicateLayer },
    { label: 'طبقة جديدة', fn: addLayer },
    { sep: 1 },
    { label: 'ملاءمة للشاشة', fn: resetView },
    { label: 'تكبير', fn: () => zoomAt(1.25) },
    { label: 'تصغير', fn: () => zoomAt(0.8) }
  ];
  return items;
}

$('stage').addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!state.layers.length) return;
  showCtx(e.clientX, e.clientY, stageMenuItems());
});

/* ---------- panels ---------- */
function togglePanel() {
  if (window.matchMedia('(max-width: 820px)').matches) $('side').classList.toggle('open');
  else $('ws').classList.toggle('hidePanel');
  setTimeout(resetView, 280);
}

/* resizable side panel (desktop) */
(function initResizer() {
  const rz = $('resizer');
  let startX = 0, startW = 0, active = false;
  rz.addEventListener('pointerdown', e => {
    active = true; startX = e.clientX;
    startW = $('side').getBoundingClientRect().width;
    rz.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  rz.addEventListener('pointermove', e => {
    if (!active) return;
    const w = clamp(startW - (e.clientX - startX), 200, 420);
    document.documentElement.style.setProperty('--side-w', w + 'px');
  });
  const end = () => { active = false; document.body.classList.remove('resizing'); };
  rz.addEventListener('pointerup', end);
  rz.addEventListener('pointercancel', end);
})();

/* ---------- theme ---------- */
function applyTheme() {
  const light = localStorage.getItem('ps-theme') === 'light';
  document.body.classList.toggle('light', light);
}
function toggleTheme() {
  const light = !document.body.classList.contains('light');
  document.body.classList.toggle('light', light);
  try { localStorage.setItem('ps-theme', light ? 'light' : 'dark'); } catch (e) {}
}

/* ---------- document tabs ---------- */
function renderTabs() {
  const bar = $('tabs');
  if (!bar) return;
  bar.innerHTML = '';
  state.docs.forEach((d, i) => {
    if (!d && i !== state.docIndex) return;
    const name = i === state.docIndex ? state.docName : d.name;
    const t = document.createElement('div');
    t.className = 'tab' + (i === state.docIndex ? ' on' : '');
    t.innerHTML = `<span>${esc(name)}</span><b title="إغلاق">×</b>`;
    t.onclick = () => switchDoc(i);
    t.querySelector('b').onclick = e => { e.stopPropagation(); closeTab(i); };
    bar.appendChild(t);
  });
  const add = document.createElement('div');
  add.className = 'tab add';
  add.textContent = '+';
  add.title = 'مستند جديد';
  add.onclick = newDocDialog;
  bar.appendChild(add);
}

/* ---------- keyboard shortcuts ---------- */
const TOOL_KEYS = {};
TOOL_LIST.forEach(t => TOOL_KEYS[t.key.toLowerCase()] = t.id);

window.addEventListener('keydown', e => {
  if ($('modal').classList.contains('on')) {
    if (e.key === 'Escape') dismissModal();
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (ctrl) {
    const map = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: redo, n: () => (e.shiftKey ? addLayer() : newDocDialog()),
      o: openFileDialog, s: () => saveProject(false),
      a: selectAll, d: clearSelection, j: duplicateLayer, g: addGroup,
      '0': resetView, '=': () => zoomAt(1.25), '+': () => zoomAt(1.25), '-': () => zoomAt(0.8)
    };
    if (k === 'e' && e.shiftKey) { e.preventDefault(); return exportAs('png'); }
    if (map[k]) { e.preventDefault(); map[k](); }
    return;
  }

  if (e.key === ' ') { e.preventDefault(); state.spaceDown = true; return; }
  if (e.key === 'Enter') {
    if (state.crop) { e.preventDefault(); return applyCrop(); }
    if (state.pen) { e.preventDefault(); return commitPen(); }
  }
  if (e.key === 'Escape') {
    if (state.crop) return cancelCrop();
    if (state.pen) return cancelPen();
    if (state.sel) return clearSelection();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.sel) { e.preventDefault(); deleteSelectionContent(); }
    return;
  }
  if (TOOL_KEYS[k]) setTool(TOOL_KEYS[k]);
});
window.addEventListener('keyup', e => { if (e.key === ' ') state.spaceDown = false; });
window.addEventListener('blur', () => { state.spaceDown = false; });

/* ---------- drag & drop image files onto the window ---------- */
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; $('dropHint').classList.add('on'); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropHint').classList.remove('on'); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('dropHint').classList.remove('on');
  const files = [...e.dataTransfer.files];
  if (files.length && files[0].name.endsWith('.json')) return openProjectFile(files[0]);
  importFiles(files);
});

/* ---------- status / coords ---------- */
window.addEventListener('resize', () => { if (state.layers.length) resetView(); });

/* ---------- init ---------- */
(function init() {
  applyTheme();
  buildMenus();
  buildTools();
  newDoc(1280, 800, null, 'Untitled 1');
  state.docs = [captureDoc()];
  state.docIndex = 0;
  setTool('move');
  renderTabs();
  resetView();
  refreshLayers();
})();
