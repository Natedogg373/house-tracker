const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  pointInGeofence,
  geofencesContaining,
  normalizeGeofences,
  saveGeofences,
  loadGeofences,
  haversineMeters,
  insideNamesForHouse,
} = require("../lib/geofences");

const rect = {
  id: "demo-rect",
  name: "Demo box",
  type: "rect",
  geometry: { south: 32.7, west: -96.9, north: 32.9, east: -96.7 },
};

const circle = {
  id: "demo-circle",
  name: "Demo circle",
  type: "circle",
  geometry: { lat: 32.8, lng: -96.8, radiusMeters: 1000 },
};

const polygon = {
  id: "demo-poly",
  name: "Demo triangle",
  type: "polygon",
  geometry: {
    latlngs: [
      [32.7, -96.9],
      [32.9, -96.9],
      [32.8, -96.7],
    ],
  },
};

describe("geofence containment", () => {
  it("detects points inside and outside a rectangle", () => {
    assert.equal(pointInGeofence(32.8, -96.8, rect), true);
    assert.equal(pointInGeofence(32.8, -96.8, { ...rect, type: "rectangle" }), true);
    assert.equal(pointInGeofence(33.1, -96.8, rect), false);
    assert.equal(pointInGeofence(32.8, -96.5, rect), false);
  });

  it("uses haversine meters for circles", () => {
    assert.equal(pointInGeofence(32.8, -96.8, circle), true);
    assert.ok(haversineMeters({ lat: 32.8, lng: -96.8 }, { lat: 32.8, lng: -96.81 }) < 1000);
    assert.equal(pointInGeofence(32.8, -96.81, circle), true);
    assert.equal(pointInGeofence(32.8, -96.82, circle), false);
  });

  it("uses even-odd ray casting for polygons", () => {
    assert.equal(pointInGeofence(32.8, -96.85, polygon), true);
    assert.equal(pointInGeofence(32.6, -96.8, polygon), false);
    assert.equal(pointInGeofence(32.8, -96.6, polygon), false);
  });

  it("returns the geofences that contain a point", () => {
    const hits = geofencesContaining(32.8, -96.8, [rect, circle, polygon]);
    assert.deepEqual(
      hits.map((fence) => fence.id).sort(),
      ["demo-circle", "demo-poly", "demo-rect"]
    );
    assert.deepEqual(geofencesContaining(40, -90, [rect, circle, polygon]), []);
  });

  it("names areas a house is inside from lat/lng", () => {
    const house = { lat: 32.8, lng: -96.8 };
    assert.deepEqual(insideNamesForHouse(house, [rect, circle]).sort(), ["Demo box", "Demo circle"]);
    assert.deepEqual(insideNamesForHouse({ address: "no coords" }, [rect]), []);
  });

  it("drops invalid fences and round-trips a valid file", () => {
    assert.deepEqual(
      normalizeGeofences([{ id: "bad", type: "rect", geometry: { south: 1 } }, rect]).map((f) => f.id),
      ["demo-rect"]
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "geofences-"));
    const filePath = path.join(dir, "geofences.json");
    const saved = saveGeofences([circle], filePath);
    assert.equal(saved[0].type, "circle");
    assert.deepEqual(loadGeofences(filePath).geofences, saved);
  });
});
