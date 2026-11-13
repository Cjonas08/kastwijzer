// Knipt een kledingstuk uit zijn foto: de egale achtergrond wordt doorzichtig.
// Werkt volledig op het toestel (gratis, geen AI-dienst). Het beste resultaat krijg je met
// een stuk op een effen achtergrond (productfoto, of plat op een laken of tafel).
import { loadImage } from './analyze.js';

const dist = (d, i, r, g, b) => Math.hypot(d[i] - r, d[i + 1] - g, d[i + 2] - b);

// Zuivere functie op pixels (ook bruikbaar in tests). Geeft null als uitknippen niet betrouwbaar is.
// Resultaat: { alpha: Uint8Array, box: {x, y, w, h}, kept } met kept = aandeel dat overblijft.
export function maskFromPixels(data, w, h, { tolerance = 34 } = {}) {
  // Achtergrondkleur = mediaan van de rand.
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const med = (c) => { const v = border.map((p) => data[p * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const [br, bg, bb] = [med(0), med(1), med(2)];
  // Is de rand wel egaal? Anders is er geen duidelijke achtergrond.
  const off = border.filter((p) => dist(data, p * 4, br, bg, bb) > tolerance * 1.6).length / border.length;
  if (off > 0.35) return null;

  // Vanaf de rand naar binnen vullen: alles wat op de achtergrond lijkt en ermee verbonden is.
  const isBg = new Uint8Array(w * h);
  const stack = [];
  const visit = (p, from) => {
    if (isBg[p]) return;
    const i = p * 4;
    const d = dist(data, i, br, bg, bb);
    // Dicht bij de achtergrondkleur, of een zachte overgang (schaduw, verloop) vanaf een buur.
    const soft = from >= 0 && d < tolerance * 2.2 && dist(data, i, data[from * 4], data[from * 4 + 1], data[from * 4 + 2]) < 7;
    if (d < tolerance || soft) { isBg[p] = 1; stack.push(p); }
  };
  border.forEach((p) => visit(p, -1));
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p / w) | 0;
    if (x > 0) visit(p - 1, p);
    if (x < w - 1) visit(p + 1, p);
    if (y > 0) visit(p - w, p);
    if (y < h - 1) visit(p + w, p);
  }

  // Smalle inhammen dichten: witte ruiten of strepen aan de rand van een stuk horen bij het stuk,
  // ook al raken ze de (witte) achtergrond. Eerst het stuk verdikken, dan weer even ver verdunnen.
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.025));
  const grown = spread(isBg, w, h, r, 0);        // 0 = stuk: breidt het stuk uit
  const closed = spread(grown, w, h, r, 1);      // 1 = achtergrond: breidt de achtergrond weer uit
  for (let p = 0; p < w * h; p++) if (isBg[p] && !closed[p]) isBg[p] = 0;

  let kept = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let p = 0; p < w * h; p++) {
    if (isBg[p]) continue;
    kept++;
    const x = p % w, y = (p / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const share = kept / (w * h);
  if (share < 0.06 || share > 0.93) return null; // bijna alles of bijna niets weg: niet te vertrouwen

  // Zachte rand: gemiddelde van de 3x3-buurt.
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      n++; s += isBg[yy * w + xx] ? 0 : 1;
    }
    alpha[y * w + x] = isBg[y * w + x] ? 0 : Math.round((s / n) * 255);
  }
  return { alpha, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, kept: share };
}

// Breidt alle pixels met waarde `v` uit met r pixels (vierkant venster), eerst per rij, dan per kolom.
function spread(mask, w, h, r, v) {
  const pass = (src, len, step, start) => {
    const out = new Uint8Array(src.length);
    for (let line = 0; line < start.length; line++) {
      let last = -Infinity;
      const near = new Uint8Array(len);
      for (let i = 0; i < len; i++) { if (src[start[line] + i * step] === v) last = i; if (i - last <= r) near[i] = 1; }
      last = Infinity;
      for (let i = len - 1; i >= 0; i--) { if (src[start[line] + i * step] === v) last = i; if (last - i <= r) near[i] = 1; }
      for (let i = 0; i < len; i++) out[start[line] + i * step] = near[i] ? v : src[start[line] + i * step];
    }
    return out;
  };
  const rows = pass(mask, w, 1, [...Array(h)].map((_, y) => y * w));
  return pass(rows, h, w, [...Array(w)].map((_, x) => x));
}

const cache = new Map(); // foto -> Promise<canvas | null>

// Geeft een canvas met het uitgeknipte stuk (doorzichtige achtergrond), of null als het niet lukt.
export function cutout(src, max = 520) {
  if (!cache.has(src)) cache.set(src, make(src, max).catch(() => null));
  return cache.get(src);
}

async function make(src, max) {
  const img = await loadImage(src);
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * r)), h = Math.max(1, Math.round(img.naturalHeight * r));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h);
  const m = maskFromPixels(px.data, w, h);
  if (!m) return null;
  for (let p = 0; p < w * h; p++) px.data[p * 4 + 3] = m.alpha[p];
  ctx.putImageData(px, 0, 0);
  const out = document.createElement('canvas');
  out.width = m.box.w; out.height = m.box.h;
  out.getContext('2d').drawImage(c, m.box.x, m.box.y, m.box.w, m.box.h, 0, 0, m.box.w, m.box.h);
  return out;
}
