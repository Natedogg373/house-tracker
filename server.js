require("dotenv").config();

const path = require("path");
const express = require("express");
const { resolveHouses, getBudget, getHousesDir, SAMPLE_DIR, coordsFromHouse, schoolIdsOf } = require("./lib/houses");
const { buildGraveyard, buildNotInterested } = require("./lib/graveyard");
const { applyRankings, loadRankings, saveRankings } = require("./lib/rankings");
const { startGitPullLoop } = require("./lib/git-pull");
const { postToHouseTracker, postHouseTrackerPayload } = require("./lib/webhook");
const { getGeocoder, isPrefetchEnabled } = require("./lib/geocode");
const {
  loadInterest,
  saveInterest,
  markNotInterested,
  requestReactivation,
  interestStatus,
  reactivationInput,
} = require("./lib/interest");
const {
  loadGeofences,
  saveGeofences,
  geofencesContaining,
  housePoint,
} = require("./lib/geofences");
const { resolveSchools } = require("./lib/schools");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/add", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "add.html"));
});

app.get("/about", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "about.html"));
});

app.get("/rankings", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "rankings.html"));
});

app.get("/graveyard", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "graveyard.html"));
});

app.get("/map", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "map.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function currentHouses() {
  return resolveHouses({
    housesDir: getHousesDir(),
    sampleDir: SAMPLE_DIR,
    useSampleData: process.env.USE_SAMPLE_DATA,
  });
}

function decorateHouse(house, { interest, geofences }) {
  const peeked = getGeocoder().peek(house.address);
  const coords = coordsFromHouse(house, peeked);
  const decorated = {
    ...house,
    schoolIds: schoolIdsOf(house),
    coords,
    interestStatus: interestStatus(interest, house.slug),
  };
  const point = housePoint(decorated);
  decorated.inside = point ? geofencesContaining(point.lat, point.lng, geofences).map((fence) => fence.name) : [];
  return decorated;
}

function snapshot() {
  const result = currentHouses();
  const interest = loadInterest();
  const { geofences } = loadGeofences();
  const schools = resolveSchools({ source: result.source });
  return {
    ...result,
    interest: {
      notInterested: interest.notInterested,
      pendingReactivation: interest.pendingReactivation,
    },
    geofences,
    schools: schools.schools,
    schoolSource: schools.source,
  };
}

app.get("/api/houses", (_req, res) => {
  try {
    const data = snapshot();
    const houses = data.houses.map((house) =>
      decorateHouse(house, { interest: data.interest, geofences: data.geofences })
    );
    res.json({
      budget: getBudget(),
      source: data.source,
      houses,
      interest: data.interest,
      geofences: data.geofences,
      schools: data.schools,
    });
    if (isPrefetchEnabled()) {
      getGeocoder().prefetch(data.houses.map((house) => house.address));
    }
  } catch (err) {
    console.error("[api] failed to load houses:", err);
    res.status(500).json({ error: "Failed to load houses." });
  }
});

app.get("/api/geocode", async (req, res) => {
  const address = String(req.query.address || "").trim();
  if (!address) {
    return res.status(400).json({ error: "Missing address." });
  }
  try {
    const coords = await getGeocoder().geocode(address);
    if (!coords) {
      return res.status(404).json({ error: "Could not locate that address.", coords: null });
    }
    return res.json({ address, coords });
  } catch (err) {
    console.error("[api] geocode failed:", err);
    return res.status(502).json({ error: "Geocoding failed.", coords: null });
  }
});

app.get("/api/graveyard", (_req, res) => {
  try {
    const data = snapshot();
    const sold = buildGraveyard(data.houses);
    const notInterested = buildNotInterested(data.houses, data.interest);
    res.json({
      source: data.source,
      houses: sold,
      sold,
      notInterested,
    });
  } catch (err) {
    console.error("[api] failed to load graveyard:", err);
    res.status(500).json({ error: "Failed to load graveyard." });
  }
});

app.get("/api/rankings", (_req, res) => {
  try {
    const result = currentHouses();
    const loaded = loadRankings();
    const ordered = applyRankings(result.houses, loaded.slugs);
    res.json({
      slugs: ordered.map((house) => house.slug),
      source: loaded.source,
    });
  } catch (err) {
    console.error("[api] failed to load rankings:", err);
    res.status(500).json({ error: "Failed to load rankings." });
  }
});

