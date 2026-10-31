const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");

const os = require("os");

process.env.GIT_PULL_ENABLED = "false";
process.env.USE_SAMPLE_DATA = "true";
process.env.GEOCODE_PREFETCH = "false";
process.env.GEOCODE_CACHE_PATH = path.join(os.tmpdir(), `geocode-api-${process.pid}.json`);
process.env.RANKINGS_PATH = path.join(os.tmpdir(), `rankings-api-${process.pid}.json`);
process.env.INTEREST_PATH = path.join(os.tmpdir(), `interest-api-${process.pid}.json`);
process.env.GEOFENCES_PATH = path.join(os.tmpdir(), `geofences-api-${process.pid}.json`);
process.env.SURVEY_DB_PATH = path.join(os.tmpdir(), `survey-api-main-${process.pid}.db`);
delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

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

describe("API", () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer(app);
    port = await listen(server);
  });

  after(() => server.close());

  it("serves House Details", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /House Tracker/);
    assert.match(html, /House Details/);
    assert.match(html, /price-chart/);
    assert.match(html, /href="\/about"/);
    assert.match(html, /href="\/rankings"/);
    assert.match(html, /href="\/survey"/);
    assert.match(html, /href="\/graveyard"/);
    assert.match(html, /href="\/map"/);
    assert.match(html, /id="not-interested-btn"/);
    assert.match(html, /id="zillow-cta"/);
    assert.match(html, /id="fill-survey-cta"/);
    assert.match(html, /id="survey-section"/);
    assert.match(html, /View on Zillow/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener/);
    assert.match(html, /id="schools-section"/);
    assert.match(html, /id="schools-list"/);
  });

  it("serves the add page", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/add`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Add a house/);
    assert.match(html, /href="\/rankings"/);
    assert.match(html, /href="\/survey"/);
    assert.match(html, /href="\/graveyard"/);
    assert.match(html, /href="\/map"/);
    assert.match(html, /House Details/);
  });

  it("serves the map page", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/map`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Houses and schools map/);
    assert.match(html, /id="level-toggle"/);
    assert.match(html, /Elementary/);
    assert.match(html, /leaflet.draw/);
    assert.match(html, /House Details/);
    assert.match(html, /href="\/map"/);
    assert.match(html, /href="\/survey"/);
    assert.match(html, /href="\/graveyard"/);
  });

  it("serves the rankings page", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/rankings`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Rankings/);
    assert.match(html, /id="rank-list"/);
    assert.match(html, /href="\/rankings"/);
    assert.match(html, /href="\/survey"/);
    assert.match(html, /href="\/graveyard"/);
    assert.match(html, /href="\/map"/);
    assert.match(html, /House Details/);
  });

  it("serves the graveyard page", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/graveyard`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Graveyard/);
    assert.match(html, /id="graveyard-list"/);
    assert.match(html, /id="not-interested-list"/);
    assert.match(html, /href="\/graveyard"/);
    assert.match(html, /href="\/survey"/);
    assert.match(html, /href="\/map"/);
    assert.match(html, /House Details/);
  });

  it("serves the about page with architecture and Cloudflare Pages roadmap", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/about`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /About House Tracker/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /Cloudflare Pages/);
    assert.match(html, /Client-side password/);
    assert.match(html, /npm start/);
    assert.match(html, /href="\/rankings"/);
    assert.match(html, /href="\/survey"/);
    assert.match(html, /href="\/graveyard"/);
    assert.match(html, /href="\/map"/);
    assert.match(html, /House Details/);
    assert.doesNotMatch(html, /lime\s*1234/i);
    assert.doesNotMatch(html, /password\s*[:=]\s*['"][^'"]+['"]/i);
  });

  it("returns sample houses and never treats index.json as a house", async () => {
    const { res, data } = await jsonRequest(port, "/api/houses");
    assert.equal(res.status, 200);
    assert.equal(data.source, "sample");
    assert.equal(data.budget, 700000);
    assert.equal(data.houses.length, 5);
    assert.ok(data.houses.every((h) => h.slug !== "index"));
    const maple = data.houses.find((h) => h.address.includes("Maple Demo"));
    assert.ok(maple);
    assert.equal(maple.listPrice, 739000);
    assert.ok(maple.priceHistory.some((p) => p.price == null));
  });

  it("returns only sold sample houses with computed graveyard fields", async () => {
    const { res, data } = await jsonRequest(port, "/api/graveyard");
    assert.equal(res.status, 200);
    assert.equal(data.source, "sample");
    assert.equal(data.houses.length, 2);
    assert.deepEqual(
      data.houses.map((h) => h.slug),
      ["321-willow-sold-st-dallas-tx", "654-birch-closed-ave-garland-tx"]
    );
    const willow = data.houses[0];
    assert.equal(willow.originalPrice, 689000);
    assert.equal(willow.lowestPrice, 665000);
    assert.equal(willow.salePrice, 655000);
    assert.equal(willow.daysOnMarket, 73);
    const birch = data.houses[1];
    assert.equal(birch.originalPrice, 599000);
    assert.equal(birch.lowestPrice, 575000);
    assert.equal(birch.salePrice, null);
    assert.equal(birch.daysOnMarket, 56);
  });

  it("rejects an empty add-house payload", async () => {
    const { res, data } = await jsonRequest(port, "/api/houses", {
      method: "POST",
      body: JSON.stringify({ input: "  " }),
    });
    assert.equal(res.status, 400);
    assert.match(data.error, /Zillow link or a street address/);
  });

  it("errors clearly when the webhook is not configured", async () => {
    const { res, data } = await jsonRequest(port, "/api/houses", {
      method: "POST",
      body: JSON.stringify({ input: "9223 Seagrove Dr, Dallas, TX" }),
    });
    assert.equal(res.status, 503);
    assert.equal(data.code, "WEBHOOK_NOT_CONFIGURED");
    assert.match(data.error, /HOUSE_TRACKER_WEBHOOK_URL/);
  });

  it("POSTs { input } and Authorization to a mock webhook", async () => {
    const received = [];
    const mock = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const mockPort = await listen(mock);
    process.env.HOUSE_TRACKER_WEBHOOK_URL = `http://127.0.0.1:${mockPort}/hook`;
    process.env.HOUSE_TRACKER_WEBHOOK_AUTH = "Bearer test-token";

    const { res, data } = await jsonRequest(port, "/api/houses", {
      method: "POST",
      body: JSON.stringify({ input: "https://www.zillow.com/homedetails/example" }),
    });

    mock.close();
    delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
    delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.match(data.message, /few minutes/);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].authorization, "Bearer test-token");
    assert.deepEqual(received[0].body, { input: "https://www.zillow.com/homedetails/example" });
  });

  it("surfaces webhook failures", async () => {
    const mock = http.createServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "nope" }));
    });
    const mockPort = await listen(mock);
    process.env.HOUSE_TRACKER_WEBHOOK_URL = `http://127.0.0.1:${mockPort}/`;
    process.env.HOUSE_TRACKER_WEBHOOK_AUTH = "Bearer x";

    const { res, data } = await jsonRequest(port, "/api/houses", {
      method: "POST",
      body: JSON.stringify({ input: "100 Test St" }),
    });

    mock.close();
    delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
    delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

    assert.equal(res.status, 502);
    assert.equal(data.code, "WEBHOOK_FAILED");
  });

  it("ranks sample houses alphabetically when rankings.json is missing", async () => {
    fs.rmSync(process.env.RANKINGS_PATH, { force: true });
    const { res, data } = await jsonRequest(port, "/api/rankings");
    assert.equal(res.status, 200);
    assert.equal(data.source, "default");
    assert.deepEqual(data.slugs, [
      "123-maple-demo-st-dallas-tx",
      "321-willow-sold-st-dallas-tx",
      "456-oak-sample-ave-richardson-tx",
      "654-birch-closed-ave-garland-tx",
      "789-cedar-placeholder-ln-plano-tx",
    ]);
  });

  it("rejects a rankings payload that is not a slug array", async () => {
    const { res, data } = await jsonRequest(port, "/api/rankings", {
      method: "POST",
      body: JSON.stringify({ slugs: "nope" }),
    });
    assert.equal(res.status, 400);
    assert.match(data.error, /slugs/);
  });

  it("writes rankings.json and returns the merged slug order", async () => {
    const { res, data } = await jsonRequest(port, "/api/rankings", {
      method: "POST",
      body: JSON.stringify({
        slugs: ["789-cedar-placeholder-ln-plano-tx", "123-maple-demo-st-dallas-tx"],
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.deepEqual(data.slugs, [
      "789-cedar-placeholder-ln-plano-tx",
      "123-maple-demo-st-dallas-tx",
      "321-willow-sold-st-dallas-tx",
      "456-oak-sample-ave-richardson-tx",
      "654-birch-closed-ave-garland-tx",
    ]);

    const saved = JSON.parse(fs.readFileSync(process.env.RANKINGS_PATH, "utf8"));
    assert.deepEqual(saved, data.slugs);

    const again = await jsonRequest(port, "/api/rankings");
    assert.equal(again.res.status, 200);
    assert.equal(again.data.source, "file");
    assert.deepEqual(again.data.slugs, data.slugs);
  });

  it("geocodes an address through Nominatim with a User-Agent and caches it", async () => {
    const { configureGeocoder, DEFAULT_USER_AGENT } = require("../lib/geocode");
    const headersSeen = [];
    configureGeocoder({
      cachePath: process.env.GEOCODE_CACHE_PATH,
      minIntervalMs: 0,
      fetchFn: async (_url, opts) => {
        headersSeen.push(opts.headers["User-Agent"]);
        return {
          ok: true,
          json: async () => [{ lat: "32.91", lon: "-96.73", display_name: "Seagrove" }],
        };
      },
    });

    const { res, data } = await jsonRequest(
      port,
      `/api/geocode?address=${encodeURIComponent("9223 Seagrove Dr, Dallas, TX 75243")}`
    );
    assert.equal(res.status, 200);
    assert.equal(data.coords.lat, 32.91);
    assert.equal(headersSeen[0], DEFAULT_USER_AGENT);

    const again = await jsonRequest(
      port,
      `/api/geocode?address=${encodeURIComponent("9223 Seagrove Dr, Dallas, TX 75243")}`
    );
    assert.equal(again.res.status, 200);
    assert.equal(headersSeen.length, 1);
  });

  it("returns 404 when geocoding finds nothing", async () => {
    const { configureGeocoder } = require("../lib/geocode");
    configureGeocoder({
      cachePath: path.join(os.tmpdir(), `geocode-miss-${process.pid}.json`),
      minIntervalMs: 0,
      fetchFn: async () => ({ ok: true, json: async () => [] }),
    });
    const { res, data } = await jsonRequest(port, "/api/geocode?address=NotARealPlace123");
    assert.equal(res.status, 404);
    assert.equal(data.coords, null);
  });

  it("returns sample schools and house lat/lng without inventing live school data", async () => {
    const houses = await jsonRequest(port, "/api/houses");
    const maple = houses.data.houses.find((h) => h.slug === "123-maple-demo-st-dallas-tx");
    assert.equal(maple.lat, 32.7875);
    assert.equal(maple.lng, -96.798);
    assert.deepEqual(maple.schoolIds, ["demo-maple-elem", "sample-cedar-high"]);
    const schools = await jsonRequest(port, "/api/schools");
    assert.equal(schools.res.status, 200);
    assert.equal(schools.data.source, "sample");
    assert.equal(schools.data.schools.length, 4);
    assert.ok(schools.data.schools.every((school) => /demo|sample|placeholder|fictional|willow demo/i.test(`${school.name} ${school.district}`)));
  });

  it("moves a house to not interested and lists it on the graveyard", async () => {
    fs.rmSync(process.env.INTEREST_PATH, { force: true });
    const { res, data } = await jsonRequest(port, "/api/interest/not-interested", {
      method: "POST",
      body: JSON.stringify({ slug: "123-maple-demo-st-dallas-tx" }),
    });
    assert.equal(res.status, 200);
    assert.equal(data.status, "notInterested");
    assert.equal(data.interest.notInterested[0].slug, "123-maple-demo-st-dallas-tx");
    assert.match(data.interest.notInterested[0].since, /^\d{4}-\d{2}-\d{2}$/);

    const saved = JSON.parse(fs.readFileSync(process.env.INTEREST_PATH, "utf8"));
    assert.deepEqual(
      saved.notInterested.map((row) => row.slug),
      ["123-maple-demo-st-dallas-tx"]
    );

    const grave = await jsonRequest(port, "/api/graveyard");
    assert.equal(grave.res.status, 200);
    assert.equal(grave.data.houses.length, 2);
    assert.equal(grave.data.notInterested.length, 1);
    assert.equal(grave.data.notInterested[0].slug, "123-maple-demo-st-dallas-tx");
    assert.equal(grave.data.notInterested[0].pending, false);
    assert.equal(grave.data.notInterested[0].listPrice, 739000);
  });

  it("POSTs a reactivate webhook body without changing the add-house { input } contract", async () => {
    fs.rmSync(process.env.INTEREST_PATH, { force: true });
    const marked = await jsonRequest(port, "/api/interest/not-interested", {
      method: "POST",
      body: JSON.stringify({ slug: "123-maple-demo-st-dallas-tx" }),
    });
    assert.equal(marked.res.status, 200);
    const received = [];
    const mock = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({
          authorization: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const mockPort = await listen(mock);
    process.env.HOUSE_TRACKER_WEBHOOK_URL = `http://127.0.0.1:${mockPort}/hook`;
    process.env.HOUSE_TRACKER_WEBHOOK_AUTH = "Bearer test-token";

    const add = await jsonRequest(port, "/api/houses", {
      method: "POST",
      body: JSON.stringify({ input: "https://www.zillow.com/homedetails/keep-me" }),
    });
    const reactivate = await jsonRequest(port, "/api/interest/reactivate", {
      method: "POST",
      body: JSON.stringify({ slug: "123-maple-demo-st-dallas-tx" }),
    });

    mock.close();
    delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
    delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

    assert.equal(add.res.status, 200);
    assert.equal(reactivate.res.status, 200);
    assert.equal(reactivate.data.status, "pendingReactivation");
    assert.equal(received.length, 2);
    assert.deepEqual(received[0].body, { input: "https://www.zillow.com/homedetails/keep-me" });
    assert.deepEqual(received[1].body, {
      action: "reactivate",
      slug: "123-maple-demo-st-dallas-tx",
      input: "https://www.zillow.com/homedetails/123-Maple-Demo-St-Dallas-TX-75201/000000001_zpid/",
    });
    assert.equal(received[1].authorization, "Bearer test-token");

    const saved = JSON.parse(fs.readFileSync(process.env.INTEREST_PATH, "utf8"));
    assert.deepEqual(saved.notInterested, []);
    assert.equal(saved.pendingReactivation[0].slug, "123-maple-demo-st-dallas-tx");

    const grave = await jsonRequest(port, "/api/graveyard");
    assert.equal(grave.data.notInterested[0].pending, true);
  });

  it("saves geofences and flags sample houses inside a rectangle", async () => {
    const fence = {
      id: "demo-area",
      name: "Maple demo box",
      type: "rect",
      geometry: { south: 32.78, west: -96.81, north: 32.80, east: -96.79 },
    };
    const { res, data } = await jsonRequest(port, "/api/geofences", {
      method: "POST",
      body: JSON.stringify({ geofences: [fence] }),
    });
    assert.equal(res.status, 200);
    assert.equal(data.geofences[0].name, "Maple demo box");
    const houses = await jsonRequest(port, "/api/houses");
    const maple = houses.data.houses.find((h) => h.slug === "123-maple-demo-st-dallas-tx");
    const oak = houses.data.houses.find((h) => h.slug === "456-oak-sample-ave-richardson-tx");
    assert.deepEqual(maple.inside, ["Maple demo box"]);
    assert.deepEqual(oak.inside, []);
  });
});

describe("real PR #1 house files when present", () => {
  it("loads 14 houses and skips index.json", () => {
    const realDir = process.env.REAL_HOUSES_DIR || "/tmp/pr1-houses";
    const { loadHousesFromDir } = require("../lib/houses");
    const fs = require("fs");
    if (!fs.existsSync(path.join(realDir, "index.json"))) {
      return;
    }
    const houses = loadHousesFromDir(realDir);
    assert.equal(houses.length, 14);
    assert.ok(houses.every((h) => h.slug !== "index"));
    const missingPhotos = houses.filter((h) => h.photoUrl == null);
    assert.equal(missingPhotos.length, 5);
    assert.ok(houses.some((h) => (h.priceHistory || []).some((p) => p.price == null)));
  });
});
