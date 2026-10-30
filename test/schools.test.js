const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  DEFAULT_SCHOOLS_PATH,
  SAMPLE_SCHOOLS_PATH,
  loadSchoolsFromFile,
  normalizeSchool,
  resolveSchools,
  schoolsListFromParsed,
} = require("../lib/schools");
const { HOUSES_DIR, loadHousesFromDir, schoolIdsOf } = require("../lib/houses");

const WRAPPED_FIXTURE = path.join(__dirname, "fixtures", "schools-wrapped.json");

describe("schoolsListFromParsed", () => {
  it("accepts a bare array and a { schools } object", () => {
    assert.deepEqual(schoolsListFromParsed([{ id: "a" }]), [{ id: "a" }]);
    assert.deepEqual(schoolsListFromParsed({ schools: [{ id: "b" }], extra: true }), [{ id: "b" }]);
    assert.equal(schoolsListFromParsed({}), null);
    assert.equal(schoolsListFromParsed(null), null);
  });
});

describe("normalizeSchool", () => {
  it("reads rating or greatSchoolsRating and keeps address and ratingSource", () => {
    const fromRating = normalizeSchool({
      id: "rated",
      name: "Rated School",
      level: "elementary",
      lat: 32.8,
      lng: -96.7,
      rating: 9,
      district: "Demo ISD",
    });
    assert.equal(fromRating.rating, 9);
    assert.equal(fromRating.address, null);
    assert.equal(fromRating.ratingSource, null);

    const fromGreatSchools = normalizeSchool({
      id: "gs-rated",
      name: "GreatSchools School",
      level: "high",
      district: "Dallas ISD",
      address: "2101 Millmar Dr, Dallas, TX 75228",
      lat: 32.82,
      lng: -96.68,
      greatSchoolsRating: 4,
      ratingSource: "https://www.greatschools.org/texas/dallas/1769-Bryan-Adams-High-School/",
    });
    assert.equal(fromGreatSchools.rating, 4);
    assert.equal(fromGreatSchools.address, "2101 Millmar Dr, Dallas, TX 75228");
    assert.equal(
      fromGreatSchools.ratingSource,
      "https://www.greatschools.org/texas/dallas/1769-Bryan-Adams-High-School/"
    );

    const prefersRating = normalizeSchool({
      id: "both",
      name: "Both Fields",
      lat: 1,
      lng: 2,
      rating: 7,
      greatSchoolsRating: 2,
    });
    assert.equal(prefersRating.rating, 7);
  });
});

describe("loadSchoolsFromFile", () => {
  it("loads a wrapped catalog in the bot's committed shape", () => {
    const loaded = loadSchoolsFromFile(WRAPPED_FIXTURE);
    assert.equal(loaded.source, "file");
    assert.equal(loaded.schools.length, 3);
    const elem = loaded.schools.find((school) => school.id === "fixture-hexter-elementary");
    assert.equal(elem.name, "Fixture Hexter Elementary");
    assert.equal(elem.level, "elementary");
    assert.equal(elem.district, "Dallas ISD");
    assert.equal(elem.rating, 8);
    assert.equal(elem.address, "9720 Waterview Rd, Dallas, TX 75218");
    assert.match(elem.ratingSource, /^https:\/\/www\.greatschools\.org\//);
    const unrated = loaded.schools.find((school) => school.id === "fixture-adams-high");
    assert.equal(unrated.rating, null);
    assert.ok(unrated.ratingSource);
  });

  it("still loads the sample bare array", () => {
    const loaded = loadSchoolsFromFile(SAMPLE_SCHOOLS_PATH);
    assert.equal(loaded.source, "file");
    assert.equal(loaded.schools.length, 4);
    assert.equal(loaded.schools[0].rating, 8);
    assert.equal(loaded.schools[0].address, null);
    assert.equal(loaded.schools[0].ratingSource, null);
  });

  it("treats a missing or invalid file as empty", () => {
    const missing = loadSchoolsFromFile(path.join(os.tmpdir(), "no-such-schools.json"));
    assert.equal(missing.source, "none");
    assert.deepEqual(missing.schools, []);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bad-schools-"));
    const filePath = path.join(dir, "schools.json");
    fs.writeFileSync(filePath, JSON.stringify({ catalog: [] }));
    const invalid = loadSchoolsFromFile(filePath);
    assert.equal(invalid.source, "none");
    assert.deepEqual(invalid.schools, []);
  });
});

describe("committed schools catalog", () => {
  it("loads data/schools.json and resolves every house schoolIds entry", () => {
    const loaded = loadSchoolsFromFile(DEFAULT_SCHOOLS_PATH);
    assert.equal(loaded.source, "file");
    assert.ok(loaded.schools.length > 0);
    const byId = new Map(loaded.schools.map((school) => [school.id, school]));
    const houses = loadHousesFromDir(HOUSES_DIR);
    assert.ok(houses.length > 0);

    const missing = [];
    for (const house of houses) {
      const ids = schoolIdsOf(house);
      assert.ok(ids.length > 0, `${house.slug} has no schoolIds`);
      for (const id of ids) {
        if (!byId.has(id)) missing.push(`${house.slug}:${id}`);
      }
    }
    assert.deepEqual(missing, []);

    for (const school of loaded.schools) {
      assert.ok(school.address);
      assert.ok(school.ratingSource);
      assert.equal(typeof school.rating, "number");
    }
  });
});

describe("resolveSchools", () => {
  it("loads sample schools in sample mode and the live file otherwise", () => {
    const sample = resolveSchools({ source: "sample" });
    assert.equal(sample.source, "sample");
    assert.equal(sample.schools.length, 4);

    const live = resolveSchools({ source: "houses", schoolsPath: DEFAULT_SCHOOLS_PATH });
    assert.equal(live.source, "file");
    assert.equal(live.schools.length, 14);
  });
});
