// Supabase Edge Function "try-on": toont een outfit fotorealistisch op jouw eigen foto.
// Stuurt jouw pasfoto en de kledingfoto's naar een AI-beeldmodel bij fal.ai en geeft het resultaat terug.
// De fal-sleutel staat als secret FAL_KEY in Supabase en komt nooit in de app.
// Enkel ingelogde gebruikers van jouw project kunnen ze gebruiken. Elke oproep kost geld bij fal.ai.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODEL = Deno.env.get('FAL_MODEL') || 'fal-ai/nano-banana/edit';
const MAX_IMAGE_CHARS = 3_000_000; // ± 2 MB per foto
// Wie mag passen? Secret ALLOWED_EMAILS = jouw adres(sen), gescheiden door komma's. Leeg = elke ingelogde gebruiker.
const ALLOWED = (Deno.env.get('ALLOWED_EMAILS') || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
// Maximum aantal beelden per dag per gebruiker (secret DAILY_LIMIT, standaard 20).
const DAILY_LIMIT = Number(Deno.env.get('DAILY_LIMIT') || 20);
const isImage = (s: unknown) => typeof s === 'string' && s.startsWith('data:image/') && s.length < MAX_IMAGE_CHARS;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const fail = (status: number, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'content-type': 'application/json' } });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, 'Niet ingelogd');
  if (ALLOWED.length && !ALLOWED.includes((user.email || '').toLowerCase())) return fail(403, 'Dit account mag de pasbeurt niet gebruiken.');

  // Daglimiet: teller in de tabel tryon_usage, enkel bereikbaar met de service role.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const day = new Date().toISOString().slice(0, 10);
  const usage = await admin.from('tryon_usage').select('count').eq('user_id', user.id).eq('day', day).maybeSingle();
  if (usage.error) return fail(503, 'De tabel tryon_usage ontbreekt: voer supabase/setup.sql opnieuw uit (zie SETUP.md).');
  const used = usage.data?.count || 0;
  if (used >= DAILY_LIMIT) return fail(429, `Daglimiet bereikt (${DAILY_LIMIT} beelden). Morgen kan je weer passen.`);

  const key = Deno.env.get('FAL_KEY');
  if (!key) return fail(503, 'De secret FAL_KEY ontbreekt in Supabase (zie SETUP.md).');

  let person: string, garments: { image: string; label: string }[];
  try {
    ({ person, garments } = await req.json());
  } catch {
    return fail(400, 'Ongeldige aanvraag');
  }
  if (!isImage(person) || !Array.isArray(garments) || !garments.length || garments.length > 6 || !garments.every((g) => isImage(g?.image))) {
    return fail(400, 'Ongeldige of te grote foto');
  }

  const list = garments
    .map((g, i) => `Image ${i + 2}: ${String(g.label || 'a clothing item').replace(/[^\p{L}\p{N} ,()'-]/gu, '').slice(0, 120)}.`)
    .join(' ');
  const prompt =
    `Image 1 is a photo of a person. The other images are product photos of clothing items. ${list} ` +
    'Create a photorealistic photo of the same person from image 1 wearing exactly these clothing items, each with its real colour, pattern, fabric and cut. ' +
    'Replace only the clothes those items cover. Keep the face, hair, skin, body shape, pose, shoes, accessories, background and lighting from image 1 unchanged. ' +
    'The clothes fit naturally with realistic folds and shadows. Output one image with the same framing as image 1.';

  const res = await fetch(`https://fal.run/${MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, image_urls: [person, ...garments.map((g) => g.image)], num_images: 1, output_format: 'jpeg' }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return fail(502, res.status === 401 || res.status === 403 ? 'fal.ai weigert de sleutel (FAL_KEY) of het tegoed is op.' : `fal.ai antwoordde met ${res.status}: ${detail}`);
  }
  await admin.from('tryon_usage').upsert({ user_id: user.id, day, count: used + 1 });
  const out = await res.json();
  const url = out?.images?.[0]?.url;
  if (!url) return fail(502, 'Het model gaf geen beeld terug. Probeer opnieuw of met een andere pasfoto.');

  const img = await fetch(url);
  if (!img.ok) return fail(502, 'Het beeld kon niet opgehaald worden');
  return new Response(await img.arrayBuffer(), { headers: { ...cors, 'content-type': img.headers.get('content-type') || 'image/jpeg' } });
});
