require("dotenv").config();

const path = require("path");
const express = require("express");
const { resolveHouses, getBudget, getHousesDir, SAMPLE_DIR } = require("./lib/houses");
const { startGitPullLoop } = require("./lib/git-pull");
const { postToHouseTracker } = require("./lib/webhook");
const { getGeocoder, isPrefetchEnabled } = require("./lib/geocode");

const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/add", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "add.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function withCoords(house) {
  return { ...house, coords: getGeocoder().peek(house.address) };
}

app.get("/api/houses", (_req, res) => {
  try {
    const result = resolveHouses({
      housesDir: getHousesDir(),
      sampleDir: SAMPLE_DIR,
      useSampleData: process.env.USE_SAMPLE_DATA,
    });
    res.json({
      budget: getBudget(),
      source: result.source,
      houses: result.houses.map(withCoords),
    });
    if (isPrefetchEnabled()) {
      getGeocoder().prefetch(result.houses.map((house) => house.address));
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
        "Request sent. House Tracker will look this up on Zillow through a browser, so it can take a few minutes. The house should appear on the dashboard after that — usually within a couple of minutes of the bot finishing.",
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
