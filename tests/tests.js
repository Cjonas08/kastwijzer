// Automatische tests voor het rekenwerk van Kastwijzer. Open tests/ in de browser om ze te draaien.
import { CATS, CAT_ORDER, SLOTS, slotOf, emptyOutfit, defaultLooks, defaultSeason, colorName } from '../js/model.js';
import { compatible, autoScore, score, verdict, outfitScore, pairKey, learnPrefs } from '../js/match.js';
import { guessFromText } from '../js/analyze.js';
import { maskFromPixels } from '../js/cutout.js';
import { layout } from '../js/collage.js';
import { dayKey, daysAgo, wornLabel, recentlyWorn, weatherAdvice, packList, analyse, fitsCloset, suggestAdditions } from '../js/insights.js';

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}
const ok = (cond, msg = 'verwachting klopt niet') => { if (!cond) throw new Error(msg); };
const eq = (a, b) => ok(JSON.stringify(a) === JSON.stringify(b), `kreeg ${JSON.stringify(a)}, verwachtte ${JSON.stringify(b)}`);

const item = (id, category, hex, extra = {}) => ({ id, name: id, category, hex, pattern: 'effen', looks: defaultLooks[category], season: 'altijd', image: 'x', ...extra });
const navyChino = item('chino', 'broek', '#1f2a44');
const whiteTee = item('tee', 'tshirt', '#f2f2f2', { looks: ['casual', 'casualchique'] });
const redTee = item('rood', 'tshirt', '#b3302f', { looks: ['casual'] });
const greenPull = item('pull', 'pull', '#3f7a4a');
const jeans = item('jeans', 'broek', '#5f7fa6', { looks: ['casual', 'casualchique'] });
const none = new Map();

// ---------- model ----------
test('elke categorie heeft een vak, standaard-looks en een seizoen', () => {
  for (const c of CAT_ORDER) { ok(CATS[c], c); ok(slotOf(c), c); ok(defaultLooks[c]?.length, c); ok(defaultSeason[c], c); }
});
test('een lege outfit heeft alle vakken', () => eq(Object.keys(emptyOutfit()), SLOTS.map((s) => s.id)));
test('kleurnamen in het Nederlands', () => { eq(colorName('#1f2a44'), 'marineblauw'); eq(colorName('#1c1c1c'), 'zwart'); });

// ---------- matching ----------
test('boven en onder kunnen samen, twee broeken niet', () => { ok(compatible(navyChino, whiteTee)); ok(!compatible(navyChino, jeans)); });
test('t-shirt onder pull kan, twee t-shirts niet', () => { ok(compatible(whiteTee, greenPull)); ok(!compatible(whiteTee, redTee)); });
test('jas, schoenen en accessoire passen bij al de rest', () => {
  const jas = item('jas', 'jas', '#3a3a3c'), schoen = item('schoen', 'schoenen', '#6b4228');
  ok(compatible(jas, whiteTee) && compatible(jas, navyChino) && compatible(schoen, jas));
  ok(!compatible(jas, item('jas2', 'jas', '#000000')));
});
test('neutraal wit op marine scoort goed', () => ok(autoScore(navyChino, whiteTee).score >= 70));
test('rood op groen vloekt', () => ok(autoScore(redTee, greenPull).score < 50));
test('twee motieven samen kost punten', () => {
  const a = { ...whiteTee, pattern: 'streep' }, b = { ...navyChino, pattern: 'ruit' };
  ok(autoScore(a, b).score < autoScore(whiteTee, navyChino).score - 20);
});
test('score blijft tussen 0 en 100', () => {
  for (const a of [navyChino, whiteTee, redTee, greenPull, jeans]) for (const b of [navyChino, whiteTee, redTee, greenPull, jeans]) {
    const s = autoScore(a, b).score; ok(s >= 0 && s <= 100);
  }
});
test('jouw ✓ en ✗ gaan voor op de inschatting', () => {
  eq(score(redTee, greenPull, new Map([[pairKey('rood', 'pull'), 'yes']])).score, 100);
  eq(score(navyChino, whiteTee, new Map([[pairKey('chino', 'tee'), 'no']])).score, 0);
});
test('oordeel bij 70 en 50', () => { eq(verdict(70).key, 'goed'); eq(verdict(69).key, 'kan'); eq(verdict(49).key, 'niet'); });
test('een afgekeurd stuk maakt de hele outfit 0', () => {
  eq(outfitScore(whiteTee, [navyChino], new Map([[pairKey('chino', 'tee'), 'no']])).score, 0);
});
test('leert pas na twee gelijke keuzes voor dezelfde kleuren', () => {
  const tee2 = item('rood2', 'tshirt', '#b3302f'), pull2 = item('pull2', 'pull', '#3f7a4a');
  const all = Object.fromEntries([redTee, greenPull, tee2, pull2].map((i) => [i.id, i]));
  const one = new Map([[pairKey('rood', 'pull'), 'yes']]);
  eq(learnPrefs(one, (id) => all[id]).size, 0);
  const two = new Map([[pairKey('rood', 'pull'), 'yes'], [pairKey('rood2', 'pull2'), 'yes']]);
  two.prefs = learnPrefs(two, (id) => all[id]);
  eq(two.prefs.size, 1);
  ok(score(redTee, pull2, two).score === autoScore(redTee, pull2).score + 12, 'geleerde voorkeur telt 12 punten');
});

