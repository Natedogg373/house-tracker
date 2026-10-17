const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const path = require("path");

const os = require("os");

process.env.GIT_PULL_ENABLED = "false";
process.env.USE_SAMPLE_DATA = "true";
process.env.GEOCODE_PREFETCH = "false";
process.env.GEOCODE_CACHE_PATH = path.join(os.tmpdir(), `geocode-api-${process.pid}.json`);
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

  it("serves the dashboard", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /House Tracker/);
    assert.match(html, /price-chart/);
  });

  it("serves the add page", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/add`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Add a house/);
  });

  it("returns sample houses and never treats index.json as a house", async () => {
    const { res, data } = await jsonRequest(port, "/api/houses");
    assert.equal(res.status, 200);
    assert.equal(data.source, "sample");
    assert.equal(data.budget, 700000);
    assert.equal(data.houses.length, 3);
    assert.ok(data.houses.every((h) => h.slug !== "index"));
    const maple = data.houses.find((h) => h.address.includes("Maple Demo"));
    assert.ok(maple);
    assert.equal(maple.listPrice, 739000);
    assert.ok(maple.priceHistory.some((p) => p.price == null));
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
