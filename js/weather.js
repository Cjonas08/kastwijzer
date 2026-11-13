// Weer van vandaag via Open-Meteo (gratis, zonder account). Enkel de gekozen gemeente
// (naam en coördinaten) gaat naar die dienst, en pas nadat je er zelf een instelt.
const PLACE_KEY = 'kastwijzer.plaats';
const CACHE_KEY = 'kastwijzer.weer';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* opslag vol of geblokkeerd */ } };

export const getPlace = () => read(PLACE_KEY);
export function forgetPlace() {
  try { localStorage.removeItem(PLACE_KEY); localStorage.removeItem(CACHE_KEY); } catch { /* niets te wissen */ }
}

export async function setPlace(name) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=nl`);
  if (!res.ok) throw new Error('De weerdienst is niet bereikbaar');
  const hit = (await res.json()).results?.[0];
  if (!hit) throw new Error(`"${name}" niet gevonden`);
  const place = { name: hit.name, lat: +hit.latitude.toFixed(2), lon: +hit.longitude.toFixed(2) };
  write(PLACE_KEY, place);
  try { localStorage.removeItem(CACHE_KEY); } catch { /* geen cache */ }
  return place;
}

// Geeft { place, tmax, tmin, rain } voor vandaag, of null als er geen gemeente ingesteld is.
export async function todayWeather() {
  const place = getPlace();
  if (!place) return null;
  const today = new Date().toISOString().slice(0, 10);
  const hit = read(CACHE_KEY);
  if (hit && hit.day === today && hit.place === place.name) return hit.data;
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1');
  if (!res.ok) throw new Error('De weerdienst is niet bereikbaar');
  const d = (await res.json()).daily;
  const data = { place: place.name, tmax: Math.round(d.temperature_2m_max[0]), tmin: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max[0] ?? 0 };
  write(CACHE_KEY, { day: today, place: place.name, data });
  return data;
}
