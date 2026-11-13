// Tekent een paspop die de outfit draagt, in de kleuren en motieven van de gekozen stukken.
// Alles is SVG: gratis, lokaal en scherp op elk scherm.
import { hexToRgb, rgbToHex, hexToHsl } from './model.js';

const SKIN = '#d9a988';
const HAIR = '#3b2c24';
const SHOE = '#2b2a28';

const mix = (hex, target, t) => {
  const a = hexToRgb(hex), b = hexToRgb(target);
  return rgbToHex(a.map((v, i) => v + (b[i] - v) * t));
};
const shade = (hex, t = 0.18) => (hexToHsl(hex)[2] > 0.5 ? mix(hex, '#000000', t) : mix(hex, '#ffffff', t * 1.4));
const mirror = (pts) => pts.map(([x, y]) => [200 - x, y]);
const poly = (pts, fill, extra = '') => `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}" ${extra}/>`;

let uid = 0;

// Vulling voor een kledingstuk: effen kleur of een SVG-patroon.
function fillFor(item, defs, id) {
  const base = item.hex;
  const second = item.hex2 || shade(base, 0.35);
  switch (item.pattern) {
    case 'streep':
      defs.push(`<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${base}"/><rect width="8" height="3" fill="${second}"/></pattern>`);
      return `url(#${id})`;
    case 'ruit':
      defs.push(`<pattern id="${id}" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="${base}"/><rect width="14" height="5" fill="${second}" opacity=".55"/><rect width="5" height="14" fill="${second}" opacity=".55"/><rect y="9" width="14" height="1" fill="${shade(base, 0.5)}" opacity=".5"/></pattern>`);
      return `url(#${id})`;
    case 'motief':
      defs.push(`<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${base}"/><circle cx="5" cy="5" r="1.6" fill="${second}"/></pattern>`);
      return `url(#${id})`;
    default:
      return base;
  }
}

const OUTLINE = 'stroke="rgb(0 0 0 / .18)" stroke-width="1" stroke-linejoin="round"';

// Romp + mouwen van een bovenstuk. long = lange mouwen; length = waar de onderkant zit.
function top(fill, { long, bottom = 214, waist = 0 }) {
  const torso = [[64, 84], [86, 76], [114, 76], [136, 84], [140 + waist, bottom], [60 - waist, bottom]];
  const sleeveL = long
    ? [[64, 84], [46, 94], [33, 198], [49, 201], [61, 120]]
    : [[64, 84], [46, 94], [40, 130], [58, 133], [62, 112]];
  return poly(sleeveL, fill, OUTLINE) + poly(mirror(sleeveL), fill, OUTLINE) + poly(torso, fill, OUTLINE);
}

function collar(item, fill, layered) {
  const dark = shade(item.hex, 0.3);
  switch (item.category) {
    case 'tshirt':
      return `<path d="M88 77 Q100 ${layered ? 86 : 90} 112 77" fill="none" stroke="${dark}" stroke-width="3"/>`
        + (item.pattern === 'print' && !layered ? `<rect x="86" y="118" width="28" height="22" rx="3" fill="${item.hex2 || shade(item.hex, 0.55)}"/>` : '');
    case 'polo':
      return poly([[88, 74], [100, 92], [95, 98], [83, 82]], fill, OUTLINE) + poly(mirror([[88, 74], [100, 92], [95, 98], [83, 82]]), fill, OUTLINE)
        + (layered ? '' : `<line x1="100" y1="92" x2="100" y2="122" stroke="${dark}" stroke-width="1.5"/><circle cx="100" cy="104" r="1.6" fill="${dark}"/><circle cx="100" cy="115" r="1.6" fill="${dark}"/>`);
    case 'hemd':
      return poly([[86, 72], [100, 90], [93, 100], [80, 80]], fill, OUTLINE) + poly(mirror([[86, 72], [100, 90], [93, 100], [80, 80]]), fill, OUTLINE)
        + (layered ? '' : `<line x1="100" y1="90" x2="100" y2="212" stroke="${dark}" stroke-width="1.2"/>${[110, 132, 154, 176, 198].map((y) => `<circle cx="100" cy="${y}" r="1.6" fill="${dark}"/>`).join('')}`);
    default:
      return '';
  }
}

function legs(item, fill) {
  const short = item.category === 'short';
  const end = short ? 292 : 398;
  const L = [[60, 206], [100, 206], [99, end], [short ? 64 : 71, end]];
  const R = [[100, 206], [140, 206], [short ? 136 : 129, end], [101, end]];
  let svg = '';
  if (short) {
    // blote benen onder de short
    svg += poly([[67, 288], [97, 288], [95, 398], [74, 398]], SKIN) + poly(mirror([[67, 288], [97, 288], [95, 398], [74, 398]]), SKIN);
  }
  svg += poly(L, fill, OUTLINE) + poly(R, fill, OUTLINE);
  svg += `<rect x="60" y="204" width="80" height="8" fill="${shade(item.hex, 0.2)}"/>`; // tailleband
  if (!short && /jeans|denim/i.test(item.name || '')) {
    svg += `<path d="M66 214 Q76 222 86 214" fill="none" stroke="${shade(item.hex, 0.3)}" stroke-width="1"/><path d="M114 214 Q124 222 134 214" fill="none" stroke="${shade(item.hex, 0.3)}" stroke-width="1"/>`;
  }
  return svg;
}

