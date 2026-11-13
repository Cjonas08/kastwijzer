# Kastwijzer instellen: synchronisatie en online zetten

Twee delen: **Supabase** (gratis database, zodat pc en gsm dezelfde kleerkast tonen) en **GitHub Pages** (gratis hosting, zodat je de app op Android kunt installeren). Reken op 15 minuten.

## In het kort: wat jij nog moet doen

De app zelf is klaar. Deze stappen kan alleen jij doen, omdat ze een account of een betaalsleutel vragen. Vink af in deze volgorde:

**A. Account en synchronisatie (gratis, ± 15 minuten)**
- [ ] Supabase-project aanmaken (stap 1)
- [ ] `supabase/setup.sql` uitvoeren (stap 2)
- [ ] Inloggen per mail instellen: Site URL `https://cjonas08.github.io/kastwijzer/` en de code in de mailtekst (stap 3)
- [ ] Project URL en publieke sleutel in [`js/config.js`](js/config.js) zetten (stap 5). Die twee zijn publiek en mogen in GitHub staan. Daarna hoef je op elk toestel alleen nog in te loggen met je e-mailadres.
- [ ] Inloggen op pc, gsm en andere toestellen met hetzelfde e-mailadres
- [ ] Afschermen: nieuwe aanmeldingen uit en secret `ALLOWED_EMAILS` (stap 8)

**B. Extra's (optioneel)**
- [ ] Functie `fetch-page` voor webshoplinks (stap 4, gratis)
- [ ] AI-herkenning met Claude: secret `ANTHROPIC_API_KEY` en functie `recognize` (stap 10, ± € 0,001 per foto)
- [ ] Betalende pasbeurt: secret `FAL_KEY` en functie `try-on` (stap 6, ± € 0,04 per beeld)

Alle secrets zet je op één plaats: **Supabase → Edge Functions → Secrets**. Zet nooit een geheime sleutel in de app of in GitHub.

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
3. Zet ze in [`js/config.js`](js/config.js) en zet die wijziging online (`git push`): dan gelden ze meteen op elk toestel. Alternatief: vul ze per toestel in via de knop **👤 Account** in de app.
4. Log in met je e-mailadres, op pc én gsm met **hetzelfde** adres. Klaar: wijzigingen komen binnen enkele seconden op het andere toestel.

