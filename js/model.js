// Categorieën, kleurhulpjes en vaste lijsten die overal in de app gebruikt worden.

export const CATS = {
  tshirt: { label: 'T-shirt', plural: "T-shirts", group: 'top', layer: 'base' },
  polo:   { label: 'Polo',    plural: "Polo's",   group: 'top', layer: 'base' },
  hemd:   { label: 'Hemd',    plural: 'Hemden',   group: 'top', layer: 'base' },
  pull:   { label: 'Pull',    plural: 'Pulls',    group: 'top', layer: 'mid' },
  broek:  { label: 'Broek',   plural: 'Broeken',  group: 'bottom' },
  short:  { label: 'Short',   plural: 'Shorts',   group: 'bottom' },
};
export const CAT_ORDER = ['tshirt', 'polo', 'hemd', 'pull', 'broek', 'short'];

// Een outfit heeft drie vakken: onderstuk, bovenstuk en (optioneel) een pull erover.
export const SLOTS = [
  { id: 'onder', label: 'Onderstuk', cats: ['broek', 'short'] },
  { id: 'boven', label: 'Bovenstuk', cats: ['tshirt', 'polo', 'hemd'] },
  { id: 'laag',  label: 'Pull erover', cats: ['pull'], optional: true },
];
export const slotOf = (cat) => SLOTS.find((s) => s.cats.includes(cat)).id;

export const PATTERNS = { effen: 'Effen', streep: 'Streep', ruit: 'Ruit', print: 'Print / logo', motief: 'Ander motief' };
export const SEASONS = { altijd: 'Hele jaar', zomer: 'Zomer', winter: 'Winter' };

// Looks, van ontspannen naar formeel. Een artikel kan bij meerdere looks horen.
export const LOOKS = {
  sportief: { label: 'Sportief', hint: 'Joggings, sportshirts, sneakers' },
  casual: { label: 'Casual', hint: 'T-shirt, jeans, short: relaxed' },
  casualchique: { label: 'Casual chique', hint: 'Polo of knit met chino of donkere jeans' },
  business: { label: 'Business casual', hint: 'Hemd met chino, pull over een hemd' },
  chique: { label: 'Chique', hint: 'Nette broek, effen hemd, fijne pull' },
  gekleed: { label: 'Gekleed', hint: 'Pantalon, nethemd: feest of trouw' },
};
export const LOOK_ORDER = Object.keys(LOOKS);
export const lookIndex = (l) => LOOK_ORDER.indexOf(l);

// Standaard-looks per categorie (de tekst van de naam kan dit nog bijsturen).
export const defaultLooks = {
  tshirt: ['casual'],
  polo: ['casual', 'casualchique'],
  hemd: ['casualchique', 'business', 'chique'],
  pull: ['casual', 'casualchique', 'business'],
  broek: ['casualchique', 'business'],
  short: ['casual'],
};
// Omzetting van de oude stijlschaal (1 casual, 2 smart casual, 3 net).
export const looksFromFormality = (f) => ({ 1: ['casual'], 2: ['casual', 'casualchique'], 3: ['chique', 'gekleed'] }[f] || ['casual']);

export const defaultSeason = { tshirt: 'zomer', polo: 'zomer', hemd: 'altijd', pull: 'winter', broek: 'altijd', short: 'zomer' };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- kleur ----------
export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
export const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));

// Geeft een Nederlandse kleurnaam voor een hex-kleur.
export function colorName(hex) {
  const [h, s, l] = hexToHsl(hex);
  if (l < 0.07 || (l < 0.15 && s < 0.25)) return 'zwart';
  // Donkere tinten met kleur: bruin, marine, donkergroen, bordeaux…
  if (h >= 5 && h < 48 && l < 0.38 && s > 0.2) return 'bruin';
  if (l > 0.9 && s < 0.45) return 'wit';
  if (s < 0.12 || (s < 0.2 && l < 0.3)) {
    if (l > 0.8) return (h > 20 && h < 70) ? 'crème' : 'lichtgrijs';
    if (l > 0.55) return 'lichtgrijs';
    if (l > 0.33) return 'grijs';
    return 'antraciet';
  }
  if (h >= 190 && h < 255) {
    if (l < 0.3) return 'marineblauw';
    if (s < 0.5 && l < 0.7) return 'jeansblauw';
    if (l > 0.68) return 'lichtblauw';
    return 'blauw';
  }
  if (h >= 165 && h < 190) return l < 0.35 ? 'petrol' : 'turquoise';
  if (h >= 70 && h < 165) {
    if (s < 0.3) return l < 0.4 ? 'olijf' : 'saliegroen';
    if (l < 0.3) return 'donkergroen';
    return 'groen';
  }
  if (h >= 48 && h < 70) {
    if (s > 0.55 && l > 0.45) return 'geel';
    return l < 0.42 ? 'olijf' : 'kaki';
  }
  if (h >= 18 && h < 48) {
    if (l > 0.82) return 'crème';
    if (l > 0.55 && s < 0.6) return 'beige';
    if (s > 0.7 && l > 0.45) return 'oranje';
    if (l < 0.38) return 'bruin';
    return s < 0.45 ? 'kaki' : 'camel';
  }
  if (h >= 255 && h < 290) return l > 0.65 ? 'lila' : 'paars';
  if (h >= 290 && h < 335) return l > 0.6 ? 'roze' : 'framboos';
  // rood/roest (335-360 en 0-18)
  if (l > 0.7) return 'roze';
  if (h < 18 && h > 8 && s < 0.75 && l < 0.5) return 'roest';
  if (l < 0.3) return 'bordeaux';
  return 'rood';
}

// Kleuren die met (bijna) alles combineren.
export const NEUTRALS = new Set(['zwart', 'wit', 'lichtgrijs', 'grijs', 'antraciet', 'crème', 'marineblauw', 'lichtblauw', 'beige', 'kaki', 'jeansblauw']);
// Aardetinten: combineren vlot, maar minder universeel dan neutrale kleuren.
export const EARTHY = new Set(['bruin', 'camel', 'olijf', 'saliegroen', 'roest', 'bordeaux']);
