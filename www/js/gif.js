/* ===== GIF export for the animation studio: palette, LZW encoder and GIF writer ===== */

/* 256-colour palette: a 6x6x6 colour cube (216 entries) followed by a 40-step grey ramp */
const GIF_PALETTE = (() => {
  const p = new Uint8Array(256 * 3);
  for (let i = 0; i < 216; i++) {
    p[i * 3] = Math.floor(i / 36) * 51; p[i * 3 + 1] = Math.floor(i / 6) % 6 * 51; p[i * 3 + 2] = (i % 6) * 51;
  }
  for (let k = 0; k < 40; k++) { const v = Math.round(k / 39 * 255); const i = 216 + k; p[i * 3] = v; p[i * 3 + 1] = v; p[i * 3 + 2] = v; }
  return p;
})();

/* maps RGBA pixels to palette indices (greys go to the ramp, colours to the cube) */
function gifIndices(rgba) {
  const n = rgba.length / 4, out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 12) out[i] = 216 + Math.round((r + g + b) / 3 / 255 * 39);
    else out[i] = Math.round(r / 51) * 36 + Math.round(g / 51) * 6 + Math.round(b / 51);
  }
  return out;
}

/* LZW compression as used by GIF (variable code size, 4096-entry table) */
function gifLzw(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map();
  const out = [];
  let buf = 0, bits = 0;
  const emit = code => {
    buf |= code << bits; bits += codeSize;
    while (bits >= 8) { out.push(buf & 255); buf >>>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k;
    const got = dict.get(key);
    if (got !== undefined) { prefix = got; continue; }
    emit(prefix);
    dict.set(key, next++);
    if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    if (next >= 4095) {                       // table full: reset
      emit(clear);
      dict = new Map(); next = eoi + 1; codeSize = minCodeSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(buf & 255);
  return Uint8Array.from(out);
}

/* splits LZW data into the 255-byte sub-blocks GIF expects */
function gifSubBlocks(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.subarray(i, Math.min(bytes.length, i + 255));
    parts.push(Uint8Array.of(chunk.length), chunk);
  }
  parts.push(Uint8Array.of(0));
  return parts;
}

/* frames: array of { indices: Uint8Array, delay: centiseconds }, all w x h */
function encodeGif(w, h, frames, loop) {
  const parts = [];
  const u16 = v => Uint8Array.of(v & 255, (v >> 8) & 255);
  parts.push(new TextEncoder().encode('GIF89a'));
  parts.push(u16(w), u16(h), Uint8Array.of(0xf7, 0, 0));        // global palette, 256 entries
  parts.push(GIF_PALETTE);
  // NETSCAPE loop extension
  parts.push(Uint8Array.of(0x21, 0xff, 0x0b), new TextEncoder().encode('NETSCAPE2.0'),
    Uint8Array.of(0x03, 0x01), u16(loop ? 0 : 1), Uint8Array.of(0x00));
  frames.forEach(f => {
    parts.push(Uint8Array.of(0x21, 0xf9, 0x04, 0x04), u16(f.delay), Uint8Array.of(0x00, 0x00));  // no disposal, no transparency
    parts.push(Uint8Array.of(0x2c), u16(0), u16(0), u16(w), u16(h), Uint8Array.of(0x00));
    parts.push(Uint8Array.of(8));                                  // LZW minimum code size
    parts.push(...gifSubBlocks(gifLzw(f.indices, 8)));
  });
  parts.push(Uint8Array.of(0x3b));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  parts.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}
