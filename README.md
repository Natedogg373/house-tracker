# House Tracker

A small local web app for Nate and partner to browse houses they’re considering. **SQLite is the single source of truth** for listings, price history, interest, and rankings (same DB file pattern as the House Survey). A separate House Tracker bot writes through an authenticated HTTP API; the site reflects changes immediately — no redeploy. Committed `data/houses/*.json` files remain as the seed / backup import source.

The House Survey and Prerequisites features share the same SQLite file (Node’s built-in `node:sqlite`, so no native addon build). After install, one command starts it.

## Setup

```bash
git clone <this-repo>
cd house-tracker
npm install
cp .env.example .env
# edit .env — see below
npm start
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

Copy `.env.example` to `.env`. `.env` is gitignored; never commit secrets.

| Variable | Purpose |
| --- | --- |
| `PORT` | Web server port (default `3000`) |
| `HOUSE_TRACKER_WEBHOOK_URL` | Bot webhook. Add house POSTs `{ "input": "<link or address>" }`. Reactivate POSTs `{ "action": "reactivate", "slug": "<slug>", "input": "<link or address>" }`. |
| `HOUSE_TRACKER_WEBHOOK_AUTH` | Sent verbatim as the `Authorization` header (for example `Bearer …`). |
| `GIT_PULL_INTERVAL_MS` | How often to `git pull` (default `120000` = 2 minutes). |
| `GIT_PULL_ENABLED` | Set `false` to skip pulling. |
| `USE_SAMPLE_DATA` | Set `true` to force the fake demo houses (and sample schools) even if real files exist. |
| `HOUSES_DIR` | Optional override of the folder to read (default `data/houses`). |
| `RANKINGS_PATH` | Optional override of the ranking order file (default `data/rankings.json`). |
| `INTEREST_PATH` | Optional override of not-interested / pending reactivation (default `data/interest.json`). |
| `GEOFENCES_PATH` | Optional override of saved map areas (default `data/geofences.json`). |
| `SCHOOLS_PATH` | Optional override of school pins (default `data/schools.json`). Sample mode uses `data/sample/schools.json`. |
| `SURVEY_DB_PATH` | SQLite path for House Survey questions/answers and Prerequisites settings (default `data/survey.db`). On Coolify, set this to a persistent volume path such as `/persist/survey.db`. |
| `HOUSES_DB_PATH` | SQLite path for listings, price history, interest, and rankings. Defaults to `SURVEY_DB_PATH` (same file) when unset. |
| `HOUSE_DATA_API_TOKEN` | Bearer token for bot write endpoints under `/api/data/houses/…`. **Writes are rejected (503) when unset.** Export/reads stay public. |
| `NOMINATIM_USER_AGENT` | Override the Nominatim User-Agent (a default identifying this app is already set). |
| `GEOCODE_CACHE_PATH` | Override the geocode cache file (default `data/geocode-cache.json`). |
| `GEOCODE_PREFETCH` | Set `false` to skip background geocoding of every loaded address. |

House Details works without webhook env vars. Adding a house or moving one back from No longer interested needs both webhook variables. Bot **updates** to listing fields need `HOUSE_DATA_API_TOKEN`.

### Git pull (legacy JSON sync)

The app can still `git pull` on an interval (for schools JSON, geofences, seed files, etc.). Listing data itself now lives in SQLite and is updated via the House data API — a pull is **not** required for new/updated houses to appear.

If pull fails, the server **logs the error and keeps running**.

## Data format

**Authoritative store:** SQLite (`HOUSES_DB_PATH` / `SURVEY_DB_PATH`). On first startup with an empty `houses` table, the app imports `data/houses/*.json`, `data/interest.json`, and `data/rankings.json` once (idempotent). Re-run with `npm run houses:import` (add `-- --force` to replace). Keep the JSON seed files in git; do not treat them as live after the DB has been seeded.

One JSON file per house: `data/houses/<address-slug>.json`.

```json
{
  "address": "9223 Seagrove Dr, Dallas, TX 75243",
  "zillowUrl": "https://www.zillow.com/homedetails/...",
  "photoUrl": "https://photos.zillowstatic.com/...",
  "status": "For sale",
  "listPrice": 739000,
  "yearBuilt": 1972,
  "sqft": 2381,
  "pricePerSqft": 310,
  "beds": 4,
  "baths": 2.5,
  "lotAcres": 0.2,
  "lastUpdated": "2026-10-13",
  "lat": 32.91,
  "lng": -96.73,
  "schoolIds": ["example-elem", "example-high"],
  "salePrice": null,
  "soldDate": null,
  "priceHistory": [
    { "week": "2026-09-07", "price": 739000 },
    { "week": "2026-09-14", "price": null }
  ]
}
```

Weeks are Mondays (series starts `2026-01-05`). `price: null` means the house was not listed that week; the chart leaves a gap and does not connect across it.

`salePrice` and `soldDate` (ISO date) may appear when House Tracker can read a close from Zillow. They are often missing even after status becomes Sold — the Graveyard page then shows sale price as Unknown and estimates days on market from `priceHistory` (or `lastUpdated`).

`lat` and `lng` are optional. The Map page uses them when present; otherwise it falls back to the Nominatim geocode cache. `schoolIds` lists ids from `data/schools.json` so a house pin can take the color of its school at the selected level.

Any field may be missing or null. The UI shows placeholders, skips a broken photo, and computes age from year built. List price is highlighted over or under the **$700,000** budget.

When `photoUrl` is missing or the image fails to load, House Details embeds an OpenStreetMap view centered on the address (with a marker) and a **View on Zillow** button. Addresses are geocoded server-side with [Nominatim](https://nominatim.org/) — no API key. The app sends a descriptive `User-Agent`, makes **at most one Nominatim request per second**, and writes results to `data/geocode-cache.json` (gitignored) so each address is looked up only once. Delete that file to force a refresh. If geocoding fails, you still get a clean placeholder plus the Zillow button.

`data/houses/index.json` (a list of slugs) is **not** treated as a house. The server reads every other `*.json` in the folder (and also skips `schools.json` if it is dropped in that folder by mistake).

### Rankings

Preference order lives in the SQLite `house_rankings` table (seeded from `data/rankings.json` on first import). The Rankings page POSTs `/api/rankings`; the server writes the DB. Missing rankings default to **alphabetical by address**. New houses not yet ranked are appended; unknown slugs are ignored.

Sold houses and No longer interested houses are hidden on the Rankings page. Clicking a house (the photo/address, not the drag handle or rank number) opens it on House Details at `/?house=<slug>`.

### Interest

Not-interested / pending reactivation live in the SQLite `house_interest` table (seeded from `data/interest.json`). Shape of the export / seed file:

```json
{
  "notInterested": [{ "slug": "9223-seagrove-dr-75243", "since": "2026-10-30" }],
  "pendingReactivation": [{ "slug": "7130-abrams-rd-75231", "requested": "2026-10-30" }]
}
```

House Details has a **Not interested** action (with a confirm). That POSTs `/api/interest/not-interested`. Those houses drop off Rankings, the Map (active pins), and House Details’ default dropdown — turn on **Include not interested** (or open `/?house=<slug>`) to view one.

Graveyard’s **No longer interested** section lists them. **Move back to interested** does **not** immediately restore the house. It:

1. Moves the slug from `notInterested` to `pendingReactivation`
2. Shows “Checking if still active…”
3. POSTs the House Tracker webhook (see below)

The bot re-checks Zillow and then updates interest via `PATCH /api/data/houses/:slug/status` with `{ "interest": "active" }` (or leaves it not-interested).

### Schools (`data/schools.json`)

The bot will commit this file. Missing or unreadable is fine — the Map still loads house pins.

```json
[
  {
    "id": "example-elem",
    "name": "Example Elementary",
    "level": "elementary",
    "lat": 32.91,
    "lng": -96.73,
    "rating": 8,
    "district": "Example ISD"
  }
]
```

`level` is `elementary`, `middle`, or `high`. `rating` is `0`–`10` or `null` (“Not rated”). The Map uses a square marker for schools and a round pin for houses. An Elementary / Middle / High toggle (remembered in `localStorage`) shows one level at a time. Pin and legend colors follow school rating: **7–10 green**, **4–6 yellow**, **1–3 red**, unrated grey. Houses use their school’s color at the selected level (grey if none). Click a school in the legend to show only houses zoned to it; click again or **Show all houses** to clear. Switching level clears the filter.

### Geofences (`data/geofences.json`)

The app owns this file. `GET`/`POST /api/geofences` reads and writes an array of:

```json
[
  {
    "id": "lake-highlands",
    "name": "Lake Highlands",
    "type": "rect",
    "geometry": { "south": 32.85, "west": -96.78, "north": 32.92, "east": -96.70 }
  }
]
```

`type` is `rect`, `circle` (`geometry`: `lat`, `lng`, `radiusMeters`), or `polygon` (`geometry.latlngs`: `[lat, lng]` rings). The Map page can draw all three, then rename or delete them. Houses whose coordinates fall inside any saved area are flagged **In area** (tooltip badge, a count on the map side panel, and an **Inside: \<area name\>** badge on House Details). Containment is computed on the server.

Commit `data/geofences.json` so the areas are shared.

### Sample data

`data/sample/` has five clearly fake houses (Demo / Sample / Placeholder / Sold / Closed addresses) plus `data/sample/schools.json` with fake school pins and coordinates. They are used only when `data/houses/` has no house files, or when `USE_SAMPLE_DATA=true`. Do not copy that sample into `data/houses/` or `data/schools.json`.

### Prerequisites

Hard filters that mirror Zillow search criteria, stored in the same SQLite file as the survey (`SURVEY_DB_PATH`). The **Prerequisites** tab (`/prerequisites`) covers Price (max), Square footage, Beds, Baths, Garage (`garageSpaces`), Lot size (`lotAcres`), Year built, HOA (`hoaMonthly` max; 0 = no HOA), Stories (max), Pool (require / exclude / don't care), Property tax (`propertyTaxAnnual` max), and minimum school ratings for elementary / middle / high (from the house’s `schoolIds` + `data/schools.json`). Each row has an enable toggle (all disabled by default) and a threshold; one global tolerance % (default 10) paints House Details metrics green / yellow / red (plus a ✓ / ~ / ✗ cue). School ratings use a fixed ±1 point yellow band instead of the percent tolerance. Missing fields stay neutral grey. `daysOnMarket` is shown on House Details when present but has no criterion. API: `GET/PUT /api/prerequisites`.

### House Survey

Standardized visit checklist stored in SQLite (`SURVEY_DB_PATH`, default `data/survey.db`; gitignored). The Survey nav tab (`/survey`) defaults to **Fill / View**: searchable address picker (active houses, matching House Details) and the collapsible fill UI (short title crossfades to full question; answer + notes; rating radio pills). Toggle **Edit survey** to organize questions into **sections**, tap **+** / **Add section**, then edit short title, full question text, answer type, and type-specific options (rating max, number unit, multiple-choice choices). Types: yes/no, number, rating 1..n, date, short text, multiple choice. Reorder sections and questions with ↑/↓; delete soft-archives a question so old answers remain viewable. Unassigned questions sit under **Other**.

Mode and selected house stay in the URL (`/survey?house=<slug>`, `/survey?mode=edit`). Legacy `/survey/fill?house=<slug>` redirects to the Survey tab. Reach fill from **Fill survey** on House Details or from each Rankings row. Answers and notes also show on House Details (archived questions are labeled).

On first startup with an empty survey DB (zero question rows, including soft-deleted), the app loads `data/survey-seed.json` once. After any question exists it never re-seeds. You can also bulk-load JSON with `POST /api/survey/import` or `npm run survey:import -- file.json` (reuses sections by title; skips questions whose text already exists in the same section).

JSON API: `GET/POST /api/survey/questions`, `PUT /api/survey/questions/:id`, `DELETE /api/survey/questions/:id` (archive), `PUT /api/survey/questions/reorder`, `GET/POST /api/survey/sections`, `PUT /api/survey/sections/:id`, `DELETE /api/survey/sections/:id`, `PUT /api/survey/sections/reorder`, `POST /api/survey/import`, `GET/PUT /api/survey/answers/:slug`, `GET /api/survey/status`. Changing a question’s type asks for confirmation and bumps a version; prior answers keep a type/text snapshot so they still render. This app never writes `data/houses/*.json`.

## Pages

- **House Details** (`/`, deep link `/?house=<slug>`) — pick an address, see details, photo, and price history vs. the $700K budget line. The dropdown updates the URL; opening a deep link selects that house. **Not interested** moves it to the Graveyard list above. **Fill survey** and the survey answers section sit on this page.
- **Map** (`/map`) — Leaflet + OSM. Active house pins (not sold, not not-interested), school pins for the selected level, a school legend, and drawable geofences. Hover a house pin for photo, price, address, and that level’s school; click the pin or tooltip to open House Details.
- **Rankings** (`/rankings`) — drag the grip (pointer-friendly), use up/down arrows, or type a rank number and press Enter. Saved to SQLite. Sold and not-interested houses are excluded. Click a house (not the handle, arrows, or rank input) to open House Details. Each row links to fill that house’s survey.
- **Survey** (`/survey`) — fill/view per house by default; toggle Edit survey for the shared questionnaire. Deep link: `/survey?house=<slug>` (legacy `/survey/fill` redirects).
- **Prerequisites** (`/prerequisites`) — enable Zillow-style thresholds (price, sqft, beds, baths, garage, lot, year built) and a global tolerance %; colors matching House Details metric boxes.
- **Graveyard** (`/graveyard`) — **Sold** (word match, so `Sold (10/1/2026)` counts) plus **No longer interested**. Sold cards show original list price, lowest list price, sale price (or Unknown), and days on market. Newest `soldDate` first; otherwise by address.
- **Add house** (`/add`) — submit a Zillow URL or street address to the bot webhook.
- **About** (`/about`) — what the project is, how the bot / GitHub JSON / web app fit together, and the plan to host on Cloudflare Pages with a public landing and a password-gated app.

Nav on every page: House Details, Map, Rankings, Survey, Prerequisites, Graveyard, Add house, About.

## Webhook contract

Same URL and `Authorization` header for both actions (`HOUSE_TRACKER_WEBHOOK_URL` / `HOUSE_TRACKER_WEBHOOK_AUTH`).

**Add house** (unchanged) — `POST /api/houses` from this app:

```json
{ "input": "https://www.zillow.com/homedetails/… or a street address" }
```

**Reactivate** — after **Move back to interested** on the Graveyard, this app POSTs:

```json
{
  "action": "reactivate",
  "slug": "9223-seagrove-dr-75243",
  "input": "https://www.zillow.com/homedetails/… or the street address if there is no URL"
}
```

`input` is the house’s `zillowUrl` when it looks like `http(s)://…`, otherwise the address. The bot should re-scrape Zillow and then update interest via the House data API (`PATCH …/status` with `"interest": "active"` when the listing is still active).

## House data API

Authenticated write API for the House Tracker bot. Set `HOUSE_DATA_API_TOKEN` in Coolify / `.env`. All write routes require:

```http
Authorization: Bearer <HOUSE_DATA_API_TOKEN>
```

If the token env var is **unset**, every write returns **503**. Wrong/missing `Authorization` → **401**.

Base URL in production: `https://projectserver.tail6f8e33.ts.net`.

### Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `PUT` | `/api/data/houses/:slug` | Bearer | Upsert house (partial merge of fields + optional `priceHistory`) |
| `POST` | `/api/data/houses/:slug/price` | Bearer | Append / upsert one price point `{ "week", "price" }` |
| `PATCH` | `/api/data/houses/:slug/status` | Bearer | Update `status` / `soldDate` / `salePrice` / `listPrice` and/or `interest` |
| `DELETE` | `/api/data/houses/:slug` | Bearer | Soft-delete (hidden from site reads; still in export) |
| `GET` | `/api/data/houses/:slug` | public | Single house record |
| `GET` | `/api/data/export` | public | Full JSON dump (`houses`, `interest`, `rankings`) |
| `GET` | `/api/data/export?format=csv` | public | Flat sheet-shaped CSV rows for rebuilding Google Sheets |

Core filterable fields are typed columns; unknown / long-tail Zillow fields (fireplace, roof, appliances, …) land in a JSON `extras` column automatically — no migration needed for new keys.

### curl examples

```bash
TOKEN=…   # HOUSE_DATA_API_TOKEN
HOST=https://projectserver.tail6f8e33.ts.net

# Upsert / partial update (merge)
curl -fsS -X PUT "$HOST/api/data/houses/9223-seagrove-dr-75243" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "9223 Seagrove Dr, Dallas, TX 75243",
    "status": "For sale",
    "listPrice": 739000,
    "beds": 4,
    "baths": 2.5,
    "sqft": 2381,
    "zestimate": 745000,
    "schoolIds": ["example-elem"],
    "priceHistory": [
      { "week": "2026-09-07", "price": 739000 },
      { "week": "2026-09-14", "price": null }
    ]
  }'

# Append one weekly price point
curl -fsS -X POST "$HOST/api/data/houses/9223-seagrove-dr-75243/price" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "week": "2026-09-21", "price": 729000 }'

# Mark sold + clear not-interested, or set interest
curl -fsS -X PATCH "$HOST/api/data/houses/9223-seagrove-dr-75243/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "Sold (10/1/2026)", "soldDate": "2026-10-01", "salePrice": 720000, "interest": "active" }'

# Soft-delete
curl -fsS -X DELETE "$HOST/api/data/houses/9223-seagrove-dr-75243" \
  -H "Authorization: Bearer $TOKEN"

# Rebuild Google Sheet from the DB
curl -fsS "$HOST/api/data/export" -o houses.json
curl -fsS "$HOST/api/data/export?format=csv" -o houses.csv
```

`interest` on the status patch accepts `active`, `notInterested`, or `pendingReactivation` (optional `since` / `requested` ISO dates).

### Nightly backup

`.github/workflows/backup-houses.yml` fetches `/api/data/export` over Tailscale and commits snapshots under `data/backup/`. Those commits use `[skip ci]` and `data/backup/**` is in the deploy workflow’s `paths-ignore`, so they do **not** trigger a Coolify redeploy.

## Local webhook testing

```bash
npm run mock-webhook
```

In `.env`:

```
HOUSE_TRACKER_WEBHOOK_URL=http://127.0.0.1:8787/
HOUSE_TRACKER_WEBHOOK_AUTH=Bearer test-token
```

Restart `npm start`, submit a house on `/add` (or reactivate from the Graveyard), and watch the mock print the JSON body and `Authorization` header.

## Tests

```bash
npm test
```

## Auto-deploy

Pushes to `main` (and manual **Run workflow**) join Tailscale, then hit a Coolify deploy webhook. The workflow is `.github/workflows/deploy.yml`. Commits that only touch `data/backup/**` or include `[skip ci]` do **not** deploy. Concurrent runs queue (`concurrency` group `deploy`) so two deploys cannot overlap. `curl -fsS` fails the job if Coolify is unreachable or returns an HTTP error.

The GitHub Action uses `tailscale/github-action@v4`. That action mints an **ephemeral** tagged node for the job and logs it out when the run finishes.

### Repo secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID |
| `TS_OAUTH_SECRET` | Tailscale OAuth client secret |
| `COOLIFY_GH_TOKEN` | Coolify API token with **deploy** permission |

### Tailscale OAuth client and ACL

1. In the tailnet policy, own `tag:ci` so the OAuth client can mint tagged auth keys:

   ```json
   "tagOwners": {
     "tag:ci": ["autogroup:admin"]
   }
   ```

2. Allow that tag to reach Coolify on the tailnet (ACL or grant). Coolify is at `100.74.201.123:8000`:

   ```json
   "grants": [
     {
       "src": ["tag:ci"],
       "dst": ["100.74.201.123"],
       "ip": ["tcp:8000"]
     }
   ]
   ```

   Equivalent ACL: `{ "action": "accept", "src": ["tag:ci"], "dst": ["100.74.201.123:8000"] }`.

3. Create the OAuth client at [https://login.tailscale.com/admin/settings/oauth](https://login.tailscale.com/admin/settings/oauth). Give it **Keys → Auth Keys: write** (`auth_keys` write) and tag `tag:ci`. Put the client ID and secret in the two `TS_OAUTH_*` repo secrets.

### Coolify API token

On a self-hosted Coolify instance, turn on **API access** (Settings → Advanced) or the webhook returns 403/disabled.

Create an API token (**Keys & Tokens → API Tokens**) with the **deploy** permission (deploy-only is enough). Store it as `COOLIFY_GH_TOKEN`. The workflow `POST`s:

`http://100.74.201.123:8000/api/v1/deploy?uuid=li87awd6s5qjttyt2icjxqiw&force=false`

### Persistent volume (do not wipe user-written files)

The process **writes**:

- SQLite (`SURVEY_DB_PATH` / `HOUSES_DB_PATH`) — listings, price history, interest, rankings, survey, prerequisites (gitignored `data/survey.db` locally).
- `data/geofences.json` — Map areas (`lib/geofences.js`). Override with `GEOFENCES_PATH`.
- `data/geocode-cache.json` — Nominatim cache (`lib/geocode.js`, gitignored). Override with `GEOCODE_CACHE_PATH`.

Seed / backup only (not live after first import):

- `data/houses/*.json` — one-time import source for the houses table.
- `data/interest.json` / `data/rankings.json` — imported once with houses.
- `data/backup/` — nightly export snapshots from GitHub Actions.
- `data/survey-seed.json` — survey checklist imported once when the survey DB has no questions.

Do **not** bind-mount the whole `data/` directory over the checkout. That would hide seed JSON and schools. Because geofence JSON saves `rename` a sibling `.tmp` file, persist a **directory**, not a single-file bind (rename across filesystems fails).

**Persistent storage:** Point `SURVEY_DB_PATH` at a Coolify persistent volume (for example `/persist/survey.db`) so listings, visit notes, and prerequisite thresholds survive redeploys. Leave `HOUSES_DB_PATH` unset so houses share that same file. Railpack does not need a native SQLite addon — the app uses Node’s built-in `node:sqlite` (Node **≥ 22.5**).

In Coolify, mount a persistent volume at a writable directory (for example `/persist`) and set:

```
GEOFENCES_PATH=/persist/geofences.json
GEOCODE_CACHE_PATH=/persist/geocode-cache.json
SURVEY_DB_PATH=/persist/survey.db
HOUSE_DATA_API_TOKEN=<long random secret>
```

On first boot with an empty houses table, the app imports committed `data/houses/*.json` (+ interest/rankings). After that the DB is authoritative; the bot should write via the House data API and rebuild the Google Sheet from `/api/data/export`.