// ---------- tekst ----------
test('omschrijving geeft categorie en kleur', () => {
  const g = guessFromText('lichtblauwe jeans');
  eq(g.category, 'broek'); eq(g.hex, '#aec7e6');
});
test('nieuwe categorieën uit tekst', () => {
  eq(guessFromText('witte sneakers').category, 'schoenen');
  eq(guessFromText('donkerblauwe blazer').category, 'jas');
  eq(guessFromText('bruine riem').category, 'accessoire');
  eq(guessFromText('zwarte polo').category, 'polo');
  eq(guessFromText('grijze short').category, 'short');
});
test('motief uit tekst', () => eq(guessFromText('geruit flanellen hemd').pattern, 'ruit'));

// ---------- uitknippen ----------
function picture(w, h, paint) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); d.set([r, g, b, 255], (y * w + x) * 4); }
  return d;
}
test('blauw vierkant op wit: achtergrond weg, stuk blijft', () => {
  const d = picture(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 8 && y < 34 ? [30, 60, 160] : [250, 250, 250]));
  const m = maskFromPixels(d, 40, 40);
  ok(m, 'geen masker');
  eq(m.alpha[0], 0); eq(m.alpha[20 * 40 + 20], 255);
  eq(m.box, { x: 10, y: 8, w: 20, h: 26 });
});
test('wit detail binnenin het stuk blijft staan', () => {
  const d = picture(40, 40, (x, y) => (x >= 18 && x < 22 && y >= 18 && y < 22 ? [250, 250, 250] : x >= 8 && x < 32 && y >= 8 && y < 32 ? [30, 60, 160] : [250, 250, 250]));
  eq(maskFromPixels(d, 40, 40).alpha[20 * 40 + 20], 255);
});
test('witte strepen die de rand van het stuk raken blijven deel van het stuk', () => {
  // blauw blok van x 20..99 met witte strepen (4 px hoog) die links tot aan de achtergrond lopen
  const d = picture(120, 120, (x, y) => (x >= 20 && x < 100 && y >= 20 && y < 100 ? (y % 12 < 4 && x < 60 ? [250, 250, 250] : [30, 60, 160]) : [250, 250, 250]));
  const m = maskFromPixels(d, 120, 120);
  eq(m.alpha[26 * 120 + 40], 255); // midden in een witte streep
  eq(m.alpha[5 * 120 + 5], 0);     // echte achtergrond blijft weg
  eq(m.box, { x: 20, y: 20, w: 80, h: 80 });
});
test('drukke achtergrond of egaal beeld: niet uitknippen', () => {
  ok(maskFromPixels(picture(40, 40, (x, y) => [(x * 37) % 255, (y * 91) % 255, ((x + y) * 53) % 255]), 40, 40) === null);
  ok(maskFromPixels(picture(40, 40, () => [240, 240, 240]), 40, 40) === null);
});
test('collage: elk gekozen stuk krijgt een vak binnen het beeld', () => {
  const o = { onder: navyChino, boven: whiteTee, laag: greenPull, jas: item('j', 'jas', '#333333'), schoenen: item('s', 'schoenen', '#553311'), accessoire: null };
  const boxes = layout(o);
  eq(Object.keys(boxes).sort(), ['boven', 'jas', 'laag', 'onder', 'schoenen']);
  for (const [x, y, w, h] of Object.values(boxes)) ok(x >= 0 && y >= 0 && x + w <= 600 && y + h <= 780);
});

