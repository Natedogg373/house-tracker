const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadHousesFromDir, resolveHouses, isHouseFilename, SAMPLE_DIR, coordsFromHouse } = require("../lib/houses");
const { resolveSchools } = require("../lib/schools");

describe("isHouseFilename", () => {
  it("skips index.json regardless of case", () => {
    assert.equal(isHouseFilename("index.json"), false);
    assert.equal(isHouseFilename("INDEX.JSON"), false);
    assert.equal(isHouseFilename("schools.json"), false);
    assert.equal(isHouseFilename("9223-seagrove-dr-75243.json"), true);
  });
});

describe("loadHousesFromDir", () => {
  it("reads sample houses and skips nothing extra", () => {
    const houses = loadHousesFromDir(SAMPLE_DIR);
    assert.equal(houses.length, 5);
    assert.ok(houses.every((h) => h.slug && h.address));
    assert.equal(houses.filter((h) => /\bsold\b/i.test(h.status)).length, 2);
  });

  it("skips index.json and keeps house files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "houses-"));
    fs.writeFileSync(
      path.join(dir, "index.json"),
      JSON.stringify([{ slug: "not-a-house", address: "Index" }])
    );
    fs.writeFileSync(
      path.join(dir, "100-test-st.json"),
      JSON.stringify({ address: "100 Test St", listPrice: 500000, photoUrl: null })
    );
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");
    const houses = loadHousesFromDir(dir);
    assert.equal(houses.length, 1);
    assert.equal(houses[0].slug, "100-test-st");
    assert.equal(houses[0].address, "100 Test St");
    assert.equal(houses[0].photoUrl, null);
  });
});

describe("resolveHouses", () => {
  it("falls back to sample data when houses dir is empty", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "empty-houses-"));
    const result = resolveHouses({ housesDir: empty, sampleDir: SAMPLE_DIR, useSampleData: "" });
    assert.equal(result.source, "sample");
    assert.equal(result.houses.length, 5);
  });

  it("prefers lat/lng on the house over a geocode peek", () => {
    const coords = coordsFromHouse({ lat: 32.1, lng: -96.2 }, { lat: 1, lon: 2 });
    assert.deepEqual(coords, { lat: 32.1, lon: -96.2, lng: -96.2 });
    assert.equal(coordsFromHouse({ address: "x" }, undefined), undefined);
    assert.equal(coordsFromHouse({ address: "x" }, null), null);
  });

  it("uses live houses when present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-houses-"));
    fs.writeFileSync(path.join(dir, "index.json"), "[]");
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ address: "A St", listPrice: 1 }));
    const result = resolveHouses({ housesDir: dir, sampleDir: SAMPLE_DIR, useSampleData: "" });
    assert.equal(result.source, "houses");
    assert.equal(result.houses.length, 1);
  });
});

describe("resolveSchools", () => {
  it("loads sample schools in sample mode and treats a missing live file as empty", () => {
    const sample = resolveSchools({ source: "sample" });
    assert.equal(sample.source, "sample");
    assert.equal(sample.schools.length, 4);
    const missing = resolveSchools({
      source: "houses",
      schoolsPath: path.join(os.tmpdir(), "no-such-schools.json"),
    });
    assert.equal(missing.source, "none");
    assert.deepEqual(missing.schools, []);
  });
});
