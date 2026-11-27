/** Client-side mirror of lib/prerequisites scoring (keep in sync). */

export const SCHOOL_RATING_TOLERANCE = 1;

export const STATUS_LABELS = Object.freeze({
  green: "Meets (better than threshold)",
  yellow: "Within tolerance of threshold",
  red: "Below threshold",
  neutral: "No data",
  off: "Not scored",
});

export const STATUS_ICONS = Object.freeze({
  green: "✓",
  yellow: "~",
  red: "✗",
  neutral: "–",
  off: "",
});

export function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clampTolerance(value, fallback = 10) {
  const n = toFiniteNumber(value);
  if (n == null) return fallback;
  return Math.min(100, Math.max(0, n));
}

export function parseBooleanField(value) {
  if (value === true || value === false) return value;
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return null;
}

/**
 * @returns {'green'|'yellow'|'red'|'neutral'|'off'}
 */
export function scoreValue(
  value,
  { direction, threshold, tolerancePercent, toleranceAbsolute, enabled } = {}
) {
  if (!enabled) return "off";
  const v = toFiniteNumber(value);
  const t = toFiniteNumber(threshold);
  if (v == null || t == null) return "neutral";

  if (toleranceAbsolute != null) {
    const absTol = Math.max(0, Number(toleranceAbsolute) || 0);
    if (Math.abs(v - t) <= absTol) return "yellow";
    const better = direction === "max" ? v < t : v > t;
    return better ? "green" : "red";
  }

  const tol = clampTolerance(tolerancePercent) / 100;
  const absT = Math.abs(t);
  const deltaRatio = absT === 0 ? (v === 0 ? 0 : Infinity) : Math.abs(v - t) / absT;

  if (deltaRatio <= tol) return "yellow";

  const better = direction === "max" ? v < t : v > t;
  return better ? "green" : "red";
}

export function scoreBoolean(value, { choice, enabled } = {}) {
  if (!enabled) return "off";
  const v = parseBooleanField(value);
  if (v == null) return "neutral";
  const want = String(choice || "require").toLowerCase() === "exclude" ? "exclude" : "require";
  if (want === "require") return v ? "green" : "red";
  return v ? "red" : "green";
}

export function schoolRatingForHouse(house, level, schools) {
  if (!house || !level) return null;
  const ids = Array.isArray(house.schoolIds) ? house.schoolIds : [];
  if (!ids.length || !Array.isArray(schools)) return null;
  const byId = new Map(schools.map((school) => [school.id, school]));
  for (const id of ids) {
    const school = byId.get(id);
    if (!school || school.level !== level) continue;
    const rating = toFiniteNumber(school.rating);
    if (rating != null) return rating;
  }
  return null;
}

export function houseValueForCriterion(house, criterion, { schools } = {}) {
  if (!house || !criterion) return null;
  if (criterion.kind === "school" || criterion.schoolLevel) {
    return schoolRatingForHouse(house, criterion.schoolLevel, schools);
  }
  if (criterion.kind === "boolean" || criterion.id === "hasPool") {
    return parseBooleanField(house[criterion.field || "hasPool"]);
  }
  const keys = [criterion.field].filter(Boolean);
  if (criterion.id === "garage") keys.push("garageSpaces");
  for (const key of keys) {
    const value = toFiniteNumber(house[key]);
    if (value != null) return value;
  }
  return null;
}

function criterionIsActive(criterion) {
  if (!criterion?.enabled) return false;
  if (criterion.kind === "boolean" || criterion.id === "hasPool") return true;
  return toFiniteNumber(criterion.threshold) != null;
}

export function scoreHouse(house, config, { schools } = {}) {
  const tolerancePercent = clampTolerance(config?.tolerancePercent);
  const criteria = Array.isArray(config?.criteria) ? config.criteria : [];
  const results = criteria.map((criterion) => {
    if (!criterion.enabled) {
      return { id: criterion.id, status: "off", value: null, met: false };
    }
    const value = houseValueForCriterion(house, criterion, { schools });
    let status;
    if (criterion.kind === "boolean" || criterion.id === "hasPool") {
      status = scoreBoolean(value, { choice: criterion.choice, enabled: true });
    } else if (criterion.kind === "school" || criterion.schoolLevel) {
      status = scoreValue(value, {
        direction: "min",
        threshold: criterion.threshold,
        toleranceAbsolute: SCHOOL_RATING_TOLERANCE,
        enabled: true,
      });
    } else {
      status = scoreValue(value, {
        direction: criterion.direction,
        threshold: criterion.threshold,
        tolerancePercent,
        enabled: true,
      });
    }
    return {
      id: criterion.id,
      status,
      value,
      met: status === "green" || status === "yellow",
    };
  });

  const active = results.filter((r) => {
    const c = criteria.find((item) => item.id === r.id);
    return c && criterionIsActive(c);
  });
  const scored = active.filter((r) => r.status !== "neutral" && r.status !== "off");
  const met = scored.filter((r) => r.met).length;

  return {
    tolerancePercent,
    results,
    byId: Object.fromEntries(results.map((r) => [r.id, r])),
    summary: {
      met,
      total: scored.length,
      active: active.length,
      unknown: active.length - scored.length,
    },
  };
}

export function yearBuiltAgeHint(year, now = new Date()) {
  const y = toFiniteNumber(year);
  if (y == null) return null;
  const age = now.getFullYear() - Math.round(y);
  if (!Number.isFinite(age)) return null;
  if (age < 0) return `≈ future / new (${Math.round(y)})`;
  if (age === 0) return `≈ built this year`;
  if (age === 1) return `≈ 1 year old`;
  return `≈ ${age} years old`;
}

/** Map metric labels on House Details to prerequisite criterion ids. */
export const METRIC_CRITERION_IDS = Object.freeze({
  "List price": "price",
  Beds: "beds",
  Baths: "baths",
  "Square feet": "sqft",
  "Year built": "yearBuilt",
  Age: "yearBuilt",
  "Lot acres": "lotSize",
  "Garage / parking": "garage",
  "HOA / mo": "hoa",
  Stories: "stories",
  Pool: "hasPool",
  "Property tax / yr": "propertyTax",
});

export const SCHOOL_LEVEL_CRITERION_IDS = Object.freeze({
  elementary: "schoolElementary",
  middle: "schoolMiddle",
  high: "schoolHigh",
});

export function summaryText(summary) {
  if (!summary || !summary.total) {
    if (summary?.active && summary.unknown) {
      return `${summary.unknown} prerequisite${summary.unknown === 1 ? "" : "s"} missing data`;
    }
    return "";
  }
  return `${summary.met} of ${summary.total} prerequisites met`;
}

export function hasOwnField(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
}
