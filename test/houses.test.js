const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadHousesFromDir, resolveHouses, isHouseFilename, SAMPLE_DIR } = require("../lib/houses");

describe("isHouseFilename", () => {
  it("skips index.json regardless of case", () => {
    assert.equal(isHouseFilename("index.json"), false);
    assert.equal(isHouseFilename("INDEX.JSON"), false);
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

  it("uses live houses when present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-houses-"));
    fs.writeFileSync(path.join(dir, "index.json"), "[]");
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify({ address: "A St", listPrice: 1 }));
    const result = resolveHouses({ housesDir: dir, sampleDir: SAMPLE_DIR, useSampleData: "" });
    assert.equal(result.source, "houses");
    assert.equal(result.houses.length, 1);
  });
});
