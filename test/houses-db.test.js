const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.GIT_PULL_ENABLED = "false";
process.env.USE_SAMPLE_DATA = "false";
process.env.GEOCODE_PREFETCH = "false";
process.env.GEOCODE_CACHE_PATH = path.join(os.tmpdir(), `geocode-houses-db-${process.pid}.json`);
process.env.GEOFENCES_PATH = path.join(os.tmpdir(), `geofences-houses-db-${process.pid}.json`);

const dbPath = path.join(os.tmpdir(), `houses-db-${process.pid}.db`);
process.env.HOUSES_DB_PATH = dbPath;
process.env.SURVEY_DB_PATH = path.join(os.tmpdir(), `survey-houses-db-${process.pid}.db`);
delete process.env.HOUSE_DATA_API_TOKEN;
delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

const {
  resetHousesDb,
  closeHousesDb,
  importHousesFromDisk,
  maybeImportHousesFromDisk,
  countHouses,
  listHouses,
  getHouseRow,
  upsertHouse,
  appendPricePoint,
  patchHouseStatus,
  softDeleteHouse,
  exportAllData,
  exportCsv,
  loadInterestFromDb,
  saveInterestToDb,
  loadRankingsFromDb,
  saveRankingsToDb,
  HOUSES_DIR,
} = require("../lib/houses-db");
const { resolveHouses, SAMPLE_DIR } = require("../lib/houses");
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
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await res.json().catch(() => ({}))
    : await res.text();
  return { res, data };
}

describe("houses DB import", () => {
  beforeEach(() => {
    resetHousesDb(path.join(os.tmpdir(), `houses-import-${process.pid}-${Date.now()}.db`));
  });

  after(() => {
    closeHousesDb();
  });

  it("imports houses, price history, interest, and rankings once", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "houses-seed-"));
    const dir = path.join(root, "houses");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "alpha-st.json"),
      JSON.stringify({
        address: "1 Alpha St",
        listPrice: 500000,
        status: "For sale",
        beds: 3,
        fireplaceCount: 2,
        heating: "Central",
        schoolIds: ["elem-a"],
        priceHistory: [
          { week: "2026-01-05", price: 510000 },
          { week: "2026-01-12", price: null },
        ],
      })
    );
    fs.writeFileSync(
      path.join(dir, "beta-st.json"),
      JSON.stringify({
        address: "2 Beta St",
        listPrice: 600000,
        status: "Sold",
        soldDate: "2026-10-01",
        priceHistory: [{ week: "2026-01-05", price: 600000 }],
      })
    );
    const interestPath = path.join(root, "interest.json");
    fs.writeFileSync(
      interestPath,
      JSON.stringify({
        notInterested: [{ slug: "beta-st", since: "2026-09-01" }],
        pendingReactivation: [],
      })
    );
    const rankingsPath = path.join(root, "rankings.json");
    fs.writeFileSync(rankingsPath, JSON.stringify(["beta-st", "alpha-st"]));

    const first = importHousesFromDisk({
      housesDir: dir,
      interestPath,
      rankingsPath,
      actor: "test",
    });
    assert.equal(first.imported, true);
    assert.equal(first.houseCount, 2);
    assert.equal(first.pricePoints, 3);
    assert.equal(first.rankings, 2);
    assert.equal(first.interest.notInterested, 1);

    const houses = listHouses();
    assert.equal(houses.length, 2);
    const alpha = houses.find((h) => h.slug === "alpha-st");
    assert.equal(alpha.address, "1 Alpha St");
    assert.equal(alpha.listPrice, 500000);
    assert.equal(alpha.fireplaceCount, 2);
    assert.equal(alpha.heating, "Central");
    assert.deepEqual(alpha.schoolIds, ["elem-a"]);
    assert.deepEqual(alpha.priceHistory, [
      { week: "2026-01-05", price: 510000 },
      { week: "2026-01-12", price: null },
    ]);

    assert.deepEqual(loadInterestFromDb().notInterested, [
      { slug: "beta-st", since: "2026-09-01" },
    ]);
    assert.deepEqual(loadRankingsFromDb().slugs, ["beta-st", "alpha-st"]);

    const second = maybeImportHousesFromDisk({ housesDir: dir });
    assert.equal(second.imported, false);
    assert.equal(second.reason, "already_has_houses");
    assert.equal(countHouses(), 2);
  });

  it("imports the real data/houses seed", () => {
    const result = importHousesFromDisk({
      housesDir: HOUSES_DIR,
      actor: "test",
    });
    assert.equal(result.imported, true);
    assert.ok(result.houseCount >= 10);
    const fromDb = listHouses();
    assert.equal(fromDb.length, result.houseCount);
    assert.ok(fromDb.every((h) => h.slug && h.address));
    const resolved = resolveHouses({ useSampleData: "", useDb: true });
    assert.equal(resolved.source, "houses");
    assert.equal(resolved.houses.length, fromDb.length);
  });
});

