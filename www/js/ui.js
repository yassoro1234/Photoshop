/* ===== UI: menus, tool rail, options bar, layers panel, dialogs, shortcuts, settings ===== */

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
  const t0 = strokeTarget();
  if (!t0 || !state.sel) return toast(t('لا يوجد تحديد'));
  if (curRaster().locked) return toast(t('الطبقة مقفلة'));
  t0.ctx.save();
  t0.ctx.globalCompositeOperation = 'destination-out';
  t0.ctx.drawImage(state.sel.mask, 0, 0);
  t0.ctx.restore();
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

function presetDefs() {
  return [
    { v: '1280x800', label: t('مخصص 1280×800') },
    { v: '1920x1080', label: t('Full HD 1920×1080') },
    { v: '1080x1080', label: t('مربع 1080×1080') },
    { v: '1080x1920', label: t('ستوري 1080×1920') },
    { v: '2480x3508', label: t('A4 (300dpi)') },
    { v: '512x512', label: t('أيقونة 512×512') }
  ];
}

function showShortcuts() {
  const body = document.createElement('div');
  body.className = 'ctrls shortcuts';
  [
    'Tools: V Move · M Marquee · L Lasso · W Quick Selection · C Crop · B Brush · E Eraser · S Clone · G Gradient · K Bucket · T Text · P Pen · I Eyedropper · H Hand · Z Zoom',
    'General: Ctrl+Z Undo · Ctrl+Shift+Z Redo · Ctrl+N New · Ctrl+O Open · Ctrl+S Save · Ctrl+J Duplicate · Ctrl+A Select all · Ctrl+D Deselect',
    'View: Ctrl+0 Fit · Ctrl+= Zoom in · Ctrl+- Zoom out · mouse wheel to zoom · Space + drag to pan',
    'Crop & pen: Enter to apply · Esc to cancel · double-click to finish the pen path'
  ].forEach(line => {
    const p = document.createElement('p');
    p.textContent = t(line);
    body.appendChild(p);
  });
  openModal({ title: t('اختصارات لوحة المفاتيح'), body, buttons: [{ label: t('إغلاق'), primary: true, onClick: closeModal }] });
}

/* ---------- settings: language and theme ---------- */
/* Re-render every piece of text after a language change */
function applyAllText() {
  document.documentElement.lang = LANG;
  applyStatic();
  buildMenus();
  buildTools();
  buildOpts();
  refreshLayers();
  renderTabs();
  refreshHomeIfOpen();
  updateTitle();
}

/* ---------- menus ---------- */
function menuDefs() {
  return [
    { label: 'File', items: [
      { label: 'الصفحة الرئيسية', fn: showHome },
      { label: 'جديد…', key: 'Ctrl+N', fn: openNewProjectDialog },
      { label: 'فتح صورة…', key: 'Ctrl+O', fn: openFileDialog },
      { label: 'فتح مشروع…', fn: () => $('projIn').click() },
      { sep: 1 },
      { label: 'حفظ المشروع', key: 'Ctrl+S', fn: () => saveProject(false) },
      { label: 'حفظ باسم…', fn: () => saveProject(true) },
      { label: 'تصدير ملف المشروع…', fn: exportProjectFile },
      { label: 'إرسال إلى Animation Studio', fn: sendToAnimation },
      { sep: 1 },
      { label: 'تصدير PNG', key: 'Ctrl+Shift+E', fn: () => exportAs('png') },
      { label: 'تصدير JPG', fn: () => exportAs('jpg') },
      { label: 'تصدير WebP', fn: () => exportAs('webp') },
      { sep: 1 },
      { label: 'الإعدادات…', fn: openSettings }
    ]},
    { label: 'Edit', items: [
      { label: 'تراجع', key: 'Ctrl+Z', fn: undo },
      { label: 'إعادة', key: 'Ctrl+Shift+Z', fn: redo },
      { sep: 1 },
      { label: 'تحويل حر', key: 'Ctrl+T', fn: freeTransformCurrent },
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
      { label: 'دمج المرئية', fn: mergeVisible },
      { label: 'قص للطبقة السفلية', fn: toggleClip },
      { label: 'فك المجموعة', fn: ungroup },
      { label: 'طبقة تعديل…', fn: () => adjustLayerMenu(innerWidth / 2 - 110, innerHeight / 3) },
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
      { label: 'تظليل الحواف…', fn: () => runFilter('vignette') },
      { sep: 1 },
      { label: 'طمس صندوقي…', fn: () => runFilter('boxBlur') },
      { label: 'طمس الحركة…', fn: () => runFilter('motionBlur') },
      { label: 'طمس دوراني…', fn: () => runFilter('radialBlur') },
      { label: 'تحديد حاد (قناع غير حاد)…', fn: () => runFilter('unsharp') },
      { label: 'تقليل الضوضاء…', fn: () => runFilter('reduceNoise') },
      { label: 'تمرير عالٍ…', fn: () => runFilter('highPass') },
      { label: 'إزاحة…', fn: () => runFilter('offset') },
      { label: 'موجة…', fn: () => runFilter('wave') },
      { label: 'تموج…', fn: () => runFilter('ripple') },
      { label: 'دوامة…', fn: () => runFilter('twirl') },
      { label: 'كروي…', fn: () => runFilter('spherize') },
      { label: 'ضغط…', fn: () => runFilter('pinch') }
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
      { label: 'مستند جديد (تبويب)', fn: openNewProjectDialog },
      { label: 'إغلاق التبويب الحالي', fn: () => closeTab(state.docIndex) }
    ]},
    { label: 'Help', items: [
      { label: 'اختصارات لوحة المفاتيح', fn: showShortcuts },
      { label: 'حول التطبيق', fn: () => toast(t('Photo Studio is an independent app, not affiliated with Adobe.')) }
    ]}
  ];
}

