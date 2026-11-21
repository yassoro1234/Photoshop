/* ===== Project library: projects kept in IndexedDB, autosave, thumbnails ===== */

const LIB = { name: 'creative-studio', version: 1, db: null };

function libOpen() {
  if (LIB.db) return Promise.resolve(LIB.db);
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB is unavailable'));
    const req = indexedDB.open(LIB.name, LIB.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    req.onsuccess = () => { LIB.db = req.result; resolve(LIB.db); };
    req.onerror = () => reject(req.error);
  });
}

/* Runs one request in its own transaction and resolves with its result */
function libRun(store, mode, make) {
  return libOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = make(tx.objectStore(store));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  }));
}

/* ---------- thumbnails and serialization ---------- */
function makeThumb() {
  const src = $('comp');
  const k = Math.min(1, 320 / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * k));
  c.height = Math.max(1, Math.round(src.height * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/* Same file format as the .psproj.json export, so projects stay compatible */
function serializeProject() {
  return {
    format: 'photostudio-project', version: 1,
    W: state.W, H: state.H, name: state.docName, active: state.active,
    layers: state.layers.map(l => ({
      meta: metaOf(l),
      png: l.canvas ? l.canvas.toDataURL('image/png') : null,
      mask: l.mask ? l.mask.toDataURL('image/png') : null
    }))
  };
}

/* Replaces the current document with a project object. Throws if the object is invalid. */
async function loadProjectData(obj, opts = {}) {
  if (!obj || obj.format !== 'photostudio-project' || !Array.isArray(obj.layers) || !obj.layers.length) {
    throw new Error('invalid project');
  }
  const layers = [];
  for (const e of obj.layers) {
    const l = { ...e.meta };
    if (e.png) {
      l.canvas = mkCanvas(obj.W, obj.H);
      l.ctx = l.canvas.getContext('2d');
      l.ctx.drawImage(await loadImage(e.png), 0, 0);
    }
    l.mask = null;
    if (e.mask) {
      l.mask = mkCanvas(obj.W, obj.H);
      l.mask.getContext('2d').drawImage(await loadImage(e.mask), 0, 0);
    }
    layers.push(l);
  }
  state.undo = []; state.redo = [];
  state.sel = null; state.crop = null; state.preview = null; state.pen = null; state.ft = null;
  state.W = obj.W; state.H = obj.H;
  state.layers = layers;
  state.active = clamp(obj.active ?? 0, 0, layers.length - 1);
  state.docName = opts.name || obj.name || opts.fallbackName || 'Untitled';
  state.projectId = opts.id || null;
  resizeStage();
  pushHistory();
  state.dirty = false;
  resetView();
  render(); refreshLayers();
}

/* ---------- saving ---------- */
/* Writes the live document to the library. Everything is read synchronously first,
   so the document can keep changing while the database writes run. */
async function saveToLibrary(explicit, silent) {
  if (!state.layers.length) return false;
  if (!state.projectId) state.projectId = uid();
  const id = state.projectId, now = Date.now();
  const name = state.docName || 'Untitled';
  const data = serializeProject();
  const thumb = makeThumb();
  state.dirty = false; updateTitle();
  try {
    const old = await libRun('meta', 'readonly', s => s.get(id));
    const rec = {
      id, name, type: 'photo', created: old ? old.created : now, updated: now,
      saved: explicit || !!(old && old.saved), thumb
    };
    await libRun('data', 'readwrite', s => s.put({ id, data }));
    await libRun('meta', 'readwrite', s => s.put(rec));
    if (!silent) toast(t('تم حفظ المشروع'));
    return true;
  } catch (err) {
    state.dirty = true; updateTitle();
    if (!silent) toast(t('فشل الحفظ'));
    return false;
  }
}

/* ---------- autosave ---------- */
let autosaveTimer = null;
function scheduleAutosave() {
  const s = getSettings();
  if (!s.autosave) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, s.autosaveDelay);
}
/* Saves the live document if it has unsaved changes and it is worth keeping
   (a new untitled document with no edits is not) */
function flushAutosave() {
  clearTimeout(autosaveTimer);
  if (!state.dirty || !state.layers.length || !getSettings().autosave) return;
  if (!state.projectId && state.undo.length <= 1) return;
  saveToLibrary(false, true);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushAutosave(); });

/* ---------- listing and project operations ---------- */
function libAll() { return libRun('meta', 'readonly', s => s.getAll()); }
function libMeta(id) { return libRun('meta', 'readonly', s => s.get(id)); }
function libData(id) { return libRun('data', 'readonly', s => s.get(id)); }

async function libRename(id, name) {
  const m = await libMeta(id); if (!m) return;
  m.name = name;
  await libRun('meta', 'readwrite', s => s.put(m));
  if (state.projectId === id) { state.docName = name; updateTitle(); }
  state.docs.forEach(d => { if (d && d.projectId === id) d.name = name; });
  renderTabs();
}

async function libDuplicate(id) {
  const m = await libMeta(id), d = await libData(id);
  if (!m || !d) return;
  const nid = uid(), now = Date.now();
  const name = docLabel(m.name) + ' (2)';
  await libRun('data', 'readwrite', s => s.put({ id: nid, data: { ...d.data, name } }));
  await libRun('meta', 'readwrite', s => s.put({ ...m, id: nid, name, created: now, updated: now, saved: true }));
}

async function libDelete(id) {
  await libRun('meta', 'readwrite', s => s.delete(id));
  await libRun('data', 'readwrite', s => s.delete(id));
  if (state.projectId === id) state.projectId = null;
  state.docs.forEach(d => { if (d && d.projectId === id) d.projectId = null; });
  renderTabs();
}

/* Index of an open tab holding this project: 'live' for the current one, -1 if none */
function findOpenTab(id) {
  if (state.projectId === id) return 'live';
  return state.docs.findIndex((d, i) => i !== state.docIndex && d && d.projectId === id);
}

async function openLibraryProject(id) {
  const open = findOpenTab(id);
  if (open === 'live') return hideHome();
  if (open >= 0) { switchDoc(open); return hideHome(); }
  try {
    const meta = await libMeta(id), rec = await libData(id);
    if (!meta || !rec) return toast(t('المشروع غير موجود'));
    flushAutosave();
    const prev = state.docIndex;
    state.docs[state.docIndex] = captureDoc();
    state.docs.push(null);
    state.docIndex = state.docs.length - 1;
    try {
      await loadProjectData(rec.data, { id, name: meta.name });
    } catch (err) {
      state.docs.pop();
      state.docIndex = prev;
      restoreDoc(state.docs[prev]);
      return toast(t('ملف المشروع غير صالح'));
    }
    state.docs[state.docIndex] = captureDoc();
    renderTabs();
    hideHome();
  } catch (err) {
    toast(t('تعذر فتح المشروع'));
  }
}
