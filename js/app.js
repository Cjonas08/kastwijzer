import { db } from './db.js';
import { CATS, CAT_ORDER, SLOTS, slotOf, PATTERNS, SEASONS, LOOKS, LOOK_ORDER, defaultLooks, looksFromFormality, defaultSeason, colorName, uid } from './model.js';
import { estimate, analyzeImage, fileToDataUrl, importFromLink, guessFromText } from './analyze.js';
import { mountCropper } from './crop.js';
import { compatible, score, verdict, outfitScore, pairKey } from './match.js';
import { SEED_ITEMS, SEED_OVERRIDES } from './seed.js';
import { outfitFigure } from './figure.js';
import { initSync, onSyncStatus, syncNow, syncState, getConfig, saveConfig, forgetConfig, currentUser, sendLogin, verifyCode, signOut } from './sync.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  items: [],
  outfits: [],
  overrides: new Map(),
  view: 'kast',
  filter: 'alle',
  outfit: { onder: null, boven: null, laag: null },
  showAll: false,
  season: 'alle',
  look: 'alle',
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
}
function closeSheet() { if (sheet.open) sheet.close(); }
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
    <div class="thumb"><img loading="lazy" src="${esc(item.image)}" alt="">${item.photos?.length ? `<span class="photo-count">${item.photos.length + 1} foto's</span>` : ''}</div>
    <div class="card-body">
      <div class="card-name">${esc(item.name)}</div>
      <div class="card-meta">${swatch(item.hex, item.hex2)}${colorName(item.hex)} · ${CATS[item.category].label}</div>
      ${extra}
    </div>
  </button>`;
}

// ---------- weergave: kleerkast ----------
function renderCloset() {
  const counts = Object.fromEntries(CAT_ORDER.map((c) => [c, state.items.filter((i) => i.category === c).length]));
  const sorted = [...state.items].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || b.createdAt - a.createdAt);
  const list = state.filter === 'alle' ? sorted : sorted.filter((i) => i.category === state.filter);
  const chips = [['alle', 'Alles', state.items.length], ...CAT_ORDER.map((c) => [c, CATS[c].plural, counts[c]])]
    .map(([k, l, n]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${l} <span>${n}</span></button>`).join('');
  return `
    <div class="view-head">
      <h1>Mijn kleerkast</h1>
      <p class="sub">${state.items.length} artikels. Tik op een artikel om te zien wat erbij past.</p>
    </div>
    <div class="chips">${chips}</div>
    ${list.length ? `<div class="grid">${list.map((i) => card(i)).join('')}</div>`
      : `<div class="empty"><p>Nog niets in deze categorie.</p><button class="btn primary" data-action="add">Artikel toevoegen</button></div>`}
  `;
}

// ---------- weergave: outfit samenstellen ----------
function seasonOk(item) {
  if (state.look !== 'alle' && !(item.looks || []).includes(state.look)) return false;
  if (state.season === 'alle') return true;
  return item.season === 'altijd' || item.season === state.season;
}

