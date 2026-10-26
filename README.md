# House Tracker

A small local web app for Nate and partner to browse houses they’re considering. House data is written into this repo as JSON by a separate House Tracker bot; this app reads those files, shows a dashboard, and can ask the bot to look up a new listing.

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
| `HOUSE_TRACKER_WEBHOOK_URL` | Bot webhook. The add-house page POSTs `{ "input": "<link or address>" }` here. |
| `HOUSE_TRACKER_WEBHOOK_AUTH` | Sent verbatim as the `Authorization` header (for example `Bearer …`). |
| `GIT_PULL_INTERVAL_MS` | How often to `git pull` (default `120000` = 2 minutes). |
| `GIT_PULL_ENABLED` | Set `false` to skip pulling. |
| `USE_SAMPLE_DATA` | Set `true` to force the fake demo houses even if real files exist. |
| `HOUSES_DIR` | Optional override of the folder to read (default `data/houses`). |
| `RANKINGS_PATH` | Optional override of the ranking order file (default `data/rankings.json`). |
| `NOMINATIM_USER_AGENT` | Override the Nominatim User-Agent (a default identifying this app is already set). |
| `GEOCODE_CACHE_PATH` | Override the geocode cache file (default `data/geocode-cache.json`). |
| `GEOCODE_PREFETCH` | Set `false` to skip background geocoding of every loaded address. |

The dashboard works without webhook env vars. Adding a house needs both webhook variables.

### Git pull (so new houses appear without a restart)

The bot commits JSON to GitHub. While the server is running it periodically runs `git pull` in the repo root, then the dashboard re-reads `data/houses/` on the next page load (it also refreshes every 30 seconds).

If pull fails, the server **logs the error and keeps running**.

The clone needs credentials that can pull (SSH key or HTTPS token). Use a branch that tracks the remote the bot pushes to (usually `main`). Uncommitted local edits to tracked files can make `git pull` fail.

## Data format

The bot owns `data/houses/`. Do not put demo data there.

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

Any field may be missing or null. The UI shows placeholders, skips a broken photo, and computes age from year built. List price is highlighted over or under the **$700,000** budget.

When `photoUrl` is missing or the image fails to load, the dashboard embeds an OpenStreetMap view centered on the address (with a marker) and a **View on Zillow** button. Addresses are geocoded server-side with [Nominatim](https://nominatim.org/) — no API key. The app sends a descriptive `User-Agent`, makes **at most one Nominatim request per second**, and writes results to `data/geocode-cache.json` (gitignored) so each address is looked up only once. Delete that file to force a refresh. If geocoding fails, you still get a clean placeholder plus the Zillow button.

`data/houses/index.json` (a list of slugs) is **not** treated as a house. The server reads every other `*.json` in the folder.

### Rankings

`data/rankings.json` is a committed JSON array of address slugs, in preference order:

```json
["9223-seagrove-dr-75243", "7130-abrams-rd-75231"]
```

The Rankings page POSTs that list to `/api/rankings`, and the local server writes the file. House JSON files are not modified — the House Tracker bot owns those.

If the file is missing, houses default to **alphabetical by address**. New houses not yet in the file are appended in that same order; slugs for houses that no longer exist are ignored.

The order is shared through git. After you rearrange houses, **commit `data/rankings.json`** (or let a later bot sync commit it) so `git pull` on other machines picks it up. Local reorders that are not committed are overwritten on the next pull.

### Sample data

`data/sample/` has five clearly fake houses (Demo / Sample / Placeholder / Sold / Closed addresses). They are used only when `data/houses/` has no house files, or when `USE_SAMPLE_DATA=true`. The two Sold samples are for exercising `/graveyard` without changing real `data/houses/` files.

## Pages

- **Dashboard** (`/`) — pick an address, see details, photo, and price history vs. the $700K budget line.
- **Rankings** (`/rankings`) — drag houses into an order, or type a rank number (that house moves there and the rest shift). Saved to `data/rankings.json`.
- **Graveyard** (`/graveyard`) — houses whose status is Sold (word match, so `Sold (10/1/2026)` counts). Shows original list price, lowest list price, sale price (or Unknown), and days on market. Newest `soldDate` first; otherwise by address.
- **Add house** (`/add`) — submit a Zillow URL or street address to the bot webhook.
- **About** (`/about`) — what the project is, how the bot / GitHub JSON / web app fit together, and the plan to host on Cloudflare Pages with a public landing and a password-gated dashboard.

## Local webhook testing

```bash
npm run mock-webhook
```

In `.env`:

```
HOUSE_TRACKER_WEBHOOK_URL=http://127.0.0.1:8787/
HOUSE_TRACKER_WEBHOOK_AUTH=Bearer test-token
```

Restart `npm start`, submit a house on `/add`, and watch the mock print the JSON body and `Authorization` header.

## Tests

```bash
npm test
```