app.post("/api/rankings", (req, res) => {
  if (!Array.isArray(req.body?.slugs)) {
    return res.status(400).json({ error: 'Send { "slugs": ["address-slug", ...] }.' });
  }
  try {
    const result = currentHouses();
    const ordered = applyRankings(result.houses, req.body.slugs);
    const slugs = saveRankings(ordered.map((house) => house.slug));
    return res.json({ ok: true, slugs });
  } catch (err) {
    console.error("[api] failed to save rankings:", err);
    return res.status(500).json({ error: "Failed to save rankings." });
  }
});

app.get("/api/interest", (_req, res) => {
  try {
    const interest = loadInterest();
    res.json({
      notInterested: interest.notInterested,
      pendingReactivation: interest.pendingReactivation,
      source: interest.source,
    });
  } catch (err) {
    console.error("[api] failed to load interest:", err);
    res.status(500).json({ error: "Failed to load interest." });
  }
});

function findHouse(slug) {
  const result = currentHouses();
  const house = result.houses.find((item) => item.slug === slug) || null;
  return { result, house };
}

app.post("/api/interest/not-interested", (req, res) => {
  const slug = String(req.body?.slug || "").trim();
  if (!slug) {
    return res.status(400).json({ error: "Missing slug." });
  }
  try {
    const { house } = findHouse(slug);
    if (!house) {
      return res.status(404).json({ error: "Unknown house." });
    }
    const saved = saveInterest(markNotInterested(loadInterest(), slug));
    return res.json({ ok: true, interest: saved, status: "notInterested" });
  } catch (err) {
    console.error("[api] failed to mark not interested:", err);
    return res.status(500).json({ error: "Failed to update interest." });
  }
});

app.post("/api/interest/reactivate", async (req, res) => {
  const slug = String(req.body?.slug || "").trim();
  if (!slug) {
    return res.status(400).json({ error: "Missing slug." });
  }
  try {
    const { house } = findHouse(slug);
    if (!house) {
      return res.status(404).json({ error: "Unknown house." });
    }
    const current = loadInterest();
    if (interestStatus(current, slug) === "active") {
      return res.status(409).json({ error: "House is already on the interested list." });
    }
    const saved = saveInterest(requestReactivation(current, slug));
    const payload = {
      action: "reactivate",
      slug,
      input: reactivationInput(house),
    };
    try {
      await postHouseTrackerPayload(payload);
      return res.json({
        ok: true,
        interest: saved,
        status: "pendingReactivation",
        webhook: payload,
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        error: err.message || "Could not send the request.",
        code: err.code,
        interest: saved,
        status: "pendingReactivation",
        webhook: payload,
      });
    }
  } catch (err) {
    console.error("[api] failed to request reactivation:", err);
    return res.status(500).json({ error: "Failed to request reactivation." });
  }
});

app.get("/api/geofences", (_req, res) => {
  try {
    const loaded = loadGeofences();
    res.json({ geofences: loaded.geofences, source: loaded.source });
  } catch (err) {
    console.error("[api] failed to load geofences:", err);
    res.status(500).json({ error: "Failed to load geofences." });
  }
});

app.post("/api/geofences", (req, res) => {
  const incoming = Array.isArray(req.body) ? req.body : req.body?.geofences;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'Send an array of geofences, or { "geofences": [...] }.' });
  }
  try {
    const geofences = saveGeofences(incoming);
    return res.json({ ok: true, geofences });
  } catch (err) {
    console.error("[api] failed to save geofences:", err);
    return res.status(500).json({ error: "Failed to save geofences." });
  }
});

app.get("/api/schools", (_req, res) => {
  try {
    const result = currentHouses();
    const loaded = resolveSchools({ source: result.source });
    res.json({ schools: loaded.schools, source: loaded.source });
  } catch (err) {
    console.error("[api] failed to load schools:", err);
    res.status(500).json({ error: "Failed to load schools." });
  }
});

app.post("/api/houses", async (req, res) => {
  const input = String(req.body?.input || "").trim();
  if (!input) {
    return res.status(400).json({ error: "Enter a Zillow link or a street address." });
  }

  try {
    await postToHouseTracker(input);
    return res.json({
      ok: true,
      message:
        "Request sent. House Tracker will look this up on Zillow through a browser, so it can take a few minutes. The house should appear on House Details after that — usually within a couple of minutes of the bot finishing.",
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      error: err.message || "Could not send the request.",
      code: err.code,
    });
  }
});

function start() {
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, () => {
    console.log(`House Tracker running at http://localhost:${port}`);
  });
  const pull = startGitPullLoop();
  const shutdown = () => {
    pull.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
