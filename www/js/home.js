/* ===== Home screen: studio selection, project library, New Project dialog ===== */

const ICON_PHOTO = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="12" width="26" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="2.5"/><rect x="15" y="4" width="26" height="26" rx="3" fill="currentColor" opacity=".3"/><circle cx="32" cy="14" r="3.5" fill="currentColor"/></svg>`;
const ICON_ANIM = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="26" y="7" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".55"/><rect x="15" y="27" width="18" height="12" rx="2" fill="currentColor" opacity=".9"/><path d="M4 44h40" stroke="currentColor" stroke-width="2"/></svg>`;

function homeOn() { return $('home').classList.contains('on'); }
function showHome() {
  flushAutosave();
  $('home').classList.add('on');
  renderHome();
}
function hideHome() { $('home').classList.remove('on'); }
function openPhotoStudio() { hideHome(); }

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function fmtDate(ms) {
  try {
    return new Date(ms).toLocaleString(LANG === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) {
    return new Date(ms).toLocaleString();
  }
}

/* ---------- rendering ---------- */
let homeToken = 0;
async function renderHome() {
  const root = $('home');
  const token = ++homeToken;
  let list = [], failed = false;
  try { list = await libAll(); } catch (err) { failed = true; }
  if (token !== homeToken) return;
  list.sort((a, b) => b.updated - a.updated);
  root.innerHTML = '';
  root.append(homeHeader(), studioSection(), librarySection(list, failed));
}
/* Re-render after a language change or a library change while the screen is open */
function refreshHomeIfOpen() { if (homeOn()) renderHome(); }

function homeHeader() {
  const h = el('header', 'hHead');
  h.append(el('div', 'hLogo', 'CS'), el('div', 'hName', 'CREATIVE STUDIO'), el('span', 'sp'));
  const set = el('button', 'hBtn', '⚙');
  set.title = t('الإعدادات');
  set.setAttribute('aria-label', t('الإعدادات'));
  set.onclick = openSettings;
  const nw = el('button', 'hBtn pri', t('مشروع جديد'));
  nw.onclick = openNewProjectDialog;
  h.append(set, nw);
  return h;
}

function studioSection() {
  const s = el('section', 'studios');
  s.append(
    studioCard({ icon: ICON_PHOTO, title: 'PHOTO STUDIO',
      desc: t('تحرير الصور الاحترافي بالطبقات والفلاتر والنصوص'),
      action: t('فتح الاستوديو'), onOpen: openPhotoStudio }),
    studioCard({ icon: ICON_ANIM, title: 'ANIMATION STUDIO',
      desc: t('رسوم متحركة ثنائية الأبعاد بالإطارات والمفاتيح'),
      action: t('فتح الاستوديو'), onOpen: () => openAnimNewDialog() })
  );
  return s;
}
function studioCard(o) {
  const c = el('article', 'studioCard' + (o.onOpen ? '' : ' soon'));
  const ic = el('div', 'sIcon');
  ic.innerHTML = o.icon;
  c.append(ic, el('h2', null, o.title), el('p', null, o.desc));
  if (o.onOpen) {
    const b = el('button', 'pri', o.action);
    b.onclick = o.onOpen;
    c.append(b);
  } else {
    c.append(el('span', 'badge', o.badge));
  }
  return c;
}

function librarySection(list, failed) {
  const wrap = el('section', 'library');
  if (failed) {
    wrap.append(el('p', 'empty', t('تعذر تحميل المكتبة. تأكد من مساحة التخزين ثم أعد فتح التطبيق.')));
    return wrap;
  }
  const groups = [
    ['recent', t('المشاريع الأخيرة'), list.slice(0, 8)],
    ['progress', t('قيد التقدم'), list.filter(r => !r.saved)],
    ['saved', t('المشاريع المحفوظة'), list.filter(r => r.saved)],
    ['all', t('كل المشاريع'), list]
  ];
  groups.forEach(([key, title, items]) => {
    const sec = el('div', 'libGroup');
    sec.dataset.group = key;
    sec.append(el('h3', null, title));
    if (!items.length) {
      sec.append(el('p', 'empty', t('لا توجد مشاريع هنا بعد')));
    } else {
      const grid = el('div', 'pGrid');
      items.forEach(r => grid.appendChild(projectCard(r)));
      sec.append(grid);
    }
    wrap.append(sec);
  });
  return wrap;
}

function projectCard(r) {
  const c = el('div', 'pCard');
  c.tabIndex = 0;
  const th = el('div', 'pThumb');
  if (r.thumb) {
    const im = new Image();
    im.alt = '';
    im.src = r.thumb;
    th.appendChild(im);
  }
  const info = el('div', 'pInfo');
  const typeLabel = r.type === 'photo' ? t('تحرير صور') : t('رسوم متحركة');
  info.append(el('div', 'pName', docLabel(r.name || 'Untitled')),
    el('div', 'pMeta', typeLabel + ' · ' + fmtDate(r.updated)));
  const more = el('button', 'pMore', '⋯');
  more.title = t('خيارات');
  more.setAttribute('aria-label', t('خيارات'));
  more.onclick = e => { e.stopPropagation(); projectMenu(r); };
  c.onclick = () => openLibraryProject(r.id);
  c.onkeydown = e => { if (e.key === 'Enter') openLibraryProject(r.id); };
  c.append(th, info, more);
  return c;
}

/* ---------- project actions ---------- */
function projectMenu(r) {
  const body = el('div', 'ctrls');
  body.appendChild(el('p', 'menuName', docLabel(r.name || 'Untitled')));
  openModal({
    title: t('خيارات المشروع'), body,
    buttons: [
      { label: t('فتح'), primary: true, onClick: () => { closeModal(); openLibraryProject(r.id); } },
      { label: t('إعادة التسمية'), onClick: () => { closeModal(); renameDialog(r); } },
      { label: t('تكرار'), onClick: () => { closeModal(); libDuplicate(r.id).then(refreshHomeIfOpen); } },
      { label: t('حذف'), onClick: () => { closeModal(); deleteDialog(r); } },
      { label: t('إلغاء'), onClick: closeModal }
    ]
  });
}

function renameDialog(r) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = docLabel(r.name || 'Untitled');
  input.maxLength = 80;
  const body = el('div', 'ctrls');
  body.appendChild(input);
  const save = () => {
    const name = input.value.trim();
    if (!name) return;
    closeModal();
    libRename(r.id, name).then(refreshHomeIfOpen).catch(() => toast(t('تعذر تغيير الاسم')));
  };
  input.onkeydown = e => { if (e.key === 'Enter') save(); };
  openModal({
    title: t('إعادة التسمية'), body,
    buttons: [{ label: t('إلغاء'), onClick: closeModal }, { label: t('حفظ'), primary: true, onClick: save }]
  });
  setTimeout(() => input.select(), 50);
}