describe("houses DB writes + export", () => {
  beforeEach(() => {
    resetHousesDb(path.join(os.tmpdir(), `houses-write-${process.pid}-${Date.now()}.db`));
  });

  after(() => {
    closeHousesDb();
  });

  it("upserts with partial merge and keeps long-tail extras", () => {
    const created = upsertHouse(
      "maple",
      {
        address: "123 Maple",
        listPrice: 700000,
        fireplaceCount: 1,
        roofType: "Composition",
        priceHistory: [{ week: "2026-01-05", price: 710000 }],
      },
      { actor: "test" }
    );
    assert.equal(created.slug, "maple");
    assert.equal(created.listPrice, 700000);
    assert.equal(created.fireplaceCount, 1);
    assert.equal(created.roofType, "Composition");

    const merged = upsertHouse(
      "maple",
      { listPrice: 690000, beds: 4, patioPorch: "Covered" },
      { actor: "test" }
    );
    assert.equal(merged.listPrice, 690000);
    assert.equal(merged.beds, 4);
    assert.equal(merged.address, "123 Maple");
    assert.equal(merged.fireplaceCount, 1);
    assert.equal(merged.roofType, "Composition");
    assert.equal(merged.patioPorch, "Covered");
    assert.deepEqual(merged.priceHistory, [{ week: "2026-01-05", price: 710000 }]);
  });

  it("appends price points and patches status / interest", () => {
    upsertHouse("oak", { address: "1 Oak", status: "For sale", listPrice: 500000 });
    const withPrice = appendPricePoint("oak", { week: "2026-02-02", price: 495000 });
    assert.deepEqual(withPrice.priceHistory, [{ week: "2026-02-02", price: 495000 }]);

    const sold = patchHouseStatus("oak", {
      status: "Sold (2/1/2026)",
      soldDate: "2026-02-01",
      salePrice: 490000,
    });
    assert.match(sold.status, /Sold/);
    assert.equal(sold.soldDate, "2026-02-01");
    assert.equal(sold.salePrice, 490000);

    patchHouseStatus("oak", { interest: "notInterested", since: "2026-02-03" });
    assert.deepEqual(loadInterestFromDb().notInterested, [
      { slug: "oak", since: "2026-02-03" },
    ]);

    patchHouseStatus("oak", { interest: "active" });
    assert.deepEqual(loadInterestFromDb().notInterested, []);
  });

  it("soft-deletes houses from the active list", () => {
    upsertHouse("pine", { address: "9 Pine" });
    softDeleteHouse("pine");
    assert.equal(listHouses().length, 0);
    assert.equal(listHouses({ includeDeleted: true }).length, 1);
    assert.ok(getHouseRow("pine", { includeDeleted: true }).deletedAt);
  });

  it("exports JSON and CSV", () => {
    upsertHouse("cedar", {
      address: "5 Cedar",
      listPrice: 550000,
      status: "For sale",
      schoolIds: ["a", "b"],
      priceHistory: [
        { week: "2026-01-05", price: 560000 },
        { week: "2026-01-12", price: 550000 },
      ],
    });
    saveInterestToDb({
      notInterested: [{ slug: "cedar", since: "2026-01-20" }],
      pendingReactivation: [],
    });
    saveRankingsToDb(["cedar"]);

    const json = exportAllData();
    assert.equal(json.houses.length, 1);
    assert.equal(json.houses[0].slug, "cedar");
    assert.deepEqual(json.rankings, ["cedar"]);
    assert.equal(json.interest.notInterested[0].slug, "cedar");

    const csv = exportCsv();
    assert.match(csv, /^slug,address,status,/);
    assert.match(csv, /cedar,/);
    assert.match(csv, /notInterested/);
    assert.match(csv, /550000/);
  });

  it("validates price append input", () => {
    upsertHouse("elm", { address: "Elm" });
    assert.throws(() => appendPricePoint("elm", { price: 1 }), (err) => err.statusCode === 400);
    assert.throws(
      () => appendPricePoint("elm", { week: "not-a-date", price: 1 }),
      (err) => err.code === "INVALID_WEEK"
    );
    assert.throws(
      () => appendPricePoint("missing", { week: "2026-01-05", price: 1 }),
      (err) => err.statusCode === 404
    );
  });
});

