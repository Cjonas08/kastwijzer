// Synchronisatie met Supabase: lokaal blijft de bron, Supabase houdt pc en gsm gelijk.
// Werkwijze: eerst ophalen (pull), dan doorsturen (push). Bij een conflict wint de laatste wijziging.
import { db, SYNCED } from './db.js';
import { SUPABASE } from './config.js';
import { setRemoteFetcher } from './analyze.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const LS_KEY = 'kastwijzer.supabase';
const BUCKET = 'photos';

let client = null;
let running = null;
let debounce = null;
const statusListeners = new Set();
export const syncState = { status: 'uit', message: '', lastSync: null, email: null };

function setStatus(status, message = '') {
  Object.assign(syncState, { status, message });
  statusListeners.forEach((f) => f(syncState));
}
export const onSyncStatus = (fn) => { statusListeners.add(fn); fn(syncState); };

// ---------- configuratie ----------
export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (c?.url && c?.key) return c;
  } catch { /* opslag niet beschikbaar */ }
  return SUPABASE.url && SUPABASE.key ? SUPABASE : null;
}
export function saveConfig(url, key) {
  localStorage.setItem(LS_KEY, JSON.stringify({ url: url.trim().replace(/\/$/, ''), key: key.trim() }));
  client = null;
}
export function forgetConfig() {
  localStorage.removeItem(LS_KEY);
  client = null;
}

// Enkel voor tests: een nagebootste Supabase-client gebruiken.
export const _useClientForTest = (c) => { client = c; };

async function getClient() {
  if (client) return client;
  const cfg = getConfig();
  if (!cfg) return null;
  const { createClient } = await import(SDK);
  client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kastwijzer-auth' },
  });
  return client;
}

export async function currentUser() {
  const c = await getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.user || null;
}

