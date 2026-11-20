/* ===== Adjustments & filters with live preview ===== */

/* ---------- color helpers ---------- */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/* Wrap a per-pixel function as a canvas->canvas transform */
function pixelFilter(fn) {
  return src => {
    const out = cloneC(src), x = out.getContext('2d');
    const img = x.getImageData(0, 0, out.width, out.height);
    fn(img.data, out.width, out.height);
    x.putImageData(img, 0, 0);
    return out;
  };
}

function curveLUT(xs, ys) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let i = 0;
    while (i < xs.length - 2 && v > xs[i + 1]) i++;
    const span = xs[i + 1] - xs[i] || 1;
    const t = clamp((v - xs[i]) / span, 0, 1);
    lut[v] = ys[i] + (ys[i + 1] - ys[i]) * t;
  }
  return lut;
}

/* ---------- filter catalogue ---------- */
function filterDefs() {
  return {
  brightness: {
    label: t('السطوع والتباين'),
    controls: [
      { k: 'b', label: t('السطوع'), min: -150, max: 150, val: 0 },
      { k: 'c', label: t('التباين'), min: -100, max: 100, val: 0 }
    ],
    make: p => {
      const f = (259 * (p.c + 255)) / (255 * (259 - p.c));
      return pixelFilter(d => {
        for (let i = 0; i < d.length; i += 4) {
          d[i] = f * (d[i] - 128) + 128 + p.b;
          d[i + 1] = f * (d[i + 1] - 128) + 128 + p.b;
          d[i + 2] = f * (d[i + 2] - 128) + 128 + p.b;
        }
      });
    }
  },
  exposure: {
    label: t('التعريض'),
    controls: [{ k: 'e', label: 'EV', min: -3, max: 3, step: 0.05, val: 0 }],
    make: p => {
      const m = Math.pow(2, p.e);
      return pixelFilter(d => {
        for (let i = 0; i < d.length; i += 4) {
          d[i] *= m; d[i + 1] *= m; d[i + 2] *= m;
        }
      });
    }
  },
  hue: {
    label: t('الصبغة والتشبع'),
    controls: [
      { k: 'h', label: t('الصبغة'), min: -180, max: 180, val: 0 },
      { k: 's', label: t('التشبع'), min: -100, max: 100, val: 0 },
      { k: 'l', label: t('الإضاءة'), min: -100, max: 100, val: 0 }
    ],
    make: p => pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const nh = (h + p.h / 360 + 1) % 1;
        const ns = clamp(s * (1 + p.s / 100), 0, 1);
        const nl = clamp(l + p.l / 200, 0, 1);
        const [r, g, b] = hslToRgb(nh, ns, nl);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    })
  },
  temperature: {
    label: t('درجة الحرارة'),
    controls: [{ k: 't', label: t('دافئ ◂ ▸ بارد'), min: -100, max: 100, val: 0 }],
    make: p => pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        d[i] += p.t * 0.5;
        d[i + 2] -= p.t * 0.5;
      }
    })
  },
  colorBalance: {
    label: t('توازن الألوان'),
    controls: [
      { k: 'cr', label: t('سماوي ◂ ▸ أحمر'), min: -100, max: 100, val: 0 },
      { k: 'mg', label: t('أرجواني ◂ ▸ أخضر'), min: -100, max: 100, val: 0 },
      { k: 'yb', label: t('أصفر ◂ ▸ أزرق'), min: -100, max: 100, val: 0 },
      { k: 'tone', label: t('النطاق'), type: 'select', val: 'mid',
        options: [{ v: 'sh', label: t('الظلال') }, { v: 'mid', label: t('المتوسطات') }, { v: 'hi', label: t('الإضاءات') }] }
    ],
    make: p => pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        let w;
        if (p.tone === 'sh') w = clamp(1 - lum * 2, 0, 1);
        else if (p.tone === 'hi') w = clamp((lum - 0.5) * 2, 0, 1);
        else w = clamp(1 - Math.abs(lum - 0.5) * 2, 0, 1);
        d[i] += p.cr * w * 0.8;
        d[i + 1] += p.mg * w * 0.8;
        d[i + 2] += p.yb * w * 0.8;
      }
    })
  },
  levels: {
    label: t('المستويات'),
    controls: [
      { k: 'inB', label: t('نقطة السواد'), min: 0, max: 254, val: 0 },
      { k: 'inW', label: t('نقطة البياض'), min: 1, max: 255, val: 255 },
      { k: 'g', label: t('المنتصف (غاما)'), min: 0.1, max: 3, step: 0.05, val: 1 }
    ],
    make: p => {
      const lut = new Uint8ClampedArray(256);
      const span = Math.max(1, p.inW - p.inB);
      for (let v = 0; v < 256; v++) {
        const t = clamp((v - p.inB) / span, 0, 1);
        lut[v] = 255 * Math.pow(t, 1 / p.g);
      }
      return pixelFilter(d => {
        for (let i = 0; i < d.length; i += 4) {
          d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
        }
      });
    }
  },
  gaussianBlur: {
    label: t('طمس غاوسي'),
    controls: [{ k: 'r', label: t('نصف القطر'), min: 0, max: 40, step: 0.5, val: 4 }],
    make: p => src => {
      const out = mkCanvas(src.width, src.height), x = out.getContext('2d');
      x.filter = `blur(${p.r}px)`;
      x.drawImage(src, 0, 0);
      x.filter = 'none';
      return out;
    }
  },
  sharpen: {
    label: t('تحديد الحواف'),
    controls: [{ k: 'a', label: t('القوة'), min: 0, max: 3, step: 0.05, val: 0.5 }],
    make: p => src => {
      const out = cloneC(src), x = out.getContext('2d');
      const w = out.width, h = out.height;
      const img = x.getImageData(0, 0, w, h), d = img.data;
      const o = new Uint8ClampedArray(d);
      const c = 1 + 4 * p.a, n = -p.a, rowB = w * 4;
      for (let y = 1; y < h - 1; y++) {
        for (let xi = 1; xi < w - 1; xi++) {
          const i = (y * w + xi) * 4;
          for (let k = 0; k < 3; k++) {
            d[i + k] = c * o[i + k] + n * (o[i - 4 + k] + o[i + 4 + k] + o[i - rowB + k] + o[i + rowB + k]);
          }
        }
      }
      x.putImageData(img, 0, 0);
      return out;
    }
  },
  noise: {
    label: t('إضافة ضوضاء'),
    controls: [{ k: 'a', label: t('الكمية'), min: 0, max: 100, val: 20 }],
    make: p => pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const n = (Math.random() * 2 - 1) * p.a;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
    })
  },
  grayscale: {
    label: t('تدرج الرمادي'),
    controls: [],
    make: () => pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = l;
      }
    })
  },
  invert: {
    label: t('عكس الألوان'),
    controls: [],
    make: () => pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
      }
    })
  },
  vignette: {
    label: t('تظليل الحواف'),
    controls: [
      { k: 'a', label: t('الكثافة'), min: 0, max: 100, val: 40 },
      { k: 'r', label: t('الحجم'), min: 0.2, max: 1.2, step: 0.05, val: 0.7 }
    ],
    make: p => src => {
      const out = cloneC(src), x = out.getContext('2d');
      const w = out.width, h = out.height;
      const cx = w / 2, cy = h / 2;
      const g = x.createRadialGradient(cx, cy, Math.min(w, h) * p.r * 0.5, cx, cy, Math.hypot(w, h) / 2);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${p.a / 100})`);
      x.save();
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.restore();
      return out;
    }
  }
};
}

/* ---------- applying results to the active layer ---------- */

/* Writes `out` into the active layer, mixing with `orig` through the selection mask */
function writeLayer(orig, out) {
  const l = curRaster(); if (!l) return;
  const W = state.W, H = state.H, ctx = l.ctx;
  if (!state.sel) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(out, 0, 0);
    return;
  }
  const o = orig.getContext('2d').getImageData(0, 0, W, H).data;
  const n = out.getContext('2d').getImageData(0, 0, W, H).data;
  const m = state.sel.mask.getContext('2d').getImageData(0, 0, W, H).data;
  const res = ctx.createImageData(W, H), r = res.data;
  for (let i = 0; i < r.length; i += 4) {
    const a = m[i + 3] / 255;
    for (let k = 0; k < 4; k++) r[i + k] = o[i + k] + (n[i + k] - o[i + k]) * a;
  }
  ctx.putImageData(res, 0, 0);
}

function canAdjust() {
  const l = curRaster();
  if (!l) { toast(t('اختر طبقة بكسل أولاً')); return null; }
  if (l.locked) { toast(t('الطبقة مقفلة')); return null; }
  return l;
}

function runFilter(key) {
  const l = canAdjust(); if (!l) return;
  const F = filterDefs()[key];
  if (!F.controls.length) {
    const orig = cloneC(l.canvas);
    writeLayer(orig, F.make({})(orig));
    pushHistory(); render(); refreshLayers();
    return;
  }
  liveDialog(F.label, F.controls, F.make);
}

/* ---------- dialog with live preview ---------- */
function controlRow(c, onInput) {
  const row = document.createElement('div');
  row.className = 'crow';
  const lab = document.createElement('span');
  lab.textContent = c.label;
  row.appendChild(lab);

  if (c.type === 'select') {
    const sel = document.createElement('select');
    c.options.forEach(o => sel.add(new Option(o.label, o.v)));
    sel.value = c.val;
    sel.onchange = () => onInput(sel.value);
    row.appendChild(sel);
    return row;
  }
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = c.min; inp.max = c.max; inp.step = c.step || 1;
  inp.value = c.val;
  const out = document.createElement('output');
  out.textContent = c.val;
  inp.oninput = () => {
    const v = parseFloat(inp.value);
    out.textContent = v;
    onInput(v);
  };
  row.append(inp, out);
  return row;
}

function liveDialog(title, controls, make) {
  const l = curRaster(); if (!l) return;
  const orig = cloneC(l.canvas);
  const vals = {};
  controls.forEach(c => vals[c.k] = c.val);

  let raf = 0;
  const apply = () => {
    raf = 0;
    writeLayer(orig, make(vals)(orig));
    render();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  const body = document.createElement('div');
  body.className = 'ctrls';
  controls.forEach(c => body.appendChild(controlRow(c, v => { vals[c.k] = v; schedule(); })));

  const cancel = () => {
    if (raf) cancelAnimationFrame(raf);
    writeLayer(orig, orig); render();
  };
  openModal({
    title, body,
    buttons: [
      { label: t('إلغاء'), onClick: () => { cancel(); closeModal(); } },
      { label: t('تطبيق'), primary: true, onClick: () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        writeLayer(orig, make(vals)(orig));
        pushHistory(); render(); refreshLayers();
        closeModal();
      } }
    ],
    onCancel: cancel
  });
  apply();
}

/* ---------- curves (draggable control points) ---------- */
function openCurves() {
  const l = canAdjust(); if (!l) return;
  const orig = cloneC(l.canvas);
  const xs = [0, 64, 128, 192, 255];
  const ys = [0, 64, 128, 192, 255];
  const size = 256;

  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  cv.className = 'curve';
  const cx = cv.getContext('2d');
  const toY = v => size - 1 - v;

  const drawCurve = () => {
    cx.clearRect(0, 0, size, size);
    cx.strokeStyle = '#333'; cx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      cx.beginPath(); cx.moveTo(i * 64, 0); cx.lineTo(i * 64, size); cx.stroke();
      cx.beginPath(); cx.moveTo(0, i * 64); cx.lineTo(size, i * 64); cx.stroke();
    }
    cx.strokeStyle = '#7fb6ff'; cx.lineWidth = 2;
    cx.beginPath();
    xs.forEach((x, i) => i ? cx.lineTo(x, toY(ys[i])) : cx.moveTo(x, toY(ys[i])));
    cx.stroke();
    cx.fillStyle = '#fff';
    xs.forEach((x, i) => { cx.beginPath(); cx.arc(x, toY(ys[i]), 5, 0, Math.PI * 2); cx.fill(); });
  };

  let raf = 0;
  const apply = () => {
    raf = 0;
    const lut = curveLUT(xs, ys);
    const out = pixelFilter(d => {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
      }
    })(orig);
    writeLayer(orig, out);
    render();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

  let drag = -1;
  const pt = e => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * size / r.width, y: (e.clientY - r.top) * size / r.height };
  };
  cv.addEventListener('pointerdown', e => {
    const p = pt(e);
    let best = -1, bd = 18;
    xs.forEach((x, i) => {
      const d = Math.hypot(p.x - x, p.y - toY(ys[i]));
      if (d < bd) { bd = d; best = i; }
    });
    drag = best;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', e => {
    if (drag < 0) return;
    const p = pt(e);
    ys[drag] = clamp(toY(p.y), 0, 255);
    if (drag === 0) ys[0] = clamp(ys[0], 0, 255);
    drawCurve(); schedule();
  });
  cv.addEventListener('pointerup', () => { drag = -1; });
  drawCurve();

  const body = document.createElement('div');
  body.className = 'ctrls';
  body.appendChild(cv);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = t('اسحب النقاط لتعديل المنحنى');
  body.appendChild(hint);

  const cancel = () => { if (raf) cancelAnimationFrame(raf); writeLayer(orig, orig); render(); };
  openModal({
    title: t('المنحنيات'), body,
    buttons: [
      { label: t('إلغاء'), onClick: () => { cancel(); closeModal(); } },
      { label: t('تطبيق'), primary: true, onClick: () => {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        const lut = curveLUT(xs, ys);
        writeLayer(orig, pixelFilter(d => {
          for (let i = 0; i < d.length; i += 4) {
            d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
          }
        })(orig));
        pushHistory(); render(); refreshLayers();
        closeModal();
      } }
    ],
    onCancel: cancel
  });
  apply();
}
