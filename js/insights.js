// Rekenwerk zonder scherm: weeradvies, draaglogboek, paklijst en kastanalyse.
import { CATS, LOOKS, LOOK_ORDER, NEUTRALS, colorName, defaultLooks, defaultSeason } from './model.js';
import { compatible, score } from './match.js';

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (key, today = dayKey()) => Math.round((new Date(today) - new Date(key)) / 86400000);
export const lastWorn = (it) => (it.worn?.length ? it.worn[it.worn.length - 1] : null);
export function wornLabel(it, today = dayKey()) {
  const last = lastWorn(it);
  if (!last) return 'nog niet gedragen';
  const n = daysAgo(last, today);
  return n <= 0 ? 'vandaag gedragen' : n === 1 ? 'gisteren gedragen' : `${n} dagen geleden gedragen`;
}
export const recentlyWorn = (it, days = 2, today = dayKey()) => { const l = lastWorn(it); return !!l && daysAgo(l, today) < days; };

// Weer -> seizoen voor de filter en een advies in woorden.
export function weatherAdvice({ tmax, tmin, rain }) {
  const season = tmax >= 22 ? 'zomer' : tmax <= 12 ? 'winter' : 'alle';
  const tips = [];
  if (tmax >= 24) tips.push('short en t-shirt kunnen');
  else if (tmax >= 18) tips.push('lange broek of short, korte mouwen');
  else if (tmax >= 12) tips.push('lange broek, pull of jas erbij');
  else tips.push('warme laag en een jas');
  if (tmax - tmin >= 10 && tmax >= 15) tips.push('laagjes: de ochtend is fris');
  if (rain >= 60) tips.push('neem een regenjas');
  return { season, text: tips.join(' · '), shorts: tmax >= 20 };
}

// Paklijst: zo weinig mogelijk stukken die samen zo veel mogelijk outfits geven.
// Kiest telkens het stuk dat het best past bij wat al in de koffer zit.
export function packList(items, overrides, days, look = 'alle') {
  const pool = items.filter((i) => !i.wash && (look === 'alle' || (i.looks || []).includes(look)));
  const group = (g) => pool.filter((i) => CATS[i.category].group === g);
  const good = (a, b) => compatible(a, b) && score(a, b, overrides).score >= 60;
  const want = { bottom: Math.max(1, Math.ceil(days / 3)), top: Math.max(1, Math.ceil(days / 1.5)), mid: days >= 3 ? 1 : 0, outer: 1, shoes: days >= 4 ? 2 : 1 };
  const chosen = [];
  const add = (cands, n) => {
    const left = [...cands];
    for (let k = 0; k < n && left.length; k++) {
      const rated = left.map((i) => ({ i, n: chosen.filter((c) => good(i, c)).length, neutral: NEUTRALS.has(colorName(i.hex)) ? 1 : 0 }))
        .sort((a, b) => b.n - a.n || b.neutral - a.neutral);
      chosen.push(rated[0].i);
      left.splice(left.indexOf(rated[0].i), 1);
    }
  };
  add(group('bottom'), want.bottom);
  add(group('top').filter((i) => CATS[i.category].layer === 'base'), want.top);
  add(group('top').filter((i) => CATS[i.category].layer === 'mid'), want.mid);
  add(group('outer'), want.outer);
  add(group('shoes'), want.shoes);
  const bottoms = chosen.filter((i) => CATS[i.category].group === 'bottom');
  const tops = chosen.filter((i) => CATS[i.category].layer === 'base');
  const combos = bottoms.reduce((n, b) => n + tops.filter((t) => good(b, t)).length, 0);
  return { items: chosen, combos, enough: combos >= days };
}

// Kastanalyse: wat draag je, wat niet, en wat ontbreekt.
export function analyse(items, overrides) {
  const worn = (i) => i.worn?.length || 0;
  const matches = (it) => items.filter((o) => compatible(it, o) && score(it, o, overrides).score >= 70).length;
  const core = items.filter((i) => ['top', 'bottom'].includes(CATS[i.category].group));
  const never = items.filter((i) => !worn(i));
  const most = [...items].filter(worn).sort((a, b) => worn(b) - worn(a)).slice(0, 5);
  const hard = core.map((i) => ({ i, n: matches(i) })).filter((x) => x.n <= 1).sort((a, b) => a.n - b.n).slice(0, 5);
  const costPerWear = items.filter((i) => i.price > 0 && worn(i)).map((i) => ({ i, cpw: i.price / worn(i) })).sort((a, b) => b.cpw - a.cpw).slice(0, 5);
  const unworn = items.filter((i) => i.price > 0 && !worn(i)).reduce((s, i) => s + i.price, 0);

  const gaps = [];
  const tops = core.filter((i) => CATS[i.category].group === 'top' && CATS[i.category].layer === 'base');
  const bottoms = core.filter((i) => CATS[i.category].group === 'bottom');
  for (const l of LOOK_ORDER) {
    const t = tops.filter((i) => (i.looks || []).includes(l)).length, b = bottoms.filter((i) => (i.looks || []).includes(l)).length;
    if (t && !b) gaps.push(`${LOOKS[l].label}: ${t} bovenstuk${t > 1 ? 'ken' : ''} maar geen broek of short`);
    else if (b && !t) gaps.push(`${LOOKS[l].label}: ${b} onderstuk${b > 1 ? 'ken' : ''} maar geen bovenstuk`);
    else if (t >= 4 && b === 1) gaps.push(`${LOOKS[l].label}: maar één onderstuk voor ${t} bovenstukken`);
  }
  if (bottoms.length && !bottoms.some((i) => NEUTRALS.has(colorName(i.hex)))) gaps.push('Geen broek in een neutrale kleur (marine, grijs, beige, zwart): die combineert het makkelijkst');
  if (core.length >= 4 && !items.some((i) => i.category === 'schoenen')) gaps.push('Nog geen schoenen in je kast: voeg ze toe om outfits af te maken');
  if (core.length >= 4 && !items.some((i) => i.category === 'jas')) gaps.push('Nog geen jas in je kast');

  return { total: items.length, never, most, hard, costPerWear, unworn, gaps };
}