function renderOutfit() {
  const chosen = SLOTS.map((s) => state.outfit[s.id]).filter(Boolean).map(byId).filter(Boolean);
  const slotCards = SLOTS.map((s) => {
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
    body = SLOTS.filter((s) => !state.outfit[s.id]).map((s) => {
      // Een pull over een t-shirt/hemd: enkel tonen als er al een bovenstuk of onderstuk is.
      let cands = state.items.filter((i) => s.cats.includes(i.category) && seasonOk(i))
        .map((i) => ({ i, r: outfitScore(i, chosen, state.overrides) }))
        .filter((x) => chosen.every((c) => compatible(x.i, c)))
        .sort((a, b) => b.r.score - a.r.score);
      const hidden = cands.filter((x) => x.r.score < 50).length;
      if (!state.showAll) cands = cands.filter((x) => x.r.score >= 50);
      const title = { onder: 'Kies een onderstuk', boven: 'Kies een bovenstuk', laag: 'Een pull erover?' }[s.id];
      return `<section class="suggest">
        <h2>${title}</h2>
        ${cands.length ? `<div class="strip">${cands.map((x) => card(x.i, badge(x.r.score, true), `data-pick="${x.i.id}"`)).join('')}</div>`
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
    body = `<section class="preview">
      <div class="preview-fig">${outfitFigure(slotItems(), { width: 150 })}</div>
      <div class="preview-info">
        <h2>Zo ziet het eruit</h2>
        ${info}
        ${complete ? `<div class="row-actions"><button class="btn primary" data-action="save-outfit">Outfit bewaren</button></div>` : ''}
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
    <div class="slots">${slotCards}</div>
    ${body}`;
}

const slotItems = (ids = state.outfit) => ({ onder: ids.onder && byId(ids.onder), boven: ids.boven && byId(ids.boven), laag: ids.laag && byId(ids.laag) });
function slotsFromIds(itemIds) {
  const o = { onder: null, boven: null, laag: null };
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
  const bottoms = pool.filter((i) => CATS[i.category].group === 'bottom');
  if (!bottoms.length) return toast('Voeg eerst een broek of short toe');
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
  state.outfit = { onder: onder.id, boven: boven?.id || null, laag: laag?.id || null };
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
    <div class="outfits">${state.outfits.map((o) => {
      const items = o.itemIds.map(byId).filter(Boolean);
      return `<div class="outfit-card">
        <button class="outfit-open" data-open-outfit="${o.id}">
          <div class="outfit-imgs"><span class="mini-fig">${outfitFigure(slotsFromIds(o.itemIds), { width: 58 })}</span>${items.map((i) => `<img src="${esc(i.image)}" alt="">`).join('')}</div>
          <strong>${esc(o.name)}</strong>${o.look && LOOKS[o.look] ? `<span class="badge kan small">${LOOKS[o.look].label}</span>` : ''}
          <span class="sub">${items.map((i) => esc(i.name)).join(' · ')}</span>
        </button>
        <button class="icon-btn" data-del-outfit="${o.id}" aria-label="Verwijderen">🗑</button>
      </div>`;
    }).join('')}</div>`;
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
    </fieldset>`;
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
        <div class="row-actions">
          <button type="button" class="btn primary" data-action="start-outfit" data-id="${it.id}">Maak outfit hiermee</button>
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
        <input type="file" accept="image/*" data-file hidden>
        <span class="big">🖼️</span><strong>Foto kiezen</strong><span class="sub">uit je bestanden</span>
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
        <div class="row-actions">
          <button class="btn primary">Opslaan</button>
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
      <div class="row-actions"><button type="button" class="btn" data-crop>✂︎ Eén stuk uitsnijden</button></div>
      <p class="sub g-hint">Staan er meerdere kledingstukken op? Sleep een kader rond het stuk dat je wilt. Enkel dat stuk komt in je kast.</p>`;
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
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = readForm(form, draft);
    if (!item.category) return toast('Kies een categorie');
    await saveItem(item);
    toast('Toegevoegd');
    openDetail(item.id);
  });
}

// ---------- menu ----------
function openMenu() {
  openSheet(`
    <h2>Instellingen</h2>
    <div class="menu">
      <button class="btn" data-action="export">Back-up downloaden (JSON)</button>
      <label class="btn">Back-up terugzetten<input type="file" accept="application/json" data-import hidden></label>
      <button class="btn" data-action="reseed">Testartikels opnieuw toevoegen</button>
      <button class="btn" data-action="remove-tests">Testartikels verwijderen</button>
      <button class="btn danger" data-action="wipe">Alles wissen</button>
    </div>
    <section class="sync-box" id="syncBox"><h3>Synchroniseren</h3><p class="sub">Laden…</p></section>
    <div class="about">
      <h3>Hoe werkt de inschatting?</h3>
      <p>Deze versie is gratis: de foto wordt op je toestel zelf geanalyseerd (hoofdkleur en motief). Categorie en looks haalt de app uit de naam of de webshop. Daarna berekent ze per combinatie een score op kleur, contrast, motief, look en seizoen. Jouw ✓/✗ gaan altijd voor.</p>
      <p>Zonder synchronisatie staan je gegevens enkel op dit toestel. Testfoto's: Unsplash.</p>
    </div>`);
  sheet.querySelector('[data-import]').addEventListener('change', importBackup);
  renderSyncBox();
}

let loginEmail = '';
async function renderSyncBox() {
  const box = $('#syncBox');
  if (!box) return;
  const cfg = getConfig();
  const user = cfg ? await currentUser().catch(() => null) : null;
  if (!cfg) {
    box.innerHTML = `<h3>Synchroniseren</h3>
      <p class="sub">Koppel je eigen (gratis) Supabase-project om pc en gsm gelijk te houden. De stappen staan in de handleiding (SETUP.md).</p>
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
    box.innerHTML = `<h3>Synchroniseren</h3>
      <p class="sub">Log in met je e-mailadres. Je krijgt een mail met een link en een code. Gebruik op elk toestel hetzelfde adres.</p>
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
  box.innerHTML = `<h3>Synchroniseren</h3>
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
  const data = { app: 'kastwijzer', version: 1, exportedAt: new Date().toISOString(), items: state.items, outfits: state.outfits, overrides: [...state.overrides].map(([key, value]) => ({ key, value })) };
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
    await load();
    closeSheet();
    toast('Back-up teruggezet');
  } catch (err) { alert(err.message); }
}

// ---------- acties ----------
const actions = {
  add: openAdd,
  surprise,
  showall: () => { state.showAll = !state.showAll; render(); },
  'reset-outfit': () => { state.outfit = { onder: null, boven: null, laag: null }; state.showAll = false; render(); },
  'save-outfit': saveOutfit,
  'start-outfit': (el) => {
    state.outfit = { onder: null, boven: null, laag: null };
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
  'forget-config'() { forgetConfig(); loginEmail = ''; renderSyncBox(); },
  async 'remove-tests'() {
    if (!confirm('Alle testartikels verwijderen?')) return;
    for (const it of state.items.filter((i) => i.test)) await db.del('items', it.id);
    await load(); closeSheet(); toast('Testartikels verwijderd');
  },
  async wipe() {
    if (!confirm('Echt alles wissen? Dit kan niet ongedaan gemaakt worden.')) return;
    await Promise.all(['items', 'outfits', 'overrides'].map((s) => db.clear(s)));
    state.outfit = { onder: null, boven: null, laag: null };
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
    state.outfit = { onder: null, boven: null, laag: null };
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
  if (e.target.matches('[data-addphoto]')) { addPhotos(e.target.dataset.addphoto, e.target.files); return; }
  if (e.target.matches('[data-season]')) { state.season = e.target.value; render(); }
  if (e.target.matches('[data-look]')) { state.look = e.target.value; render(); }
});
$('#menuBtn').addEventListener('click', openMenu);
$('#syncBtn').addEventListener('click', openMenu);
const SYNC_ICON = { uit: '', uitgelogd: '☁︎', bezig: '↻', ok: '☁︎', fout: '⚠︎', offline: '☁︎' };
const SYNC_TITLE = { uitgelogd: 'Niet ingelogd: niet gesynchroniseerd', bezig: 'Bezig met synchroniseren…', ok: 'Gesynchroniseerd', fout: 'Synchronisatie mislukt', offline: 'Offline: synchroniseert later' };
onSyncStatus(({ status, message }) => {
  const b = $('#syncBtn');
  b.hidden = status === 'uit';
  b.textContent = SYNC_ICON[status] || '☁︎';
  b.title = (SYNC_TITLE[status] || '') + (message ? `: ${message}` : '');
  b.dataset.status = status;
});

function render() {
  const v = $('#view');
  v.innerHTML = state.view === 'kast' ? renderCloset() : state.view === 'outfit' ? renderOutfit() : renderSaved();
  $('#fab').hidden = state.view !== 'kast';
}

load().then(() => { render(); initSync(refreshFromSync); }).catch((e) => {
  $('#view').innerHTML = `<div class="empty"><p>De app kon niet starten: ${esc(e.message)}</p></div>`;
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
