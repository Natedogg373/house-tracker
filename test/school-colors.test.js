const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SCHOOLS_PATH, SAMPLE_SCHOOLS_PATH, loadSchoolsFromFile } = require("../lib/schools");

async function loadColors() {
  return import("../public/js/school-colors.js");
}

function assertNearbyDoNotShare(schools, colors, distanceKm, minKm) {
  for (let i = 0; i < schools.length; i += 1) {
    for (let j = i + 1; j < schools.length; j += 1) {
      const a = schools[i];
      const b = schools[j];
      const km = distanceKm(a, b);
      if (km <= minKm) {
        assert.notEqual(
          colors.get(a.id),
          colors.get(b.id),
          `${a.id} and ${b.id} are ${km.toFixed(2)} km apart and share ${colors.get(a.id)}`
        );
      }
    }
  }
}

describe("assignSchoolColors", async () => {
  const {
    SCHOOL_PALETTE,
    MIN_SCHOOL_COLOR_DISTANCE_KM,
    NEUTRAL_HOUSE_COLOR,
    assignSchoolColors,
    colorForHouseAtLevel,
    colorsToObject,
    distanceKm,
    schoolAtLevel,
    schoolsAtLevel,
  } = await loadColors();

  it("uses a palette of 8–10 distinct colors", () => {
    assert.ok(SCHOOL_PALETTE.length >= 8);
    assert.ok(SCHOOL_PALETTE.length <= 10);
    assert.equal(new Set(SCHOOL_PALETTE).size, SCHOOL_PALETTE.length);
  });

  it("is deterministic and ignores input order", () => {
    const schools = [
      { id: "zeta", lat: 32.9, lng: -96.74 },
      { id: "alpha", lat: 32.901, lng: -96.741 },
      { id: "mu", lat: 33.05, lng: -96.5 },
    ];
    const first = colorsToObject(assignSchoolColors(schools));
    const second = colorsToObject(assignSchoolColors([...schools].reverse()));
    const third = colorsToObject(assignSchoolColors(schools));
    assert.deepEqual(second, first);
    assert.deepEqual(third, first);
  });

  it("never shares a color between schools within ~3 km", () => {
    const schools = [
      { id: "near-a", lat: 32.9, lng: -96.74 },
      { id: "near-b", lat: 32.905, lng: -96.745 },
      { id: "near-c", lat: 32.91, lng: -96.735 },
      { id: "far-north", lat: 33.1, lng: -96.74 },
    ];
    assert.ok(distanceKm(schools[0], schools[1]) <= MIN_SCHOOL_COLOR_DISTANCE_KM);
    assert.ok(distanceKm(schools[0], schools[2]) <= MIN_SCHOOL_COLOR_DISTANCE_KM);
    assert.ok(distanceKm(schools[0], schools[3]) > MIN_SCHOOL_COLOR_DISTANCE_KM);

    const colors = assignSchoolColors(schools);
    assertNearbyDoNotShare(schools, colors, distanceKm, MIN_SCHOOL_COLOR_DISTANCE_KM);
  });

  it("reuses a color only when schools are far apart", () => {
    const palette = ["#111111", "#222222"];
    const schools = [
      { id: "cluster-a", lat: 32.9, lng: -96.74 },
      { id: "cluster-b", lat: 32.902, lng: -96.742 },
      { id: "isolated", lat: 33.2, lng: -96.2 },
    ];
    const colors = assignSchoolColors(schools, { palette });
    assert.notEqual(colors.get("cluster-a"), colors.get("cluster-b"));
    assert.equal(new Set(colors.values()).size, 2);
    assert.ok(distanceKm(schools[0], schools[2]) > MIN_SCHOOL_COLOR_DISTANCE_KM);
    assert.ok(distanceKm(schools[1], schools[2]) > MIN_SCHOOL_COLOR_DISTANCE_KM);
  });

  it("colors each committed school so neighbors within 3 km never match, per level", () => {
    const loaded = loadSchoolsFromFile(DEFAULT_SCHOOLS_PATH);
    assert.equal(loaded.source, "file");
    assert.ok(loaded.schools.length > 0);

    for (const level of ["elementary", "middle", "high"]) {
      const schools = schoolsAtLevel(loaded.schools, level);
      assert.ok(schools.length > 0, `expected ${level} schools in live catalog`);
      const colors = assignSchoolColors(schools);
      assert.equal(colors.size, schools.length);
      assertNearbyDoNotShare(schools, colors, distanceKm, MIN_SCHOOL_COLOR_DISTANCE_KM);
      assert.deepEqual(colorsToObject(assignSchoolColors([...schools].reverse())), colorsToObject(colors));
    }
  });

  it("keeps sample schools distinct when they sit more than 3 km apart", () => {
    const loaded = loadSchoolsFromFile(SAMPLE_SCHOOLS_PATH);
    const elementary = schoolsAtLevel(loaded.schools, "elementary");
    const colors = assignSchoolColors(elementary);
    assertNearbyDoNotShare(elementary, colors, distanceKm, MIN_SCHOOL_COLOR_DISTANCE_KM);
  });

  it("uses the matching school color for a house and grey when that level is missing", () => {
    const schools = [
      { id: "elem-1", level: "elementary", lat: 32.9, lng: -96.74, name: "Elem" },
      { id: "high-1", level: "high", lat: 32.95, lng: -96.7, name: "High" },
    ];
    const colors = assignSchoolColors(schoolsAtLevel(schools, "elementary"));
    const house = { schoolIds: ["elem-1", "high-1"] };
    assert.equal(schoolAtLevel(house, schools, "elementary").id, "elem-1");
    assert.equal(colorForHouseAtLevel(house, colors, schools, "elementary"), colors.get("elem-1"));
    assert.equal(colorForHouseAtLevel(house, colors, schools, "middle"), NEUTRAL_HOUSE_COLOR);
    assert.equal(colorForHouseAtLevel({ schoolIds: [] }, colors, schools, "elementary"), NEUTRAL_HOUSE_COLOR);
  });
});
