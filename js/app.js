import { db } from './db.js';
import { CATS, CAT_ORDER, SLOTS, slotOf, emptyOutfit, PATTERNS, SEASONS, LOOKS, LOOK_ORDER, defaultLooks, looksFromFormality, defaultSeason, colorName, uid } from './model.js';
import { estimate, analyzeImage, fileToDataUrl, toDataUrl, importFromLink, guessFromText } from './analyze.js';
import { mountCropper } from './crop.js';
import { compatible, score, verdict, outfitScore, pairKey, learnPrefs } from './match.js';
import { collage, collageKey } from './collage.js';
import { getPlace, setPlace, forgetPlace, todayWeather } from './weather.js';
import { dayKey, wornLabel, recentlyWorn, weatherAdvice, packList, analyse, fitsCloset, suggestAdditions } from './insights.js';
import { SEED_ITEMS, SEED_OVERRIDES } from './seed.js';
import { outfitFigure } from './figure.js';
import { initSync, onSyncStatus, syncNow, syncState, getConfig, saveConfig, forgetConfig, currentUser, sendLogin, verifyCode, signOut, tryOn, recognize } from './sync.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  items: [],
  outfits: [],
  overrides: new Map(),
  view: 'kast',
  filter: 'alle',
  outfit: emptyOutfit(),
  q: '',             // zoekterm in de kast
  weather: null,
  seasonTouched: false,
  plan: {},          // weekplanning: datum -> outfit-id
  queue: [],         // foto's die nog toegevoegd moeten worden
  showAll: false,
  season: 'alle',
  look: 'alle',
  person: null,      // pasfoto van de gebruiker (enkel op dit toestel)
  fits: new Map(),   // gepaste outfits: sleutel van de stukken -> foto
  fitting: false,
};
const byId = (id) => state.items.find((i) => i.id === id);

// ---------- opslag ----------
async function load() {
  const meta = await db.get('meta', 'seeded');
  if (!meta) await seed();
  state.items = (await db.all('items')).sort((a, b) => b.createdAt - a.createdAt);
  // Oudere artikels hadden een stijlniveau i.p.v. looks: omzetten.
  for (const it of state.items.filter((i) => !Array.isArray(i.looks))) {
    it.looks = it.formality ? looksFromFormality(it.formality) : defaultLooks[it.category];
    delete it.formality;
    await db.put('items', it);
  }
  state.outfits = (await db.all('outfits')).sort((a, b) => b.createdAt - a.createdAt);
  state.overrides = new Map((await db.all('overrides')).map((o) => [o.key, o.value]));
  state.overrides.prefs = learnPrefs(state.overrides, byId);
  // Oudere versies bewaarden pasfoto en gepaste beelden enkel lokaal: verhuizen naar 'extras' (back-up en sync).
  for (const m of await db.all('meta')) {
    if (m.key === 'pasfoto') { await db.put('extras', { id: 'pasfoto', image: m.image }); await db.del('meta', m.key); }
    else if (m.key.startsWith('tryon:')) { await db.put('extras', { id: 'fit:' + m.key.slice(6), image: m.image, createdAt: m.createdAt }); await db.del('meta', m.key); }
  }
  const extras = await db.all('extras');
  state.person = extras.find((x) => x.id === 'pasfoto')?.image || null;
  state.fits = new Map(extras.filter((x) => x.id.startsWith('fit:')).map((x) => [x.id.slice(4), x.image]));
  state.plan = extras.find((x) => x.id === 'plan')?.days || {};
}
async function seed() {
  await db.putMany('items', SEED_ITEMS);
  await db.putMany('overrides', SEED_OVERRIDES);
  await db.put('meta', { key: 'seeded', value: true });
}
async function saveItem(item) {
  await db.put('items', item);
  const i = state.items.findIndex((x) => x.id === item.id);
  if (i >= 0) state.items[i] = item; else state.items.unshift(item);
}
async function setOverride(a, b, value) {
  const key = pairKey(a, b);
  if (value) { await db.put('overrides', { key, value }); state.overrides.set(key, value); }
  else { await db.del('overrides', key); state.overrides.delete(key); }
  state.overrides.prefs = learnPrefs(state.overrides, byId);
}

// ---------- algemeen ----------
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg) {
  const t = toastEl;
  // Een open dialoog ligt boven alles; zet de melding er dan in.
  (sheet.open ? sheet : document.body).appendChild(t);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const sheet = $('#sheet');
function openSheet(html, cls = '') {
  sheet.className = 'sheet ' + cls;
  sheet.innerHTML = `<button class="sheet-close" data-close aria-label="Sluiten">✕</button>${html}`;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
  sheet.appendChild(toastEl); // de melding moet in het venster zitten om zichtbaar te blijven
}
sheet.addEventListener('close', () => document.body.appendChild(toastEl));
function closeSheet() {
  if (!sheet.open) return;
  sheet.close();
  document.body.appendChild(toastEl);
  render(); // niet wachten op de close-gebeurtenis: die komt soms pas later
}
sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close]')) closeSheet();
});
sheet.addEventListener('close', () => render());

function setView(v) {
  state.view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  render();
  window.scrollTo(0, 0);
}

const swatch = (hex, hex2) => `<span class="swatch" style="background:${hex2 ? `linear-gradient(135deg, ${hex} 50%, ${hex2} 50%)` : hex}"></span>`;
const badge = (sc, small) => { const v = verdict(sc); return `<span class="badge ${v.key}${small ? ' small' : ''}">${v.label}</span>`; };

function card(item, extra = '', attrs = '') {
  return `<button class="card" data-id="${item.id}" ${attrs}>
    <div class="thumb"><img loading="lazy" src="${esc(item.image)}" alt="">${item.photos?.length ? `<span class="photo-count">${item.photos.length + 1} foto's</span>` : ''}${item.wash ? '<span class="wash-tag">🧺 in de was</span>' : ''}</div>
    <div class="card-body">
      <div class="card-name">${esc(item.name)}</div>
      <div class="card-meta">${swatch(item.hex, item.hex2)}${colorName(item.hex)} · ${CATS[item.category].label}</div>
      ${extra}
    </div>
  </button>`;
}

// ---------- weergave: kleerkast ----------
function closetItems() {
  const sorted = [...state.items].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || b.createdAt - a.createdAt);
  let list = state.filter === 'alle' ? sorted : state.filter === 'was' ? sorted.filter((i) => i.wash) : sorted.filter((i) => i.category === state.filter);
  const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    list = list.filter((i) => {
      const hay = [i.name, colorName(i.hex), CATS[i.category].label, PATTERNS[i.pattern], SEASONS[i.season], ...(i.looks || []).map((l) => LOOKS[l]?.label)].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  return list;
}
function closetGrid() {
  const list = closetItems();
  if (list.length) return `<div class="grid">${list.map((i) => card(i)).join('')}</div>`;
  return state.q ? `<div class="empty"><p>Niets gevonden voor "${esc(state.q)}".</p></div>`
    : `<div class="empty"><p>Nog niets in deze categorie.</p><button class="btn primary" data-action="add">Artikel toevoegen</button></div>`;
}
function renderCloset() {
  const counts = Object.fromEntries(CAT_ORDER.map((c) => [c, state.items.filter((i) => i.category === c).length]));
  const washing = state.items.filter((i) => i.wash).length;
  const chips = [['alle', 'Alles', state.items.length], ...CAT_ORDER.filter((c) => counts[c] || CAT_ORDER.indexOf(c) < 6).map((c) => [c, CATS[c].plural, counts[c]]), ...(washing ? [['was', '🧺 In de was', washing]] : [])]
    .map(([k, l, n]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${l} <span>${n}</span></button>`).join('');
  return `
    <div class="view-head">
      <h1>Mijn kleerkast</h1>
      <p class="sub">${state.items.length} artikels. Tik op een artikel om te zien wat erbij past.</p>
    </div>
    ${accountHint()}
    <input type="search" class="search" data-search placeholder="Zoek op naam, kleur, look…" value="${esc(state.q)}" aria-label="Zoeken in je kast">
    <div class="chips">${chips}</div>
    <div id="closetGrid">${closetGrid()}</div>
  `;
}

// ---------- weergave: outfit samenstellen ----------
function seasonOk(item) {
  if (item.wash) return false;
  if (state.look !== 'alle' && !(item.looks || []).includes(state.look)) return false;
  if (state.season === 'alle') return true;
  return item.season === 'altijd' || item.season === state.season;
}

