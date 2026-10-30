# House Tracker

A small local web app for Nate and partner to browse houses they’re considering. House data is written into this repo as JSON by a separate House Tracker bot; this app reads those files, shows House Details, a map, rankings, and a graveyard, and can ask the bot to look up a new listing.

No database. After install, one command starts it.

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
| `NOMINATIM_USER_AGENT` | Override the Nominatim User-Agent (a default identifying this app is already set). |
| `GEOCODE_CACHE_PATH` | Override the geocode cache file (default `data/geocode-cache.json`). |
| `GEOCODE_PREFETCH` | Set `false` to skip background geocoding of every loaded address. |

House Details works without webhook env vars. Adding a house or moving one back from No longer interested needs both webhook variables.

### Git pull (so new houses appear without a restart)

The bot commits JSON to GitHub. While the server is running it periodically runs `git pull` in the repo root, then House Details re-reads `data/houses/` on the next page load (it also refreshes every 30 seconds).

If pull fails, the server **logs the error and keeps running**.

The clone needs credentials that can pull (SSH key or HTTPS token). Use a branch that tracks the remote the bot pushes to (usually `main`). Uncommitted local edits to tracked files can make `git pull` fail.

## Data format

The bot owns `data/houses/`. Do not put demo data there. This app never writes house JSON files.

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

`data/rankings.json` is a committed JSON array of address slugs, in preference order:

```json
["9223-seagrove-dr-75243", "7130-abrams-rd-75231"]
```

The Rankings page POSTs that list to `/api/rankings`, and the local server writes the file. House JSON files are not modified — the House Tracker bot owns those.

If the file is missing, houses default to **alphabetical by address**. New houses not yet in the file are appended in that same order; slugs for houses that no longer exist are ignored.

Sold houses and No longer interested houses are hidden on the Rankings page. Clicking a house (the photo/address, not the drag handle or rank number) opens it on House Details at `/?house=<slug>`.

The order is shared through git. After you rearrange houses, **commit `data/rankings.json`** (or let a later bot sync commit it) so `git pull` on other machines picks it up. Local reorders that are not committed are overwritten on the next pull.

### Interest (`data/interest.json`)

The app owns this file. It never edits house JSON. Shape:

```json
{
  "notInterested": [{ "slug": "9223-seagrove-dr-75243", "since": "2026-10-30" }],
  "pendingReactivation": [{ "slug": "7130-abrams-rd-75231", "requested": "2026-10-30" }]
}
```

House Details has a **Not interested** action (with a confirm). That POSTs `/api/interest/not-interested` and the server appends the slug to `notInterested`. Those houses drop off Rankings, the Map (active pins), and House Details’ default dropdown — turn on **Include not interested** (or open `/?house=<slug>`) to view one.

Graveyard’s **No longer interested** section lists them (photo, address, last list price, since date, link to House Details). **Move back to interested** does **not** immediately restore the house. It:

1. Moves the slug from `notInterested` to `pendingReactivation`
2. Shows “Checking if still active…”
3. POSTs the House Tracker webhook (see below)

The bot re-checks Zillow and commits the result: if the listing is still active it **removes the slug from both lists** in `data/interest.json`; if not, it **keeps the house out** of the interested list. Commit `data/interest.json` (or let a bot sync commit it) so other machines pick it up.

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

`level` is `elementary`, `middle`, or `high`. `rating` is `0`–`10` or `null` (“Not rated”). The Map uses a square marker for schools and a round pin for houses. An Elementary / Middle / High toggle (remembered in `localStorage`) shows one level at a time. Each school gets one color; houses zoned to that school use the same color. Nearby schools (about 3 km) never share a color; far-apart schools may. Houses with no school at the selected level are grey. The legend lists only the schools for that level (color, name, rating).

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

## Pages

- **House Details** (`/`, deep link `/?house=<slug>`) — pick an address, see details, photo, and price history vs. the $700K budget line. The dropdown updates the URL; opening a deep link selects that house. **Not interested** moves it to the Graveyard list above.
- **Map** (`/map`) — Leaflet + OSM. Active house pins (not sold, not not-interested), school pins for the selected level, a school legend, and drawable geofences. Hover a house pin for photo, price, address, and that level’s school; click the pin or tooltip to open House Details.
- **Rankings** (`/rankings`) — drag houses into an order, or type a rank number (that house moves there and the rest shift). Saved to `data/rankings.json`. Sold and not-interested houses are excluded. Click a house (not the handle or rank input) to open House Details.
- **Graveyard** (`/graveyard`) — **Sold** (word match, so `Sold (10/1/2026)` counts) plus **No longer interested**. Sold cards show original list price, lowest list price, sale price (or Unknown), and days on market. Newest `soldDate` first; otherwise by address.
- **Add house** (`/add`) — submit a Zillow URL or street address to the bot webhook.
- **About** (`/about`) — what the project is, how the bot / GitHub JSON / web app fit together, and the plan to host on Cloudflare Pages with a public landing and a password-gated app.

Nav on every page: House Details, Map, Rankings, Graveyard, Add house, About.

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

`input` is the house’s `zillowUrl` when it looks like `http(s)://…`, otherwise the address. The bot should re-scrape Zillow and then update `data/interest.json`: remove the slug from both `notInterested` and `pendingReactivation` if the listing is still active; otherwise leave it out of the interested set.

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

Pushes to `main` (and manual **Run workflow**) join Tailscale, then hit a Coolify deploy webhook. Every push deploys — including House Tracker bot commits under `data/houses/`. The workflow is `.github/workflows/deploy.yml`. Concurrent runs queue (`concurrency` group `deploy`) so two deploys cannot overlap. `curl -fsS` fails the job if Coolify is unreachable or returns an HTTP error.

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

The process **writes** these files under `data/`, each via temp file then `rename`:

- `data/rankings.json` — Rankings page `POST /api/rankings` (`lib/rankings.js`). Override with `RANKINGS_PATH`.
- `data/interest.json` — not-interested / pending reactivation (`lib/interest.js`). Override with `INTEREST_PATH`.
- `data/geofences.json` — Map areas (`lib/geofences.js`). Override with `GEOFENCES_PATH`.
- `data/geocode-cache.json` — Nominatim cache (`lib/geocode.js`, gitignored). Override with `GEOCODE_CACHE_PATH`.

Do **not** bind-mount the whole `data/` directory over the checkout. That would hide `data/houses/` from bot-driven deploys. Because saves `rename` a sibling `.tmp` file, persist a **directory**, not a single-file bind (rename across filesystems fails).

In Coolify, mount a persistent volume at a writable directory (for example `/persist`) and set:

```
RANKINGS_PATH=/persist/rankings.json
INTEREST_PATH=/persist/interest.json
GEOFENCES_PATH=/persist/geofences.json
GEOCODE_CACHE_PATH=/persist/geocode-cache.json
```

Leave `data/houses/` in the image so each deploy picks up new listing JSON. Seed `/persist/rankings.json`, `/persist/interest.json`, and `/persist/geofences.json` once from the committed files if you want the current state on first boot; otherwise rankings start alphabetical and interest/geofences start empty until someone saves them in the app.
