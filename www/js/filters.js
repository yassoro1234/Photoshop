/* ===== More filters: box, motion and radial blur, unsharp mask, wave, ripple, twirl, spherize,
   pinch, noise reduction, high pass and offset. Each is a pixel filter with live preview (adjust.js). ===== */

/* a filter that writes a new pixel array of the same size: fn(data, w, h, p) -> Uint8ClampedArray */
function dataFilter(fn) {
  return p => src => {
    const out = cloneC(src), x = out.getContext('2d');
    const w = out.width, h = out.height;
    const res = fn(x.getImageData(0, 0, w, h).data, w, h, p);
    x.putImageData(new ImageData(res, w, h), 0, 0);
    return out;
  };
}
/* a filter that moves pixels: map(x, y, m) sets m[0], m[1] to the source position for (x, y) */
function remapPixels(src, map) {
  const w = src.width, h = src.height;
  const out = cloneC(src), x = out.getContext('2d');
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const img = x.createImageData(w, h), d = img.data, m = [0, 0];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      map(px, py, m);
      const ix = clamp(Math.round(m[0]), 0, w - 1), iy = clamp(Math.round(m[1]), 0, h - 1);
      const si = (iy * w + ix) * 4, di = (py * w + px) * 4;
      d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
    }
  }
  x.putImageData(img, 0, 0);
  return out;
}
/* separable box blur with running sums; radius r in pixels */
function boxBlurData(src, w, h, r) {
  const tmp = new Float32Array(w * h * 4), out = new Uint8ClampedArray(w * h * 4), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[(y * w + clamp(k, 0, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / n;
        sum += src[(y * w + clamp(x + r + 1, 0, w - 1)) * 4 + c] - src[(y * w + clamp(x - r, 0, w - 1)) * 4 + c];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[(clamp(k, 0, h - 1) * w + x) * 4 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / n;
        sum += tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 4 + c] - tmp[(clamp(y - r, 0, h - 1) * w + x) * 4 + c];
      }
    }
  }
  return out;
}
const lerpN = (a, b, t) => a + (b - a) * t;

