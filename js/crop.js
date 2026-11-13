// Uitsnijden: sleep een kader rond één stuk op een foto met meerdere kledingstukken.
import { loadImage } from './analyze.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Toont de foto met een sleepbaar kader in `host`. onApply krijgt de uitgesneden foto (JPEG data-URL).
export function mountCropper(host, src, { onApply, onCancel, hint = 'Sleep een kader rond het stuk dat je wilt bewaren.' }) {
  host.innerHTML = `
    <div class="crop-wrap"><img class="crop-img" src="${src.replace(/"/g, '&quot;')}" alt="" draggable="false"><div class="crop-box" hidden></div></div>
    <p class="sub crop-hint">${hint}</p>
    <div class="row-actions">
      <button type="button" class="btn primary" data-crop-ok disabled>✂︎ Uitsnijden</button>
      <button type="button" class="btn ghost" data-crop-cancel>Annuleren</button>
    </div>`;
  const wrap = host.querySelector('.crop-wrap');
  const img = host.querySelector('.crop-img');
  const box = host.querySelector('.crop-box');
  const ok = host.querySelector('[data-crop-ok]');
  let start = null;
  let rect = null;

  const pos = (e) => {
    const r = img.getBoundingClientRect();
    return [clamp(e.clientX - r.left, 0, r.width), clamp(e.clientY - r.top, 0, r.height)];
  };
  wrap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    start = pos(e);
    rect = null;
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!start) return;
    const [x, y] = pos(e);
    rect = { x: Math.min(x, start[0]), y: Math.min(y, start[1]), w: Math.abs(x - start[0]), h: Math.abs(y - start[1]) };
    Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.w + 'px', height: rect.h + 'px' });
    box.hidden = false;
  });
  const end = () => {
    start = null;
    ok.disabled = !rect || rect.w < 12 || rect.h < 12;
    if (ok.disabled) box.hidden = true;
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);

  ok.addEventListener('click', async () => {
    const shown = img.getBoundingClientRect();
    try {
      const full = await loadImage(src); // met CORS, zodat het canvas leesbaar blijft
      const sx = full.naturalWidth / shown.width, sy = full.naturalHeight / shown.height;
      const w = Math.round(rect.w * sx), h = Math.round(rect.h * sy);
      const scale = Math.min(1, 900 / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(full, rect.x * sx, rect.y * sy, w, h, 0, 0, c.width, c.height);
      onApply(c.toDataURL('image/jpeg', 0.85));
    } catch {
      host.querySelector('.crop-hint').textContent = 'Deze foto kan niet uitgesneden worden (de website staat het niet toe). Voeg ze toe via een foto of screenshot.';
    }
  });
  host.querySelector('[data-crop-cancel]').addEventListener('click', () => onCancel?.());
}