// ---------- draaglogboek en weer ----------
test('dagen tellen', () => { eq(daysAgo('2026-11-10', '2026-11-13'), 3); eq(dayKey(new Date(2026, 0, 5)), '2026-01-05'); });
test('draaglabel en pas gedragen', () => {
  const it = { worn: ['2026-11-01', '2026-11-12'] };
  eq(wornLabel(it, '2026-11-13'), 'gisteren gedragen');
  ok(recentlyWorn(it, 2, '2026-11-13')); ok(!recentlyWorn(it, 2, '2026-11-20')); ok(!recentlyWorn({}, 2, '2026-11-13'));
  eq(wornLabel({}, '2026-11-13'), 'nog niet gedragen');
});
test('weeradvies: warm, koud, regen', () => {
  eq(weatherAdvice({ tmax: 27, tmin: 17, rain: 5 }).season, 'zomer');
  eq(weatherAdvice({ tmax: 6, tmin: 1, rain: 80 }).season, 'winter');
  ok(weatherAdvice({ tmax: 6, tmin: 1, rain: 80 }).text.includes('regenjas'));
  eq(weatherAdvice({ tmax: 16, tmin: 9, rain: 10 }).season, 'alle');
});

// ---------- paklijst, analyse, koopcheck ----------
const closet = [navyChino, jeans, whiteTee, redTee, item('hemd', 'hemd', '#aec7e6'), greenPull, item('polo', 'polo', '#1c1c1c')];
test('paklijst: meer dagen geeft meer stukken, wat in de was zit telt niet', () => {
  const short = packList(closet, none, 2), long = packList(closet, none, 6);
  ok(short.items.length < long.items.length);
  ok(long.items.some((i) => CATS[i.category].group === 'bottom') && long.combos > 0);
  const washed = packList(closet.map((i) => (i.id === 'chino' ? { ...i, wash: true } : i)), none, 6);
  ok(!washed.items.some((i) => i.id === 'chino'));
});
test('paklijst respecteert de look', () => {
  ok(packList(closet, none, 4, 'gekleed').items.every((i) => i.looks.includes('gekleed')));
});
test('kastanalyse: gedragen, ongedragen, prijs per draagbeurt en gaten', () => {
  const items = [{ ...navyChino, worn: ['2026-11-01', '2026-11-02'], price: 80 }, whiteTee, { ...redTee, price: 20 }];
  const a = analyse(items, none);
  eq(a.most.map((i) => i.id), ['chino']);
  eq(a.never.map((i) => i.id).sort(), ['rood', 'tee']);
  eq(a.costPerWear[0].cpw, 40); eq(a.unworn, 20);
  const noBottom = analyse([whiteTee, redTee], none);
  ok(noBottom.gaps.some((g) => g.includes('geen broek')));
});
test('koopcheck telt goede combinaties en dubbels', () => {
  const nieuw = item('nieuw', 'tshirt', '#f2f2f2', { looks: ['casual', 'casualchique'] });
  const r = fitsCloset(nieuw, closet, none);
  ok(r.good.some((o) => o.id === 'chino')); eq(r.twins.map((o) => o.id), ['tee']);
  ok(r.of === closet.filter((o) => compatible(nieuw, o)).length);
});

test('aanvuladvies: stelt enkel voor wat je nog niet hebt en wat goed combineert', () => {
  const ideas = suggestAdditions(closet, none);
  ok(ideas.length > 0 && ideas.length <= 6, 'aantal voorstellen');
  for (const d of ideas) {
    ok(!closet.some((i) => i.category === d.category && colorName(i.hex) === d.colorName), `${d.category} in ${d.colorName} zit al in de kast`);
    ok(d.fits.length >= 2 && d.fits.length <= d.of);
  }
  ok(ideas.filter((d) => d.category === ideas[0].category).length <= 2, 'hoogstens twee per categorie');
  ok(ideas.some((d) => d.isNew), 'een ontbrekende categorie (jas, schoenen, short) komt aan bod');
  eq(suggestAdditions([navyChino, whiteTee], none), []);
});
test('aanvuladvies: bij enkel felle bovenstukken komt een neutraal onderstuk bovenaan', () => {
  const tops = ['#b3302f', '#3f7a4a', '#e07b39', '#6a4c93'].map((hex, i) => item('t' + i, 'tshirt', hex));
  const ideas = suggestAdditions(tops, none);
  ok(['broek', 'short'].includes(ideas[0].category), `eerste voorstel is ${ideas[0].category}`);
});

// ---------- verslag ----------
const failed = results.filter((r) => !r.ok);
window.__tests = { total: results.length, failed: failed.length, failures: failed };
document.getElementById('summary').textContent = failed.length ? `${failed.length} van ${results.length} tests mislukt` : `Alle ${results.length} tests geslaagd`;
document.getElementById('summary').className = failed.length ? 'bad' : 'good';
document.getElementById('list').innerHTML = results.map((r) => `<li class="${r.ok ? 'good' : 'bad'}">${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ` <em>(${r.error})</em>`}</li>`).join('');
