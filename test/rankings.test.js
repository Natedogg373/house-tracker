const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadHousesFromDir, HOUSES_DIR } = require("../lib/houses");
const {
  applyRankings,
  loadRankings,
  moveBySteps,
  moveToRank,
  normalizeSlugs,
  saveRankings,
} = require("../lib/rankings");

describe("normalizeSlugs", () => {
  it("keeps unique trimmed strings and drops the rest", () => {
    assert.deepEqual(
      normalizeSlugs(["  a  ", "b", "a", "", 3, null, "b"]),
      ["a", "b"]
    );
    assert.deepEqual(normalizeSlugs("nope"), []);
  });
});

describe("applyRankings", () => {
  const houses = [
    { slug: "alpha", address: "Alpha St" },
    { slug: "beta", address: "Beta St" },
    { slug: "gamma", address: "Gamma St" },
  ];

  it("follows saved order, drops unknown slugs, and appends the rest", () => {
    const ordered = applyRankings(houses, ["gamma", "missing", "alpha", "gamma"]);
    assert.deepEqual(
      ordered.map((h) => h.slug),
      ["gamma", "alpha", "beta"]
    );
  });

  it("returns houses as-is when there is no saved order", () => {
    assert.deepEqual(
      applyRankings(houses, []).map((h) => h.slug),
      ["alpha", "beta", "gamma"]
    );
  });
});

describe("moveToRank", () => {
  it("moves an item to a 1-based rank and shifts the others", () => {
    assert.deepEqual(moveToRank(["a", "b", "c"], 2, 1), ["c", "a", "b"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 0, 2), ["b", "a", "c"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 0, 3), ["b", "c", "a"]);
  });

  it("moves #2 to #7 in a list of 9 and shifts 3..7 up one", () => {
    const list = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    assert.deepEqual(moveToRank(list, 1, 7), [
      "1",
      "3",
      "4",
      "5",
      "6",
      "7",
      "2",
      "8",
      "9",
    ]);
  });

  it("moves a lower item up and shifts the intervening items down", () => {
    const list = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    assert.deepEqual(moveToRank(list, 6, 2), [
      "1",
      "7",
      "2",
      "3",
      "4",
      "5",
      "6",
      "8",
      "9",
    ]);
  });

  it("clamps out-of-range ranks to 1..N", () => {
    assert.deepEqual(moveToRank(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 0, 99), ["b", "c", "a"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 1, -3), ["b", "a", "c"]);
  });

  it("leaves the list unchanged for empty, whitespace, or non-numeric input", () => {
    assert.deepEqual(moveToRank(["a", "b", "c"], 1, "nope"), ["a", "b", "c"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 1, ""), ["a", "b", "c"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 1, "   "), ["a", "b", "c"]);
    assert.deepEqual(moveToRank(["a", "b", "c"], 1, null), ["a", "b", "c"]);
  });
});

describe("moveBySteps", () => {
  it("moves an item up or down by one and clamps at the ends", () => {
    assert.deepEqual(moveBySteps(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
    assert.deepEqual(moveBySteps(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
    assert.deepEqual(moveBySteps(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
    assert.deepEqual(moveBySteps(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
  });

  it("supports multi-step moves and ignores a zero/invalid step", () => {
    assert.deepEqual(moveBySteps(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
    assert.deepEqual(moveBySteps(["a", "b", "c"], 1, 0), ["a", "b", "c"]);
    assert.deepEqual(moveBySteps(["a", "b", "c"], 1, "nope"), ["a", "b", "c"]);
  });
});

describe("committed data/rankings.json", () => {
  it("lists each live house slug once and nothing else", () => {
    const houses = loadHousesFromDir(HOUSES_DIR);
    const saved = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "data", "rankings.json"), "utf8")
    );
    const houseSlugs = houses.map((h) => h.slug).sort();
    assert.ok(Array.isArray(saved));
    assert.deepEqual([...saved].sort(), houseSlugs);
    assert.equal(new Set(saved).size, saved.length);
  });
});

describe("loadRankings / saveRankings", () => {
  it("round-trips a slug array and treats a missing file as default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rankings-"));
    const filePath = path.join(dir, "rankings.json");
    assert.deepEqual(loadRankings(filePath), { slugs: [], source: "default" });
    saveRankings(["zeta", "alpha", "alpha"], filePath);
    assert.deepEqual(loadRankings(filePath), {
      slugs: ["zeta", "alpha"],
      source: "file",
    });
  });
});
