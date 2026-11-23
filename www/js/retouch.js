/* ===== Retouch brushes: blur, sharpen, smudge, dodge, burn, sponge ===== */

const RET_PAD = 2;   // extra ring around each dab so blur/sharpen can read neighbours

// Square region around a dab centre, padded on every side
function retRect(cx, cy, r) {
  const x0 = Math.round(cx) - r - RET_PAD, y0 = Math.round(cy) - r - RET_PAD;
  const n = 2 * r + 1 + 2 * RET_PAD;
  return { x0, y0, w: n, h: n, cx: cx - x0, cy: cy - y0 };
}

// 5x5 box blur on a Float32 RGBA buffer (separable: horizontal then vertical)
function retBlur(src, w, h) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let k = -2; k <= 2; k++) {
      const xx = x + k; if (xx < 0 || xx >= w) continue;
      const i = (y * w + xx) * 4;
      r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
    }
    const j = (y * w + x) * 4;
    tmp[j] = r / n; tmp[j + 1] = g / n; tmp[j + 2] = b / n; tmp[j + 3] = a / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let k = -2; k <= 2; k++) {
      const yy = y + k; if (yy < 0 || yy >= h) continue;
      const i = (yy * w + x) * 4;
      r += tmp[i]; g += tmp[i + 1]; b += tmp[i + 2]; a += tmp[i + 3]; n++;
    }
    const j = (y * w + x) * 4;
    out[j] = r / n; out[j + 1] = g / n; out[j + 2] = b / n; out[j + 3] = a / n;
  }
  return out;
}

// Apply one dab of a retouch tool at point p. Returns true if any pixel changed.
function retDab(p, kind, d) {
  const t = strokeTarget(), l = curRaster();
  if (!t || !l || l.locked) return false;
  const size = optNum('brushSize', 12);
  const r = Math.max(1, Math.round(size / 2));
  const rf = Math.max(1, size / 2);                 // falloff radius
  const str = clamp(optNum('retStrength', 50), 1, 100) / 100;
  const rc = retRect(p.x, p.y, r);

  const img = t.ctx.getImageData(rc.x0, rc.y0, rc.w, rc.h);
  const orig = Float32Array.from(img.data);
  const selA = state.sel
    ? state.sel.mask.getContext('2d').getImageData(rc.x0, rc.y0, rc.w, rc.h).data : null;
  const blur = (kind === 'blur' || kind === 'sharpen')
    ? retBlur(kind === 'blur' ? retBlur(orig, rc.w, rc.h) : orig, rc.w, rc.h) : null;   // blur runs twice for a visible softening
  const out = Float32Array.from(orig);
  const range = OPT.retRange ?? 'mid';
  const spongeMode = OPT.retSponge ?? 'sat';
  if (kind === 'smudge' && (!d.carry || d.carry.length !== orig.length)) d.carry = Float32Array.from(orig);

  let touched = false;
  for (let py = 0; py < rc.h; py++) for (let px = 0; px < rc.w; px++) {
    const i = (py * rc.w + px) * 4;
    const dx = px + 0.5 - rc.cx, dy = py + 0.5 - rc.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= rf) continue;
    let a = str * (1 - (dist / rf) * (dist / rf));
    if (selA) a *= selA[i + 3] / 255;
    if (a <= 0) continue;
    touched = true;

    if (kind === 'blur') {
      for (let c = 0; c < 4; c++) out[i + c] = orig[i + c] + (blur[i + c] - orig[i + c]) * a;
    } else if (kind === 'sharpen') {
      for (let c = 0; c < 3; c++) out[i + c] = orig[i + c] + (orig[i + c] - blur[i + c]) * a * 1.5;
    } else if (kind === 'smudge') {
      for (let c = 0; c < 4; c++) out[i + c] = orig[i + c] + (d.carry[i + c] - orig[i + c]) * a;
    } else if (kind === 'dodge' || kind === 'burn') {
      const R = orig[i], G = orig[i + 1], B = orig[i + 2];
      const L = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
      const rw = range === 'shadow' ? 1 - L : range === 'high' ? L
               : range === 'all' ? 1 : 1 - Math.abs(2 * L - 1);
      const k = a * rw * 0.5;
      for (let c = 0; c < 3; c++) {
        const v = orig[i + c];
        out[i + c] = kind === 'dodge' ? v + (255 - v) * k : v - v * k;
      }
    } else if (kind === 'sponge') {
      const R = orig[i], G = orig[i + 1], B = orig[i + 2];
      const gray = 0.299 * R + 0.587 * G + 0.114 * B;
      const f = spongeMode === 'desat' ? 1 - a : 1 + a;
      for (let c = 0; c < 3; c++) out[i + c] = gray + (orig[i + c] - gray) * f;
    }
  }
  if (!touched) return false;

  if (kind === 'smudge') d.carry = out;       // the smear carries what was just painted
  img.data.set(out);                          // Uint8ClampedArray clamps and rounds
  t.ctx.putImageData(img, rc.x0, rc.y0);
  return true;
}

function makeRetouchTool(kind) {
  return {
    cursor: 'crosshair',
    down(p, e, d) {
      d.carry = null;
      d.painted = retDab(p, kind, d);
      d.last = p;
      render();
    },
    move(p, e, d) {
      const a = d.last, size = optNum('brushSize', 12);
      const step = Math.max(1, size / 6);
      const n = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / step));
      for (let i = 1; i <= n; i++) {
        const q = { x: a.x + (p.x - a.x) * i / n, y: a.y + (p.y - a.y) * i / n };
        if (retDab(q, kind, d)) d.painted = true;
      }
      d.last = p;
      render();
    },
    up(p, e, d) {
      if (d.painted) { pushHistory(); refreshLayers(); }
      d.carry = null;
    }
  };
}

defTool('blur', makeRetouchTool('blur'));
defTool('sharpen', makeRetouchTool('sharpen'));
defTool('smudge', makeRetouchTool('smudge'));
defTool('dodge', makeRetouchTool('dodge'));
defTool('burn', makeRetouchTool('burn'));
defTool('sponge', makeRetouchTool('sponge'));