function renderOutfit() {
  const chosen = SLOTS.map((s) => state.outfit[s.id]).filter(Boolean).map(byId).filter(Boolean);
  const slotCards = SLOTS.filter((s) => !s.optional || state.outfit[s.id] || s.id === 'laag').map((s) => {
    const it = state.outfit[s.id] && byId(state.outfit[s.id]);
    return `<div class="slot ${it ? 'filled' : ''}">
      <div class="slot-label">${s.label}${s.optional ? ' <em>optioneel</em>' : ''}</div>
      ${it ? `<div class="slot-item">
          <img src="${esc(it.image)}" alt="">
          <div><strong>${esc(it.name)}</strong><span>${swatch(it.hex, it.hex2)}${colorName(it.hex)}</span></div>
          <button class="icon-btn" data-unslot="${s.id}" aria-label="Verwijderen">✕</button>
        </div>`
        : `<div class="slot-empty">${chosen.length ? 'Kies hieronder' : '—'}</div>`}
    </div>`;
  }).join('');

  let body = '';
  if (!chosen.length) {
    body = `<div class="start">
      <h2>Waar begin je mee?</h2>
      <p class="sub">Kies één stuk, bijvoorbeeld een broek, en je krijgt meteen wat erop past.${state.look !== 'alle' ? ` Je ziet enkel wat bij de look <strong>${LOOKS[state.look].label}</strong> hoort.` : ''}</p>
      ${state.look !== 'alle' && !state.items.some(seasonOk) ? `<p class="sub">Nog geen artikels voor deze look. Duid looks aan bij je artikels.</p>` : ''}
      <div class="row-actions"><button class="btn" data-action="surprise">🎲 Verras me</button></div>
      ${CAT_ORDER.map((c) => {
        const items = state.items.filter((i) => i.category === c && seasonOk(i));
        if (!items.length) return '';
        return `<h3>${CATS[c].plural}</h3><div class="strip">${items.map((i) => card(i, '', `data-pick="${i.id}"`)).join('')}</div>`;
      }).join('')}
    </div>`;
  } else {
    const base = state.outfit.onder && (state.outfit.boven || state.outfit.laag);
    body = SLOTS.filter((s) => !state.outfit[s.id] && (base || !['jas', 'schoenen', 'accessoire'].includes(s.id))).map((s) => {
      // Een pull over een t-shirt/hemd: enkel tonen als er al een bovenstuk of onderstuk is.
      let cands = state.items.filter((i) => s.cats.includes(i.category) && seasonOk(i))
        .map((i) => ({ i, r: outfitScore(i, chosen, state.overrides) }))
        .filter((x) => chosen.every((c) => compatible(x.i, c)))
        .sort((a, b) => b.r.score - a.r.score);
      const hidden = cands.filter((x) => x.r.score < 50).length;
      if (!state.showAll) cands = cands.filter((x) => x.r.score >= 50);
      const title = { onder: 'Kies een onderstuk', boven: 'Kies een bovenstuk', laag: 'Een pull erover?', jas: 'Een jas erbij?', schoenen: 'Welke schoenen?', accessoire: 'Een accessoire?' }[s.id];
      return `<section class="suggest">
        <h2>${title}</h2>
        ${cands.length ? `<div class="strip">${cands.map((x) => card(x.i, badge(x.r.score, true) + (recentlyWorn(x.i) ? '<span class="worn-tag">pas gedragen</span>' : ''), `data-pick="${x.i.id}"`)).join('')}</div>`
          : `<p class="sub">Niets dat goed past${hidden ? '' : ' in je kast'}.</p>`}
        ${hidden && !state.showAll ? `<button class="link" data-action="showall">Toon ook ${hidden} die minder goed passen</button>` : ''}
      </section>`;
    }).join('');

    const complete = state.outfit.onder && (state.outfit.boven || state.outfit.laag);
    const pairs = [];
    for (let a = 0; a < chosen.length; a++) for (let b = a + 1; b < chosen.length; b++) {
      if (compatible(chosen[a], chosen[b])) pairs.push(score(chosen[a], chosen[b], state.overrides));
    }
    let info = '<p class="sub">Kies hieronder wat erbij komt.</p>';
    if (pairs.length) {
      const total = Math.round(Math.min(...pairs.map((p) => p.score)) * 0.6 + pairs.reduce((s, p) => s + p.score, 0) / pairs.length * 0.4);
      const why = [...new Set(pairs.flatMap((p) => p.override ? [p.override === 'yes' ? 'door jou goedgekeurd' : 'door jou afgekeurd'] : p.why))];
      info = `<div>${badge(total)}</div><p class="sub">${why.join(' · ')}</p>`;
    }
    const fit = state.fits.get(fitKey());
    const fitBtn = state.fitting
      ? '<button class="btn" disabled>📸 Bezig… (± 20 s)</button>'
      : `<button class="btn" data-action="try-on">📸 ${fit ? 'Opnieuw passen' : 'Pas op mijn foto'}</button>`;
    body = `<section class="preview">
      <div class="preview-fig">${fit
        ? `<button class="fit-btn" data-action="fit-zoom" aria-label="Vergroten"><img class="fit-img" src="${esc(fit)}" alt="Jij in deze outfit"></button>`
        : `<button class="fit-btn" data-action="collage-zoom" aria-label="Vergroten"><span id="collageHost" data-key="${esc(collageKey(slotItems()))}">${outfitFigure(slotItems(), { width: 150 })}</span></button>`}</div>
      <div class="preview-info">
        <h2>Zo ziet het eruit</h2>
        ${info}
        ${complete ? `<div class="row-actions"><button class="btn primary" data-action="save-outfit">Outfit bewaren</button><button class="btn" data-action="wear-today">✓ Vandaag gedragen</button>${fitBtn}<button class="btn" data-action="gemini-export">✨ Zelf passen in Gemini</button></div>
          <p class="sub fit-note">"Pas op mijn foto" kost ± €0,04 per beeld (fal.ai). Via Gemini doe je het zelf, gratis binnen je daglimiet.</p>` : ''}
      </div>
    </section>` + body;
    if (state.showAll) body += `<button class="link" data-action="showall">Verberg wat niet past</button>`;
  }

  return `
    <div class="view-head">
      <h1>Outfit samenstellen</h1>
      <div class="head-tools">
        <label class="select-inline">Look
          <select data-look><option value="alle">Alle</option>${LOOK_ORDER.map((k) => `<option value="${k}" ${state.look === k ? 'selected' : ''}>${LOOKS[k].label}</option>`).join('')}</select>
        </label>
        <label class="select-inline">Seizoen
          <select data-season>${['alle', 'zomer', 'winter'].map((s) => `<option value="${s}" ${state.season === s ? 'selected' : ''}>${s === 'alle' ? 'Alles' : SEASONS[s]}</option>`).join('')}</select>
        </label>
        ${chosen.length ? '<button class="btn ghost" data-action="reset-outfit">Opnieuw</button>' : ''}
      </div>
    </div>
    ${weatherBar()}
    <div class="slots">${slotCards}</div>
    ${body}`;
}

const slotItems = (ids = state.outfit) => Object.fromEntries(SLOTS.map((s) => [s.id, (ids[s.id] && byId(ids[s.id])) || null]));

// Weer van vandaag boven de outfit.
function weatherBar() {
  if (!getPlace()) return '<div class="weather"><button class="link" data-action="weather-set">🌤 Weer van vandaag gebruiken</button></div>';
  const w = state.weather;
  if (!w) return '<div class="weather"><span class="sub">Weer ophalen…</span> <button class="link" data-action="weather-set">wijzig</button></div>';
  const a = weatherAdvice(w);
  return `<div class="weather"><div>🌤 <strong>${esc(w.place)}</strong> ${w.tmax}° / ${w.tmin}° · ${w.rain}% kans op regen <button class="link" data-action="weather-set">wijzig</button></div>
    <span class="sub">Advies: ${a.text}.</span></div>`;
}
async function refreshWeather() {
  try {
    state.weather = await todayWeather();
    if (state.weather && !state.seasonTouched) state.season = weatherAdvice(state.weather).season;
  } catch { state.weather = null; }
  if (state.view === 'outfit') render();
}

// De neergelegde outfit (uitgeknipte foto's) vervangt de paspop zodra hij klaar is.
function paintCollage() {
  const host = $('#collageHost');
  if (!host) return;
  const key = host.dataset.key;
  collage(slotItems()).then((url) => {
    const h = $('#collageHost');
    if (h && h.dataset.key === key) h.innerHTML = `<img class="fit-img" src="${url}" alt="De stukken van deze outfit naast elkaar">`;
  }).catch(() => { /* paspop blijft staan */ });
}

