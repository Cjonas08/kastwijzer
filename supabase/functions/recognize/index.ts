// Supabase Edge Function "recognize": laat Claude een kledingfoto bekijken en geeft terug
// welk stuk het is (categorie, kleur, motief, looks, seizoen) en waar het op de foto staat.
// De Claude-sleutel staat als secret ANTHROPIC_API_KEY in Supabase en komt nooit in de app.
// Enkel ingelogde (en toegelaten) gebruikers kunnen ze gebruiken. Elke oproep kost een fractie van een cent.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk/helpers/zod';
import { z } from 'npm:zod';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Goedkoop en snel model; zet de secret CLAUDE_MODEL op bv. claude-opus-5-5 voor het sterkste model.
const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-5-5';
const ALLOWED = (Deno.env.get('ALLOWED_EMAILS') || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const MAX_IMAGE_CHARS = 3_000_000;

const Garment = z.object({
  found: z.boolean().describe('false als er geen kledingstuk, schoen of accessoire op de foto staat'),
  name: z.string().describe('Korte Nederlandse naam, bv. "Lichtblauwe jeans" of "Witte sneakers"'),
  category: z.enum(['tshirt', 'polo', 'hemd', 'pull', 'broek', 'short', 'jas', 'schoenen', 'accessoire']),
  hex: z.string().describe('Hoofdkleur van het stuk als #rrggbb'),
  hex2: z.string().nullable().describe('Tweede kleur als #rrggbb bij een motief, anders null'),
  pattern: z.enum(['effen', 'streep', 'ruit', 'print', 'motief']),
  looks: z.array(z.enum(['sportief', 'casual', 'casualchique', 'business', 'chique', 'gekleed'])).describe('Alle looks waarin dit stuk past'),
  season: z.enum(['altijd', 'zomer', 'winter']),
  box: z.array(z.number()).describe('Kader rond het stuk als [x0, y0, x1, y1], elk tussen 0 en 1 t.o.v. breedte en hoogte van de foto'),
  others: z.number().describe('Aantal andere kledingstukken op de foto'),
});

const SYSTEM = `Je helpt iemand zijn kleerkast te inventariseren. Je krijgt één foto en soms een korte omschrijving van het stuk dat bedoeld is.
Staan er meerdere stukken op de foto, kies dan het stuk dat bij de omschrijving past; zonder omschrijving het stuk dat het meest in beeld is.
Beschrijf enkel dat ene stuk. Categorieën: tshirt, polo, hemd (overhemd met knopen), pull (trui, sweater, hoodie, cardigan), broek (lange broek, jeans, chino), short, jas (jas, blazer, bodywarmer), schoenen, accessoire (riem, sjaal, muts, pet, horloge, tas).
De kleur is die van de stof zelf, niet van de achtergrond of van schaduwen. Looks lopen van ontspannen naar formeel: sportief, casual, casualchique, business, chique, gekleed.
Het kader (box) omsluit het hele gekozen stuk, zo nauw mogelijk, zonder andere stukken.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
  const fail = (status: number, msg: string) => json(status, { error: msg });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, 'Niet ingelogd');
  if (ALLOWED.length && !ALLOWED.includes((user.email || '').toLowerCase())) return fail(403, 'Dit account mag de AI-herkenning niet gebruiken.');

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return fail(503, 'De secret ANTHROPIC_API_KEY ontbreekt in Supabase (zie SETUP.md).');

  let image: string, hint: string;
  try {
    ({ image, hint = '' } = await req.json());
  } catch {
    return fail(400, 'Ongeldige aanvraag');
  }
  const m = typeof image === 'string' && image.length < MAX_IMAGE_CHARS ? image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/) : null;
  if (!m) return fail(400, 'Ongeldige of te grote foto');

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: m[2] } },
          { type: 'text', text: hint ? `Omschrijving van het bedoelde stuk: ${String(hint).slice(0, 200)}` : 'Geen omschrijving: kies het stuk dat het meest in beeld is.' },
        ],
      }],
      output_config: { format: zodOutputFormat(Garment) },
    });
    if (response.stop_reason === 'refusal') return fail(422, 'Claude wilde deze foto niet beoordelen.');
    const out = response.parsed_output;
    if (!out) return fail(502, 'Claude gaf geen bruikbaar antwoord. Probeer opnieuw.');
    return json(200, out);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail(502, 'Claude weigert de sleutel (ANTHROPIC_API_KEY).');
    if (e instanceof Anthropic.RateLimitError) return fail(429, 'Te veel aanvragen bij Claude. Probeer zo meteen opnieuw.');
    if (e instanceof Anthropic.APIError) return fail(502, `Claude antwoordde met ${e.status}: ${String(e.message).slice(0, 200)}`);
    return fail(500, 'De herkenning is mislukt.');
  }
});