function buildMenus() {
  const bar = $('menubar');
  bar.innerHTML = '';
  menuDefs().forEach(m => {
    const top = document.createElement('div');
    top.className = 'm';
    top.textContent = t(m.label);
    const dd = document.createElement('div');
    dd.className = 'dd';
    m.items.forEach(it => {
      if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; dd.appendChild(s); return; }
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = t(it.label);
      row.appendChild(label);
      if (it.key) {
        const k = document.createElement('span');
        k.textContent = it.key;
        row.appendChild(k);
      }
      row.onclick = e => { e.stopPropagation(); closeMenus(); it.fn(); };
      dd.appendChild(row);
    });
    top.appendChild(dd);
    top.onclick = e => {
      e.stopPropagation();
      const open = top.classList.contains('open');
      closeMenus();
      if (!open) { top.classList.add('open'); placeDropdown(top); }
    };
    top.onmouseenter = () => { if (document.querySelector('#menubar .m.open')) { closeMenus(); top.classList.add('open'); placeDropdown(top); } };
    bar.appendChild(top);
  });

  const title = document.createElement('div');
  title.className = 'title';
  title.id = 'appTitle';
  title.textContent = 'CREATIVE STUDIO';
  bar.appendChild(title);

  const gear = document.createElement('button');
  gear.className = 'gear';
  gear.title = t('Settings');
  gear.textContent = '⚙';
  gear.onclick = e => { e.stopPropagation(); closeMenus(); openSettings(); };
  const homeBtn = document.createElement('button');
  homeBtn.className = 'gear';
  homeBtn.title = t('الصفحة الرئيسية');
  homeBtn.setAttribute('aria-label', t('الصفحة الرئيسية'));
  homeBtn.textContent = '⌂';
  homeBtn.onclick = e => { e.stopPropagation(); closeMenus(); showHome(); };
  bar.append(homeBtn, gear);
}
function closeMenus() { document.querySelectorAll('#menubar .m.open').forEach(m => m.classList.remove('open')); }
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menubar')) closeMenus(); hideCtx(); });

/* ---------- tool rail ---------- */
function buildTools() {
  const box = $('tools');
  box.innerHTML = '';
  TOOL_LIST.forEach(tl => {
    const d = document.createElement('div');
    d.className = 'tool' + (state.tool === tl.id ? ' on' : '');
    d.dataset.tip = `${t(tl.name)} (${tl.key})`;
    if (tl.img) d.innerHTML = `<img src="icons/${tl.img}" alt="">`;
    else d.textContent = tl.icon;
    d.onclick = () => setTool(tl.id);
    box.appendChild(d);
  });
  box.appendChild(makeSwatches());
  renderSwatches();   // the swatch squares need to be in the document before they can be colored
}