// Draaglogboek
async function wear(items) {
  const today = dayKey();
  let n = 0;
  for (const it of items) {
    if (it.worn?.[it.worn.length - 1] === today) continue;
    await saveItem({ ...it, worn: [...(it.worn || []), today].slice(-120) });
    n++;
  }
  return n;
}
// ---------- pasbeurt op eigen foto ----------
const fitKeyOf = (ids) => [...ids].filter(Boolean).sort().join('+');
const fitKey = () => fitKeyOf(SLOTS.map((s) => state.outfit[s.id]));
const GARMENT_EN = { tshirt: 't-shirt', pull: 'sweater', polo: 'polo shirt', hemd: 'button-up shirt', broek: 'long trousers', short: 'shorts', jas: 'jacket, worn open over the other tops', schoenen: 'shoes', accessoire: 'accessory' };
async function runTryOn() {
  if (state.fitting) return;
  if (!state.person) { toast('Voeg eerst je pasfoto toe'); return openMenu(); }
  const o = slotItems();
  const key = fitKey();
  const parts = SLOTS.map((sl) => o[sl.id]).filter(Boolean);
  state.fitting = true; render();
  try {
    const garments = [];
    for (const it of parts) {
      const layered = o.laag && o.boven && it === o.laag ? ', worn over the shirt' : '';
      garments.push({ image: await toDataUrl(it.image, 768), label: `${GARMENT_EN[it.category]}${layered}` });
    }
    const blob = await tryOn(state.person, garments);
    const url = URL.createObjectURL(blob);
    const image = await toDataUrl(url, 1100).finally(() => URL.revokeObjectURL(url));
    await db.put('extras', { id: 'fit:' + key, image, createdAt: Date.now() });
    state.fits.set(key, image);
    toast('Klaar! Tik op de foto om te vergroten.');
  } catch (err) {
    toast('Passen lukte niet: ' + (err.message || err));
  }
  state.fitting = false; render();
}
// ---------- export voor Gemini (zelf passen, zonder betalende dienst) ----------
const GARMENT_NL = { tshirt: 't-shirt', pull: 'pull', polo: 'polo', hemd: 'hemd', broek: 'broek', short: 'short', jas: 'jas', schoenen: 'schoenen', accessoire: 'accessoire' };
let geminiPack = null; // { files: File[], prompt }
const dataUrlToFile = async (dataUrl, name) => new File([await (await fetch(dataUrl)).blob()], name, { type: 'image/jpeg' });
async function openGeminiExport() {
  if (!state.person) { toast('Voeg eerst je pasfoto toe'); return openMenu(); }
  const o = slotItems();
  const parts = SLOTS.map((sl) => o[sl.id]).filter(Boolean);
  const files = [await dataUrlToFile(state.person, '1-ik.jpg')];
  const lines = [];
  const thumbs = [state.person];
  try {
    for (const [i, it] of parts.entries()) {
      const img = await toDataUrl(it.image, 1024);
      thumbs.push(img);
      files.push(await dataUrlToFile(img, `${i + 2}-${GARMENT_NL[it.category]}.jpg`));
      const layered = o.laag && o.boven && it === o.laag ? ', gedragen over het bovenstuk' : '';
      lines.push(`Foto ${i + 2}: ${GARMENT_NL[it.category]} (${it.name})${layered}.`);
    }
  } catch { return toast('Een kledingfoto kon niet gelezen worden'); }
  const prompt = `Foto 1 is een foto van mij. De andere foto's zijn productfoto's van kledingstukken. ${lines.join(' ')} `
    + 'Maak een fotorealistische foto van mij uit foto 1 waarop ik precies deze kledingstukken draag, met hun echte kleur, motief, stof en snit. '
    + 'Vervang alleen de kleding. Behoud mijn gezicht, haar, lichaamsbouw, houding, ' + (o.schoenen ? '' : 'schoenen, ') + 'de achtergrond en het licht van foto 1. '
    + 'De kleren zitten natuurlijk, met realistische plooien en schaduwen. Geef één beeld met dezelfde uitsnede als foto 1.';
  geminiPack = { files, prompt };
  const canShare = !!navigator.canShare?.({ files });
  openSheet(`
    <h2>Zelf passen in Gemini</h2>
    <p class="sub">Gratis binnen de daglimiet van je Gemini-account. Je geeft Gemini deze foto’s en de opdracht, en zet het resultaat daarna hier terug.</p>
    <div class="gem-thumbs">${thumbs.map((t, i) => `<figure><img src="${esc(t)}" alt=""><figcaption>Foto ${i + 1}</figcaption></figure>`).join('')}</div>
    <label class="field"><span>Opdracht voor Gemini</span><textarea id="gemPrompt" rows="7" readonly>${esc(prompt)}</textarea></label>
    <ol class="gem-steps">
      <li>${canShare ? 'Tik op <strong>Delen naar Gemini</strong> en kies Gemini. Lukt dat niet, download dan de foto’s.' : 'Klik op <strong>Foto’s downloaden</strong> en sleep ze in volgorde in Gemini (gemini.google.com).'}</li>
      <li>Plak de opdracht erbij (knop <strong>Opdracht kopiëren</strong>) en verstuur.</li>
      <li>Bewaar het beeld van Gemini en zet het hier terug met <strong>Resultaat toevoegen</strong>.</li>
    </ol>
    <div class="row-actions">
      ${canShare ? '<button class="btn primary" data-action="gemini-share">Delen naar Gemini</button>' : ''}
      <button class="btn ${canShare ? '' : 'primary'}" data-action="gemini-download">Foto’s downloaden</button>
      <button class="btn" data-action="gemini-copy">Opdracht kopiëren</button>
      <label class="btn">Resultaat toevoegen<input type="file" accept="image/*" data-fitresult hidden></label>
    </div>`);
}
async function copyGeminiPrompt() {
  try { await navigator.clipboard.writeText(geminiPack.prompt); return true; }
  catch { const ta = $('#gemPrompt'); ta?.select(); return document.execCommand?.('copy') || false; }
}
async function setFitResult(file) {
  const url = URL.createObjectURL(file);
  try {
    const key = fitKey();
    const image = await toDataUrl(url, 1100);
    await db.put('extras', { id: 'fit:' + key, image, createdAt: Date.now() });
    state.fits.set(key, image);
    closeSheet();
    toast('Beeld toegevoegd aan deze outfit');
  } catch { toast('Deze foto kon niet gelezen worden'); }
  URL.revokeObjectURL(url);
}

async function setPerson(file) {
  const url = URL.createObjectURL(file);
  try {
    state.person = await toDataUrl(url, 1024);
    await db.put('extras', { id: 'pasfoto', image: state.person });
    toast('Pasfoto bewaard');
  } catch { toast('Deze foto kon niet gelezen worden'); }
  URL.revokeObjectURL(url);
  if ($('#personBox')) openMenu();
}

function slotsFromIds(itemIds) {
  const o = emptyOutfit();
  itemIds.map(byId).filter(Boolean).forEach((it) => { o[slotOf(it.category)] = it; });
  return o;
}

function pickForOutfit(id) {
  const it = byId(id);
  state.outfit[slotOf(it.category)] = id;
  state.showAll = false;
  render();
}

function surprise() {
  const pool = state.items.filter(seasonOk);
  const allBottoms = pool.filter((i) => CATS[i.category].group === 'bottom');
  if (!allBottoms.length) return toast('Voeg eerst een broek of short toe');
  const fresh = allBottoms.filter((i) => !recentlyWorn(i));
  const bottoms = fresh.length ? fresh : allBottoms;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const onder = pick(bottoms);
  const best = (cats, chosen) => pool.filter((i) => cats.includes(i.category))
    .map((i) => ({ i, s: outfitScore(i, chosen, state.overrides).score }))
    .filter((x) => x.s >= 60).sort((a, b) => b.s - a.s).slice(0, 3);
  const tops = best(['tshirt', 'polo', 'hemd'], [onder]);
  const boven = tops.length ? pick(tops).i : null;
  let laag = null;
  if (boven && onder.category !== 'short' && Math.random() < 0.5) {
    const pulls = best(['pull'], [onder, boven]);
    if (pulls.length) laag = pick(pulls).i;
  }
  const shoes = best(['schoenen'], [onder, boven, laag].filter(Boolean));
  state.outfit = { ...emptyOutfit(), onder: onder.id, boven: boven?.id || null, laag: laag?.id || null, schoenen: shoes.length ? pick(shoes).i.id : null };
  render();
}

function saveOutfit() {
  const ids = SLOTS.map((s) => state.outfit[s.id]).filter(Boolean);
  openSheet(`
    <h2>Outfit bewaren</h2>
    <div class="outfit-imgs"><span class="mini-fig">${outfitFigure(slotItems(), { width: 58 })}</span>${ids.map((id) => `<img src="${esc(byId(id).image)}" alt="">`).join('')}</div>
    <form class="form" id="outfitForm">
      <label>Naam<input name="name" value="${esc(ids.map((id) => byId(id).name).join(' + '))}" required></label>
      <div class="row-actions"><button class="btn primary">Bewaren</button><button type="button" class="btn ghost" data-close>Annuleren</button></div>
    </form>`);
  $('#outfitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    const o = { id: uid(), name: name || 'Outfit', itemIds: ids, look: state.look !== 'alle' ? state.look : null, createdAt: Date.now() };
    await db.put('outfits', o);
    state.outfits.unshift(o);
    closeSheet();
    toast('Outfit bewaard');
  });
}

// ---------- weergave: bewaarde outfits ----------
function renderSaved() {
  return `
    <div class="view-head"><h1>Bewaarde outfits</h1>
    <p class="sub">${state.outfits.length ? 'Tik op een outfit om hem verder aan te passen.' : 'Nog geen outfits bewaard. Stel er een samen via "Outfit".'}</p></div>
    ${plannerHtml()}
    <div class="outfits">${state.outfits.map((o) => {
      const items = o.itemIds.map(byId).filter(Boolean);
      return `<div class="outfit-card">
        <button class="outfit-open" data-open-outfit="${o.id}">
          <div class="outfit-imgs">${state.fits.has(fitKeyOf(o.itemIds)) ? `<img class="mini-fit" src="${esc(state.fits.get(fitKeyOf(o.itemIds)))}" alt="">` : `<span class="mini-fig">${outfitFigure(slotsFromIds(o.itemIds), { width: 58 })}</span>`}${items.map((i) => `<img src="${esc(i.image)}" alt="">`).join('')}</div>
          <strong>${esc(o.name)}</strong>${o.look && LOOKS[o.look] ? `<span class="badge kan small">${LOOKS[o.look].label}</span>` : ''}
          <span class="sub">${items.map((i) => esc(i.name)).join(' · ')}</span>
        </button>
        <button class="icon-btn" data-del-outfit="${o.id}" aria-label="Verwijderen">🗑</button>
      </div>`;
    }).join('')}</div>`;
}