describe("house data API", () => {
  let server;
  let port;
  const token = `test-token-${process.pid}`;

  before(async () => {
    resetHousesDb(path.join(os.tmpdir(), `houses-api-${process.pid}.db`));
    process.env.HOUSE_DATA_API_TOKEN = token;
    process.env.USE_SAMPLE_DATA = "false";
    upsertHouse("api-house", {
      address: "100 API St",
      listPrice: 400000,
      status: "For sale",
      beds: 3,
      priceHistory: [{ week: "2026-01-05", price: 400000 }],
    });
    server = http.createServer(app);
    port = await listen(server);
  });

  after(() => {
    server.close();
    delete process.env.HOUSE_DATA_API_TOKEN;
    closeHousesDb();
  });

  it("rejects writes when unauthorized", async () => {
    const { res, data } = await jsonRequest(port, "/api/data/houses/api-house", {
      method: "PUT",
      body: JSON.stringify({ listPrice: 1 }),
    });
    assert.equal(res.status, 401);
    assert.equal(data.code, "UNAUTHORIZED");
  });

  it("rejects writes when token env is unset", async () => {
    const previous = process.env.HOUSE_DATA_API_TOKEN;
    delete process.env.HOUSE_DATA_API_TOKEN;
    const { res, data } = await jsonRequest(port, "/api/data/houses/api-house", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ listPrice: 1 }),
    });
    process.env.HOUSE_DATA_API_TOKEN = previous;
    assert.equal(res.status, 503);
    assert.equal(data.code, "TOKEN_UNSET");
  });

  it("upserts, appends price, patches status, and soft-deletes with auth", async () => {
    const auth = { Authorization: `Bearer ${token}` };

    const put = await jsonRequest(port, "/api/data/houses/api-house", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ listPrice: 410000, zestimate: 415000 }),
    });
    assert.equal(put.res.status, 200);
    assert.equal(put.data.house.listPrice, 410000);
    assert.equal(put.data.house.zestimate, 415000);

    const price = await jsonRequest(port, "/api/data/houses/api-house/price", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ week: "2026-01-12", price: 405000 }),
    });
    assert.equal(price.res.status, 200);
    assert.ok(price.data.house.priceHistory.some((row) => row.week === "2026-01-12"));

    const status = await jsonRequest(port, "/api/data/houses/api-house/status", {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ status: "Pending", interest: "notInterested" }),
    });
    assert.equal(status.res.status, 200);
    assert.equal(status.data.house.status, "Pending");

    const houses = await jsonRequest(port, "/api/houses");
    assert.equal(houses.res.status, 200);
    const found = houses.data.houses.find((h) => h.slug === "api-house");
    assert.ok(found);
    assert.equal(found.interestStatus, "notInterested");

    const del = await jsonRequest(port, "/api/data/houses/api-house", {
      method: "DELETE",
      headers: auth,
    });
    assert.equal(del.res.status, 200);
    assert.ok(del.data.house.deletedAt);

    const after = await jsonRequest(port, "/api/houses");
    assert.equal(
      after.data.houses.some((h) => h.slug === "api-house"),
      false
    );
  });

  it("exports JSON and CSV without auth", async () => {
    // Re-create a live house for export after soft-delete above.
    process.env.HOUSE_DATA_API_TOKEN = token;
    await jsonRequest(port, "/api/data/houses/export-house", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ address: "Export St", listPrice: 123456 }),
    });

    const json = await jsonRequest(port, "/api/data/export");
    assert.equal(json.res.status, 200);
    assert.ok(Array.isArray(json.data.houses));
    assert.ok(json.data.houses.some((h) => h.slug === "export-house"));

    const csv = await jsonRequest(port, "/api/data/export?format=csv");
    assert.equal(csv.res.status, 200);
    assert.match(String(csv.data), /slug,address/);
    assert.match(String(csv.data), /export-house/);
  });

  it("validates write payloads", async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const badPrice = await jsonRequest(port, "/api/data/houses/export-house/price", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ week: "2026-01-05" }),
    });
    assert.equal(badPrice.res.status, 400);

    const badStatus = await jsonRequest(port, "/api/data/houses/export-house/status", {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({}),
    });
    assert.equal(badStatus.res.status, 400);
  });
});

describe("sample data still works", () => {
  it("resolveHouses sample mode ignores DB", () => {
    resetHousesDb(path.join(os.tmpdir(), `houses-sample-${process.pid}.db`));
    upsertHouse("should-not-appear", { address: "Hidden" });
    const result = resolveHouses({ sampleDir: SAMPLE_DIR, useSampleData: "true" });
    assert.equal(result.source, "sample");
    assert.equal(result.houses.length, 5);
    assert.equal(
      result.houses.some((h) => h.slug === "should-not-appear"),
      false
    );
    closeHousesDb();
  });
});
