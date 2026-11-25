export const NEUTRAL_HOUSE_COLOR = "#8a847c";
export const SCHOOL_LEVELS = ["elementary", "middle", "high"];
export const MAP_LEVEL_STORAGE_KEY = "house-tracker:map-level";

/** Hex fills for map pins / legend swatches by GreatSchools-style rating band. */
export const RATING_COLORS = {
  high: "#15803d",
  mid: "#ca8a04",
  low: "#b91c1c",
  unrated: NEUTRAL_HOUSE_COLOR,
};

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

/**
 * Rating bands for color: 7–10 high (green), 4–6 mid (yellow), 1–3 low (red).
 * Missing / non-numeric → unrated (neutral gray). 0 counts as low.
 */
export function schoolRatingBand(rating) {
  if (rating == null || rating === "" || Number.isNaN(Number(rating))) return "unrated";
  const n = Number(rating);
  if (n >= 7) return "high";
  if (n >= 4) return "mid";
  return "low";
}

export function schoolRatingClass(rating) {
  return schoolRatingBand(rating);
}

export function schoolRatingColor(rating) {
  return RATING_COLORS[schoolRatingBand(rating)] || RATING_COLORS.unrated;
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

/** True when the house is zoned to schoolId at the given level (via schoolIds). */
export function isHouseInSchoolZone(house, schools, schoolId, level) {
  if (!schoolId) return true;
  const school = schoolAtLevel(house, schools, level);
  return Boolean(school && school.id === schoolId);
}

export function housesInSchoolZone(houses, schools, schoolId, level) {
  return (houses || []).filter((house) => isHouseInSchoolZone(house, schools, schoolId, level));
}

/** Assign each school its rating color (same API shape as the old palette helper). */
export function assignSchoolColors(schools) {
  const assigned = new Map();
  const seen = new Set();
  for (const school of schools || []) {
    const id = typeof school?.id === "string" ? school.id : "";
    if (!id || seen.has(id) || !schoolPoint(school)) continue;
    seen.add(id);
    assigned.set(id, schoolRatingColor(school.rating));
  }
  return assigned;
}

export function colorForHouseAtLevel(house, colorBySchoolId, schools, level) {
  const school = schoolAtLevel(house, schools, level);
  if (!school) return NEUTRAL_HOUSE_COLOR;
  if (colorBySchoolId?.get) {
    return colorBySchoolId.get(school.id) || schoolRatingColor(school.rating);
  }
  return schoolRatingColor(school.rating);
}

export function colorsToObject(colorBySchoolId) {
  return Object.fromEntries(colorBySchoolId);
}
