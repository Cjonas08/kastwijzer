// Supabase Edge Function "fetch-page": haalt een webshoppagina of productfoto op namens de app.
// Browsers mogen andere websites niet rechtstreeks uitlezen (CORS); deze functie doet het voor jou.
// Enkel ingelogde gebruikers van jouw project kunnen ze gebruiken.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BYTES = 8 * 1024 * 1024;

function blockedHost(host: string) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith('.internal');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const fail = (status: number, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'content-type': 'application/json' } });

  // Enkel ingelogde gebruikers (de publieke sleutel alleen volstaat niet).
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, 'Niet ingelogd');
  const allowed = (Deno.env.get('ALLOWED_EMAILS') || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes((user.email || '').toLowerCase())) return fail(403, 'Dit account mag deze functie niet gebruiken.');

  let url: URL;
  try {
    url = new URL((await req.json()).url);
  } catch {
    return fail(400, 'Ongeldige link');
  }
  if (!/^https?:$/.test(url.protocol) || blockedHost(url.hostname)) return fail(400, 'Deze link is niet toegestaan');

  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'accept-language': 'nl-BE,nl;q=0.9,en;q=0.8',
      accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) return fail(502, `Webshop antwoordde met ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return fail(413, 'Bestand te groot');
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_BYTES) return fail(413, 'Bestand te groot');

  const type = res.headers.get('content-type') || 'application/octet-stream';
  // Tekst als text/plain teruggeven zodat de app het als tekst leest.
  const outType = type.startsWith('image/') ? type : 'text/plain; charset=utf-8';
  return new Response(body, { headers: { ...cors, 'content-type': outType } });
});