// ---------- weekplanner en paklijst ----------
function plannerHtml() {
  if (!state.outfits.length) return '';
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  return `<section class="planner">
    <div class="planner-head"><h2>Deze week</h2><button class="btn" data-action="pack">🧳 Paklijst</button></div>
    ${days.map((d, i) => {
      const k = dayKey(d);
      const label = i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : d.toLocaleDateString('nl-BE', { weekday: 'long' });
      return `<label class="plan-row"><span>${label} <small>${d.getDate()}/${d.getMonth() + 1}</small></span>
        <select data-plan="${k}"><option value="">—</option>${state.outfits.map((o) => `<option value="${o.id}" ${state.plan[k] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`;
    }).join('')}
  </section>`;
}
async function setPlan(day, outfitId) {
  const today = dayKey();
  const days = Object.fromEntries(Object.entries(state.plan).filter(([k]) => k >= today));
  if (outfitId) days[day] = outfitId; else delete days[day];
  state.plan = days;
  await db.put('extras', { id: 'plan', days });
}
function openPack() {
  openSheet(`
    <h2>Paklijst</h2>
    <p class="sub">Zo weinig mogelijk stukken die samen zo veel mogelijk outfits geven. Wat in de was zit, telt niet mee.</p>
    <form class="form two" id="packForm">
      <label>Aantal dagen<input type="number" name="days" min="1" max="21" value="4" inputmode="numeric"></label>
      <label>Look<select name="look"><option value="alle">Alle</option>${LOOK_ORDER.map((k) => `<option value="${k}">${LOOKS[k].label}</option>`).join('')}</select></label>
    </form>
    <div id="packResult"></div>`);
  const form = $('#packForm');
  const show = () => {
    const days = Math.max(1, Math.min(21, +form.days.value || 1));
    const r = packList(state.items, state.overrides, days, form.look.value);
    $('#packResult').innerHTML = r.items.length
      ? `<p><strong>${r.items.length} stukken</strong>, goed voor ${r.combos} combinatie${r.combos === 1 ? '' : 's'} van onder- en bovenstuk.${r.enough ? '' : ` Dat is minder dan ${days} dagen: je kast heeft te weinig stukken die samen passen voor deze look.`}</p>
        <div class="grid">${r.items.map((i) => card(i)).join('')}</div>`
      : '<p class="sub">Geen stukken gevonden voor deze look.</p>';
  };
  form.addEventListener('input', show);
  form.addEventListener('submit', (e) => e.preventDefault());
  show();
}

// ---------- kastanalyse ----------
function openAnalyse() {
  const a = analyse(state.items, state.overrides);
  const ideas = suggestAdditions(state.items, state.overrides);
  const row = (i, extra) => `<li><img src="${esc(i.image)}" alt=""><div class="m-info"><strong>${esc(i.name)}</strong><span class="sub">${extra}</span></div></li>`;
  const block = (title, html, empty) => `<h3>${title}</h3>${html ? `<ul class="matches">${html}</ul>` : `<p class="sub">${empty}</p>`}`;
  const euro = (n) => '€ ' + n.toFixed(2).replace('.', ',');
  openSheet(`
    <h2>Kastanalyse</h2>
    <p class="sub">${a.total} artikels. Het draaglogboek vult zich met de knop "Vandaag gedragen".</p>
    <h3>Mooie toevoegingen</h3>
    ${ideas.length ? `<p class="sub">Stukken die je nog niet hebt en die de meeste nieuwe combinaties geven met wat er al hangt.</p>
      <ul class="matches ideas">${ideas.map((d) => `<li>
        <span class="idea-swatch" style="background:${d.hex}"></span>
        <div class="m-info"><strong>${CATS[d.category].label} in ${d.colorName}</strong>
          <span class="sub">Past goed bij ${d.fits.length} van de ${d.of} stukken, o.a. ${d.fits.slice(0, 3).map((o) => esc(o.name)).join(', ')}.${d.isNew ? ` Je hebt nog geen ${CATS[d.category].label.toLowerCase()}.` : ''}${d.rescued.length ? ` Geeft ${d.rescued.length === 1 ? esc(d.rescued[0].name) : `${d.rescued.length} stukken die nu moeilijk combineren`} een extra combinatie.` : ''}</span></div>
      </li>`).join('')}</ul>` : '<p class="sub">Voeg eerst wat meer artikels toe: dan zoekt de app welke stukken je kast het best aanvullen.</p>'}
    <h3>Wat ontbreekt?</h3>
    ${a.gaps.length ? `<ul class="plain">${a.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '<p class="sub">Geen duidelijke gaten gevonden.</p>'}
    ${block('Meest gedragen', a.most.map((i) => row(i, `${i.worn.length}× gedragen · ${wornLabel(i)}`)).join(''), 'Nog niets gelogd.')}
    ${block(`Nog nooit gedragen (${a.never.length})`, a.never.slice(0, 8).map((i) => row(i, CATS[i.category].label)).join(''), 'Alles is al eens gedragen.')}
    ${block('Moeilijk te combineren', a.hard.map(({ i, n }) => row(i, n ? 'past goed bij maar 1 ander stuk' : 'past bij geen enkel ander stuk goed')).join(''), 'Elk stuk heeft minstens twee goede combinaties.')}
    ${block('Duurst per draagbeurt', a.costPerWear.map(({ i, cpw }) => row(i, `${euro(cpw)} per keer (${euro(i.price)}, ${i.worn.length}× gedragen)`)).join(''), 'Vul bij je artikels een aankoopprijs in om dit te zien.')}
    ${a.unworn ? `<p class="sub">Ongedragen stukken met een prijs: samen ${euro(a.unworn)}.</p>` : ''}`, 'wide');
}