// Koopcheck: hoe goed past een (nieuw) stuk bij wat je al hebt?
export function fitsCloset(item, items, overrides) {
  const others = items.filter((o) => o.id !== item.id && compatible(item, o));
  const good = others.map((o) => ({ o, s: score(item, o, overrides).score })).filter((x) => x.s >= 70).sort((a, b) => b.s - a.s);
  const twins = items.filter((o) => o.id !== item.id && o.category === item.category && colorName(o.hex) === colorName(item.hex));
  return { good: good.map((x) => x.o), of: others.length, twins };
}

// Aanvuladvies: welke stukken zouden de meeste nieuwe combinaties opleveren?
// Probeert per categorie een reeks veelgebruikte kleuren uit als denkbeeldig stuk en telt
// met hoeveel bestaande stukken het goed zou passen. Wat je al hebt (zelfde categorie en kleur) valt weg.
const C = { wit: '#f2f2f2', marine: '#1f2a44', grijs: '#8a8a8a', beige: '#cdb994', zwart: '#1c1c1c', lichtblauw: '#aec7e6', olijf: '#6b6b3a', bordeaux: '#6d1f2c', bruin: '#6b4228', jeans: '#5f7fa6' };
// Per categorie de kleuren die je in de winkel ook echt vindt en vaak draagt.
const IDEAS = {
  tshirt: [C.wit, C.marine, C.grijs, C.zwart, C.olijf, C.bordeaux, C.lichtblauw],
  polo: [C.wit, C.marine, C.grijs, C.zwart, C.olijf, C.bordeaux, C.lichtblauw],
  hemd: [C.wit, C.lichtblauw, C.marine, C.jeans, C.beige, C.olijf],
  pull: [C.marine, C.grijs, C.beige, C.olijf, C.bordeaux, C.zwart, C.bruin],
  broek: [C.marine, C.beige, C.grijs, C.zwart, C.jeans, C.olijf, C.bruin],
  short: [C.marine, C.beige, C.grijs, C.olijf, C.jeans],
  jas: [C.marine, C.zwart, C.beige, C.olijf, C.grijs, C.jeans, C.bruin],
  schoenen: [C.wit, C.zwart, C.bruin],
};
const MAX_PER_CAT = { jas: 1, schoenen: 1 };
export function suggestAdditions(items, overrides, max = 6) {
  if (items.length < 3) return [];
  const good = (a, b) => compatible(a, b) && score(a, b, overrides).score >= 70;
  // Stukken die nu weinig goede combinaties hebben: een toevoeging die hén helpt, is extra waard.
  const lonely = new Set(items.filter((i) => items.filter((o) => good(i, o)).length <= 1).map((i) => i.id));
  // Zonder onderstuk of bovenstuk kun je geen outfit maken: dat tekort weegt het zwaarst.
  const count = (test) => items.filter((i) => test(CATS[i.category])).length;
  const bottoms = count((c) => c.group === 'bottom'), tops = count((c) => c.layer === 'base');
  const need = (category) => {
    const c = CATS[category];
    if (c.group === 'bottom') return bottoms === 0 ? 2.5 : bottoms * 3 < tops ? 1.3 : 1;
    if (c.layer === 'base') return tops === 0 ? 2.5 : tops < bottoms ? 1.3 : 1;
    return 1;
  };
  const ideas = [];
  for (const category of Object.keys(IDEAS)) {
    const owned = items.filter((i) => i.category === category);
    for (const hex of IDEAS[category]) {
      const name = colorName(hex);
      if (owned.some((i) => colorName(i.hex) === name)) continue;
      const idea = { id: `idee-${category}-${hex}`, category, hex, pattern: 'effen', looks: defaultLooks[category], season: defaultSeason[category] };
      const partners = items.filter((o) => compatible(idea, o));
      const fits = partners.map((o) => ({ o, s: score(idea, o, overrides).score })).filter((x) => x.s >= 70).sort((a, b) => b.s - a.s).map((x) => x.o);
      if (fits.length < 2) continue;
      const rescued = fits.filter((o) => lonely.has(o.id));
      const weight = (owned.length === 0 ? 1.4 : owned.length >= 4 ? 0.75 : 1) * need(category);
      ideas.push({ category, hex, colorName: name, fits, of: partners.length, rescued, isNew: owned.length === 0, value: (fits.length + rescued.length * 1.5) * weight });
    }
  }
  ideas.sort((a, b) => b.value - a.value);
  const out = [], perCat = {}, perColor = {};
  for (const idea of ideas) {
    if ((perCat[idea.category] || 0) >= (MAX_PER_CAT[idea.category] || 2) || (perColor[idea.colorName] || 0) >= 2) continue;
    perCat[idea.category] = (perCat[idea.category] || 0) + 1;
    perColor[idea.colorName] = (perColor[idea.colorName] || 0) + 1;
    out.push(idea);
    if (out.length >= max) break;
  }
  return out;
}
