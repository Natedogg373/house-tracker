const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SCHOOLS_PATH, SAMPLE_SCHOOLS_PATH, loadSchoolsFromFile } = require("../lib/schools");

async function loadColors() {
  return import("../public/js/school-colors.js");
}

describe("school rating colors", async () => {
  const {
    NEUTRAL_HOUSE_COLOR,
    RATING_COLORS,
    assignSchoolColors,
    colorForHouseAtLevel,
    colorsToObject,
    housesInSchoolZone,
    isHouseInSchoolZone,
    schoolAtLevel,
    schoolRatingBand,
    schoolRatingClass,
    schoolRatingColor,
    schoolsAtLevel,
  } = await loadColors();

  it("maps ratings to high/mid/low bands at 7 and 4 boundaries", () => {
    assert.equal(schoolRatingBand(10), "high");
    assert.equal(schoolRatingBand(7), "high");
    assert.equal(schoolRatingBand(6.9), "mid");
    assert.equal(schoolRatingBand(6), "mid");
    assert.equal(schoolRatingBand(4), "mid");
    assert.equal(schoolRatingBand(3.9), "low");
    assert.equal(schoolRatingBand(3), "low");
    assert.equal(schoolRatingBand(1), "low");
    assert.equal(schoolRatingBand(0), "low");
    assert.equal(schoolRatingBand(null), "unrated");
    assert.equal(schoolRatingBand(undefined), "unrated");
    assert.equal(schoolRatingBand(""), "unrated");
    assert.equal(schoolRatingBand("n/a"), "unrated");
  });

  it("uses green / yellow / red hex colors for those bands", () => {
    assert.equal(schoolRatingColor(7), RATING_COLORS.high);
    assert.equal(schoolRatingColor(10), RATING_COLORS.high);
    assert.equal(schoolRatingColor(4), RATING_COLORS.mid);
    assert.equal(schoolRatingColor(6), RATING_COLORS.mid);
    assert.equal(schoolRatingColor(3), RATING_COLORS.low);
    assert.equal(schoolRatingColor(1), RATING_COLORS.low);
    assert.equal(schoolRatingColor(null), RATING_COLORS.unrated);
    assert.equal(schoolRatingColor(null), NEUTRAL_HOUSE_COLOR);
    assert.equal(schoolRatingClass(7), "high");
    assert.equal(schoolRatingClass(4), "mid");
    assert.equal(schoolRatingClass(3), "low");
    assert.equal(schoolRatingClass(null), "unrated");
  });

  it("assignSchoolColors paints each school by its rating", () => {
    const schools = [
      { id: "a", lat: 32.9, lng: -96.74, rating: 9 },
      { id: "b", lat: 32.91, lng: -96.75, rating: 5 },
      { id: "c", lat: 32.92, lng: -96.76, rating: 2 },
      { id: "d", lat: 32.93, lng: -96.77, rating: null },
    ];
    const colors = assignSchoolColors(schools);
    assert.equal(colors.get("a"), RATING_COLORS.high);
    assert.equal(colors.get("b"), RATING_COLORS.mid);
    assert.equal(colors.get("c"), RATING_COLORS.low);
    assert.equal(colors.get("d"), RATING_COLORS.unrated);
    assert.deepEqual(colorsToObject(assignSchoolColors([...schools].reverse())), colorsToObject(colors));
  });

  it("colors houses from their school at the selected level", () => {
    const schools = [
      { id: "elem-1", level: "elementary", lat: 32.9, lng: -96.74, name: "Elem", rating: 8 },
      { id: "mid-1", level: "middle", lat: 32.91, lng: -96.74, name: "Mid", rating: 3 },
      { id: "high-1", level: "high", lat: 32.95, lng: -96.7, name: "High", rating: 5 },
    ];
    const colors = assignSchoolColors(schoolsAtLevel(schools, "elementary"));
    const house = { schoolIds: ["elem-1", "mid-1", "high-1"] };
    assert.equal(schoolAtLevel(house, schools, "elementary").id, "elem-1");
    assert.equal(colorForHouseAtLevel(house, colors, schools, "elementary"), RATING_COLORS.high);
    assert.equal(colorForHouseAtLevel(house, colors, schools, "middle"), RATING_COLORS.low);
    assert.equal(colorForHouseAtLevel(house, colors, schools, "high"), RATING_COLORS.mid);
    assert.equal(colorForHouseAtLevel({ schoolIds: [] }, colors, schools, "elementary"), NEUTRAL_HOUSE_COLOR);
  });

  it("filters houses zoned to a selected school at the current level", () => {
    const schools = [
      { id: "elem-a", level: "elementary", lat: 32.9, lng: -96.74, name: "A", rating: 8 },
      { id: "elem-b", level: "elementary", lat: 32.91, lng: -96.75, name: "B", rating: 4 },
      { id: "mid-a", level: "middle", lat: 32.92, lng: -96.76, name: "Mid", rating: 6 },
    ];
    const houses = [
      { slug: "h1", schoolIds: ["elem-a", "mid-a"] },
      { slug: "h2", schoolIds: ["elem-b", "mid-a"] },
      { slug: "h3", schoolIds: ["mid-a"] },
      { slug: "h4", schoolIds: ["elem-a"] },
    ];

    assert.equal(isHouseInSchoolZone(houses[0], schools, "elem-a", "elementary"), true);
    assert.equal(isHouseInSchoolZone(houses[1], schools, "elem-a", "elementary"), false);
    assert.equal(isHouseInSchoolZone(houses[2], schools, "elem-a", "elementary"), false);
    assert.equal(isHouseInSchoolZone(houses[0], schools, null, "elementary"), true);

    assert.deepEqual(
      housesInSchoolZone(houses, schools, "elem-a", "elementary").map((h) => h.slug),
      ["h1", "h4"]
    );
    assert.deepEqual(
      housesInSchoolZone(houses, schools, "elem-b", "elementary").map((h) => h.slug),
      ["h2"]
    );
    assert.deepEqual(
      housesInSchoolZone(houses, schools, "mid-a", "middle").map((h) => h.slug),
      ["h1", "h2", "h3"]
    );
    assert.deepEqual(
      housesInSchoolZone(houses, schools, "mid-a", "elementary").map((h) => h.slug),
      []
    );
  });

  it("colors live catalog schools by rating at each level", () => {
    const loaded = loadSchoolsFromFile(DEFAULT_SCHOOLS_PATH);
    assert.equal(loaded.source, "file");
    assert.ok(loaded.schools.length > 0);

    for (const level of ["elementary", "middle", "high"]) {
      const schools = schoolsAtLevel(loaded.schools, level);
      assert.ok(schools.length > 0, `expected ${level} schools in live catalog`);
      const colors = assignSchoolColors(schools);
      assert.equal(colors.size, schools.length);
      for (const school of schools) {
        assert.equal(colors.get(school.id), schoolRatingColor(school.rating));
      }
    }
  });

  it("colors sample schools by rating including unrated", () => {
    const loaded = loadSchoolsFromFile(SAMPLE_SCHOOLS_PATH);
    const elementary = schoolsAtLevel(loaded.schools, "elementary");
    const colors = assignSchoolColors(elementary);
    const unrated = elementary.find((school) => school.rating == null);
    assert.ok(unrated, "sample set includes an unrated elementary");
    assert.equal(colors.get(unrated.id), NEUTRAL_HOUSE_COLOR);
  });
});
