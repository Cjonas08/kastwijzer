// Gratis, lokale beeldanalyse: haalt de hoofdkleur en een eventueel motief uit de foto.
// Alles gebeurt in de browser; er gaat niets naar een server.
import { rgbToHex, rgbToHsl, colorName, defaultSeason } from './model.js';

const PROXY = 'https://api.allorigins.win/raw?url=';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:') && !src.startsWith('blob:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Afbeelding kon niet geladen worden'));
    img.src = src;
  });
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function median(px) {
  const ch = [0, 1, 2].map((i) => px.map((p) => p[i]).sort((a, b) => a - b)[px.length >> 1]);
  return ch;
}

function kmeans(points, k, iters = 10) {
  // Startpunten: gemiddelde, daarna telkens het verste punt.
  const mean = [0, 1, 2].map((i) => points.reduce((s, p) => s + p[i], 0) / points.length);
  const centers = [mean];
  while (centers.length < k) {
    let best = null, bestD = -1;
    for (let i = 0; i < points.length; i += 3) {
      const d = Math.min(...centers.map((c) => dist(points[i], c)));
      if (d > bestD) { bestD = d; best = points[i]; }
    }
    centers.push([...best]);
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => {
      let bi = 0, bd = Infinity;
      centers.forEach((c, j) => { const d = dist(p, c); if (d < bd) { bd = d; bi = j; } });
      assign[i] = bi;
      const s = sums[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    sums.forEach((s, j) => { if (s[3]) centers[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const members = centers.map(() => []);
  assign.forEach((a, i) => members[a].push(points[i]));
  return centers
    .map((c, j) => ({ c, members: members[j], share: members[j].length / points.length }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.share - a.share);
}

// Zijn twee kleuren duidelijk verschillend (en niet gewoon licht/schaduw van dezelfde stof)?
function distinct(a, b) {
  const [h1, s1, l1] = rgbToHsl(a), [h2, s2, l2] = rgbToHsl(b);
  const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
  if (Math.abs(l1 - l2) > 0.25) return true;
  return s1 > 0.25 && s2 > 0.25 && dh > 35;
}

export async function analyzeImage(src) {
  const img = await loadImage(src);
  const N = 100;
  const r = Math.min(N / img.naturalWidth, N / img.naturalHeight);
  const w = Math.max(8, Math.round(img.naturalWidth * r));
  const h = Math.max(8, Math.round(img.naturalHeight * r));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data; // gooit een fout bij afbeeldingen zonder CORS
  const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  // 1. Achtergrond schatten uit de bovenrand en de bovenste 70% van de zijkanten
  //    (een kledingstuk raakt vaak de onderrand van de foto).
  const border = [];
  for (let x = 0; x < w; x++) for (const y of [0, 1]) border.push(px(x, y));
  for (let y = 0; y < h * 0.7; y++) for (const x of [0, 1, w - 2, w - 1]) border.push(px(x, y));
  const bg = median(border);
  const bgSpread = border.reduce((s, p) => s + dist(p, bg), 0) / border.length;
  const threshold = bgSpread < 25 ? 40 : 75;

  // 2. Voorgrond: pixels die duidelijk van de achtergrond verschillen, in het midden van de foto.
  let fg = [];
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x / w - 0.5, dy = y / h - 0.5;
      if (Math.abs(dx) > 0.42 || Math.abs(dy) > 0.45) continue;
      const p = px(x, y);
      if (dist(p, bg) > threshold) { fg.push(p); mask[y * w + x] = 1; }
    }
  }
  if (fg.length < w * h * 0.06) {
    fg = []; mask.fill(0);
    for (let y = Math.floor(h * 0.25); y < h * 0.75; y++) {
      for (let x = Math.floor(w * 0.28); x < w * 0.72; x++) { fg.push(px(x, y)); mask[y * w + x] = 1; }
    }
  }

  // 3. Kleurgroepen zoeken.
  const clusters = kmeans(fg, 4);
  const main = clusters[0];
  const others = clusters.slice(1).filter((c) => c.share > 0.14 && distinct(c.c, main.c));

  // 4. Hoe "druk" is de stof? (gemiddeld helderheidsverschil tussen buurpixels)
  const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
  let edge = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) {
    if (mask[y * w + x] && mask[y * w + x + 1]) { edge += Math.abs(lum(px(x, y)) - lum(px(x + 1, y))); n++; }
  }
  edge = n ? edge / n : 0;

  // Voorzichtig: enkel "motief" als er een tweede duidelijke kleur is én de stof onrustig is.
  const patterned = others.length > 0 && edge > 17;
  // Schaduwplooien maken het gemiddelde te donker: neem het lichtere deel van de hoofdgroep.
  const sorted = main.members.slice().sort((p, q) => lum(p) - lum(q));
  const part = sorted.slice(Math.floor(sorted.length * 0.45), Math.max(Math.floor(sorted.length * 0.9), Math.floor(sorted.length * 0.45) + 1));
  const rep = [0, 1, 2].map((i) => part.reduce((s, p) => s + p[i], 0) / part.length);
  const hex = rgbToHex(rep);
  return {
    hex,
    hex2: others[0] ? rgbToHex(others[0].c) : null,
    pattern: patterned ? 'motief' : 'effen',
    colorName: colorName(hex),
    debug: { mainShare: +main.share.toFixed(2), edge: +edge.toFixed(1), bgSpread: +bgSpread.toFixed(1), fg: fg.length },
  };
}

// ---------- Tekst (naam van het artikel of titel van de webshop) ----------
const RULES = [
  [/schoen|sneaker|loafer|laars|laarzen|boots?\b|sandaal|sandalen|slipper|espadrille|mocassin|derby|brogue/i, 'schoenen'],
  [/\bjas\b|jasje|jacket|\bjack\b|blazer|mantel|parka|bomber|trenchcoat|regenjas|bodywarmer|overshirt|colbert/i, 'jas'],
  [/riem|sjaal|\bmuts\b|\bpet\b|\bcap\b|horloge|das\b|stropdas|zonnebril|handschoen|tas\b|rugzak/i, 'accessoire'],
  [/\bshorts?\b|bermuda|zwembroek/i, 'short'],
  [/t-?shirt|\btee\b|longsleeve/i, 'tshirt'],
  [/\bpolo/i, 'polo'],
  [/pull|trui|sweater|sweat|hoodie|cardigan|vest\b|knit|gebreid/i, 'pull'],
  [/hemd|overhemd|blouse|oxford|flanel|button[- ]?(down|up)|\bshirt\b/i, 'hemd'],
  [/broek|jeans|chino|pantalon|trousers|pants|jogger|cargo|denim/i, 'broek'],
];

// Kleurwoorden in de omschrijving ("de lichtblauwe jeans", "navy sweater"). Langste eerst.
const COLOR_WORDS = [
  ['donkerblauw', '#1f2a44'], ['marineblauw', '#1f2a44'], ['marine', '#1f2a44'], ['navy', '#1f2a44'],
  ['lichtblauw', '#aec7e6'], ['light blue', '#aec7e6'], ['jeansblauw', '#5f7fa6'],
  ['lichtgrijs', '#c8c8c8'], ['lichtgrijze', '#c8c8c8'], ['donkergrijs', '#4a4a4c'], ['donkergrijze', '#4a4a4c'], ['antraciet', '#3a3a3c'], ['charcoal', '#3a3a3c'],
  ['donkergroen', '#2f4f36'], ['saliegroen', '#9aa685'], ['salie', '#9aa685'], ['sage', '#9aa685'], ['olijf', '#6b6b3a'], ['olive', '#6b6b3a'],
  ['bordeaux', '#6d1f2c'], ['burgundy', '#6d1f2c'], ['turquoise', '#3fb0b0'], ['petrol', '#1f5560'],
  ['crème', '#ece4d4'], ['creme', '#ece4d4'], ['ecru', '#ece4d4'], ['offwhite', '#efeae0'], ['off-white', '#efeae0'],
  ['beige', '#cdb994'], ['zand', '#cdb994'], ['kaki', '#b3a073'], ['khaki', '#b3a073'], ['camel', '#b5814a'], ['cognac', '#9a5b2e'],
  ['bruin', '#6b4228'], ['brown', '#6b4228'], ['zwart', '#1c1c1c'], ['black', '#1c1c1c'], ['wit', '#f2f2f2'], ['white', '#f2f2f2'],
  ['grijs', '#8a8a8a'], ['grijze', '#8a8a8a'], ['grey', '#8a8a8a'], ['gray', '#8a8a8a'], ['blauw', '#2f5fa8'], ['blue', '#2f5fa8'],
  ['groen', '#3f7a4a'], ['green', '#3f7a4a'], ['rood', '#b3302f'], ['rode', '#b3302f'], ['red', '#b3302f'], ['roze', '#e6a3b4'], ['pink', '#e6a3b4'],
  ['geel', '#e3c34a'], ['gele', '#e3c34a'], ['yellow', '#e3c34a'], ['oranje', '#e07b39'], ['orange', '#e07b39'], ['lila', '#c8b6e2'], ['paars', '#6a4c93'], ['purple', '#6a4c93'],
];

export function guessFromText(text = '') {
  const out = {};
  const low = text.toLowerCase();
  for (const [word, hex] of COLOR_WORDS) if (low.includes(word)) { out.hex = hex; out.colorWord = word; break; }
  for (const [re, cat] of RULES) if (re.test(text)) { out.category = cat; break; }
  if (/jogging|jogger|track|sport|dry-?fit|training|running/i.test(text)) out.looks = ['sportief', 'casual'];
  else if (/blazer|colbert|loafer|derby|brogue|stropdas/i.test(text)) out.looks = ['casualchique', 'business', 'chique'];
  else if (/sneaker|bomber|parka|pet\b|cap\b|rugzak/i.test(text)) out.looks = ['sportief', 'casual'];
  else if (/smoking|kostuum|nethemd|dress shirt|wollen pantalon/i.test(text)) out.looks = ['chique', 'gekleed'];
  else if (/pantalon|trousers/i.test(text)) out.looks = ['business', 'chique', 'gekleed'];
  else if (/hoodie|sweat|cargo|graphic|print|flanel/i.test(text)) out.looks = ['casual'];
  else if (/jeans|denim/i.test(text)) out.looks = ['casual', 'casualchique'];
  else if (/chino/i.test(text)) out.looks = ['casual', 'casualchique', 'business'];
  else if (/oxford/i.test(text)) out.looks = ['casualchique', 'business'];
  else if (/merino|cashmere|kasjmier|fijn ?gebreid|fine knit/i.test(text)) out.looks = ['casualchique', 'business', 'chique'];
  if (/streep|stripe|gestreept/i.test(text)) out.pattern = 'streep';
  else if (/ruit|geruit|check|plaid|flanel|tartan/i.test(text)) out.pattern = 'ruit';
  else if (/print|logo|graphic|opdruk/i.test(text)) out.pattern = 'print';
  return out;
}

// Volledige inschatting voor een nieuw artikel: foto + tekst + standaardwaarden per categorie.
export async function estimate({ image, name = '' }) {
  const text = guessFromText(name);
  let img = null;
  try { img = await analyzeImage(image); } catch (e) { console.warn('Analyse mislukt', e); }
  const category = text.category || 'tshirt';
  return {
    category,
    hex: text.hex || img?.hex || '#888888',
    colorFromText: !!text.hex,
    hex2: img?.hex2 || null,
    pattern: text.pattern || img?.pattern || 'effen',
    looks: text.looks || null,
    season: defaultSeason[category],
    analyzed: !!img,
    categoryGuessed: !!text.category,
  };
}

// ---------- Afbeeldingen inlezen ----------
// Verkleint een afbeelding en bewaart ze als JPEG-data zodat ze offline beschikbaar is.
export async function toDataUrl(src, max = 900) {
  const img = await loadImage(src);
  const r = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * r);
  c.height = Math.round(img.naturalHeight * r);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    toDataUrl(url).then(resolve, reject).finally(() => URL.revokeObjectURL(url));
  });
}

// Als synchronisatie aan staat, haalt de eigen Supabase-functie webshoppagina's op.
let remoteFetcher = null;
export const setRemoteFetcher = (fn) => { remoteFetcher = fn; };

async function fetchVia(url, as) {
  try {
    const r = await fetch(url);
    if (r.ok) return as === 'text' ? r.text() : r.blob();
  } catch { /* CORS: probeer via de eigen functie of de proxy */ }
  if (remoteFetcher) {
    try {
      const res = await remoteFetcher(url, as);
      if (res) return res;
    } catch (e) { console.warn('Eigen functie faalde, probeer publieke proxy', e); }
  }
  const r = await fetch(PROXY + encodeURIComponent(url));
  if (!r.ok) throw new Error('Pagina niet bereikbaar');
  return as === 'text' ? r.text() : r.blob();
}

const IMG_EXT = /\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i;

// Leest een webshoplink of directe afbeeldingslink in.
export async function importFromLink(url) {
  let image = url, title = '';
  if (!IMG_EXT.test(url) && !/images\.unsplash\.com/.test(url)) {
    const html = await fetchVia(url, 'text');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = (n) => doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.getAttribute('content');
    let found = meta('og:image') || meta('og:image:url') || meta('twitter:image');
    title = meta('og:title') || doc.querySelector('title')?.textContent || '';
    if (!found) {
      for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const j = JSON.parse(s.textContent);
          const list = Array.isArray(j) ? j : j['@graph'] || [j];
          const p = list.find((x) => /product/i.test(x['@type']));
          if (p) { found = [].concat(p.image)[0]; found = found?.url || found; title = title || p.name; break; }
        } catch { /* ongeldige JSON negeren */ }
      }
    }
    if (!found) throw new Error('Geen productfoto gevonden op deze pagina');
    image = new URL(found, url).href;
    title = title.replace(/\s*[|–-]\s*[^|–-]+$/, '').trim(); // " | Winkelnaam" weghalen
  }
  // Afbeelding lokaal bewaren (werkt offline en laat kleuranalyse toe).
  let stored = image;
  try {
    const blob = await fetchVia(image, 'blob');
    const objUrl = URL.createObjectURL(blob);
    try { stored = await toDataUrl(objUrl); } finally { URL.revokeObjectURL(objUrl); }
  } catch (e) { console.warn('Afbeelding niet lokaal bewaard', e); }
  return { image: stored, title, sourceUrl: url };
}
