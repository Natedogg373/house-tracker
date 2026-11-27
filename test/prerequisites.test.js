const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.GIT_PULL_ENABLED = "false";
process.env.USE_SAMPLE_DATA = "true";
process.env.GEOCODE_PREFETCH = "false";
process.env.GEOCODE_CACHE_PATH = path.join(os.tmpdir(), `geocode-prereq-${process.pid}.json`);
process.env.RANKINGS_PATH = path.join(os.tmpdir(), `rankings-prereq-${process.pid}.json`);
process.env.INTEREST_PATH = path.join(os.tmpdir(), `interest-prereq-${process.pid}.json`);
process.env.GEOFENCES_PATH = path.join(os.tmpdir(), `geofences-prereq-${process.pid}.json`);
process.env.SURVEY_DB_PATH = path.join(os.tmpdir(), `survey-prereq-${process.pid}.db`);
delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

const {
  scoreValue,
  scoreBoolean,
  scoreHouse,
  houseValueForCriterion,
  schoolRatingForHouse,
  loadPrerequisites,
  savePrerequisites,
  resetPrerequisitesDb,
  closePrerequisitesDb,
  yearBuiltAgeHint,
  CRITERION_DEFS,
  SKIPPED_CRITERIA,
  DEFAULT_TOLERANCE_PERCENT,
  SCHOOL_RATING_TOLERANCE,
} = require("../lib/prerequisites");
const { app } = require("../server");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function jsonRequest(port, pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

describe("prerequisites scoring", () => {
  it("defaults tolerance to 10% and school rating absolute tolerance to 1", () => {
    assert.equal(DEFAULT_TOLERANCE_PERCENT, 10);
    assert.equal(SCHOOL_RATING_TOLERANCE, 1);
  });

  it("scores max direction (price): green / yellow / red at ±10% boundaries", () => {
    const base = { direction: "max", threshold: 100, tolerancePercent: 10, enabled: true };
    assert.equal(scoreValue(89, base), "green");
    assert.equal(scoreValue(90, base), "yellow");
    assert.equal(scoreValue(100, base), "yellow");
    assert.equal(scoreValue(110, base), "yellow");
    assert.equal(scoreValue(111, base), "red");
  });

  it("scores min direction (sqft): green / yellow / red at ±10% boundaries", () => {
    const base = { direction: "min", threshold: 2000, tolerancePercent: 10, enabled: true };
    assert.equal(scoreValue(2201, base), "green");
    assert.equal(scoreValue(2200, base), "yellow");
    assert.equal(scoreValue(2000, base), "yellow");
    assert.equal(scoreValue(1800, base), "yellow");
    assert.equal(scoreValue(1799, base), "red");
  });

  it("scores school ratings with absolute ±1 tolerance", () => {
    const base = {
      direction: "min",
      threshold: 7,
      toleranceAbsolute: SCHOOL_RATING_TOLERANCE,
      enabled: true,
    };
    assert.equal(scoreValue(9, base), "green");
    assert.equal(scoreValue(8, base), "yellow");
    assert.equal(scoreValue(7, base), "yellow");
    assert.equal(scoreValue(6, base), "yellow");
    assert.equal(scoreValue(5, base), "red");
  });

  it("scores pool require / exclude boolean preferences", () => {
    assert.equal(scoreBoolean(true, { choice: "require", enabled: true }), "green");
    assert.equal(scoreBoolean(false, { choice: "require", enabled: true }), "red");
    assert.equal(scoreBoolean(false, { choice: "exclude", enabled: true }), "green");
    assert.equal(scoreBoolean(true, { choice: "exclude", enabled: true }), "red");
    assert.equal(scoreBoolean(null, { choice: "require", enabled: true }), "neutral");
    assert.equal(scoreBoolean(true, { choice: "require", enabled: false }), "off");
  });

  it("treats disabled criteria as off", () => {
    assert.equal(
      scoreValue(50, { direction: "max", threshold: 100, tolerancePercent: 10, enabled: false }),
      "off"
    );
  });

  it("returns neutral for missing value or threshold", () => {
    assert.equal(
      scoreValue(null, { direction: "min", threshold: 3, tolerancePercent: 10, enabled: true }),
      "neutral"
    );
    assert.equal(
      scoreValue(3, { direction: "min", threshold: null, tolerancePercent: 10, enabled: true }),
      "neutral"
    );
  });

  it("handles threshold of zero (e.g. no HOA) without throwing", () => {
    assert.equal(
      scoreValue(0, { direction: "max", threshold: 0, tolerancePercent: 10, enabled: true }),
      "yellow"
    );
    assert.equal(
      scoreValue(50, { direction: "max", threshold: 0, tolerancePercent: 10, enabled: true }),
      "red"
    );
  });

  it("reads exact Zillow field names and stays neutral when missing", () => {
    const house = {
      listPrice: 650000,
      sqft: 2100,
      beds: 3,
      baths: 2.5,
      lotAcres: 0.2,
      yearBuilt: 1995,
      garageSpaces: 2,
      hoaMonthly: 0,
      stories: 1,
      hasPool: false,
      propertyTaxAnnual: 9000,
      daysOnMarket: 42,
    };
    assert.equal(houseValueForCriterion(house, { id: "price" }), 650000);
    assert.equal(houseValueForCriterion(house, { id: "garage" }), 2);
    assert.equal(houseValueForCriterion(house, { id: "hoa" }), 0);
    assert.equal(houseValueForCriterion(house, { id: "stories" }), 1);
    assert.equal(houseValueForCriterion(house, { id: "hasPool" }), false);
    assert.equal(houseValueForCriterion(house, { id: "propertyTax" }), 9000);
    assert.equal(houseValueForCriterion({ listPrice: 1 }, { id: "garage" }), null);
    assert.equal(houseValueForCriterion({ listPrice: 1 }, { id: "hoa" }), null);
  });

  it("resolves school ratings from assigned schoolIds", () => {
    const schools = [
      { id: "e1", level: "elementary", rating: 8 },
      { id: "m1", level: "middle", rating: 5 },
      { id: "h1", level: "high", rating: 4 },
    ];
    const house = { schoolIds: ["e1", "m1", "h1"] };
    assert.equal(schoolRatingForHouse(house, "elementary", schools), 8);
    assert.equal(schoolRatingForHouse(house, "middle", schools), 5);
    assert.equal(schoolRatingForHouse(house, "high", schools), 4);
    assert.equal(schoolRatingForHouse({ schoolIds: [] }, "elementary", schools), null);
    assert.equal(
      houseValueForCriterion(house, { id: "schoolElementary" }, { schools }),
      8
    );
  });

  it("scores a house with mixed numeric, boolean, and school results", () => {
    const schools = [
      { id: "e1", level: "elementary", rating: 8 },
      { id: "m1", level: "middle", rating: 5 },
    ];
    const config = {
      tolerancePercent: 10,
      criteria: [
        { id: "price", kind: "number", direction: "max", field: "listPrice", enabled: true, threshold: 700000 },
        { id: "garage", kind: "number", direction: "min", field: "garageSpaces", enabled: true, threshold: 2 },
        { id: "hasPool", kind: "boolean", field: "hasPool", enabled: true, choice: "exclude" },
        { id: "schoolElementary", kind: "school", schoolLevel: "elementary", enabled: true, threshold: 7 },
        { id: "schoolMiddle", kind: "school", schoolLevel: "middle", enabled: true, threshold: 7 },
        { id: "baths", kind: "number", direction: "min", field: "baths", enabled: false, threshold: 3 },
      ],
    };
    const house = {
      listPrice: 650000,
      baths: 2,
      hasPool: false,
      schoolIds: ["e1", "m1"],
    };
    const scored = scoreHouse(house, config, { schools });
    const byId = Object.fromEntries(scored.results.map((r) => [r.id, r]));
    assert.equal(byId.price.status, "yellow");
    assert.equal(byId.garage.status, "neutral");
    assert.equal(byId.hasPool.status, "green");
    assert.equal(byId.schoolElementary.status, "yellow"); // 8 within 1 of 7
    assert.equal(byId.schoolMiddle.status, "red"); // 5 vs 7
    assert.equal(byId.baths.status, "off");
    assert.ok(scored.summary.total >= 4);
  });

  it("includes new Zillow and school criteria and skips none by default", () => {
    const ids = CRITERION_DEFS.map((c) => c.id);
    assert.ok(ids.includes("hoa"));
    assert.ok(ids.includes("stories"));
    assert.ok(ids.includes("hasPool"));
    assert.ok(ids.includes("propertyTax"));
    assert.ok(ids.includes("schoolElementary"));
    assert.ok(ids.includes("schoolMiddle"));
    assert.ok(ids.includes("schoolHigh"));
    assert.ok(!ids.includes("daysOnMarket"));
    assert.deepEqual(SKIPPED_CRITERIA, []);
  });

  it("builds a year-built age hint", () => {
    const hint = yearBuiltAgeHint(2000, new Date("2026-06-01"));
    assert.match(hint, /2000/);
    assert.match(hint, /26 years/);
  });
});

describe("prerequisites persistence", () => {
  beforeEach(() => {
    const dbPath = path.join(os.tmpdir(), `prereq-unit-${process.pid}-${Date.now()}.db`);
    resetPrerequisitesDb(dbPath);
  });

  after(() => {
    closePrerequisitesDb();
  });

  it("defaults to all criteria disabled", () => {
    const config = loadPrerequisites();
    assert.equal(config.tolerancePercent, 10);
    assert.ok(config.criteria.length >= 10);
    assert.ok(config.criteria.every((c) => c.enabled === false));
    assert.ok(config.criteria.find((c) => c.id === "hasPool").choice === "require");
    assert.ok(config.criteria.find((c) => c.id === "hoa"));
  });

  it("saves and reloads enabled thresholds and pool choice", () => {
    const saved = savePrerequisites({
      tolerancePercent: 15,
      criteria: [
        { id: "price", enabled: true, threshold: 700000 },
        { id: "hasPool", enabled: true, choice: "exclude" },
        { id: "schoolHigh", enabled: true, threshold: 6 },
      ],
    });
    assert.equal(saved.tolerancePercent, 15);
    assert.equal(saved.criteria.find((c) => c.id === "hasPool").choice, "exclude");
    assert.equal(saved.criteria.find((c) => c.id === "schoolHigh").threshold, 6);

    const loaded = loadPrerequisites();
    assert.equal(loaded.tolerancePercent, 15);
    assert.equal(loaded.criteria.find((c) => c.id === "hasPool").enabled, true);
    assert.equal(loaded.criteria.find((c) => c.id === "hasPool").choice, "exclude");
    assert.equal(loaded.criteria.find((c) => c.id === "sqft").enabled, false);
  });
});

describe("prerequisites API", () => {
  let server;
  let port;
  let dbPath;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `prereq-api-${process.pid}-${Date.now()}.db`);
    resetPrerequisitesDb(dbPath);
    server = http.createServer(app);
    port = await listen(server);
  });

  after(() => {
    server.close();
    closePrerequisitesDb();
    try {
      fs.rmSync(dbPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("serves the Prerequisites page", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/prerequisites`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Prerequisites/);
    assert.match(html, /id="prereq-list"/);
    assert.match(html, /id="tolerance-input"/);
    assert.match(html, /href="\/prerequisites"/);
  });

  it("GET /api/prerequisites returns defaults including new criteria", async () => {
    const { res, data } = await jsonRequest(port, "/api/prerequisites");
    assert.equal(res.status, 200);
    assert.equal(data.tolerancePercent, 10);
    assert.ok(Array.isArray(data.criteria));
    assert.ok(data.criteria.every((c) => c.enabled === false));
    const ids = data.criteria.map((c) => c.id);
    assert.ok(ids.includes("hoa"));
    assert.ok(ids.includes("hasPool"));
    assert.ok(ids.includes("schoolElementary"));
  });

  it("PUT /api/prerequisites persists settings", async () => {
    const { res, data } = await jsonRequest(port, "/api/prerequisites", {
      method: "PUT",
      body: JSON.stringify({
        tolerancePercent: 12,
        criteria: [
          { id: "price", enabled: true, threshold: 680000 },
          { id: "hasPool", enabled: true, choice: "require" },
          { id: "schoolElementary", enabled: true, threshold: 7 },
        ],
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.tolerancePercent, 12);
    assert.equal(data.criteria.find((c) => c.id === "hasPool").choice, "require");
    assert.equal(data.criteria.find((c) => c.id === "schoolElementary").threshold, 7);

    const again = await jsonRequest(port, "/api/prerequisites");
    assert.equal(again.data.tolerancePercent, 12);
    assert.equal(again.data.criteria.find((c) => c.id === "hasPool").enabled, true);
  });

  it("scores a sample house including school and garage neutrality", async () => {
    await jsonRequest(port, "/api/prerequisites", {
      method: "PUT",
      body: JSON.stringify({
        tolerancePercent: 10,
        criteria: [
          { id: "beds", enabled: true, threshold: 2 },
          { id: "garage", enabled: true, threshold: 2 },
          { id: "schoolElementary", enabled: true, threshold: 1 },
        ],
      }),
    });

    const housesRes = await jsonRequest(port, "/api/houses");
    const house = housesRes.data.houses?.[0];
    assert.ok(house?.slug);

    const { res, data } = await jsonRequest(
      port,
      `/api/prerequisites/score/${encodeURIComponent(house.slug)}`
    );
    assert.equal(res.status, 200);
    assert.equal(data.slug, house.slug);
    assert.ok(Array.isArray(data.results));
    const garage = data.results.find((r) => r.id === "garage");
    assert.equal(garage.status, "neutral");
  });
});