### 6. Passen op je eigen foto (optioneel, betalend)
Met de knop **📸 Pas op mijn foto** tekent een AI-model je outfit fotorealistisch op je eigen foto. Dat loopt via [fal.ai](https://fal.ai) en kost ongeveer € 0,04 per beeld (model `fal-ai/nano-banana/edit`, $ 0,0398 per beeld bij het schrijven van deze handleiding). Je betaalt enkel wat je gebruikt.
1. Maak een account op [fal.ai](https://fal.ai), zet er een klein tegoed op (bv. $ 5) en maak onder **API Keys** een sleutel aan.
2. In Supabase: **Edge Functions → Secrets** → voeg een secret toe met naam `FAL_KEY` en als waarde je fal-sleutel. Zet die sleutel nooit in de app of in GitHub.
3. **Edge Functions → Deploy a new function → Via Editor**, naam: `try-on` (precies zo). Vervang de voorbeeldcode door de inhoud van [`supabase/functions/try-on/index.ts`](supabase/functions/try-on/index.ts) en klik **Deploy**.
4. In de app: **⚙︎ Instellingen → Mijn pasfoto** → kies een foto waarop je rechtop en volledig in beeld staat. Stel een outfit samen en tik op **📸 Pas op mijn foto**.

Goed om te weten:
- Je moet ingelogd zijn (stap 5). Zo kan niemand anders op jouw kosten beelden maken.
- Je pasfoto en de gepaste beelden zitten in de back-up en, als synchronisatie aan staat, in je eigen Supabase (privé-opslag). Bij het passen gaan de pasfoto en de kledingfoto's naar fal.ai.
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

### 8. Afschermen: alleen jij (doe dit zeker als je stap 6 gebruikt)
Standaard kan iedereen die je publieke sleutel kent een account aanmaken in je Supabase-project. Je gegevens blijven dan wel afgeschermd, maar zo iemand zou de betalende pasbeurt op jouw kosten kunnen gebruiken. Sluit dat af:
1. Log eerst zelf één keer in via de app (pc en gsm).
2. In Supabase: **Authentication → Sign In / Providers** → zet **Allow new users to sign up** uit.
3. **Edge Functions → Secrets** → voeg `ALLOWED_EMAILS` toe met je eigen e-mailadres (meerdere adressen scheid je met een komma). De functies `try-on` en `fetch-page` weigeren dan elk ander account.
4. Optioneel: secret `DAILY_LIMIT` (standaard 20) bepaalt hoeveel beelden je per dag kan laten maken.
5. Heb je `supabase/setup.sql` vóór deze versie uitgevoerd? Voer het dan opnieuw uit in de **SQL Editor**: het voegt de teller voor de daglimiet toe en laat de synchronisatie van je pasfoto, gepaste beelden en weekplanning toe. Opnieuw uitvoeren wist niets.

### 10. AI-herkenning met Claude (optioneel, betalend)
Met de knop **✨ Herken met AI** bij het toevoegen bekijkt Claude de foto en vult naam, categorie, kleur, motief, looks en seizoen in. Staan er meerdere stukken op de foto, typ dan eerst welk stuk je bedoelt (bv. "de lichtblauwe jeans"): Claude zoekt het en de app snijdt het uit. De knop verschijnt zodra je ingelogd bent.
1. Maak een account op [console.anthropic.com](https://console.anthropic.com), zet er een klein tegoed op (bv. $ 5) en maak onder **API Keys** een sleutel aan. Dit staat los van een Claude-abonnement.
2. In Supabase: **Edge Functions → Secrets** → voeg `ANTHROPIC_API_KEY` toe met die sleutel.
3. **Edge Functions → Deploy a new function → Via Editor**, naam: `recognize` (precies zo). Vervang de voorbeeldcode door de inhoud van [`supabase/functions/recognize/index.ts`](supabase/functions/recognize/index.ts) en klik **Deploy**.

Goed om te weten:
- Standaard gebruikt de functie het goedkoopste model, Claude Haiku 5.5 ($ 0,10 per miljoen tokens invoer, $ 0,50 uitvoer). Reken op ruwweg € 0,001 per foto. Met de secret `CLAUDE_MODEL` kies je een ander model, bv. `claude-opus-5-5` (nauwkeuriger, duurder).
- De foto gaat bij elke herkenning naar Anthropic. Zonder deze stap blijft de gratis analyse op je toestel gewoon werken.
- `ALLOWED_EMAILS` (stap 8) geldt ook voor deze functie.

### 9. Tests
Open `tests/` achter het adres van de app (bv. `https://<jouw-naam>.github.io/kastwijzer/tests/`). De pagina controleert het rekenwerk: matching, tekstherkenning, uitknippen, paklijst en kastanalyse.

---

## Deel 2: Online zetten met GitHub Pages
1. Maak een publieke repository `kastwijzer` en zet de inhoud van deze map erin.
2. Repository → **Settings → Pages** → Source: **Deploy from a branch**, branch `main`, map `/ (root)`.
3. Na ±1 minuut staat de app op `https://<jouw-github-naam>.github.io/kastwijzer/`.

De code is dan publiek, maar je kleerkast niet: die staat op je toestel en in je eigen, afgeschermde Supabase-project.

## Deel 3: Installeren
- **Android**: open het adres in Chrome → menu ⋮ → **App installeren** (of "Toevoegen aan startscherm").
- **Pc**: open het adres in Chrome of Edge → klik op het installatie-icoon rechts in de adresbalk.
