// Kleine IndexedDB-wrapper. Alles staat eerst lokaal op het toestel; sync.js stuurt
// wijzigingen door naar Supabase als synchronisatie aan staat.
const DB_NAME = 'kastwijzer';
const VERSION = 2;
export const SYNCED = ['items', 'outfits', 'overrides'];
const KEY = { items: 'id', outfits: 'id', overrides: 'key' };
let dbPromise;
const listeners = new Set();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const d = req.result;
        if (e.oldVersion < 1) {
          d.createObjectStore('items', { keyPath: 'id' });
          d.createObjectStore('outfits', { keyPath: 'id' });
          d.createObjectStore('overrides', { keyPath: 'key' });
          d.createObjectStore('meta', { keyPath: 'key' });
        }
        // Verwijderde records onthouden, zodat het andere toestel ze ook kan wissen.
        if (e.oldVersion < 2) d.createObjectStore('tombstones', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const changed = (store) => { if (SYNCED.includes(store)) listeners.forEach((f) => f(store)); };

export const db = {
  keyOf: (store) => KEY[store],
  onChange: (fn) => listeners.add(fn),
  all: (store) => run(store, 'readonly', (t) => t.objectStore(store).getAll()),
  get: (store, key) => run(store, 'readonly', (t) => t.objectStore(store).get(key)),

  // Gewone wijziging door de gebruiker: krijgt een tijdstempel voor de synchronisatie.
  async put(store, value) {
    if (SYNCED.includes(store)) value.updatedAt = Date.now();
    await run(store, 'readwrite', (t) => t.objectStore(store).put(value));
    changed(store);
  },
  async del(store, key) {
    const stores = SYNCED.includes(store) ? [store, 'tombstones'] : [store];
    await run(stores, 'readwrite', (t) => {
      t.objectStore(store).delete(key);
      if (stores.length > 1) t.objectStore('tombstones').put({ key: `${store}:${key}`, store, id: key, deletedAt: Date.now() });
    });
    changed(store);
  },
  async clear(store) {
    const all = SYNCED.includes(store) ? await db.all(store) : [];
    await run(SYNCED.includes(store) ? [store, 'tombstones'] : [store], 'readwrite', (t) => {
      t.objectStore(store).clear();
      all.forEach((v) => t.objectStore('tombstones').put({ key: `${store}:${v[KEY[store]]}`, store, id: v[KEY[store]], deletedAt: Date.now() }));
    });
    changed(store);
  },
  // Ruw wegschrijven zonder tijdstempel (testdata, back-up, binnenkomende synchronisatie).
  putMany: (store, values) => run(store, 'readwrite', (t) => { values.forEach((v) => t.objectStore(store).put(v)); }),
  // Na een geslaagde verzending: markeren als gesynchroniseerd, tenzij er intussen opnieuw gewijzigd werd.
  markSynced: (store, patches) => run(store, 'readwrite', (t) => {
    const s = t.objectStore(store);
    patches.forEach(({ key, updatedAt, extra }) => {
      const req = s.get(key);
      req.onsuccess = () => {
        const cur = req.result;
        if (cur && cur.updatedAt === updatedAt) s.put({ ...cur, ...extra, syncedAt: updatedAt });
      };
    });
  }),
  delRaw: (store, keys) => run(store, 'readwrite', (t) => { keys.forEach((k) => t.objectStore(store).delete(k)); }),
};
