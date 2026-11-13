# Kastwijzer

Webapp (PWA) om je kleerkast bij te houden en outfits samen te stellen. Werkt op pc en Android, ook offline.

## Lokaal starten

```bash
python -m http.server 8765
```

Open daarna http://localhost:8765.

## Structuur

- `js/model.js`: categorieën, kleurnamen, neutrale kleuren
- `js/analyze.js`: gratis analyse op het toestel (hoofdkleur, motief), tekstherkenning (categorie, stijl) en inlezen van een link
- `js/match.js`: score per combinatie (kleur, contrast, motief, stijl, seizoen) en jouw ✓/✗-aanpassingen
- `js/seed.js`: testartikels (foto's van Unsplash)
- `js/app.js`: interface
- `js/db.js`: opslag in IndexedDB (lokaal op het toestel), met bijhouden van wijzigingen
- `js/sync.js`: synchronisatie met Supabase (inloggen per mail, foto's in Storage)
- `js/config.js`: Supabase-adres en publieke sleutel (optioneel)
- `js/figure.js`, `js/crop.js`: paspop en uitsnijden van één stuk uit een foto
- `js/cutout.js`, `js/collage.js`: achtergrond wegknippen op het toestel en de outfit neerleggen als beeld
- `js/insights.js`: draaglogboek, weeradvies, paklijst, kastanalyse en koopcheck (rekenwerk)
- `js/weather.js`: weer van vandaag via Open-Meteo
- `supabase/`: SQL-script en de functies `fetch-page` (webshoplinks), `try-on` (betalende pasbeurt) en `recognize` (AI-herkenning met Claude)
- `tests/`: automatische tests, open `tests/` in de browser

Instellen van synchronisatie en hosting: zie [SETUP.md](SETUP.md).

## Ideeën voor later

- Betere inschatting via de Claude API