// items: { onder, boven, laag } met artikels (of null). Geeft een SVG-string terug.
export function outfitFigure({ onder, boven, laag, jas, schoenen }, { width = 180 } = {}) {
  const p = `fig${++uid}-`;
  const defs = [];
  let body = '';

  // Hoofd, nek, handen
  body += `<rect x="92" y="60" width="16" height="20" rx="4" fill="${SKIN}"/>`;
  body += `<ellipse cx="100" cy="42" rx="21" ry="24" fill="${SKIN}"/>`;
  body += `<path d="M79 40 Q80 16 100 16 Q121 16 121 40 Q114 28 100 28 Q86 28 79 40 Z" fill="${HAIR}"/>`;
  const hands = `<circle cx="41" cy="206" r="8" fill="${SKIN}"/><circle cx="159" cy="206" r="8" fill="${SKIN}"/>`;
  // Armen (huid) als er geen lange mouwen zijn
  const arm = [[46, 94], [33, 198], [49, 201], [62, 112]];
  body += poly(arm, SKIN) + poly(mirror(arm), SKIN);

  // Benen en schoenen
  if (onder) body += legs(onder, fillFor(onder, defs, p + 'onder'));
  else body += poly([[62, 206], [99, 206], [97, 398], [72, 398]], '#bdb6ab', 'opacity=".5"') + poly(mirror([[62, 206], [99, 206], [97, 398], [72, 398]]), '#bdb6ab', 'opacity=".5"');
  body += `<ellipse cx="82" cy="404" rx="17" ry="7" fill="${schoenen?.hex || SHOE}"/><ellipse cx="118" cy="404" rx="17" ry="7" fill="${schoenen?.hex || SHOE}"/>`;

  // Bovenstuk(ken)
  if (boven) {
    const f = fillFor(boven, defs, p + 'boven');
    const long = boven.category === 'hemd';
    body += top(f, { long, bottom: 216 });
    if (!laag) body += collar(boven, f, false);
  }
  if (laag) {
    const f = fillFor(laag, defs, p + 'laag');
    body += top(f, { long: true, bottom: boven ? 206 : 214 });
    // ribboorden van de pull
    const rib = shade(laag.hex, 0.15);
    body += `<rect x="60" y="${boven ? 199 : 207}" width="80" height="7" fill="${rib}" ${OUTLINE}/>`;
    body += poly([[33, 192], [49, 195], [49, 201], [33, 198]], rib) + poly(mirror([[33, 192], [49, 195], [49, 201], [33, 198]]), rib);
    if (boven) body += collar(boven, fillFor(boven, defs, p + 'boven2'), true);
    else body += `<path d="M86 77 Q100 92 114 77" fill="none" stroke="${rib}" stroke-width="5"/>`;
    if (boven?.category === 'tshirt') body += `<path d="M86 77 Q100 92 114 77" fill="none" stroke="${rib}" stroke-width="4"/>`;
  }
  if (!boven && !laag) body += poly([[64, 84], [86, 76], [114, 76], [136, 84], [140, 214], [60, 214]], '#bdb6ab', 'opacity=".5"');
  if (jas) {
    // Open jas: mouwen en twee voorpanden, het bovenstuk blijft in het midden zichtbaar.
    const f = fillFor(jas, defs, p + 'jas');
    const sleeve = [[64, 84], [44, 93], [30, 198], [51, 202], [62, 120]];
    const panel = [[62, 84], [86, 75], [91, 82], [87, 228], [55, 228]];
    const lapel = [[86, 75], [91, 82], [85, 116], [77, 86]];
    body += poly(sleeve, f, OUTLINE) + poly(mirror(sleeve), f, OUTLINE) + poly(panel, f, OUTLINE) + poly(mirror(panel), f, OUTLINE)
      + poly(lapel, shade(jas.hex, 0.14), OUTLINE) + poly(mirror(lapel), shade(jas.hex, 0.14), OUTLINE);
  }
  body += hands;

  return `<svg class="figure" viewBox="20 8 160 408" width="${width}" role="img" aria-label="Paspop met deze outfit" xmlns="http://www.w3.org/2000/svg">
    <defs>${defs.join('')}</defs>
    <ellipse cx="100" cy="410" rx="62" ry="6" fill="rgb(0 0 0 / .12)"/>
    ${body}
  </svg>`;
}