// ---------- artikel-detail ----------
function attrFields(it, prefix = '') {
  return `
    <label>Naam<input name="name" value="${esc(it.name || '')}" placeholder="bv. Blauwe oxford hemd" required></label>
    <label>Categorie
      <select name="category" required>
        ${it.category ? '' : '<option value="">Kies…</option>'}
        ${CAT_ORDER.map((c) => `<option value="${c}" ${it.category === c ? 'selected' : ''}>${CATS[c].label}</option>`).join('')}
      </select>
    </label>
    <div class="two">
      <label>Hoofdkleur
        <span class="color-field"><input type="color" name="hex" value="${it.hex}"><span data-colorname>${colorName(it.hex)}</span></span>
      </label>
      <label>Motief
        <select name="pattern">${Object.entries(PATTERNS).map(([k, l]) => `<option value="${k}" ${it.pattern === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
    </div>
    <fieldset class="seg"><legend>Looks <small>(meerdere mogelijk)</small></legend>
      ${LOOK_ORDER.map((k) => `<label title="${esc(LOOKS[k].hint)}"><input type="checkbox" name="looks" value="${k}" ${(it.looks || []).includes(k) ? 'checked' : ''}><span>${LOOKS[k].label}</span></label>`).join('')}
    </fieldset>
    <fieldset class="seg"><legend>Seizoen</legend>
      ${Object.entries(SEASONS).map(([k, l]) => `<label><input type="radio" name="season" value="${k}" ${it.season === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}
    </fieldset>
    <label>Aankoopprijs in euro <small>(optioneel, voor de prijs per draagbeurt)</small><input type="number" name="price" min="0" step="0.01" inputmode="decimal" value="${it.price ?? ''}"></label>`;
}

function readForm(form, base) {
  const f = new FormData(form);
  return {
    ...base,
    name: (f.get('name') || '').trim() || 'Naamloos',
    category: f.get('category'),
    hex: f.get('hex'),
    pattern: f.get('pattern'),
    looks: f.getAll('looks'),
    season: f.get('season'),
    price: f.get('price') ? +f.get('price') : null,
  };
}

function matchList(it) {
  const others = state.items.filter((o) => compatible(it, o));
  if (!others.length) return '<p class="sub">Nog geen andere artikels om mee te combineren.</p>';
  return CAT_ORDER.map((c) => {
    const rows = others.filter((o) => o.category === c)
      .map((o) => ({ o, r: score(it, o, state.overrides) }))
      .sort((a, b) => b.r.score - a.r.score);
    if (!rows.length) return '';
    return `<h3>${CATS[c].plural}</h3><ul class="matches">${rows.map(({ o, r }) => `
      <li>
        <img src="${esc(o.image)}" alt="">
        <div class="m-info">
          <strong>${esc(o.name)}</strong>
          <span class="sub">${r.override ? `Jouw keuze · inschatting was ${verdict(r.auto).label.toLowerCase()}` : esc(r.why.slice(0, 2).join(' · '))}</span>
        </div>
        ${badge(r.score, true)}
        <div class="tri" role="group" aria-label="Aanpassen">
          <button class="${r.override === 'yes' ? 'on yes' : ''}" data-ov="yes" data-a="${it.id}" data-b="${o.id}" title="Past wel">✓</button>
          <button class="${!r.override ? 'on' : ''}" data-ov="" data-a="${it.id}" data-b="${o.id}" title="Automatische inschatting">auto</button>
          <button class="${r.override === 'no' ? 'on no' : ''}" data-ov="no" data-a="${it.id}" data-b="${o.id}" title="Past niet">✗</button>
        </div>
      </li>`).join('')}</ul>`;
  }).join('');
}

// ---------- foto's van een artikel ----------
const MAX_PHOTOS = 8;
let gallerySel = 0;
const photosOf = (it) => [it.image, ...(it.photos || [])];

function gallery(it) {
  const imgs = photosOf(it);
  if (gallerySel >= imgs.length) gallerySel = 0;
  return `
    <img class="g-main" src="${esc(imgs[gallerySel])}" alt="">
    <div class="g-thumbs">
      ${imgs.map((src, i) => `<button type="button" class="g-thumb ${i === gallerySel ? 'on' : ''}" data-gsel="${i}" aria-label="Foto ${i + 1}">
        <img src="${esc(src)}" alt="">${i === 0 && imgs.length > 1 ? '<span class="star" title="Hoofdfoto">★</span>' : ''}</button>`).join('')}
      ${imgs.length < MAX_PHOTOS ? `<label class="g-add" title="Foto's toevoegen">＋<input type="file" accept="image/*" multiple data-addphoto="${it.id}" hidden></label>` : ''}
    </div>
    <div class="row-actions g-actions"><button type="button" class="btn" data-action="photo-crop" data-id="${it.id}">✂︎ Uitsnijden</button></div>
    ${gallerySel > 0
      ? `<div class="row-actions g-actions">
          <button type="button" class="btn" data-action="photo-main" data-id="${it.id}">★ Maak hoofdfoto</button>
          <button type="button" class="btn danger" data-action="photo-del" data-id="${it.id}">Foto verwijderen</button>
        </div>`
      : `<p class="sub g-hint">${imgs.length > 1 ? '★ Hoofdfoto: verschijnt in de kast en bepaalt de kleur.' : 'Tik op ＋ om extra foto’s toe te voegen (achterkant, detail, gedragen…).'}</p>`}`;
}
function refreshGallery(id) {
  const g = $('#gallery');
  if (g) g.innerHTML = gallery(byId(id));
}
async function addPhotos(id, files) {
  const it = byId(id);
  const room = MAX_PHOTOS - photosOf(it).length;
  const list = [...files].slice(0, room);
  if (!list.length) return toast(`Maximaal ${MAX_PHOTOS} foto's per artikel`);
  toast('Foto’s toevoegen…');
  const added = [];
  for (const f of list) { try { added.push(await fileToDataUrl(f)); } catch { /* onleesbaar bestand overslaan */ } }
  await saveItem({ ...it, photos: [...(it.photos || []), ...added] });
  gallerySel = photosOf(byId(id)).length - 1;
  refreshGallery(id);
  toast(added.length === 1 ? 'Foto toegevoegd' : `${added.length} foto's toegevoegd`);
}

let currentDetailId = null;
function openDetail(id) {
  currentDetailId = id;
  gallerySel = 0;
  const it = byId(id);
  openSheet(`
    <div class="detail">
      <div class="detail-img"><div id="gallery">${gallery(it)}</div>
        ${it.credit ? `<small>${esc(it.credit)}</small>` : ''}
        ${it.sourceUrl ? `<small><a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener">Bekijk in webshop ↗</a></small>` : ''}
      </div>
      <form class="form" id="detailForm">
        ${attrFields(it)}
        <p class="sub wear-info">${it.worn?.length ? `${it.worn.length}× gedragen · ${wornLabel(it)}` : 'Nog niet gedragen'}${it.wash ? ' · 🧺 in de was' : ''}</p>
        <div class="row-actions">
          <button type="button" class="btn primary" data-action="start-outfit" data-id="${it.id}">Maak outfit hiermee</button>
          <button type="button" class="btn" data-action="wear-item" data-id="${it.id}">✓ Vandaag gedragen</button>
          <button type="button" class="btn" data-action="toggle-wash" data-id="${it.id}">${it.wash ? 'Terug uit de was' : '🧺 In de was'}</button>
          <button type="button" class="btn" data-action="reanalyze" data-id="${it.id}">Kleur opnieuw inschatten</button>
          <button type="button" class="btn danger" data-action="delete" data-id="${it.id}">Verwijderen</button>
        </div>
      </form>
    </div>
    <section class="match-section">
      <h2>Wat past hierbij?</h2>
      <p class="sub">Automatisch ingeschat. Klopt het niet? Zet het met ✓ of ✗ zelf goed.</p>
      <div id="matchList">${matchList(it)}</div>
    </section>`, 'wide');

  const form = $('#detailForm');
  form.addEventListener('input', (e) => {
    if (e.target.name === 'hex') $('[data-colorname]', form).textContent = colorName(e.target.value);
  });
  form.addEventListener('change', async () => {
    const updated = readForm(form, byId(id));
    await saveItem(updated);
    $('#matchList').innerHTML = matchList(updated);
    toast('Opgeslagen');
  });
}

// ---------- artikel toevoegen ----------
function openAdd() {
  openSheet(`
    <h2>Artikel toevoegen</h2>
    <div class="add-sources">
      <label class="source">
        <input type="file" accept="image/*" capture="environment" data-file hidden>
        <span class="big">📷</span><strong>Foto maken</strong><span class="sub">met de camera</span>
      </label>
      <label class="source">
        <input type="file" accept="image/*" data-file multiple hidden>
        <span class="big">🖼️</span><strong>Foto’s kiezen</strong><span class="sub">één of meerdere tegelijk</span>
      </label>
    </div>
    <form class="link-form" id="linkForm">
      <label>Of plak een link naar een webshop of afbeelding
        <span class="link-row"><input type="url" name="url" placeholder="https://…" required><button class="btn">Ophalen</button></span>
      </label>
    </form>
    <p class="status" id="addStatus"></p>
    <div id="addStep2"></div>`);

  sheet.querySelectorAll('[data-file]').forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files[0];
    if (!file) return;
    state.queue = [...inp.files].slice(1); // de rest komt hierna één voor één
    status('Foto inlezen…');
    try {
      const image = await fileToDataUrl(file);
      await step2({ image, name: '' });
    } catch (e) { status('Kon de foto niet lezen: ' + e.message, true); }
  }));
  $('#linkForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = new FormData(e.target).get('url').trim();
    status('Pagina ophalen…');
    try {
      const res = await importFromLink(url);
      await step2({ image: res.image, name: res.title, sourceUrl: res.sourceUrl });
    } catch (err) {
      status(`${err.message}. Tip: open de foto in de webshop, kies "Afbeeldingsadres kopiëren" en plak die link hier.`, true);
    }
  });
}
// Snijdt een kader [x0, y0, x1, y1] (0..1) uit een foto, met wat marge. Geeft null bij een onbruikbaar kader.
async function cropToBox(src, box) {
  if (!Array.isArray(box) || box.length !== 4 || box.some((v) => typeof v !== 'number' || Number.isNaN(v))) return null;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const pad = 0.03;
  const x0 = clamp(Math.min(box[0], box[2]) - pad), y0 = clamp(Math.min(box[1], box[3]) - pad);
  const x1 = clamp(Math.max(box[0], box[2]) + pad), y1 = clamp(Math.max(box[1], box[3]) + pad);
  if (x1 - x0 < 0.1 || y1 - y0 < 0.1 || (x1 - x0) * (y1 - y0) > 0.9) return null;
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const w = Math.round((x1 - x0) * img.naturalWidth), h = Math.round((y1 - y0) * img.naturalHeight);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, x0 * img.naturalWidth, y0 * img.naturalHeight, w, h, 0, 0, w, h);
  try { return c.toDataURL('image/jpeg', 0.85); } catch { return null; }
}
async function nextInQueue() {
  const file = state.queue.shift();
  const left = state.queue;
  openAdd();
  state.queue = left;
  status('Volgende foto inlezen…');
  try { await step2({ image: await fileToDataUrl(file), name: '' }); }
  catch (e) { status('Kon de foto niet lezen: ' + e.message, true); }
}
function status(msg, err) {
  const s = $('#addStatus');
  if (s) { s.textContent = msg; s.classList.toggle('err', !!err); }
}

async function step2({ image, name, sourceUrl = '' }) {
  status('Kleur en stijl inschatten…');
  const est = await estimate({ image, name });
  const draft = {
    id: uid(), name, image, sourceUrl, createdAt: Date.now(),
    category: est.categoryGuessed ? est.category : '',
    hex: est.hex, hex2: est.hex2, pattern: est.pattern,
    looks: est.looks || (est.categoryGuessed ? defaultLooks[est.category] : []), season: est.season,
  };
  status(est.analyzed
    ? `Ingeschat: ${colorName(est.hex)}${est.pattern !== 'effen' ? ', met motief' : ''}. Staan er meerdere stukken op de foto? Zeg hieronder welk stuk het is en snij het uit.`
    : 'De kleur kon niet uit deze foto gehaald worden. Kies ze hieronder zelf.');
  sheet.classList.add('wide');
  sheet.querySelector('.add-sources').hidden = true;
  $('#linkForm').hidden = true;
  $('#addStep2').innerHTML = `
    <div class="detail">
      <div class="detail-img">
        <div id="addImg"></div>
      </div>
      <form class="form" id="addForm">
        ${attrFields(draft).replace('<label>Naam<input name="name"', '<label>Welk stuk is het? <small>bv. "lichtblauwe jeans" of "zwarte polo"</small><input name="name" autocomplete="off"')}
        <p class="sub buy-check" id="buyCheck"></p>
        <div class="row-actions">
          <button class="btn primary">${state.queue.length ? `Opslaan en volgende (nog ${state.queue.length})` : 'Opslaan'}</button>
          <button type="button" class="btn ghost" data-close>Annuleren</button>
        </div>
      </form>
    </div>`;
  const form = $('#addForm');
  const touched = new Set();
  let colorFromText = est.colorFromText;

  const setHex = (hex) => {
    form.hex.value = hex;
    $('[data-colorname]', form).textContent = colorName(hex);
  };
  const setCategory = (c) => {
    if (!form.category.querySelector('option[value=""]') && !c) return;
    form.category.value = c;
    form.category.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Foto tonen, met knop om uit te snijden.
  const showImage = () => {
    $('#addImg').innerHTML = `<img class="g-main" src="${esc(draft.image)}" alt="">
      <div class="row-actions"><button type="button" class="btn" data-crop>✂︎ Eén stuk uitsnijden</button>
        ${syncState.email ? '<button type="button" class="btn" data-ai>✨ Herken met AI</button>' : ''}
        ${draft.original && draft.original !== draft.image ? '<button type="button" class="btn" data-orig>↩︎ Originele foto</button>' : ''}</div>
      <p class="sub g-hint">Staan er meerdere kledingstukken op? Sleep een kader rond het stuk dat je wilt. Enkel dat stuk komt in je kast.</p>`;
    $('[data-orig]')?.addEventListener('click', () => { draft.image = draft.original; showImage(); status('Originele foto teruggezet.'); });
    $('[data-ai]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      status('Claude bekijkt de foto…');
      try {
        const r = await recognize(await toDataUrl(draft.image, 1024), form.name.value);
        if (!r.found) { status('Claude ziet geen kledingstuk op deze foto.', true); return showImage(); }
        if (!form.name.value.trim()) form.name.value = r.name;
        if (!touched.has('category')) setCategory(r.category);
        if (!touched.has('hex') && /^#[0-9a-f]{6}$/i.test(r.hex)) { setHex(r.hex.toLowerCase()); draft.hex2 = /^#[0-9a-f]{6}$/i.test(r.hex2 || '') ? r.hex2.toLowerCase() : null; colorFromText = true; }
        if (!touched.has('pattern')) form.pattern.value = r.pattern;
        if (!touched.has('looks') && r.looks?.length) form.querySelectorAll('[name=looks]').forEach((b) => { b.checked = r.looks.includes(b.value); });
        if (!touched.has('season')) { const s = form.querySelector(`[name=season][value="${r.season}"]`); if (s) s.checked = true; }
        // Staan er nog andere stukken op? Dan snijdt de app het aangeduide stuk uit.
        const cut = r.others > 0 ? await cropToBox(draft.image, r.box) : null;
        if (cut) { draft.original = draft.original || draft.image; draft.image = cut; }
        showImage();
        updateCheck();
        status(`Herkend door Claude: ${r.name}${cut ? '. Het stuk is uitgesneden; niet goed? Zet de originele foto terug.' : '.'} Kijk de velden na.`);
      } catch (err) { status('AI-herkenning lukte niet: ' + (err.message || err), true); showImage(); }
    });
    $('[data-crop]').addEventListener('click', () => {
      mountCropper($('#addImg'), draft.image, {
        onApply: async (cropped) => {
          draft.image = cropped;
          showImage();
          try {
            const r = await analyzeImage(cropped);
            if (!touched.has('hex') && !colorFromText) setHex(r.hex);
            if (!touched.has('pattern')) form.pattern.value = r.pattern;
            status(`Uitgesneden. Ingeschat: ${r.colorName}${r.pattern !== 'effen' ? ', met motief' : ''}.`);
          } catch { status('Uitgesneden.'); }
        },
        onCancel: showImage,
      });
    });
  };
  showImage();

  // De omschrijving vult categorie, kleur, motief en looks in (tenzij je die zelf al koos).
  let typing;
  form.name.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      const g = guessFromText(form.name.value);
      if (g.category && !touched.has('category')) setCategory(g.category);
      if (g.hex && !touched.has('hex')) { setHex(g.hex); colorFromText = true; }
      if (g.pattern && !touched.has('pattern')) form.pattern.value = g.pattern;
      if (g.looks && !touched.has('looks')) form.querySelectorAll('[name=looks]').forEach((b) => { b.checked = g.looks.includes(b.value); });
    }, 350);
  });

  form.addEventListener('input', (e) => {
    if (e.target.name !== 'name') touched.add(e.target.name);
    if (e.target.name === 'hex') $('[data-colorname]', form).textContent = colorName(e.target.value);
  });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'category') return;
    if (e.isTrusted) touched.add('category');
    const c = e.target.value;
    const g = guessFromText(form.name.value);
    if (!touched.has('looks') && !g.looks) form.querySelectorAll('[name=looks]').forEach((b) => { b.checked = defaultLooks[c].includes(b.value); });
    if (!touched.has('season')) form.querySelector(`[name=season][value="${defaultSeason[c]}"]`).checked = true;
  });
  // Koopcheck: hoe goed past dit stuk bij wat je al hebt?
  const updateCheck = () => {
    const el = $('#buyCheck');
    const it = readForm(form, draft);
    if (!el || !it.category) { if (el) el.textContent = ''; return; }
    const r = fitsCloset(it, state.items, state.overrides);
    el.innerHTML = `<strong>Past dit bij je kast?</strong> Combineert goed met ${r.good.length} van de ${r.of} stukken`
      + (r.good.length ? `, o.a. ${r.good.slice(0, 3).map((o) => esc(o.name)).join(', ')}.` : '.')
      + (r.twins.length ? ` Je hebt al ${r.twins.length} ${CATS[it.category].label.toLowerCase()} in ${colorName(it.hex)}.` : '');
  };
  form.addEventListener('input', () => setTimeout(updateCheck, 400));
  form.addEventListener('change', updateCheck);
  updateCheck();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = readForm(form, draft);
    if (!item.category) return toast('Kies een categorie');
    await saveItem(item);
    toast('Toegevoegd');
    if (state.queue.length) return nextInQueue();
    openDetail(item.id);
  });
}

// ---------- menu ----------
function openMenu() {
  openSheet(`
    <h2>Instellingen</h2>
    <div class="menu">
      <button class="btn" data-action="analyse">📊 Kastanalyse</button>
      ${state.items.some((i) => i.wash) ? '<button class="btn" data-action="wash-clear">🧺 Alles terug uit de was</button>' : ''}
      <button class="btn" data-action="export">Back-up downloaden (JSON)</button>
      <label class="btn">Back-up terugzetten<input type="file" accept="application/json" data-import hidden></label>
      <button class="btn" data-action="reseed">Testartikels opnieuw toevoegen</button>
      <button class="btn" data-action="remove-tests">Testartikels verwijderen</button>
      <button class="btn danger" data-action="wipe">Alles wissen</button>
    </div>
    <section class="sync-box" id="personBox">
      <h3>Mijn pasfoto</h3>
      <p class="sub">Een foto van jezelf, rechtopstaand en volledig in beeld. Daarop past de app je outfits fotorealistisch (knop "Pas op mijn foto"). De foto staat op dit toestel en, als synchronisatie aan staat, in je eigen Supabase. Ze gaat enkel bij het passen naar het AI-model van fal.ai, of naar Gemini als je ze zelf deelt.</p>
      ${state.person ? `<img class="person-img" src="${esc(state.person)}" alt="Je pasfoto">` : ''}
      <div class="row-actions">
        <label class="btn">${state.person ? 'Andere foto kiezen' : 'Pasfoto kiezen'}<input type="file" accept="image/*" data-person hidden></label>
        ${state.person ? '<button class="btn danger" data-action="person-remove">Pasfoto en gepaste beelden wissen</button>' : ''}
      </div>
    </section>
    <section class="sync-box" id="syncBox"><h3>Account</h3><p class="sub">Laden…</p></section>
    <div class="about">
      <h3>Hoe werkt de inschatting?</h3>
      <p>Deze versie is gratis: de foto wordt op je toestel zelf geanalyseerd (hoofdkleur en motief). Categorie en looks haalt de app uit de naam of de webshop. Daarna berekent ze per combinatie een score op kleur, contrast, motief, look en seizoen. Jouw ✓/✗ gaan altijd voor.</p>
      <p>Zonder synchronisatie staan je gegevens enkel op dit toestel. Testfoto's: Unsplash.</p>
    </div>`);
  sheet.querySelector('[data-import]').addEventListener('change', importBackup);
  renderSyncBox();
}

function openAccount() {
  openSheet('<h2>Account</h2><section class="sync-box" id="syncBox"><p class="sub">Laden…</p></section>');
  renderSyncBox();
}
const HINT_KEY = 'kastwijzer.accounthint';
const hintHidden = () => { try { return localStorage.getItem(HINT_KEY) === 'weg'; } catch { return false; } };
function accountHint() {
  if (syncState.email || hintHidden()) return '';
  return `<div class="account-hint"><span>Log in met je account om je kleerkast op pc, gsm en andere toestellen te zien.</span>
    <span class="row-actions"><button class="btn primary" data-action="account">Account</button><button class="btn ghost" data-action="hint-hide">Niet nu</button></span></div>`;
}

let loginEmail = '';
async function renderSyncBox() {
  const box = $('#syncBox');
  if (!box) return;
  const cfg = getConfig();
  const user = cfg ? await currentUser().catch(() => null) : null;
  if (!cfg) {
    box.innerHTML = `<h3>Account en synchronisatie</h3>
      <p class="sub">Met een account staat je kleerkast veilig online en zie je ze op elk toestel. Daarvoor moet de app één keer gekoppeld worden aan je eigen (gratis) Supabase-project; de stappen staan in de handleiding (SETUP.md). Zolang dat niet gebeurd is, staan je gegevens enkel op dit toestel.</p>
      <form class="form" id="cfgForm">
        <label>Project URL<input name="url" placeholder="https://xxxx.supabase.co" required></label>
        <label>Publieke sleutel (anon / publishable)<input name="key" required></label>
        <div class="row-actions"><button class="btn primary">Koppelen</button></div>
      </form>`;
    $('#cfgForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      saveConfig(f.get('url'), f.get('key'));
      await initSync(refreshFromSync);
      renderSyncBox();
    });
    return;
  }
  if (!user) {
    box.innerHTML = `<h3>Inloggen</h3>
      <p class="sub">Je account is je e-mailadres, zonder wachtwoord: je krijgt een mail met een link en een code. Gebruik op elk toestel (pc, gsm, tablet) hetzelfde adres en je ziet overal dezelfde kleerkast.</p>
      <form class="form" id="loginForm">
        <label>E-mailadres<input type="email" name="email" value="${esc(loginEmail)}" autocomplete="email" required></label>
        <div class="row-actions"><button class="btn primary">Stuur login-mail</button></div>
      </form>
      <form class="form" id="codeForm" ${loginEmail ? '' : 'hidden'}>
        <label>Code uit de mail<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
        <div class="row-actions"><button class="btn primary">Inloggen</button></div>
      </form>
      <p class="status" id="syncMsg"></p>
      <button class="link" data-action="forget-config">Ander Supabase-project koppelen</button>`;
    const msg = (t, err) => { const m = $('#syncMsg'); m.textContent = t; m.classList.toggle('err', !!err); };
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      loginEmail = new FormData(e.target).get('email').trim();
      try {
        await sendLogin(loginEmail);
        $('#codeForm').hidden = false;
        msg('Mail verstuurd. Tik op de link in de mail, of typ de code hieronder.');
      } catch (err) { msg(err.message, true); }
    });
    $('#codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await verifyCode(loginEmail, new FormData(e.target).get('code'));
        renderSyncBox();
      } catch (err) { msg(err.message, true); }
    });
    return;
  }
  const last = syncState.lastSync ? syncState.lastSync.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : 'nog niet';
  box.innerHTML = `<h3>Account</h3>
    <p>Ingelogd als <strong>${esc(user.email)}</strong>.<br>
    <span class="sub">${syncState.status === 'fout' ? `Probleem: ${esc(syncState.message)}` : `Laatst gesynchroniseerd: ${last}`}</span></p>
    <div class="row-actions">
      <button class="btn primary" data-action="sync-now">Nu synchroniseren</button>
      <button class="btn" data-action="sign-out">Uitloggen</button>
    </div>`;
}

async function refreshFromSync() {
  await load();
  if (!sheet.open) render();
}

async function exportBackup() {
  const data = { app: 'kastwijzer', version: 1, exportedAt: new Date().toISOString(), items: state.items, outfits: state.outfits, overrides: [...state.overrides].map(([key, value]) => ({ key, value })), extras: await db.all('extras') };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kastwijzer-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'kastwijzer') throw new Error('Dit is geen Kastwijzer-back-up');
    if (!confirm(`${data.items.length} artikels en ${data.outfits.length} outfits terugzetten? Bestaande artikels met dezelfde id worden overschreven.`)) return;
    await db.putMany('items', data.items);
    await db.putMany('outfits', data.outfits);
    await db.putMany('overrides', data.overrides);
    if (Array.isArray(data.extras)) await db.putMany('extras', data.extras);
    await load();
    closeSheet();
    toast('Back-up teruggezet');
  } catch (err) { alert(err.message); }
}

// ---------- acties ----------
const actions = {
  add: () => { state.queue = []; openAdd(); },
  analyse: openAnalyse,
  pack: openPack,
  async 'wear-today'() {
    const n = await wear(SLOTS.map((sl) => state.outfit[sl.id]).filter(Boolean).map(byId).filter(Boolean));
    toast(n ? 'Genoteerd: vandaag gedragen' : 'Stond al genoteerd voor vandaag');
    render();
  },
  async 'wear-item'(el) {
    const n = await wear([byId(el.dataset.id)]);
    toast(n ? 'Genoteerd: vandaag gedragen' : 'Stond al genoteerd voor vandaag');
    openDetail(el.dataset.id);
  },
  async 'toggle-wash'(el) {
    const it = byId(el.dataset.id);
    await saveItem({ ...it, wash: !it.wash });
    toast(it.wash ? 'Terug in de kast' : 'In de was: komt niet meer in voorstellen');
    openDetail(it.id);
  },
  async 'wash-clear'() {
    for (const it of state.items.filter((i) => i.wash)) await saveItem({ ...it, wash: false });
    closeSheet(); render(); toast('Alles is terug uit de was');
  },
  async 'collage-zoom'() {
    try {
      const url = await collage(slotItems());
      openSheet(`<h2>Deze outfit</h2><img class="fit-large" src="${url}" alt="De stukken van deze outfit naast elkaar">
        <div class="row-actions"><button class="btn primary" data-action="collage-share">Delen of bewaren</button></div>
        <p class="sub">Uitknippen werkt het best met een stuk op een effen achtergrond. Lukt het niet, dan zie je de foto als kaartje.</p>`);
    } catch { toast('Het beeld kon niet gemaakt worden'); }
  },
  async 'collage-share'() {
    const file = await dataUrlToFile(await collage(slotItems()), 'outfit.jpg');
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Mijn outfit' }); } catch { /* geannuleerd */ }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('Beeld gedownload');
  },
  'weather-set'() {
    const place = getPlace();
    openSheet(`
      <h2>Weer van vandaag</h2>
      <p class="sub">De app haalt de verwachting op bij Open-Meteo (gratis) en stemt het seizoen en het advies erop af. Enkel de naam van je gemeente gaat naar die dienst.</p>
      <form class="form" id="placeForm">
        <label>Gemeente<input name="place" value="${esc(place?.name || '')}" placeholder="bv. Gent" required autocomplete="off"></label>
        <div class="row-actions"><button class="btn primary">Bewaren</button>${place ? '<button type="button" class="btn" data-action="weather-forget">Weer niet meer gebruiken</button>' : ''}</div>
      </form>`);
    $('#placeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await setPlace(new FormData(e.target).get('place').trim());
        state.seasonTouched = false;
        closeSheet();
        await refreshWeather();
      } catch (err) { toast(err.message); }
    });
  },
  'weather-forget'() { forgetPlace(); state.weather = null; closeSheet(); },
  surprise,
  'try-on': runTryOn,
  'gemini-export': openGeminiExport,
  async 'gemini-share'() {
    const copied = await copyGeminiPrompt();
    try {
      await navigator.share({ files: geminiPack.files, text: geminiPack.prompt });
      if (copied) toast('Opdracht staat ook op je klembord');
    } catch (err) { if (err.name !== 'AbortError') toast('Delen lukte niet. Download de foto’s.'); }
  },
  'gemini-download'() {
    geminiPack.files.forEach((f, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, i * 350));
    toast(`${geminiPack.files.length} foto’s gedownload`);
  },
  async 'gemini-copy'() { toast((await copyGeminiPrompt()) ? 'Opdracht gekopieerd' : 'Kopiëren lukte niet: selecteer de tekst zelf'); },
  'fit-zoom'() {
    const fit = state.fits.get(fitKey());
    if (fit) openSheet(`<h2>Jij in deze outfit</h2><img class="fit-large" src="${esc(fit)}" alt="Jij in deze outfit"><p class="sub">Door AI gemaakt beeld: pasvorm en details kunnen afwijken van de echte stukken.</p>`);
  },
  async 'person-remove'() {
    if (!confirm('Je pasfoto en alle gepaste beelden wissen?')) return;
    for (const x of await db.all('extras')) if (x.id === 'pasfoto' || x.id.startsWith('fit:')) await db.del('extras', x.id);
    state.person = null; state.fits = new Map();
    openMenu(); render();
  },
  showall: () => { state.showAll = !state.showAll; render(); },
  'reset-outfit': () => { state.outfit = emptyOutfit(); state.showAll = false; render(); },
  'save-outfit': saveOutfit,
  'start-outfit': (el) => {
    state.outfit = emptyOutfit();
    closeSheet();
    pickForOutfit(el.dataset.id);
    setView('outfit');
  },
  'photo-crop'(el) {
    const it = byId(el.dataset.id);
    const idx = gallerySel;
    mountCropper($('#gallery'), photosOf(it)[idx], {
      onApply: async (cropped) => {
        const cur = byId(it.id);
        const imgs = photosOf(cur);
        imgs[idx] = cropped;
        await saveItem({ ...cur, image: imgs[0], photos: imgs.slice(1) });
        refreshGallery(it.id);
        toast(idx === 0 ? 'Uitgesneden. Tip: "Kleur opnieuw inschatten".' : 'Uitgesneden');
      },
      onCancel: () => refreshGallery(it.id),
    });
  },
  async 'photo-main'(el) {
    const it = byId(el.dataset.id);
    const imgs = photosOf(it);
    const [main] = imgs.splice(gallerySel, 1);
    await saveItem({ ...it, image: main, photos: imgs });
    gallerySel = 0;
    refreshGallery(it.id);
    toast('Hoofdfoto gewijzigd. Tip: "Kleur opnieuw inschatten".');
  },
  async 'photo-del'(el) {
    if (!confirm('Deze foto verwijderen?')) return;
    const it = byId(el.dataset.id);
    const photos = (it.photos || []).filter((_, i) => i !== gallerySel - 1);
    await saveItem({ ...it, photos });
    gallerySel = 0;
    refreshGallery(it.id);
    toast('Foto verwijderd');
  },
  async reanalyze(el) {
    const it = byId(el.dataset.id);
    try {
      const r = await analyzeImage(it.image);
      await saveItem({ ...it, hex: r.hex, hex2: r.hex2 });
      openDetail(it.id);
      toast(`Nieuwe inschatting: ${r.colorName}`);
    } catch { toast('Deze foto kan niet geanalyseerd worden'); }
  },
  async delete(el) {
    const it = byId(el.dataset.id);
    if (!confirm(`"${it.name}" verwijderen?`)) return;
    await db.del('items', it.id);
    state.items = state.items.filter((i) => i.id !== it.id);
    for (const s of SLOTS) if (state.outfit[s.id] === it.id) state.outfit[s.id] = null;
    closeSheet();
    toast('Verwijderd');
  },
  export: exportBackup,
  async reseed() {
    // Met tijdstempel, zodat ze ook op je andere toestellen terugkomen.
    for (const it of SEED_ITEMS) await db.put('items', { ...it });
    await load(); closeSheet(); toast('Testartikels toegevoegd');
  },
  async 'sync-now'() {
    const r = await syncNow();
    if (r.error) toast('Synchronisatie mislukt');
    else { toast(`Gesynchroniseerd (${r.pulled} binnen, ${r.pushed} verstuurd)`); if (r.pulled) await load(); }
    renderSyncBox();
  },
  async 'sign-out'() { await signOut(); renderSyncBox(); },
  account: openAccount,
  'hint-hide'() { try { localStorage.setItem(HINT_KEY, 'weg'); } catch { /* opslag geblokkeerd */ } render(); },
  'forget-config'() { forgetConfig(); loginEmail = ''; renderSyncBox(); },
  async 'remove-tests'() {
    if (!confirm('Alle testartikels verwijderen?')) return;
    for (const it of state.items.filter((i) => i.test)) await db.del('items', it.id);
    await load(); closeSheet(); toast('Testartikels verwijderd');
  },
  async wipe() {
    if (!confirm('Echt alles wissen? Dit kan niet ongedaan gemaakt worden.')) return;
    await Promise.all(['items', 'outfits', 'overrides', 'extras'].map((s) => db.clear(s)));
    state.outfit = emptyOutfit();
    await load(); closeSheet(); toast('Alles gewist');
  },
};

document.addEventListener('click', async (e) => {
  const t = e.target;
  const gsel = t.closest('[data-gsel]');
  if (gsel) { gallerySel = +gsel.dataset.gsel; return refreshGallery(currentDetailId); }
  const act = t.closest('[data-action]');
  if (act) { e.preventDefault(); return actions[act.dataset.action]?.(act); }
  const view = t.closest('[data-view]');
  if (view) return setView(view.dataset.view);
  const filter = t.closest('[data-filter]');
  if (filter) { state.filter = filter.dataset.filter; return render(); }
  const pick = t.closest('[data-pick]');
  if (pick) return pickForOutfit(pick.dataset.pick);
  const unslot = t.closest('[data-unslot]');
  if (unslot) { state.outfit[unslot.dataset.unslot] = null; return render(); }
  const ov = t.closest('[data-ov]');
  if (ov) {
    await setOverride(ov.dataset.a, ov.dataset.b, ov.dataset.ov || null);
    $('#matchList').innerHTML = matchList(byId(ov.dataset.a));
    return;
  }
  const openO = t.closest('[data-open-outfit]');
  if (openO) {
    const o = state.outfits.find((x) => x.id === openO.dataset.openOutfit);
    state.outfit = emptyOutfit();
    o.itemIds.filter(byId).forEach((id) => { state.outfit[slotOf(byId(id).category)] = id; });
    state.look = o.look || 'alle';
    return setView('outfit');
  }
  const delO = t.closest('[data-del-outfit]');
  if (delO) {
    if (!confirm('Deze outfit verwijderen?')) return;
    await db.del('outfits', delO.dataset.delOutfit);
    state.outfits = state.outfits.filter((x) => x.id !== delO.dataset.delOutfit);
    return render();
  }
  const c = t.closest('.card[data-id]');
  if (c && !sheet.contains(c)) return openDetail(c.dataset.id);
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-fitresult]')) { if (e.target.files[0]) setFitResult(e.target.files[0]); return; }
  if (e.target.matches('[data-person]')) { if (e.target.files[0]) setPerson(e.target.files[0]); return; }
  if (e.target.matches('[data-addphoto]')) { addPhotos(e.target.dataset.addphoto, e.target.files); return; }
  if (e.target.matches('[data-plan]')) { setPlan(e.target.dataset.plan, e.target.value); return; }
  if (e.target.matches('[data-season]')) { state.season = e.target.value; state.seasonTouched = true; render(); }
  if (e.target.matches('[data-look]')) { state.look = e.target.value; render(); }
});
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-search]')) return;
  state.q = e.target.value;
  $('#closetGrid').innerHTML = closetGrid();
});
$('#menuBtn').addEventListener('click', openMenu);
$('#syncBtn').addEventListener('click', openAccount);
const SYNC_ICON = { uit: '👤', uitgelogd: '☁︎', bezig: '↻', ok: '☁︎', fout: '⚠︎', offline: '☁︎' };
const SYNC_TITLE = { uit: 'Account: nog niet gekoppeld', uitgelogd: 'Niet ingelogd: niet gesynchroniseerd', bezig: 'Bezig met synchroniseren…', ok: 'Gesynchroniseerd', fout: 'Synchronisatie mislukt', offline: 'Offline: synchroniseert later' };
onSyncStatus(({ status, message }) => {
  const b = $('#syncBtn');
  b.hidden = false;
  b.textContent = SYNC_ICON[status] || '☁︎';
  b.title = (SYNC_TITLE[status] || '') + (message ? `: ${message}` : '');
  b.dataset.status = status;
  if (status === 'ok' && $('.account-hint')) render();
});

function render() {
  const v = $('#view');
  v.innerHTML = state.view === 'kast' ? renderCloset() : state.view === 'outfit' ? renderOutfit() : renderSaved();
  $('#fab').hidden = state.view !== 'kast';
  paintCollage();
}

load().then(() => { render(); initSync(refreshFromSync); refreshWeather(); }).catch((e) => {
  $('#view').innerHTML = `<div class="empty"><p>De app kon niet starten: ${esc(e.message)}</p></div>`;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Nieuwe versie geladen terwijl de app open staat: vraag om te herladen.
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if ($('.update-bar')) return;
      const bar = document.createElement('div');
      bar.className = 'update-bar';
      bar.innerHTML = '<span>Er is een nieuwe versie van Kastwijzer.</span><button class="btn primary">Herladen</button>';
      bar.querySelector('button').addEventListener('click', () => location.reload());
      document.body.appendChild(bar);
    });
  }
}