// ---------- inloggen (mail met link én 6-cijferige code) ----------
export async function sendLogin(email) {
  const c = await getClient();
  if (!c) throw new Error('Supabase is nog niet ingesteld');
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function verifyCode(email, token) {
  const c = await getClient();
  const { error } = await c.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
  if (error) throw error;
  await afterLogin();
}
export async function signOut() {
  const c = await getClient();
  if (c) await c.auth.signOut();
  syncState.email = null;
  setStatus('uitgelogd');
}

// ---------- foto's ----------
async function sha1(text) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
const dataUrlToBlob = (u) => fetch(u).then((r) => r.blob());
const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

// Lokaal item → wat er in Supabase komt (eigen foto's naar Storage, niet in de database).
// Eigen foto's (data-URL's) gaan naar Storage; in de database staat enkel "sb:<pad>".
// Het pad bevat een hash van de foto, zodat dezelfde foto nooit twee keer verstuurd wordt.
const hashFromPath = (path) => path.split('-').pop().replace(/\.jpg$/, '');

async function imageToRemote(src, id, c, uid, uploaded) {
  if (!String(src).startsWith('data:')) return { ref: src };
  const path = `${uid}/${id}-${await sha1(src)}.jpg`;
  if (!uploaded.includes(path)) {
    const { error } = await c.storage.from(BUCKET).upload(path, await dataUrlToBlob(src), { upsert: true, contentType: 'image/jpeg' });
    if (error) throw error;
  }
  return { ref: 'sb:' + path, path };
}

// Geeft { data, extra } terug: extra wordt na verzending lokaal bewaard (welke foto's al online staan).
async function toRemote(store, value, c, uid) {
  const { updatedAt, syncedAt, uploaded = [], imagePath, ...data } = value;
  if (store !== 'items') return { data };
  const refs = [], paths = [];
  for (const src of [value.image, ...(value.photos || [])]) {
    const r = await imageToRemote(src, value.id, c, uid, uploaded.concat(imagePath ? [imagePath] : []));
    refs.push(r.ref);
    if (r.path) paths.push(r.path);
  }
  return { data: { ...data, image: refs[0], photos: refs.slice(1) }, extra: { uploaded: paths } };
}

async function fromRemote(store, data, updatedAt, c) {
  const v = { ...data, updatedAt, syncedAt: updatedAt };
  if (store !== 'items') return v;
  const local = await db.get('items', data.id);
  const localImgs = local ? [local.image, ...(local.photos || [])].filter((x) => String(x).startsWith('data:')) : [];
  const localHashes = await Promise.all(localImgs.map(sha1));
  const resolve = async (ref) => {
    if (!String(ref).startsWith('sb:')) return ref;
    const path = ref.slice(3);
    const i = localHashes.indexOf(hashFromPath(path));
    if (i >= 0) return localImgs[i];
    const { data: blob, error } = await c.storage.from(BUCKET).download(path);
    if (error) throw error;
    return blobToDataUrl(blob);
  };
  const refs = [data.image, ...(data.photos || [])];
  const imgs = [];
  for (const r of refs) imgs.push(await resolve(r));
  v.image = imgs[0];
  v.photos = imgs.slice(1);
  v.uploaded = refs.filter((r) => String(r).startsWith('sb:')).map((r) => r.slice(3));
  delete v.imagePath;
  return v;
}

// ---------- synchroniseren ----------
export function syncNow() {
  if (!running) running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const c = await getClient();
  const user = c && (await currentUser());
  if (!user) { setStatus(c ? 'uitgelogd' : 'uit'); return { pulled: 0, pushed: 0 }; }
  if (!navigator.onLine) { setStatus('offline'); return { pulled: 0, pushed: 0 }; }
  setStatus('bezig');
  try {
    const meta = (await db.get('meta', 'sync')) || { key: 'sync', lastPull: '1970-01-01T00:00:00Z', userId: user.id };
    if (meta.userId !== user.id) Object.assign(meta, { lastPull: '1970-01-01T00:00:00Z', userId: user.id });

    // 1. Ophalen wat sinds de vorige keer veranderd is.
    let pulled = 0;
    for (;;) {
      const { data, error } = await c.from('records')
        .select('store,id,data,updated_at,deleted,server_updated')
        .gt('server_updated', meta.lastPull).order('server_updated').limit(500);
      if (error) throw error;
      for (const row of data) {
        if (!SYNCED.includes(row.store)) continue;
        const local = await db.get(row.store, row.id);
        const tomb = await db.get('tombstones', `${row.store}:${row.id}`);
        const localTs = local?.updatedAt || 0;
        if (row.deleted) {
          if (local && localTs <= row.updated_at) { await db.delRaw(row.store, [row.id]); pulled++; }
          if (tomb) await db.delRaw('tombstones', [tomb.key]);
        } else {
          if (tomb && tomb.deletedAt > row.updated_at) continue; // hier later verwijderd
          if (local && localTs >= row.updated_at) continue;    // hier nieuwer
          await db.putMany(row.store, [await fromRemote(row.store, row.data, row.updated_at, c)]);
          if (tomb) await db.delRaw('tombstones', [tomb.key]);
          pulled++;
        }
        meta.lastPull = row.server_updated;
      }
      if (data.length < 500) break;
    }

    // 2. Lokale wijzigingen doorsturen: alles wat na de laatste synchronisatie gewijzigd is.
    const rows = [];
    const patches = Object.fromEntries(SYNCED.map((st) => [st, []]));
    for (const store of SYNCED) {
      for (const v of await db.all(store)) {
        if ((v.updatedAt || 0) > (v.syncedAt || 0)) {
          const key = v[db.keyOf(store)];
          const { data, extra } = await toRemote(store, v, c, user.id);
          rows.push({ user_id: user.id, store, id: String(key), data, updated_at: v.updatedAt, deleted: false });
          patches[store].push({ key, updatedAt: v.updatedAt, extra });
        }
      }
    }
    const tombs = await db.all('tombstones');
    for (const t of tombs) rows.push({ user_id: user.id, store: t.store, id: String(t.id), data: null, updated_at: t.deletedAt, deleted: true });
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await c.from('records').upsert(rows.slice(i, i + 100), { onConflict: 'user_id,store,id' });
      if (error) throw error;
    }
    for (const store of SYNCED) if (patches[store].length) await db.markSynced(store, patches[store]);
    await db.delRaw('tombstones', tombs.map((t) => t.key));

    await db.putMany('meta', [meta]);
    syncState.lastSync = new Date();
    setStatus('ok');
    return { pulled, pushed: rows.length };
  } catch (e) {
    console.error('Synchronisatie mislukt', e);
    setStatus('fout', e.message || String(e));
    return { pulled: 0, pushed: 0, error: e };
  }
}

// ---------- automatisch ----------
let onPulled = () => {};
async function afterLogin() {
  const user = await currentUser();
  syncState.email = user?.email || null;
  const r = await syncNow();
  if (r.pulled) onPulled();
}

// Webshoplinks ophalen via de eigen Supabase-functie i.p.v. een publieke proxy.
async function fetchViaFunction(url, as) {
  const c = await getClient();
  if (!c || !(await currentUser())) return null;
  const { data, error } = await c.functions.invoke('fetch-page', { body: { url } });
  if (error) throw error;
  if (as === 'text') return typeof data === 'string' ? data : await data.text();
  return data instanceof Blob ? data : new Blob([data]);
}

export async function initSync(refresh) {
  onPulled = refresh;
  const c = await getClient().catch((e) => { setStatus('fout', 'Supabase kon niet laden: ' + e.message); return null; });
  if (!c) { setStatus('uit'); return; }
  setRemoteFetcher(fetchViaFunction);
  c.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') afterLogin();
  });
  const user = await currentUser();
  if (user) await afterLogin(); else setStatus('uitgelogd');

  // Na elke wijziging (even wachten om ze te bundelen), bij terugkeren naar de app en elke 2 minuten.
  db.onChange(() => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => { const r = await syncNow(); if (r.pulled) onPulled(); }, 2500);
  });
  const later = async () => { const r = await syncNow(); if (r.pulled) onPulled(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') later(); });
  window.addEventListener('online', later);
  setInterval(later, 2 * 60 * 1000);
}
