/* ===== Global state & helpers ===== */
const state = {
  W: 1280, H: 800,
  layers: [],          // entries: raster layers or groups (type:'group')
  active: -1,
  zoom: 1, panX: 0, panY: 0,
  tool: 'move',
  fg: '#000000', bg: '#ffffff',
  projectId: null,     // library id of the open project (null until first saved or autosaved)
  sampleSrc: 'all',    // eyedropper source: 'all' layers or 'layer' (current)
  ft: null,            // free transform in progress {id, src, box, sx, sy, rot, ox, oy}
  sel: null,           // {mask:canvas, poly:[{x,y}]|null, box:{x,y,w,h}}
  crop: null,          // {x,y,w,h} while cropping
  lastSel: null,       // the selection before the last deselect, for Reselect
  selections: {},      // saved selections: name -> mask canvas (written into the project)
  preview: null,       // overlay preview shape
  pen: null,           // {pts:[]} while drawing a pen path
  cloneSrc: null,      // {x,y,off} clone tool source
  cloneArm: false,
  maskEdit: false,
  spaceDown: false,
  undo: [], redo: [],
  docName: 'Untitled',
  docs: [],            // open project tabs (slots)
  docIndex: 0,
  dirty: false
};

const OPT = { brushSize: 12, brushAlpha: 100, tolerance: 32, textSize: 48, feather: 0, selShape: 'rect', selMode: 'new', lassoType: 'free', wandMode: 'contig', cropRatio: 'free' };

let _uid = 1;
const uid = () => _uid++;
const $ = id => document.getElementById(id);

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/* 2D context used for pixel reads */
function ctx2d(c) {
  return c.getContext('2d', { willReadFrequently: true });
}

function cloneC(src) {
  const c = mkCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 1800);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