function deleteDialog(r) {
  const body = el('div', 'ctrls');
  body.appendChild(el('p', 'menuName', t('حذف المشروع «{name}»؟ لا يمكن التراجع عن هذا.', { name: docLabel(r.name || 'Untitled') })));
  openModal({
    title: t('حذف المشروع'), body,
    buttons: [
      { label: t('إلغاء'), onClick: closeModal },
      { label: t('حذف'), primary: true, onClick: () => {
        closeModal();
        libDelete(r.id).then(refreshHomeIfOpen).catch(() => toast(t('تعذر حذف المشروع')));
      } }
    ]
  });
}

/* ---------- New Project dialog (Photo Studio) ---------- */
function openNewProjectDialog() {
  const s = getSettings();
  const body = el('div', 'ctrls newProj');

  /* studio selection */
  const seg = el('div', 'seg');
  const bPhoto = el('button', 'segOn', t('تحرير الصور'));
  const bAnim = el('button', '', t('الرسوم المتحركة'));
  bAnim.disabled = true;
  bAnim.title = t('قريباً في التحديث القادم');
  seg.append(bPhoto, bAnim);
  body.appendChild(seg);

  const nameIn = document.createElement('input');
  nameIn.type = 'text';
  nameIn.maxLength = 80;
  nameIn.value = 'Untitled ' + (state.docs.length + 1);
  body.appendChild(formRow(t('اسم المستند'), nameIn));

  /* size, with units and resolution */
  body.appendChild(formSection(t('المقاس')));
  const presetSel = mkSelect([['custom', t('مخصص')]].concat(presetDefs().map(p => [p.v, p.label])), 'custom');
  body.appendChild(formRow(t('قالب جاهز'), presetSel));
  const unitSel = mkSelect([['px', t('بكسل')], ['cm', t('سم')], ['mm', t('مم')], ['in', t('بوصة')]], s.unit);
  const ppiIn = mkNumber(s.ppi, 1, 2400, 1);
  const wIn = mkNumber(0, 0, 8000, 'any'), hIn = mkNumber(0, 0, 8000, 'any');
  body.appendChild(formRow(t('الوحدة'), unitSel));
  body.appendChild(formRow(t('العرض'), wIn));
  body.appendChild(formRow(t('الارتفاع'), hIn));
  body.appendChild(formRow(t('الدقة (PPI)'), ppiIn));
  const info = el('div', 'pxInfo');
  body.appendChild(info);

  /* background */
  body.appendChild(formSection(t('الخلفية')));
  const transpIn = mkCheck(s.newBg === 'transparent');
  const bgIn = document.createElement('input');
  bgIn.type = 'color';
  bgIn.value = s.newBg === 'transparent' ? '#ffffff' : s.newBg;
  bgIn.disabled = transpIn.checked;
  body.appendChild(formRow(t('لون الخلفية'), bgIn));
  const tRow = formRow(t('خلفية شفافة'), transpIn);
  body.appendChild(tRow);
  transpIn.onchange = () => { bgIn.disabled = transpIn.checked; };

  let unit = s.unit;
  const P = () => +ppiIn.value || 300;
  const K = u => (u === 'px' ? 1 : u === 'in' ? P() : u === 'cm' ? P() / 2.54 : P() / 25.4);
  const pxW = () => Math.round((+wIn.value || 0) * K(unit));
  const pxH = () => Math.round((+hIn.value || 0) * K(unit));
  const fmt = v => Math.round(v * 100) / 100;
  const createBtn = () => $('mFoot').lastElementChild;

  const refresh = () => {
    const w = pxW(), h = pxH();
    const ok = w >= 1 && w <= 8000 && h >= 1 && h <= 8000 && +ppiIn.value >= 1;
    info.textContent = ok ? `${w} × ${h} px` : t('المقاس خارج الحدود (1–8000 بكسل)');
    createBtn().disabled = !ok;
  };
  const setSize = (w, h, u) => {
    unit = u; unitSel.value = u;
    const k = K(u);
    wIn.value = fmt(w / k); hIn.value = fmt(h / k);
    refresh();
  };

  unitSel.onchange = () => {
    const w = pxW(), h = pxH();
    unit = unitSel.value;
    const k = K(unit);
    wIn.value = fmt(w / k); hIn.value = fmt(h / k);
    refresh();
  };
  presetSel.onchange = () => {
    if (presetSel.value === 'custom') return;
    const [pw, ph] = presetSel.value.split('x').map(Number);
    setSize(pw, ph, 'px');
  };
  [wIn, hIn, ppiIn].forEach(i => { i.oninput = refresh; });

  openModal({
    title: t('مستند جديد'), body,
    buttons: [
      { label: t('إلغاء'), onClick: closeModal },
      { label: t('إنشاء'), primary: true, onClick: () => {
        const w = clamp(pxW(), 1, 8000), h = clamp(pxH(), 1, 8000);
        const bg = transpIn.checked ? null : bgIn.value;
        const name = nameIn.value.trim() || 'Untitled';
        setSettings({
          unit, ppi: clamp(+ppiIn.value | 0, 1, 2400), newW: w, newH: h,
          newBg: transpIn.checked ? 'transparent' : bgIn.value
        });
        closeModal();
        newTab(w, h, bg, name);
        saveToLibrary(false, true);
        hideHome();
      } }
    ]
  });
  setSize(s.newW, s.newH, s.unit);
}
