const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_GEOFENCES_PATH = path.join(__dirname, "..", "data", "geofences.json");
const EARTH_RADIUS_M = 6371000;

function getGeofencesPath(env = process.env) {
  if (env.GEOFENCES_PATH && String(env.GEOFENCES_PATH).trim()) {
    return path.resolve(String(env.GEOFENCES_PATH).trim());
  }
  return DEFAULT_GEOFENCES_PATH;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `gf-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function normalizeRectGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  let south;
  let west;
  let north;
  let east;
  if (geometry.south != null || geometry.west != null || geometry.north != null || geometry.east != null) {
    south = toFiniteNumber(geometry.south);
    west = toFiniteNumber(geometry.west);
    north = toFiniteNumber(geometry.north);
    east = toFiniteNumber(geometry.east);
  } else if (Array.isArray(geometry.bounds) && geometry.bounds.length >= 2) {
    const a = geometry.bounds[0];
    const b = geometry.bounds[1];
    const latA = toFiniteNumber(Array.isArray(a) ? a[0] : a?.lat);
    const lngA = toFiniteNumber(Array.isArray(a) ? a[1] : a?.lng ?? a?.lon);
    const latB = toFiniteNumber(Array.isArray(b) ? b[0] : b?.lat);
    const lngB = toFiniteNumber(Array.isArray(b) ? b[1] : b?.lng ?? b?.lon);
    if ([latA, lngA, latB, lngB].some((n) => n == null)) return null;
    south = Math.min(latA, latB);
    north = Math.max(latA, latB);
    west = Math.min(lngA, lngB);
    east = Math.max(lngA, lngB);
  }
  if ([south, west, north, east].some((n) => n == null)) return null;
  return { south, west, north, east };
}

function normalizeCircleGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  const center = geometry.center && typeof geometry.center === "object" ? geometry.center : geometry;
  const lat = toFiniteNumber(geometry.lat ?? center.lat);
  const lng = toFiniteNumber(geometry.lng ?? geometry.lon ?? center.lng ?? center.lon);
  const radiusMeters = toFiniteNumber(geometry.radiusMeters ?? geometry.radius);
  if (lat == null || lng == null || radiusMeters == null || radiusMeters < 0) return null;
  return { lat, lng, radiusMeters };
}

function ringFrom(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return Array.isArray(value[0]?.[0]) || (value[0] && typeof value[0] === "object" && Array.isArray(value[0].latlngs))
    ? value[0]
    : value;
}

function normalizePolygonGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  const raw = geometry.latlngs || geometry.coordinates || geometry.points;
  const ring = ringFrom(raw);
  if (!ring || ring.length < 3) return null;
  const latlngs = [];
  for (const point of ring) {
    const lat = toFiniteNumber(Array.isArray(point) ? point[0] : point?.lat);
    const lng = toFiniteNumber(Array.isArray(point) ? point[1] : point?.lng ?? point?.lon);
    if (lat == null || lng == null) return null;
    latlngs.push([lat, lng]);
  }
  if (latlngs.length < 3) return null;
  return { latlngs };
}

function normalizeType(type) {
  const value = String(type || "").trim().toLowerCase();
  if (value === "rect" || value === "rectangle") return "rect";
  if (value === "circle") return "circle";
  if (value === "polygon" || value === "freehand") return "polygon";
  return null;
}

function normalizeGeofence(item, fallbackId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const type = normalizeType(item.type);
  if (!type) return null;
  let geometry = null;
  if (type === "rect") geometry = normalizeRectGeometry(item.geometry);
  if (type === "circle") geometry = normalizeCircleGeometry(item.geometry);
  if (type === "polygon") geometry = normalizePolygonGeometry(item.geometry);
  if (!geometry) return null;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : fallbackId || newId();
  const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Untitled area";
  return { id, name, type, geometry };
}

function normalizeGeofences(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.geofences) ? value.geofences : [];
  const seen = new Set();
  const geofences = [];
  for (const item of list) {
    const fence = normalizeGeofence(item);
    if (!fence || seen.has(fence.id)) continue;
    seen.add(fence.id);
    geofences.push(fence);
  }
  return geofences;
}

function loadGeofences(filePath = getGeofencesPath()) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { geofences: [], source: "default" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { geofences: normalizeGeofences(parsed), source: "file" };
  } catch (err) {
    console.error(`[geofences] cannot read ${filePath}:`, err.message);
    return { geofences: [], source: "default" };
  }
}

function saveGeofences(geofences, filePath = getGeofencesPath()) {
  const normalized = normalizeGeofences(geofences);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
  return normalized;
}

function pointInRect(lat, lng, geometry) {
  const south = Math.min(geometry.south, geometry.north);
  const north = Math.max(geometry.south, geometry.north);
  const west = Math.min(geometry.west, geometry.east);
  const east = Math.max(geometry.west, geometry.east);
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

function pointInCircle(lat, lng, geometry) {
  const distance = haversineMeters(
    { lat, lng },
    { lat: geometry.lat, lng: geometry.lng }
  );
  return distance <= geometry.radiusMeters;
}

function pointInPolygon(lat, lng, geometry) {
  const ring = geometry.latlngs;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeofence(lat, lng, fence) {
  const normalized = normalizeGeofence(fence, fence?.id);
  if (!normalized) return false;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
  const plat = Number(lat);
  const plng = Number(lng);
  if (normalized.type === "rect") return pointInRect(plat, plng, normalized.geometry);
  if (normalized.type === "circle") return pointInCircle(plat, plng, normalized.geometry);
  if (normalized.type === "polygon") return pointInPolygon(plat, plng, normalized.geometry);
  return false;
}

function geofencesContaining(lat, lng, geofences) {
  return normalizeGeofences(geofences).filter((fence) => pointInGeofence(lat, lng, fence));
}

function housePoint(house) {
  if (!house) return null;
  const lat = toFiniteNumber(house.lat ?? house.coords?.lat);
  const lng = toFiniteNumber(house.lng ?? house.lon ?? house.coords?.lng ?? house.coords?.lon);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function insideNamesForHouse(house, geofences) {
  const point = housePoint(house);
  if (!point) return [];
  return geofencesContaining(point.lat, point.lng, geofences).map((fence) => fence.name);
}

module.exports = {
  DEFAULT_GEOFENCES_PATH,
  EARTH_RADIUS_M,
  getGeofencesPath,
  newId,
  toFiniteNumber,
  haversineMeters,
  normalizeGeofence,
  normalizeGeofences,
  loadGeofences,
  saveGeofences,
  pointInGeofence,
  geofencesContaining,
  housePoint,
  insideNamesForHouse,
};
