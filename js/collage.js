// Legt de outfit neer zoals op een bed: de uitgeknipte foto's van de stukken op hun plaats,
// zonder persoon. Gratis en volledig op het toestel.
import { loadImage } from './analyze.js';
import { cutout } from './cutout.js';

const W = 600, H = 780;

// Vakken per stuk: [x, y, breedte, hoogte]. De indeling schuift op als er een jas of pull bij is.
export function layout(o) {
  const boxes = {};
  const wide = o.jas || (o.laag && o.boven);
  if (o.boven) boxes.boven = wide ? [150, 40, 290, 320] : [130, 30, 340, 350];
  if (o.laag) boxes.laag = o.boven ? [300, 80, 280, 310] : (o.jas ? [170, 40, 290, 320] : [130, 30, 340, 350]);
  if (o.jas) boxes.jas = [10, 60, 270, 340];
  if (o.onder) boxes.onder = [160, 335, 280, 420];
  if (o.schoenen) boxes.schoenen = [440, 610, 150, 150];
  if (o.accessoire) boxes.accessoire = [15, 620, 130, 130];
  return boxes;
}
const ORDER = ['jas', 'onder', 'boven', 'laag', 'schoenen', 'accessoire'];

const cache = new Map();
export const collageKey = (o) => ORDER.map((k) => (o[k] ? `${o[k].id}:${o[k].image.length}` : '')).join('|');

// Geeft een JPEG data-URL van de neergelegde outfit.
export function collage(o) {
  const key = collageKey(o);
  if (!cache.has(key)) cache.set(key, draw(o).catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

async function draw(o) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  // Ondergrond: licht linnen met een zachte vignettering.
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H / 2, H * 0.75);
  g.addColorStop(0, '#f6f2ea'); g.addColorStop(1, '#e4ddd0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const boxes = layout(o);
  for (const slot of ORDER) {
    const it = o[slot];
    if (!it) continue;
    const [bx, by, bw, bh] = boxes[slot];
    const cut = await cutout(it.image);
    ctx.save();
    ctx.shadowColor = 'rgba(40, 30, 20, .28)';
    ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    if (cut) {
      const r = Math.min(bw / cut.width, bh / cut.height);
      const w = cut.width * r, h = cut.height * r;
      ctx.drawImage(cut, bx + (bw - w) / 2, by + (bh - h) / 2, w, h);
    } else {
      // Uitknippen lukte niet (drukke achtergrond): toon de foto als kaartje.
      let img = null;
      try { img = await loadImage(it.image); } catch { /* foto niet leesbaar */ }
      const iw = img?.naturalWidth || 3, ih = img?.naturalHeight || 4;
      const r = Math.min((bw - 24) / iw, (bh - 24) / ih);
      const w = iw * r, h = ih * r, x = bx + (bw - w) / 2, y = by + (bh - h) / 2;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.roundRect(x - 6, y - 6, w + 12, h + 12, 10); ctx.fill();
      ctx.shadowColor = 'transparent';
      if (img) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.clip(); ctx.drawImage(img, x, y, w, h); }
      else { ctx.fillStyle = it.hex || '#bbb'; ctx.fillRect(x, y, w, h); }
    }
    ctx.restore();
  }
  return c.toDataURL('image/jpeg', 0.9);
}