/* ---------- options bar ---------- */
function buildOpts() {
  const bar = $('opts');
  const tl = TOOL_LIST.find(x => x.id === state.tool);
  const bounded = (id, label, min, max, val) =>
    `<span>${esc(t(label))}</span> <input type="number" id="${id}" min="${min}" max="${max}" value="${OPT[id] ?? val}">`;
  const btn = (id, label, cls) => `<button id="${id}"${cls ? ` class="${cls}"` : ''}>${esc(t(label))}</button>`;
  const hint = label => `<span class="hint">${esc(t(label))}</span>`;

  let html = `<span class="tname">${esc(tl ? t(tl.name) : '')}</span>`;

  if (state.maskEdit) {
    html += `<span class="modeBanner">${esc(t('Mask editing: white reveals, black hides'))}
      ${btn('exitMask', 'Exit mask editing', 'pri')}</span>`;
  }

  switch (state.tool) {
    case 'pencil':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('brushAlpha', 'الشفافية %', 1, 100, 100);
      break;
    case 'colorrep':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('tolerance', 'التسامح', 0, 255, 32);
      html += bounded('retStrength', 'القوة %', 1, 100, 50);
      html += hint('اضغط على اللون المراد استبداله ثم اطلِ فوقه');
      break;
    case 'heal':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('retStrength', 'القوة %', 1, 100, 50);
      html += hint('اطلِ فوق البقعة: يُملأ مكانها من محيطها مع الحفاظ على الملمس');
      break;
    case 'patch':
      html += hint('ارسم تحديداً ثم اسحبه داخله إلى منطقة المصدر ليأخذ محتواها');
      break;
    case 'blur': case 'sharpen': case 'smudge': case 'dodge': case 'burn': case 'sponge': {
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('retStrength', 'القوة %', 1, 100, 50);
      if (state.tool === 'dodge' || state.tool === 'burn') {
        html += `<span>${esc(t('النطاق'))}</span> <select id="retRange">${[['mid', 'متوسطات'], ['shadow', 'ظلال'], ['high', 'مناطق مضيئة'], ['all', 'الكل']].map(([v, lab]) =>
          `<option value="${v}"${(OPT.retRange ?? 'mid') === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      }
      if (state.tool === 'sponge') {
        html += `<span>${esc(t('الوضع'))}</span> <select id="retSponge">${[['sat', 'تشبع'], ['desat', 'إزالة تشبع']].map(([v, lab]) =>
          `<option value="${v}"${(OPT.retSponge ?? 'sat') === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      }
      break;
    }
    case 'brush': case 'eraser':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('brushAlpha', 'الشفافية %', 1, 100, 100);
      break;
    case 'clone':
      html += bounded('brushSize', 'الحجم', 1, 400, 12);
      html += bounded('brushAlpha', 'الشفافية %', 1, 100, 100);
      html += btn('cloneArm', state.cloneArm ? 'انقر على المصدر…' : 'تحديد المصدر');
      html += hint(state.cloneSrc ? 'المصدر محدد' : 'لم يُحدد المصدر');
      break;
    case 'quick': {
      const modes = [['new', 'جديد'], ['add', 'إضافة'], ['subtract', 'طرح'], ['intersect', 'تقاطع']];
      html += bounded('brushSize', 'الحجم', 1, 400, 12) + bounded('tolerance', 'التسامح', 0, 255, 32);
      html += `<span>${esc(t('الوضع'))}</span> <select id="selMode">${modes.map(([v, lab]) =>
        `<option value="${v}"${(OPT.selMode ?? 'new') === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      html += hint('ارسم فوق المنطقة: تُضاف البكسلات المتشابهة في اللون');
      html += btn('selAll', 'الكل') + btn('selNone', 'إلغاء التحديد') + btn('selInv', 'عكس') + btn('refineEdge', 'تحسين الحواف');
      break;
    }
    case 'bucket':
      html += bounded('tolerance', 'التسامح', 0, 255, 32);
      break;
    case 'text':
      html += bounded('textSize', 'الحجم', 6, 400, 48);
      html += btn('textProps', 'خصائص النص');
      html += hint('انقر لإضافة نص، أو انقر نصاً موجوداً لتعديله');
      break;
    case 'pen': {
      html += bounded('brushSize', 'سُمك الخط', 1, 200, 12);
      const pm = OPT.penMode ?? 'stroke';
      html += `<span>${esc(t('الوضع'))}</span> <select id="penMode">${[['stroke', 'حد'], ['fill', 'تعبئة'], ['both', 'حد وتعبئة']].map(([v, lab]) =>
        `<option value="${v}"${pm === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      html += btn('penClose', 'إغلاق المسار') + btn('penDone', 'إنهاء المسار') + btn('penCancel', 'إلغاء');
      break;
    }
    case 'shape': {
      html += `<span>${esc(t('الشكل'))}</span> <select id="shapeKind">${[['rect', 'مستطيل'], ['ellipse', 'إهليلج'], ['line', 'خط'], ['polygon', 'مضلع']].map(([v, lab]) =>
        `<option value="${v}"${(OPT.shapeKind || 'rect') === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      html += `<label>${esc(t('لون'))} <input type="color" id="shapeColor" value="${OPT.shapeColor || '#3a6ea5'}"></label>`;
      html += bounded('sides', 'الأضلاع', 3, 12, 6);
      html += hint('اسحب على الطبقة لرسم الشكل. يبقى الشكل قابلاً للتعديل بعد الحفظ');
      break;
    }
    case 'crop': {
      const ratios = [['free', 'حرة'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16'], ['original', 'الأصلية']];
      html += `<span>${esc(t('النسبة'))}</span> <select id="cropRatio">${ratios.map(([v, lab]) =>
        `<option value="${v}"${(OPT.cropRatio ?? 'free') === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      if (state.crop) html += btn('cropApply', 'تطبيق (Enter)', 'pri') + btn('cropCancel', 'إلغاء (Esc)');
      else html += hint('اسحب لتحديد منطقة القص');
      break;
    }
    case 'zoom':
      html += btn('zoomOutToggle', 'تصغير', state.zoomOut ? 'on' : '');
      break;
    case 'marquee': case 'lasso': case 'wand': {
      const pick = (id, label, opts, def) => `<span>${esc(t(label))}</span> <select id="${id}">${opts.map(([v, lab]) =>
        `<option value="${v}"${(OPT[id] ?? def) === v ? ' selected' : ''}>${esc(t(lab))}</option>`).join('')}</select>`;
      const modes = [['new', 'جديد'], ['add', 'إضافة'], ['subtract', 'طرح'], ['intersect', 'تقاطع']];
      if (state.tool === 'marquee') {
        html += pick('selShape', 'الشكل', [['rect', 'مستطيل'], ['ellipse', 'إهليلج'], ['row', 'صف بكسل'], ['column', 'عمود بكسل']], 'rect');
        html += pick('selMode', 'الوضع', modes, 'new') + bounded('feather', 'تنعيم', 0, 250, 0);
      } else if (state.tool === 'lasso') {
        html += pick('lassoType', 'النوع', [['free', 'حر'], ['poly', 'متعدد الأضلاع'], ['magnetic', 'مغناطيسي']], 'free');
        html += pick('selMode', 'الوضع', modes, 'new') + bounded('feather', 'تنعيم', 0, 250, 0);
        if (polyActive()) html += btn('polyDone', 'إنهاء المضلع', 'pri') + btn('polyCancel', 'إلغاء المضلع') + hint('انقر لإضافة نقاط، وانقر البداية أو انقر مرتين للإغلاق');
      } else {
        html += bounded('tolerance', 'التسامح', 0, 255, 32);
        html += pick('wandMode', 'النطاق', [['contig', 'متصل'], ['global', 'كل الألوان المشابهة']], 'contig');
        html += pick('selMode', 'الوضع', modes, 'new') + bounded('feather', 'تنعيم', 0, 250, 0);
      }
      html += btn('selAll', 'الكل') + btn('selNone', 'إلغاء التحديد') + btn('selInv', 'عكس') + btn('refineEdge', 'تحسين الحواف');
      html += btn('selReselect', 'إعادة التحديد') + bounded('growPx', 'بكسل', 1, 100, 2) +
        btn('selExpand', 'توسيع') + btn('selContract', 'تقليص') + btn('selSmooth', 'تنعيم') + btn('selSave', 'حفظ التحديد');
      const saved = Object.keys(state.selections || {});
      if (saved.length) {
        html += `<select id="selSaved">${saved.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select>`;
        html += btn('selLoad', 'تحميل') + btn('selDelete', 'حذف');
      }
      break;
    }
    case 'eyedrop':
      html += `<span>${esc(t('العينة من'))}</span> <select id="sampleSrc">
        <option value="all"${state.sampleSrc === 'all' ? ' selected' : ''}>${esc(t('كل الطبقات'))}</option>
        <option value="layer"${state.sampleSrc === 'layer' ? ' selected' : ''}>${esc(t('الطبقة الحالية'))}</option>
      </select>`;
      html += hint('اسحب فوق الصورة لمعاينة اللون، وارفع الإصبع لاختياره');
      break;
    case 'move':
      if (state.ft) {
        html += btn('ftApply', 'تطبيق (Enter)', 'pri') + btn('ftCancel', 'إلغاء (Esc)');
        html += hint('اسحب المقابض للتحويل، والدوران من المقبض العلوي');
      } else {
        html += hint('اسحب الطبقة، أو المحدد إن وُجد · انقر مرتين للتحويل الحر');
      }
      break;
    default:
      break;
  }

  html += `<span class="sp"></span>
    <span id="zoomInfo">${Math.round(state.zoom * 100)}%</span>
    ${btn('fitBtn', 'ملاءمة')}
    <button id="panelBtn" class="mobileOnly">${esc(t('الطبقات'))}</button>`;
  bar.innerHTML = html;
  bindOpts();
}

function bindOpts() {
  ['brushSize', 'brushAlpha', 'retStrength', 'tolerance', 'textSize', 'feather', 'growPx', 'sides'].forEach(id => {
    const e = $(id); if (!e) return;
    e.oninput = () => { OPT[id] = parseFloat(e.value) || OPT[id]; };
  });
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on('exitMask', exitMaskEdit);
  on('cloneArm', () => { state.cloneArm = !state.cloneArm; buildOpts(); toast(state.cloneArm ? t('انقر على نقطة المصدر') : t('أُلغي')); });
  on('penDone', commitPen);
  on('refineEdge', refineEdgeDialog);
  on('penClose', () => { if (state.pen && state.pen.pts.length > 2) { state.pen.closed = true; commitPen(); } });
  on('penCancel', cancelPen);
  on('cropApply', applyCrop);
  on('cropCancel', cancelCrop);
  on('zoomOutToggle', () => { state.zoomOut = !state.zoomOut; buildOpts(); });
  on('selAll', selectAll);
  on('selNone', clearSelection);
  on('selInv', invertSelection);
  on('selReselect', reselect);
  on('selExpand', () => growSel(true));
  on('selContract', () => growSel(false));
  on('selSmooth', smoothSel);
  on('selSave', saveSelection);
  on('selLoad', loadSelection);
  on('selDelete', deleteSelection);
  on('polyDone', polyFinish);
  on('polyCancel', polyCancel);
  const sc = $('shapeColor'); if (sc) sc.oninput = () => { OPT.shapeColor = sc.value; };
  ['selShape', 'selMode', 'lassoType', 'wandMode', 'cropRatio', 'shapeKind', 'retRange', 'retSponge', 'penMode'].forEach(id => {
    const e = $(id); if (!e) return;
    e.onchange = () => { OPT[id] = e.value; if (id === 'lassoType') buildOpts(); };
  });
  on('fitBtn', resetView);
  on('panelBtn', togglePanel);
  on('textProps', editTextLayer);
  on('ftApply', ftCommit);
  on('ftCancel', ftCancel);
  const ss = $('sampleSrc');
  if (ss) ss.onchange = () => { state.sampleSrc = ss.value; };
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
    if (groupChain(l).some(g => g.collapsed)) continue;   // hidden while any group around it is collapsed
    box.appendChild(layerRow(i));
  }
  syncLayerCtl();
  $('docInfo').textContent = infoText(state.W, state.H, state.layers.filter(isRaster).length);
  updateTitle();
  renderTabs();
}

function layerRow(i) {
  const l = state.layers[i];
  const row = document.createElement('div');
  row.className = 'layer' + (i === state.active ? ' sel' : '') + (l.group ? ' child' : '') + (l.type === 'group' ? ' grp' : '');
  row.draggable = true;

  const eye = document.createElement('span');
  eye.className = 'eye';
  eye.textContent = l.visible ? '◉' : '○';
  eye.title = t('إظهار / إخفاء');
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
    if (l.type === 'adjust') { const ic = document.createElement('span'); ic.textContent = '◐'; th.appendChild(ic); }
    else th.appendChild(thumbFor(l));
    row.appendChild(th);
  }

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = '\u00a0'.repeat(groupChain(l).length * 3) + (l.type === 'group' ? '📁 ' : '') + (l.clip ? '↳ ' : '') + layerName(l);
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

  /* selecting a layer always leaves mask-editing mode */
  row.onclick = () => {
    if (state.maskEdit) state.maskEdit = false;
    state.active = i;
    refreshLayers();
  };
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
  const isR = isRaster(l) || isAdjust(l);
  $('opacity').value = Math.round(l.opacity * 100);
  $('opVal').textContent = Math.round(l.opacity * 100) + '%';
  $('blend').value = l.blend || 'source-over';
  $('opacity').disabled = !(isR || l.type === 'group');   // a group's opacity applies to everything inside it
  $('blend').disabled = !isR;
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
    { label: t('تكرار الطبقة'), fn: duplicateLayer },
    { label: t('إعادة تسمية…'), fn: renameLayer },
    { label: t('دمج مع ما تحتها'), fn: mergeDown },
    { label: t('قص للطبقة السفلية'), fn: toggleClip },
    { sep: 1 },
    { label: t('طبقة جديدة'), fn: addLayer },
    { label: t('مجموعة جديدة'), fn: addGroup },
    l.mask
      ? { label: t('حذف القناع'), fn: removeMask }
      : { label: t('إضافة قناع'), fn: addMask },
    { label: t('قلب أفقي'), fn: () => flipLayer(true) },
    { sep: 1 },
    { label: t('حذف'), fn: deleteLayer }
  ];
  if (l.type === 'text') items.unshift({ label: t('تعديل النص…'), fn: editTextLayer });
  if (l.type === 'adjust') items.unshift({ label: t('تعديل التعديل…'), fn: editAdjustLayer });
  if (l.type === 'shape') items.unshift({ label: t('تعديل الشكل…'), fn: editShapeLayer });
  const targets = state.layers.filter(g => g.type === 'group' && !isInside(g, l));
  if (targets.length) {
    items.push({ sep: 1 });
    targets.forEach(g =>
      items.push({ label: t('نقل إلى «{name}»', { name: layerName(g) }), fn: () => setGroupOf(i, g.id) }));
    if (l.group) items.push({ label: t('إخراج من المجموعة'), fn: () => setGroupOf(i, null) });
  }
  return items;
}

function stageMenuItems() {
  return [
    { label: t('تحديد الكل'), fn: selectAll },
    { label: t('إلغاء التحديد'), fn: clearSelection },
    { label: t('حذف المحتوى المحدد'), fn: deleteSelectionContent },
    { sep: 1 },
    { label: t('تحويل الطبقة…'), fn: layerTransformDialog },
    { label: t('تكرار الطبقة'), fn: duplicateLayer },
    { label: t('طبقة جديدة'), fn: addLayer },
    { sep: 1 },
    { label: t('ملاءمة للشاشة'), fn: resetView },
    { label: t('تكبير'), fn: () => zoomAt(1.25) },
    { label: t('تصغير'), fn: () => zoomAt(0.8) }
  ];
}

$('stage').addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!state.layers.length) return;
  showCtx(e.clientX, e.clientY, stageMenuItems());
});

/* ---------- panels ---------- */
function togglePanel() {
  if (window.matchMedia('(max-width: 820px)').matches) {
    const open = !$('side').classList.contains('open');
    $('side').classList.toggle('open', open);
    document.body.classList.toggle('panelOpen', open);
    return;
  }
  $('ws').classList.toggle('hidePanel');
  setTimeout(resetView, 280);
}

/* On phones the menu list is clipped by the scrolling menu strip, so position it fixed under the bar */
function placeDropdown(top) {
  const dd = top.querySelector('.dd');
  if (!dd || !window.matchMedia('(max-width: 820px)').matches) return;
  const r = top.getBoundingClientRect();
  const bar = $('menubar').getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.top = bar.bottom + 'px';
  dd.style.left = Math.max(4, Math.min(r.left, window.innerWidth - dd.offsetWidth - 4)) + 'px';
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
function setTheme(light) {
  document.body.classList.toggle('light', light);
  try { localStorage.setItem('ps-theme', light ? 'light' : 'dark'); } catch (e) {}
}
function applyTheme() {
  let light = false;
  try { light = localStorage.getItem('ps-theme') === 'light'; } catch (e) {}
  document.body.classList.toggle('light', light);
}
function toggleTheme() {
  setTheme(!document.body.classList.contains('light'));
}

/* ---------- document tabs ---------- */
function renderTabs() {
  const bar = $('tabs');
  if (!bar) return;
  bar.innerHTML = '';
  state.docs.forEach((d, i) => {
    if (!d && i !== state.docIndex) return;
    const name = i === state.docIndex ? state.docName : d.name;
    const tab = document.createElement('div');
    tab.className = 'tab' + (i === state.docIndex ? ' on' : '');
    const label = document.createElement('span');
    label.textContent = docLabel(name);
    const close = document.createElement('b');
    close.title = t('إغلاق');
    close.textContent = '×';
    tab.append(label, close);
    tab.onclick = () => switchDoc(i);
    close.onclick = e => { e.stopPropagation(); closeTab(i); };
    bar.appendChild(tab);
  });
  const add = document.createElement('div');
  add.className = 'tab add';
  add.textContent = '+';
  add.title = t('مستند جديد');
  add.onclick = openNewProjectDialog;
  bar.appendChild(add);
}

/* ---------- keyboard shortcuts ---------- */
const TOOL_KEYS = {};
TOOL_LIST.forEach(tl => { if (tl.key) TOOL_KEYS[tl.key.toLowerCase()] = tl.id; });

window.addEventListener('keydown', e => {
  if (ANIM.open) return;   // the animation studio handles its own keys
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
      y: redo, n: () => (e.shiftKey ? addLayer() : openNewProjectDialog()),
      o: openFileDialog, s: () => saveProject(false),
      a: selectAll, d: clearSelection, j: duplicateLayer, g: addGroup, t: freeTransformCurrent,
      '0': resetView, '=': () => zoomAt(1.25), '+': () => zoomAt(1.25), '-': () => zoomAt(0.8)
    };
    if (k === 'e' && e.shiftKey) { e.preventDefault(); return exportAs('png'); }
    if (map[k]) { e.preventDefault(); map[k](); }
    return;
  }

  if (e.key === ' ') { e.preventDefault(); state.spaceDown = true; return; }
  if (e.key === 'Enter') {
    if (state.ft) { e.preventDefault(); return ftCommit(); }
    if (state.crop) { e.preventDefault(); return applyCrop(); }
    if (state.pen) { e.preventDefault(); return commitPen(); }
  }
  if (e.key === 'Escape') {
    if (state.ft) return ftCancel();
    if (state.crop) return cancelCrop();
    if (state.pen) return cancelPen();
    if (state.maskEdit) return exitMaskEdit();
    if (state.sel) return clearSelection();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.sel) { e.preventDefault(); deleteSelectionContent(); }
    return;
  }
  if (k === 'x') return swapColors();
  if (k === 'd') return resetColors();
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

window.addEventListener('resize', () => { if (state.layers.length) resetView(); });

/* ---------- init ---------- */
(function init() {
  applyTheme();
  applyStatic();
  buildMenus();
  buildTools();
  newDoc(1280, 800, '#ffffff', 'Untitled 1');
  state.docs = [captureDoc()];
  state.docIndex = 0;
  setTool('move');
  renderTabs();
  resetView();
  refreshLayers();
  buildAnimUI();
  if (getSettings().startHome) showHome();
})();