function extraFilterDefs() {
  return {
    boxBlur: {
      label: t('طمس صندوقي'),
      controls: [{ k: 'r', label: t('نصف القطر'), min: 0, max: 30, step: 1, val: 4 }],
      make: dataFilter((d, w, h, p) => boxBlurData(d, w, h, Math.round(p.r)))
    },
    motionBlur: {
      label: t('طمس الحركة'),
      controls: [
        { k: 'ang', label: t('الزاوية'), min: -180, max: 180, step: 1, val: 0 },
        { k: 'dist', label: t('المسافة'), min: 1, max: 60, step: 1, val: 12 }
      ],
      make: dataFilter((d, w, h, p) => {
        const th = p.ang * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
        const steps = Math.min(30, Math.max(1, Math.round(p.dist)));
        const o = new Uint8ClampedArray(d.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let s = 0; s < steps; s++) {
              const tt = steps === 1 ? 0 : (s / (steps - 1) - 0.5) * p.dist;
              const sx = clamp(Math.round(x + cs * tt), 0, w - 1), sy = clamp(Math.round(y + sn * tt), 0, h - 1);
              const k = (sy * w + sx) * 4;
              r += d[k]; g += d[k + 1]; b += d[k + 2]; a += d[k + 3];
            }
            const i = (y * w + x) * 4;
            o[i] = r / steps; o[i + 1] = g / steps; o[i + 2] = b / steps; o[i + 3] = a / steps;
          }
        }
        return o;
      })
    },
    radialBlur: {
      label: t('طمس دوراني'),
      controls: [{ k: 'a', label: t('الكمية'), min: 1, max: 60, step: 1, val: 10 }],
      make: dataFilter((d, w, h, p) => {
        const cx = w / 2, cy = h / 2, N = 12, span = p.a * Math.PI / 180;
        const o = new Uint8ClampedArray(d.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dx = x - cx, dy = y - cy;
            let r = 0, g = 0, b = 0, a = 0;
            for (let s = 0; s < N; s++) {
              const an = (s / (N - 1) - 0.5) * span, c = Math.cos(an), sn = Math.sin(an);
              const sx = clamp(Math.round(cx + dx * c - dy * sn), 0, w - 1), sy = clamp(Math.round(cy + dx * sn + dy * c), 0, h - 1);
              const k = (sy * w + sx) * 4;
              r += d[k]; g += d[k + 1]; b += d[k + 2]; a += d[k + 3];
            }
            const i = (y * w + x) * 4;
            o[i] = r / N; o[i + 1] = g / N; o[i + 2] = b / N; o[i + 3] = a / N;
          }
        }
        return o;
      })
    },
    unsharp: {
      label: t('تحديد حاد (قناع غير حاد)'),
      controls: [
        { k: 'a', label: t('الكمية %'), min: 0, max: 500, step: 5, val: 100 },
        { k: 'r', label: t('نصف القطر'), min: 1, max: 20, step: 1, val: 2 }
      ],
      make: dataFilter((d, w, h, p) => {
        const b = boxBlurData(d, w, h, Math.max(1, Math.round(p.r)));
        const o = new Uint8ClampedArray(d.length), k = p.a / 100;
        for (let i = 0; i < d.length; i += 4) {
          for (let c = 0; c < 3; c++) o[i + c] = d[i + c] + (d[i + c] - b[i + c]) * k;
          o[i + 3] = d[i + 3];
        }
        return o;
      })
    },
    wave: {
      label: t('موجة'),
      controls: [
        { k: 'amp', label: t('السعة'), min: 0, max: 60, step: 1, val: 10 },
        { k: 'wl', label: t('الطول الموجي'), min: 10, max: 400, step: 5, val: 80 }
      ],
      make: p => src => remapPixels(src, (x, y, m) => {
        m[0] = x + p.amp * Math.sin(2 * Math.PI * y / p.wl); m[1] = y;
      })
    },
    ripple: {
      label: t('تموج'),
      controls: [
        { k: 'amp', label: t('السعة'), min: 0, max: 60, step: 1, val: 10 },
        { k: 'wl', label: t('الطول الموجي'), min: 10, max: 400, step: 5, val: 80 }
      ],
      make: p => src => {
        const cx = src.width / 2, cy = src.height / 2;
        return remapPixels(src, (x, y, m) => {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
          if (r < 1) { m[0] = x; m[1] = y; return; }
          const r2 = r + p.amp * Math.sin(2 * Math.PI * r / p.wl);
          m[0] = cx + dx * r2 / r; m[1] = cy + dy * r2 / r;
        });
      }
    },
    twirl: {
      label: t('دوامة'),
      controls: [{ k: 'ang', label: t('الزاوية'), min: -360, max: 360, step: 5, val: 90 }],
      make: p => src => {
        const cx = src.width / 2, cy = src.height / 2, R = Math.min(src.width, src.height) / 2;
        return remapPixels(src, (x, y, m) => {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
          if (r >= R) { m[0] = x; m[1] = y; return; }
          const th = -(p.ang * Math.PI / 180) * (1 - r / R) * (1 - r / R);
          const c = Math.cos(th), s = Math.sin(th);
          m[0] = cx + dx * c - dy * s; m[1] = cy + dx * s + dy * c;
        });
      }
    },
    spherize: {
      label: t('كروي'),
      controls: [{ k: 'a', label: t('الكمية'), min: -100, max: 100, step: 1, val: 50 }],
      make: p => src => {
        const cx = src.width / 2, cy = src.height / 2, R = Math.min(src.width, src.height) / 2, a = p.a / 100;
        return remapPixels(src, (x, y, m) => {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), f = r / R;
          if (f >= 1 || r < 1e-6) { m[0] = x; m[1] = y; return; }
          const sf = a >= 0 ? lerpN(f, 1 - Math.sqrt(1 - f * f), a) : lerpN(f, 2 / Math.PI * Math.asin(f), -a);
          m[0] = cx + dx / r * sf * R; m[1] = cy + dy / r * sf * R;
        });
      }
    },
    pinch: {
      label: t('ضغط'),
      controls: [{ k: 'a', label: t('الكمية'), min: -100, max: 100, step: 1, val: 50 }],
      make: p => src => {
        const cx = src.width / 2, cy = src.height / 2, R = Math.min(src.width, src.height) / 2, e = 1 + p.a / 100;
        return remapPixels(src, (x, y, m) => {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), f = r / R;
          if (f >= 1 || r < 1e-6) { m[0] = x; m[1] = y; return; }
          const sf = Math.pow(f, e);
          m[0] = cx + dx / r * sf * R; m[1] = cy + dy / r * sf * R;
        });
      }
    },
    reduceNoise: {
      label: t('تقليل الضوضاء'),
      controls: [{ k: 'th', label: t('القوة'), min: 0, max: 60, step: 1, val: 12 }],
      make: dataFilter((d, w, h, p) => {
        const o = new Uint8ClampedArray(d);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (d[i + 3] === 0) continue;
            for (let c = 0; c < 3; c++) {
              let sum = 0, n = 0;
              for (let yy = -1; yy <= 1; yy++) {
                for (let xx = -1; xx <= 1; xx++) {
                  const sx = clamp(x + xx, 0, w - 1), sy = clamp(y + yy, 0, h - 1), k = (sy * w + sx) * 4;
                  if (Math.abs(d[k + c] - d[i + c]) <= p.th) { sum += d[k + c]; n++; }
                }
              }
              o[i + c] = sum / n;
            }
          }
        }
        return o;
      })
    },
    highPass: {
      label: t('تمرير عالٍ'),
      controls: [{ k: 'r', label: t('نصف القطر'), min: 1, max: 50, step: 1, val: 10 }],
      make: dataFilter((d, w, h, p) => {
        const b = boxBlurData(d, w, h, Math.round(p.r));
        const o = new Uint8ClampedArray(d.length);
        for (let i = 0; i < d.length; i += 4) {
          for (let c = 0; c < 3; c++) o[i + c] = d[i + c] - b[i + c] + 128;
          o[i + 3] = d[i + 3];
        }
        return o;
      })
    },
    curves: {
      label: t('منحنى الألوان'),
      controls: [0, 1, 2, 3, 4].map(i => ({ k: 'p' + i, label: [t('الظلال'), t('ربع الظل'), t('المتوسطات'), t('ربع الضوء'), t('الضوء')][i], min: 0, max: 255, step: 1, val: [0, 64, 128, 192, 255][i] })),
      make: dataFilter((d, w, h, p) => {
        // five control points at inputs 0, 64, 128, 192, 255; linear between them
        const ys = [p.p0, p.p1, p.p2, p.p3, p.p4], xs = [0, 64, 128, 192, 255];
        const lut = new Uint8ClampedArray(256);
        for (let v = 0; v < 256; v++) {
          let s = 0;
          while (s < 3 && v > xs[s + 1]) s++;
          const t = (v - xs[s]) / (xs[s + 1] - xs[s]);
          lut[v] = clamp(lerpN(ys[s], ys[s + 1], t), 0, 255);
        }
        const o = new Uint8ClampedArray(d.length);
        for (let i = 0; i < d.length; i += 4) { o[i] = lut[d[i]]; o[i + 1] = lut[d[i + 1]]; o[i + 2] = lut[d[i + 2]]; o[i + 3] = d[i + 3]; }
        return o;
      })
    },
    rangeBalance: {
      label: t('توازن الألوان بالنطاق'),
      controls: [
        { k: 'sr', label: t('ظلال: أحمر/سماوي'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'sg', label: t('ظلال: أخضر/أرجواني'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'sb', label: t('ظلال: أزرق/أصفر'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'mr', label: t('متوسطات: أحمر/سماوي'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'mg', label: t('متوسطات: أخضر/أرجواني'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'mb', label: t('متوسطات: أزرق/أصفر'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'hr', label: t('ضوء: أحمر/سماوي'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'hg', label: t('ضوء: أخضر/أرجواني'), min: -100, max: 100, step: 1, val: 0 },
        { k: 'hb', label: t('ضوء: أزرق/أصفر'), min: -100, max: 100, step: 1, val: 0 }
      ],
      make: dataFilter((d, w, h, p) => {
        const o = new Uint8ClampedArray(d.length), K = 0.8;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const ws = 1 - L, wh = L, wm = 1 - Math.abs(2 * L - 1);
          o[i] = r + K * (ws * p.sr + wm * p.mr + wh * p.hr);
          o[i + 1] = g + K * (ws * p.sg + wm * p.mg + wh * p.hg);
          o[i + 2] = b + K * (ws * p.sb + wm * p.mb + wh * p.hb);
          o[i + 3] = d[i + 3];
        }
        return o;
      })
    },
    solidFill: {
      label: t('تعبئة بلون'),
      controls: [
        { k: 'r', label: t('أحمر'), min: 0, max: 255, step: 1, val: 255 },
        { k: 'g', label: t('أخضر'), min: 0, max: 255, step: 1, val: 255 },
        { k: 'b', label: t('أزرق'), min: 0, max: 255, step: 1, val: 255 },
        { k: 'a', label: t('التغطية %'), min: 0, max: 100, step: 1, val: 100 }
      ],
      make: p => src => {
        const out = cloneC(src), x = out.getContext('2d');
        x.globalAlpha = p.a / 100;
        x.fillStyle = `rgb(${p.r | 0},${p.g | 0},${p.b | 0})`;
        x.fillRect(0, 0, out.width, out.height);
        return out;
      }
    },
    offset: {
      label: t('إزاحة'),
      controls: [
        { k: 'dx', label: t('أفقياً'), min: -300, max: 300, step: 1, val: 0 },
        { k: 'dy', label: t('رأسياً'), min: -300, max: 300, step: 1, val: 0 }
      ],
      make: dataFilter((d, w, h, p) => {
        const o = new Uint8ClampedArray(d.length);
        const dx = Math.round(p.dx), dy = Math.round(p.dy);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const sx = ((x - dx) % w + w) % w, sy = ((y - dy) % h + h) % h;
            const i = (y * w + x) * 4, k = (sy * w + sx) * 4;
            o[i] = d[k]; o[i + 1] = d[k + 1]; o[i + 2] = d[k + 2]; o[i + 3] = d[k + 3];
          }
        }
        return o;
      })
    }
  };
}
