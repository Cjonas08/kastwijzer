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

---

## Deel 2: Online zetten met GitHub Pages
1. Maak een publieke repository `kastwijzer` en zet de inhoud van deze map erin.
2. Repository → **Settings → Pages** → Source: **Deploy from a branch**, branch `main`, map `/ (root)`.
3. Na ±1 minuut staat de app op `https://<jouw-github-naam>.github.io/kastwijzer/`.

De code is dan publiek, maar je kleerkast niet: die staat op je toestel en in je eigen, afgeschermde Supabase-project.

## Deel 3: Installeren
- **Android**: open het adres in Chrome → menu ⋮ → **App installeren** (of "Toevoegen aan startscherm").
- **Pc**: open het adres in Chrome of Edge → klik op het installatie-icoon rechts in de adresbalk.
