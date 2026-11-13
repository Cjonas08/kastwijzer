# Kastwijzer instellen: synchronisatie en online zetten

Twee delen: **Supabase** (gratis database, zodat pc en gsm dezelfde kleerkast tonen) en **GitHub Pages** (gratis hosting, zodat je de app op Android kunt installeren). Reken op 15 minuten.

---

## Deel 1: Supabase

### 1. Project aanmaken
1. Ga naar https://supabase.com en maak een gratis account aan.
2. Kies **New project**. Naam: `kastwijzer`. Regio: **Central EU (Frankfurt)**. Kies een databasewachtwoord en bewaar het goed (de app heeft het niet nodig).
3. Wacht tot het project klaar is (±2 minuten).

### 2. Database en foto-opslag aanmaken
1. Open links **SQL Editor** → **New query**.
2. Plak de volledige inhoud van [`supabase/setup.sql`](supabase/setup.sql) en klik **Run**. Je zou "Success. No rows returned" moeten zien.

### 3. Inloggen per mail instellen
1. **Authentication → URL Configuration**
   - **Site URL**: het adres van je app, bv. `https://<jouw-github-naam>.github.io/kastwijzer/`
   - **Redirect URLs**: voeg datzelfde adres toe, plus `http://localhost:8765/` om lokaal te testen.
2. **Authentication → Emails → Magic Link**: zet deze regel in de tekst, zodat de mail ook een code bevat (handig in de geïnstalleerde app op je gsm):
   ```
   <p>Of typ deze code in de app: <strong>{{ .Token }}</strong></p>
   ```
3. Tip: de ingebouwde mailservice van Supabase verstuurt maar een paar mails per uur. Voor één gebruiker volstaat dat ruim.

### 4. Functie voor webshoplinks (optioneel, aanbevolen)
Zonder deze functie haalt de app webshoppagina's op via een publieke tussendienst (allorigins.win).
1. Open **Edge Functions → Deploy a new function → Via Editor**.
2. Naam: `fetch-page` (precies zo).
3. Vervang de voorbeeldcode door de inhoud van [`supabase/functions/fetch-page/index.ts`](supabase/functions/fetch-page/index.ts) en klik **Deploy**.

### 5. Sleutels in de app zetten
1. Open **Project Settings → API** (of **Data API / API Keys**).
2. Noteer de **Project URL** en de publieke sleutel (**anon** of **publishable**). Gebruik nooit de *service_role*- of *secret*-sleutel.
3. Ofwel vul je ze in de app in via **⚙︎ Instellingen → Synchroniseren** (op elk toestel één keer), ofwel zet je ze in [`js/config.js`](js/config.js), dan gelden ze meteen overal.
4. Log in met je e-mailadres, op pc én gsm met **hetzelfde** adres. Klaar: wijzigingen komen binnen enkele seconden op het andere toestel.

### 6. Passen op je eigen foto (optioneel, betalend)
Met de knop **📸 Pas op mijn foto** tekent een AI-model je outfit fotorealistisch op je eigen foto. Dat loopt via [fal.ai](https://fal.ai) en kost ongeveer € 0,04 per beeld (model `fal-ai/nano-banana/edit`, $ 0,0398 per beeld bij het schrijven van deze handleiding). Je betaalt enkel wat je gebruikt.
1. Maak een account op [fal.ai](https://fal.ai), zet er een klein tegoed op (bv. $ 5) en maak onder **API Keys** een sleutel aan.
2. In Supabase: **Edge Functions → Secrets** → voeg een secret toe met naam `FAL_KEY` en als waarde je fal-sleutel. Zet die sleutel nooit in de app of in GitHub.
3. **Edge Functions → Deploy a new function → Via Editor**, naam: `try-on` (precies zo). Vervang de voorbeeldcode door de inhoud van [`supabase/functions/try-on/index.ts`](supabase/functions/try-on/index.ts) en klik **Deploy**.
4. In de app: **⚙︎ Instellingen → Mijn pasfoto** → kies een foto waarop je rechtop en volledig in beeld staat. Stel een outfit samen en tik op **📸 Pas op mijn foto**.

Goed om te weten:
- Je moet ingelogd zijn (stap 5). Zo kan niemand anders op jouw kosten beelden maken.
- Je pasfoto blijft op het toestel waar je ze koos. Bij het passen gaan ze samen met de kledingfoto's naar fal.ai.
- Een gepast beeld wordt op je toestel bewaard, dus dezelfde outfit opnieuw bekijken kost niets. Enkel **Opnieuw passen** kost opnieuw.
- Het beeld is door AI gemaakt: pasvorm en details kunnen afwijken van het echte stuk.
- Een ander model proberen kan met een extra secret `FAL_MODEL` (een fal-model dat `prompt` en `image_urls` aanvaardt).

### 7. Gratis alternatief: zelf passen in Gemini
Dit werkt zonder Supabase en zonder fal.ai. Je hebt enkel een Google-account met Gemini nodig; het aantal gratis beelden per dag bepaalt Google.
1. Kies je pasfoto via **⚙︎ Instellingen → Mijn pasfoto**.
2. Stel een outfit samen en tik op **✨ Zelf passen in Gemini**.
3. Op je gsm: **Delen naar Gemini**. Op pc: **Foto's downloaden** en ze in volgorde in [gemini.google.com](https://gemini.google.com) slepen.
4. Plak de opdracht erbij (**Opdracht kopiëren**) en verstuur.
5. Bewaar het beeld van Gemini en zet het terug in de app met **Resultaat toevoegen**. Het hangt dan aan die outfit.

---

## Deel 2: Online zetten met GitHub Pages
1. Maak een publieke repository `kastwijzer` en zet de inhoud van deze map erin.
2. Repository → **Settings → Pages** → Source: **Deploy from a branch**, branch `main`, map `/ (root)`.
3. Na ±1 minuut staat de app op `https://<jouw-github-naam>.github.io/kastwijzer/`.

De code is dan publiek, maar je kleerkast niet: die staat op je toestel en in je eigen, afgeschermde Supabase-project.

## Deel 3: Installeren
- **Android**: open het adres in Chrome → menu ⋮ → **App installeren** (of "Toevoegen aan startscherm").
- **Pc**: open het adres in Chrome of Edge → klik op het installatie-icoon rechts in de adresbalk.
