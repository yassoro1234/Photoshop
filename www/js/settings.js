/* ===== Settings: stored preferences and the settings dialog ===== */

const SETTINGS_KEY = 'cs-settings';
const SETTINGS_DEFAULT = {
  autosave: true,
  autosaveDelay: 2000,   // ms after the last edit
  startHome: true,       // show the home screen at launch
  unit: 'px',            // default unit for New Project
  ppi: 300,
  newW: 1280, newH: 800,
  newBg: '#ffffff'       // hex color, or 'transparent'
};

function getSettings() {
  try {
    return { ...SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch (e) {
    return { ...SETTINGS_DEFAULT };
  }
}
function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}

/* ---------- small form controls shared by the dialogs ---------- */
function mkSelect(options, value) {
  const sel = document.createElement('select');
  let found = false;
  options.forEach(([v, label]) => {
    sel.add(new Option(label, String(v)));
    if (String(v) === String(value)) found = true;
  });
  if (!found && value != null) sel.add(new Option(String(value), String(value)));
  sel.value = String(value);
  return sel;
}
function mkCheck(checked) {
  const i = document.createElement('input');
  i.type = 'checkbox'; i.checked = !!checked;
  return i;
}
function mkNumber(value, min, max, step) {
  const i = document.createElement('input');
  i.type = 'number'; i.value = value; i.min = min; i.max = max; i.step = step;
  return i;
}
function formRow(label, control) {
  const r = document.createElement('div'); r.className = 'crow';
  const s = document.createElement('span'); s.textContent = label;
  r.append(s, control);
  return r;
}
function formSection(label) {
  const h = document.createElement('div'); h.className = 'secHead'; h.textContent = label;
  return h;
}

/* ---------- settings dialog ---------- */
function openSettings() {
  const s = getSettings();
  const body = document.createElement('div');
  body.className = 'ctrls';

  body.appendChild(formSection(t('المظهر واللغة')));
  const langSel = mkSelect([['ar', 'العربية'], ['en', 'English']], LANG);
  langSel.onchange = () => {
    setLang(langSel.value);
    applyAllText();
    closeModal();
    openSettings();
  };
  body.appendChild(formRow(t('اللغة'), langSel));
  const themeSel = mkSelect([['dark', t('داكن')], ['light', t('فاتح')]],
    document.body.classList.contains('light') ? 'light' : 'dark');
  themeSel.onchange = () => setTheme(themeSel.value === 'light');
  body.appendChild(formRow(t('المظهر'), themeSel));

  body.appendChild(formSection(t('الحفظ التلقائي')));
  const autoChk = mkCheck(s.autosave);
  autoChk.onchange = () => setSettings({ autosave: autoChk.checked });
  body.appendChild(formRow(t('حفظ المشروع تلقائياً'), autoChk));
  const delaySel = mkSelect([[1000, '1 s'], [2000, '2 s'], [5000, '5 s'], [15000, '15 s']], s.autosaveDelay);
  delaySel.onchange = () => setSettings({ autosaveDelay: +delaySel.value });
  body.appendChild(formRow(t('الحفظ بعد التوقف عن التعديل'), delaySel));

  body.appendChild(formSection(t('المشاريع الجديدة')));
  const unitSel = mkSelect([['px', t('بكسل')], ['cm', t('سم')], ['mm', t('مم')], ['in', t('بوصة')]], s.unit);
  unitSel.onchange = () => setSettings({ unit: unitSel.value });
  body.appendChild(formRow(t('الوحدة الافتراضية'), unitSel));
  const ppiIn = mkNumber(s.ppi, 1, 2400, 1);
  ppiIn.onchange = () => setSettings({ ppi: clamp(+ppiIn.value | 0, 1, 2400) });
  body.appendChild(formRow(t('الدقة (PPI)'), ppiIn));
  const wIn = mkNumber(s.newW, 1, 8000, 1), hIn = mkNumber(s.newH, 1, 8000, 1);
  wIn.onchange = () => setSettings({ newW: clamp(+wIn.value | 0, 1, 8000) });
  hIn.onchange = () => setSettings({ newH: clamp(+hIn.value | 0, 1, 8000) });
  body.appendChild(formRow(t('العرض (px)'), wIn));
  body.appendChild(formRow(t('الارتفاع (px)'), hIn));
  const bgSel = mkSelect([['#ffffff', t('أبيض')], ['#000000', t('أسود')], ['transparent', t('شفاف')]], s.newBg);
  bgSel.onchange = () => setSettings({ newBg: bgSel.value });
  body.appendChild(formRow(t('الخلفية الافتراضية'), bgSel));

  body.appendChild(formSection(t('مساحة العمل')));
  const homeChk = mkCheck(s.startHome);
  homeChk.onchange = () => setSettings({ startHome: homeChk.checked });
  body.appendChild(formRow(t('فتح الصفحة الرئيسية عند التشغيل'), homeChk));

  openModal({ title: t('الإعدادات'), body, buttons: [{ label: t('إغلاق'), primary: true, onClick: closeModal }] });
}
