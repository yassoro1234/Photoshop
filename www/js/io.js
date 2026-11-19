/* ===== Files: import, export, project save/open, document tabs ===== */

const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/* Save a file: browser download, or native share sheet on Android */
async function saveBlob(blob, filename) {
  if (isNative() && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    const data = await blobToBase64(blob);
    const path = 'PhotoStudio/' + filename;
    const res = await Filesystem.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true });
    await Share.share({ title: filename, url: res.uri, dialogTitle: 'مشاركة / حفظ' });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- import images as layers ---------- */
function openFileDialog() { $('fileIn').click(); }

$('fileIn').addEventListener('change', e => {
  importFiles([...e.target.files]);
  e.target.value = '';
});

function importFiles(files) {
  const imgs = files.filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  let pending = imgs.length;
  imgs.forEach(f => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (!state.layers.length) newDoc(img.width, img.height, null, f.name);
      const l = makeLayer(f.name.replace(/\.[^.]+$/, ''));
      l.ctx.drawImage(img, 0, 0);
      const a = cur();
      l.group = a && a.type === 'group' ? a.id : (a ? a.group : null);
      insertAboveActive(l);
      if (--pending === 0) { pushHistory(); render(); refreshLayers(); }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { toast('تعذر فتح ' + f.name); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/* ---------- export ---------- */
function flattenedCanvas(opaque) {
  render();
  const c = mkCanvas(state.W, state.H), x = c.getContext('2d');
  if (opaque) { x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage($('comp'), 0, 0);
  return c;
}

function exportAs(kind, quality = 0.92) {
  if (!state.layers.length) return toast('لا توجد صورة للتصدير');
  const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[kind];
  const ext = kind;
  const c = flattenedCanvas(kind === 'jpg');
  c.toBlob(b => {
    if (!b) return toast('فشل التصدير');
    saveBlob(b, `${state.docName}.${ext}`).catch(() => toast('فشل الحفظ'));
  }, mime, quality);
}

/* ---------- project save / open (.psproj.json) ---------- */
async function saveProject(asNew) {
  if (asNew || !state.docName || state.docName === 'Untitled') {
    const n = prompt('اسم المشروع', state.docName);
    if (!n) return;
    state.docName = n.trim() || 'Untitled';
  }
  const data = {
    format: 'photostudio-project', version: 1,
    W: state.W, H: state.H, name: state.docName, active: state.active,
    layers: state.layers.map(l => ({
      meta: metaOf(l),
      png: l.canvas ? l.canvas.toDataURL('image/png') : null,
      mask: l.mask ? l.mask.toDataURL('image/png') : null
    }))
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  state.dirty = false; updateTitle();
  saveBlob(blob, `${state.docName}.psproj.json`).catch(() => toast('فشل الحفظ'));
  toast('تم حفظ المشروع');
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

async function openProjectFile(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (obj.format !== 'photostudio-project') throw new Error('bad');
    const layers = [];
    for (const e of obj.layers) {
      const l = { ...e.meta };
      if (e.png) {
        l.canvas = mkCanvas(obj.W, obj.H);
        l.ctx = l.canvas.getContext('2d');
        const im = await loadImage(e.png);
        l.ctx.drawImage(im, 0, 0);
      }
      l.mask = null;
      if (e.mask) {
        l.mask = mkCanvas(obj.W, obj.H);
        l.mask.getContext('2d').drawImage(await loadImage(e.mask), 0, 0);
      }
      layers.push(l);
    }
    state.undo = []; state.redo = [];
    state.sel = null; state.crop = null; state.preview = null; state.pen = null;
    state.W = obj.W; state.H = obj.H;
    state.layers = layers;
    state.active = clamp(obj.active ?? 0, 0, layers.length - 1);
    state.docName = obj.name || file.name.replace(/\.psproj\.json$/, '');
    resizeStage();
    pushHistory();
    resetView();
    render(); refreshLayers();
    toast('تم فتح المشروع');
  } catch (err) {
    toast('ملف المشروع غير صالح');
  }
}

$('projIn').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) openProjectFile(f);
  e.target.value = '';
});

/* ---------- document tabs (multiple open projects) ---------- */
function captureDoc() {
  return { name: state.docName, snap: snapshot(), undo: state.undo, redo: state.redo, dirty: state.dirty };
}
function restoreDoc(d) {
  state.docName = d.name;
  state.undo = d.undo; state.redo = d.redo; state.dirty = d.dirty;
  restoreSnap(d.snap);
  resetView();
  renderTabs();
}
function switchDoc(i) {
  if (i === state.docIndex || !state.docs[i]) return;
  state.docs[state.docIndex] = captureDoc();
  state.docIndex = i;
  restoreDoc(state.docs[i]);
}
function newTab(w, h, bg, name) {
  state.docs[state.docIndex] = captureDoc();
  state.docs.push(null);
  state.docIndex = state.docs.length - 1;
  newDoc(w, h, bg, name);
  state.docs[state.docIndex] = captureDoc();
  renderTabs();
}
function closeTab(i) {
  if (state.docs.length <= 1) return toast('لا يمكن إغلاق آخر مستند');
  state.docs.splice(i, 1);
  let ni = state.docIndex;
  if (i < state.docIndex) ni--;
  else if (i === state.docIndex) ni = Math.min(i, state.docs.length - 1);
  state.docIndex = -1;
  state.docIndex = ni;
  restoreDoc(state.docs[ni]);
}
