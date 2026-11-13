// Inschatting "wat past bij wat" op basis van kleur, motief, stijl en seizoen.
import { CATS, NEUTRALS, EARTHY, LOOKS, lookIndex, hexToHsl, colorName } from './model.js';

export const pairKey = (a, b) => [a, b].sort().join('|');

// Welke categorieën kun je samen dragen?
export function compatible(a, b) {
  if (a.id === b.id) return false;
  const A = CATS[a.category], B = CATS[b.category];
  if (A.group !== B.group) return true; // boven + onder
  return A.group === 'top' && A.layer !== B.layer; // t-shirt/polo/hemd onder een pull
}

const kind = (name) => (NEUTRALS.has(name) ? 'neutraal' : EARTHY.has(name) ? 'aarde' : 'kleur');

export function autoScore(a, b) {
  let s = 52;
  const why = [];
  const na = colorName(a.hex), nb = colorName(b.hex);
  const [h1, , l1] = hexToHsl(a.hex), [h2, , l2] = hexToHsl(b.hex);
  const ka = kind(na), kb = kind(nb);

  // Kleur
  if (ka === 'neutraal' && kb === 'neutraal') {
    if (na === nb) { s -= na === 'jeansblauw' ? 12 : 2; why.push(na === 'jeansblauw' ? 'denim op denim' : `allebei ${na}`); }
    else if ((na === 'zwart' && nb === 'marineblauw') || (nb === 'zwart' && na === 'marineblauw')) { s -= 8; why.push('zwart en marine botsen wat'); }
    else { s += 18; why.push('neutrale kleuren combineren altijd'); }
  } else if (ka === 'neutraal' || kb === 'neutraal') {
    s += 20; why.push(`${ka === 'neutraal' ? na : nb} is neutraal`);
  } else if (ka === 'aarde' && kb === 'aarde') {
    s += 8; why.push('aardetinten samen');
  } else {
    const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2));
    if (dh < 20) { s += 4; why.push('ton-sur-ton'); }
    else if (dh < 60) { s += 10; why.push('verwante kleuren'); }
    else if (dh > 150) { s += 6; why.push('complementaire kleuren'); }
    else { s -= 18; why.push(`${na} en ${nb} vloeken`); }
  }

  // Contrast in helderheid
  const dl = Math.abs(l1 - l2);
  if (dl < 0.08 && !(na === 'jeansblauw' || nb === 'jeansblauw')) { s -= 8; why.push('weinig contrast'); }
  else if (dl > 0.3) { s += 6; why.push('mooi contrast'); }

  // Motieven
  const pa = a.pattern !== 'effen', pb = b.pattern !== 'effen';
  if (pa && pb) { s -= 25; why.push('twee motieven samen'); }
  else if (pa || pb) { s += 3; }

  // Look: delen ze een look, of liggen ze er ver uit elkaar?
  const la = a.looks || [], lb = b.looks || [];
  const shared = la.filter((l) => lb.includes(l));
  if (shared.length) { s += 8; why.push(`samen ${LOOKS[shared[shared.length - 1]].label.toLowerCase()}`); }
  else if (la.length && lb.length) {
    const gap = Math.min(...la.flatMap((x) => lb.map((y) => Math.abs(lookIndex(x) - lookIndex(y)))));
    if (gap >= 2) { s -= 20; why.push('look verschilt sterk'); }
    else s -= 4;
  }

  // Seizoen
  const seasons = [a.season, b.season];
  if (seasons.includes('zomer') && seasons.includes('winter')) {
    const cats = [a.category, b.category];
    if (cats.includes('short')) { s -= 25; why.push('short met winterkleding'); }
    else { s -= 6; }
  }

  // Laagjes: een hemd onder een pull is een klassieker.
  const cats = [a.category, b.category].sort().join('+');
  if (cats === 'hemd+pull') { s += 6; why.push('hemd onder pull'); }
  if (cats === 'polo+pull') { s -= 4; }

  return { score: Math.max(0, Math.min(100, Math.round(s))), why };
}

// Leert uit jouw ✓/✗: als je dezelfde kleurcombinatie minstens twee keer goed- of afkeurt,
// telt dat ook voor andere stukken in die kleuren.
export const colorPair = (a, b) => [colorName(a.hex), colorName(b.hex)].sort().join('+');
export function learnPrefs(overrides, byId) {
  const net = new Map();
  for (const [key, value] of overrides) {
    const [a, b] = key.split('|').map(byId);
    if (!a || !b) continue;
    const k = colorPair(a, b);
    net.set(k, (net.get(k) || 0) + (value === 'yes' ? 1 : -1));
  }
  return new Map([...net].filter(([, n]) => Math.abs(n) >= 2));
}

// Score met jouw aanpassingen erbij: ✓ = altijd ja, ✗ = altijd nee.
// overrides.prefs (optioneel) bevat wat de app uit je keuzes geleerd heeft.
export function score(a, b, overrides) {
  const auto = autoScore(a, b);
  const learned = overrides.prefs?.get(colorPair(a, b));
  if (learned) {
    auto.score = Math.max(0, Math.min(100, auto.score + (learned > 0 ? 12 : -12)));
    auto.why.unshift(learned > 0 ? 'jij vindt deze kleuren samen mooi' : 'jij keurt deze kleuren samen vaak af');
  }
  const o = overrides.get(pairKey(a.id, b.id));
  if (o === 'yes') return { ...auto, auto: auto.score, score: 100, override: 'yes' };
  if (o === 'no') return { ...auto, auto: auto.score, score: 0, override: 'no' };
  return { ...auto, auto: auto.score, override: null };
}

export function verdict(sc) {
  if (sc >= 70) return { key: 'goed', label: 'Past goed' };
  if (sc >= 50) return { key: 'kan', label: 'Kan' };
  return { key: 'niet', label: 'Past niet' };
}

// Score van een kandidaat t.o.v. alle stukken die al in de outfit zitten.
export function outfitScore(candidate, chosen, overrides) {
  if (!chosen.length) return { score: 60, parts: [] };
  const parts = chosen.map((c) => score(candidate, c, overrides));
  if (parts.some((p) => p.override === 'no')) return { score: 0, parts };
  const min = Math.min(...parts.map((p) => p.score));
  const avg = parts.reduce((s, p) => s + p.score, 0) / parts.length;
  return { score: Math.round(0.6 * min + 0.4 * avg), parts };
}
