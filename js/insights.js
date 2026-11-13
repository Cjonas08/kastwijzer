// Rekenwerk zonder scherm: weeradvies, draaglogboek, paklijst en kastanalyse.
import { CATS, LOOKS, LOOK_ORDER, NEUTRALS, colorName } from './model.js';
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
