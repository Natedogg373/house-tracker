const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createGeocoder, cacheKey, DEFAULT_USER_AGENT } = require("../lib/geocode");

function tempCache() {
  return path.join(os.tmpdir(), `geocode-cache-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

describe("geocode cache and Nominatim policy", () => {
  it("normalizes cache keys", () => {
    assert.equal(cacheKey("  9223   Seagrove Dr, Dallas "), "9223 seagrove dr, dallas");
  });

  it("returns cached coordinates without hitting the network", async () => {
    const cachePath = tempCache();
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        "9223 seagrove dr, dallas, tx 75243": {
          found: true,
          lat: 32.9,
          lon: -96.73,
          displayName: "9223 Seagrove Dr",
        },
      })
    );
    let calls = 0;
    const geocoder = createGeocoder({
      cachePath,
      fetchFn: async () => {
        calls += 1;
        throw new Error("should not fetch");
      },
    });
    const coords = await geocoder.geocode("9223 Seagrove Dr, Dallas, TX 75243");
    assert.equal(calls, 0);
    assert.deepEqual(coords.lat, 32.9);
    assert.equal(geocoder.peek("9223 Seagrove Dr, Dallas, TX 75243").lon, -96.73);
  });

  it("sends a descriptive User-Agent and caches a successful lookup", async () => {
    const cachePath = tempCache();
    const headersSeen = [];
    const geocoder = createGeocoder({
      cachePath,
      minIntervalMs: 0,
      fetchFn: async (_url, opts) => {
        headersSeen.push(opts.headers["User-Agent"]);
        return {
          ok: true,
          json: async () => [{ lat: "32.910", lon: "-96.731", display_name: "Seagrove" }],
        };
      },
    });
    const coords = await geocoder.geocode("9223 Seagrove Dr, Dallas, TX 75243");
    assert.equal(coords.lat, 32.91);
    assert.equal(coords.lon, -96.731);
    assert.equal(headersSeen[0], DEFAULT_USER_AGENT);
    const saved = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    assert.equal(saved["9223 seagrove dr, dallas, tx 75243"].found, true);
  });

  it("caches not-found results and does not retry the network", async () => {
    const cachePath = tempCache();
    let calls = 0;
    const geocoder = createGeocoder({
      cachePath,
      minIntervalMs: 0,
      fetchFn: async () => {
        calls += 1;
        return { ok: true, json: async () => [] };
      },
    });
    assert.equal(await geocoder.geocode("123 Maple Demo St, Dallas, TX 75201"), null);
    assert.equal(await geocoder.geocode("123 Maple Demo St, Dallas, TX 75201"), null);
    assert.equal(calls, 1);
    assert.equal(geocoder.peek("123 Maple Demo St, Dallas, TX 75201"), null);
  });

  it("does not cache transient network errors", async () => {
    const cachePath = tempCache();
    let calls = 0;
    const geocoder = createGeocoder({
      cachePath,
      minIntervalMs: 0,
      fetchFn: async () => {
        calls += 1;
        throw new Error("offline");
      },
    });
    assert.equal(await geocoder.geocode("8026 Westover Dr, Dallas, TX 75231"), null);
    assert.equal(await geocoder.geocode("8026 Westover Dr, Dallas, TX 75231"), null);
    assert.equal(calls, 2);
    assert.equal(geocoder.peek("8026 Westover Dr, Dallas, TX 75231"), undefined);
  });

  it("waits at least 1 second between Nominatim requests", async () => {
    const cachePath = tempCache();
    const stamps = [];
    let clock = 10_000;
    let queuedSleep = 0;
    const geocoder = createGeocoder({
      cachePath,
      minIntervalMs: 1000,
      now: () => clock,
      sleepFn: async (ms) => {
        queuedSleep += ms;
        clock += ms;
      },
      fetchFn: async (url) => {
        stamps.push({ at: clock, q: String(url) });
        clock += 5;
        return {
          ok: true,
          json: async () => [{ lat: "1", lon: "2", display_name: "x" }],
        };
      },
    });
    await Promise.all([geocoder.geocode("One St, Dallas, TX"), geocoder.geocode("Two St, Dallas, TX")]);
    assert.equal(stamps.length, 2);
    assert.ok(stamps[1].at - stamps[0].at >= 1000);
    assert.ok(queuedSleep >= 900);
  });
});
