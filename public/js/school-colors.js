export const SCHOOL_PALETTE = [
  "#c2410c",
  "#1d4ed8",
  "#15803d",
  "#7c3aed",
  "#b45309",
  "#be123c",
  "#0f766e",
  "#4338ca",
  "#a16207",
  "#0369a1",
];

export const NEUTRAL_HOUSE_COLOR = "#8a847c";
export const MIN_SCHOOL_COLOR_DISTANCE_KM = 3;
export const SCHOOL_LEVELS = ["elementary", "middle", "high"];
export const MAP_LEVEL_STORAGE_KEY = "house-tracker:map-level";

const EARTH_KM = 6371;

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

export function schoolPoint(school) {
  const lat = Number(school?.lat);
  const lng = Number(school?.lng ?? school?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function distanceKm(a, b) {
  const pa = a && Number.isFinite(Number(a.lat)) ? { lat: Number(a.lat), lng: Number(a.lng ?? a.lon) } : schoolPoint(a);
  const pb = b && Number.isFinite(Number(b.lat)) ? { lat: Number(b.lat), lng: Number(b.lng ?? b.lon) } : schoolPoint(b);
  if (!pa || !pb || !Number.isFinite(pa.lng) || !Number.isFinite(pb.lng)) return Infinity;
  const dLat = toRad(pb.lat - pa.lat);
  const dLng = toRad(pb.lng - pa.lng);
  const lat1 = toRad(pa.lat);
  const lat2 = toRad(pb.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function normalizeSchoolLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return SCHOOL_LEVELS.includes(level) ? level : "elementary";
}

export function schoolsAtLevel(schools, level) {
  const wanted = normalizeSchoolLevel(level);
  return (schools || []).filter((school) => school?.level === wanted && schoolPoint(school));
}

export function schoolAtLevel(house, schools, level) {
  const wanted = normalizeSchoolLevel(level);
  const ids = Array.isArray(house?.schoolIds) ? house.schoolIds : [];
  const byId = new Map((schools || []).map((school) => [school.id, school]));
  for (const id of ids) {
    const school = byId.get(id);
    if (school?.level === wanted) return school;
  }
  return null;
}

function colorEntries(colorBySchoolId) {
  return Object.fromEntries(colorBySchoolId);
}

function nearestSameColorKm(school, color, assigned, schools) {
  let nearest = Infinity;
  for (const other of schools) {
    if (other.id === school.id) continue;
    if (assigned.get(other.id) !== color) continue;
    nearest = Math.min(nearest, distanceKm(school, other));
  }
  return nearest;
}

function pickColor(school, used, palette, assigned, schools) {
  const assignedColors = new Set(assigned.values());
  const legal = palette.filter((color) => !used.has(color));
  if (legal.length) {
    return legal.find((color) => !assignedColors.has(color)) || legal[0];
  }
  let best = palette[0];
  let bestDist = -1;
  for (const color of palette) {
    const dist = nearestSameColorKm(school, color, assigned, schools);
    if (dist > bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

export function assignSchoolColors(schools, options = {}) {
  const palette = Array.isArray(options.palette) && options.palette.length ? options.palette : SCHOOL_PALETTE;
  const minKm = Number.isFinite(Number(options.minDistanceKm))
    ? Number(options.minDistanceKm)
    : MIN_SCHOOL_COLOR_DISTANCE_KM;

  const valid = [];
  const seen = new Set();
  for (const school of schools || []) {
    const id = typeof school?.id === "string" ? school.id : "";
    if (!id || seen.has(id) || !schoolPoint(school)) continue;
    seen.add(id);
    valid.push(school);
  }
  valid.sort((a, b) => a.id.localeCompare(b.id, "en"));

  const assigned = new Map();
  for (const school of valid) {
    const used = new Set();
    for (const other of valid) {
      if (!assigned.has(other.id)) continue;
      if (distanceKm(school, other) <= minKm) used.add(assigned.get(other.id));
    }
    assigned.set(school.id, pickColor(school, used, palette, assigned, valid));
  }
  return assigned;
}

export function colorForHouseAtLevel(house, colorBySchoolId, schools, level) {
  const school = schoolAtLevel(house, schools, level);
  if (!school) return NEUTRAL_HOUSE_COLOR;
  return colorBySchoolId.get(school.id) || NEUTRAL_HOUSE_COLOR;
}

export function colorsToObject(colorBySchoolId) {
  return colorEntries(colorBySchoolId);
}
