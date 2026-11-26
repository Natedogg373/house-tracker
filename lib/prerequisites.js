const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_SURVEY_DB_PATH = path.join(__dirname, "..", "data", "survey.db");
const DEFAULT_TOLERANCE_PERCENT = 10;
/** Absolute tolerance (rating points) for school rating criteria. */
const SCHOOL_RATING_TOLERANCE = 1;

/**
 * Criteria available as Zillow-style filters / house fields / assigned schools.
 * daysOnMarket is display-only on House Details (no criterion).
 */
const CRITERION_DEFS = Object.freeze([
  {
    id: "price",
    label: "Price",
    direction: "max",
    field: "listPrice",
    unit: "$",
    inputMode: "currency",
    kind: "number",
    hint: "Maximum list price (lower is better).",
  },
  {
    id: "sqft",
    label: "Square footage",
    direction: "min",
    field: "sqft",
    unit: "sq ft",
    inputMode: "number",
    kind: "number",
    hint: "Minimum living area.",
  },
  {
    id: "beds",
    label: "Beds",
    direction: "min",
    field: "beds",
    unit: "beds",
    inputMode: "number",
    kind: "number",
    hint: "Minimum bedrooms.",
  },
  {
    id: "baths",
    label: "Baths",
    direction: "min",
    field: "baths",
    unit: "baths",
    inputMode: "decimal",
    kind: "number",
    hint: "Minimum bathrooms.",
  },
  {
    id: "garage",
    label: "Garage / parking spaces",
    direction: "min",
    field: "garageSpaces",
    unit: "spaces",
    inputMode: "number",
    kind: "number",
    hint: "Minimum garage spaces (garageSpaces). Missing data stays neutral.",
  },
  {
    id: "lotSize",
    label: "Lot size (backyard)",
    direction: "min",
    field: "lotAcres",
    unit: "acres",
    inputMode: "decimal",
    kind: "number",
    hint: "Minimum lot size in acres (stand-in for backyard).",
  },
  {
    id: "yearBuilt",
    label: "Year built",
    direction: "min",
    field: "yearBuilt",
    unit: "year",
    inputMode: "year",
    kind: "number",
    hint: "Minimum year built (newer is better).",
  },
  {
    id: "hoa",
    label: "HOA fee",
    direction: "max",
    field: "hoaMonthly",
    unit: "$/mo",
    inputMode: "currency",
    kind: "number",
    hint: "Maximum monthly HOA (hoaMonthly). 0 means no HOA.",
  },
  {
    id: "stories",
    label: "Stories",
    direction: "max",
    field: "stories",
    unit: "stories",
    inputMode: "number",
    kind: "number",
    hint: "Maximum stories (lower / fewer is better).",
  },
  {
    id: "hasPool",
    label: "Pool",
    field: "hasPool",
    kind: "boolean",
    inputMode: "pool",
    hint: "Require a pool, exclude pools, or leave disabled (don't care).",
  },
  {
    id: "propertyTax",
    label: "Property tax",
    direction: "max",
    field: "propertyTaxAnnual",
    unit: "$/yr",
    inputMode: "currency",
    kind: "number",
    hint: "Maximum annual property tax (propertyTaxAnnual).",
  },
  {
    id: "schoolElementary",
    label: "Elementary school rating",
    direction: "min",
    schoolLevel: "elementary",
    unit: "/10",
    inputMode: "rating",
    kind: "school",
    hint: "Minimum GreatSchools-style rating (1–10) for the assigned elementary school. Yellow within 1 point.",
  },
  {
    id: "schoolMiddle",
    label: "Middle school rating",
    direction: "min",
    schoolLevel: "middle",
    unit: "/10",
    inputMode: "rating",
    kind: "school",
    hint: "Minimum rating (1–10) for the assigned middle school. Yellow within 1 point.",
  },
  {
    id: "schoolHigh",
    label: "High school rating",
    direction: "min",
    schoolLevel: "high",
    unit: "/10",
    inputMode: "rating",
    kind: "school",
    hint: "Minimum rating (1–10) for the assigned high school. Yellow within 1 point.",
  },
]);

/** No skipped criteria currently — HOA is included via hoaMonthly. */
const SKIPPED_CRITERIA = Object.freeze([]);

let db = null;
let openedPath = null;

function getSurveyDbPath(env = process.env) {
  if (env.SURVEY_DB_PATH && String(env.SURVEY_DB_PATH).trim()) {
    return path.resolve(String(env.SURVEY_DB_PATH).trim());
  }
  return DEFAULT_SURVEY_DB_PATH;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(text, fallback) {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampTolerance(value) {
  const n = toFiniteNumber(value);
  if (n == null) return DEFAULT_TOLERANCE_PERCENT;
  return Math.min(100, Math.max(0, n));
}

function clampRatingThreshold(value) {
  const n = toFiniteNumber(value);
  if (n == null) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

function normalizePoolChoice(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "require" || raw === "exclude") return raw;
  return "require";
}

function parseBooleanField(value) {
  if (value === true || value === false) return value;
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return null;
}

function defaultCriteria() {
  return CRITERION_DEFS.map((def) => {
    const base = {
      id: def.id,
      label: def.label,
      direction: def.direction || null,
      field: def.field || null,
      schoolLevel: def.schoolLevel || null,
      unit: def.unit || "",
      inputMode: def.inputMode,
      kind: def.kind,
      hint: def.hint,
      enabled: false,
      threshold: null,
    };
    if (def.kind === "boolean") base.choice = "require";
    return base;
  });
}

function defaultConfig() {
  return {
    tolerancePercent: DEFAULT_TOLERANCE_PERCENT,
    criteria: defaultCriteria(),
    skipped: SKIPPED_CRITERIA.map((item) => ({ ...item })),
  };
}

function normalizeCriterion(raw, def) {
  const src = raw && typeof raw === "object" ? raw : {};
  const enabled = Boolean(src.enabled);
  const base = {
    id: def.id,
    label: def.label,
    direction: def.direction || null,
    field: def.field || null,
    schoolLevel: def.schoolLevel || null,
    unit: def.unit || "",
    inputMode: def.inputMode,
    kind: def.kind,
    hint: def.hint,
    enabled,
    threshold: null,
  };

  if (def.kind === "boolean") {
    base.choice = normalizePoolChoice(src.choice);
    return base;
  }

  if (def.kind === "school" || def.inputMode === "rating") {
    base.threshold = clampRatingThreshold(src.threshold);
    return base;
  }

  base.threshold = toFiniteNumber(src.threshold);
  return base;
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const byId = new Map();
  if (Array.isArray(src.criteria)) {
    for (const item of src.criteria) {
      if (item && typeof item === "object" && item.id) byId.set(String(item.id), item);
    }
  }
  return {
    tolerancePercent: clampTolerance(src.tolerancePercent ?? src.tolerance),
    criteria: CRITERION_DEFS.map((def) => normalizeCriterion(byId.get(def.id), def)),
    skipped: SKIPPED_CRITERIA.map((item) => ({ ...item })),
  };
}

function ensureSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS prerequisites_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function openPrerequisitesDb(filePath = getSurveyDbPath()) {
  const resolved = path.resolve(filePath);
  if (db && openedPath === resolved) return db;
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
    openedPath = null;
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new DatabaseSync(resolved);
  openedPath = resolved;
  ensureSchema(db);
  return db;
}

function getDb() {
  return openPrerequisitesDb();
}

function closePrerequisitesDb() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
  db = null;
  openedPath = null;
}

/** Test helper: point at a fresh DB path and reopen. */
function resetPrerequisitesDb(filePath) {
  closePrerequisitesDb();
  if (filePath) {
    process.env.SURVEY_DB_PATH = filePath;
    try {
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}-wal`, { force: true });
      fs.rmSync(`${filePath}-shm`, { force: true });
    } catch {
      /* ignore */
    }
  }
  return openPrerequisitesDb(getSurveyDbPath());
}

function loadPrerequisites() {
  const database = getDb();
  const row = database.prepare("SELECT config_json FROM prerequisites_config WHERE id = 1").get();
  if (!row) return defaultConfig();
  return normalizeConfig(parseJson(row.config_json, {}));
}

function savePrerequisites(raw) {
  const config = normalizeConfig(raw);
  const database = getDb();
  const updatedAt = nowIso();
  database
    .prepare(
      `INSERT INTO prerequisites_config (id, config_json, updated_at)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    )
    .run(
      JSON.stringify({
        tolerancePercent: config.tolerancePercent,
        criteria: config.criteria.map((c) => ({
          id: c.id,
          enabled: c.enabled,
          threshold: c.threshold,
          choice: c.choice,
        })),
      }),
      updatedAt
    );
  return { ...config, updatedAt };
}

function schoolRatingForHouse(house, level, schools) {
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

/**
 * Read the value used for scoring a criterion.
 * Missing → null (neutral / grey). Boolean → true/false/null.
 */
function houseValueForCriterion(house, criterionOrId, { schools } = {}) {
  const id = typeof criterionOrId === "string" ? criterionOrId : criterionOrId?.id;
  const def = CRITERION_DEFS.find((item) => item.id === id);
  const criterion = typeof criterionOrId === "object" && criterionOrId ? criterionOrId : def;
  if (!def || !house || typeof house !== "object") return null;

  if (def.kind === "school") {
    return schoolRatingForHouse(house, def.schoolLevel, schools);
  }

  if (def.kind === "boolean") {
    return parseBooleanField(house[def.field]);
  }

  const keys = [def.field, ...(def.altFields || [])].filter(Boolean);
  for (const key of keys) {
    const value = toFiniteNumber(house[key]);
    if (value != null) return value;
  }
  return null;
}

/**
 * Score a single numeric value against a threshold.
 * @returns {'green'|'yellow'|'red'|'neutral'|'off'}
 */
function scoreValue(
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

function scoreBoolean(value, { choice, enabled } = {}) {
  if (!enabled) return "off";
  const v = parseBooleanField(value);
  if (v == null) return "neutral";
  const want = normalizePoolChoice(choice);
  if (want === "require") return v ? "green" : "red";
  return v ? "red" : "green";
}

function criterionIsActive(criterion) {
  if (!criterion?.enabled) return false;
  if (criterion.kind === "boolean") return true;
  return toFiniteNumber(criterion.threshold) != null;
}

function scoreCriterion(house, criterion, tolerancePercent, { schools } = {}) {
  const enabled = Boolean(criterion?.enabled);
  if (!enabled) {
    return {
      id: criterion?.id,
      status: "off",
      value: null,
      met: false,
    };
  }

  const value = houseValueForCriterion(house, criterion, { schools });

  let status;
  if (criterion.kind === "boolean") {
    status = scoreBoolean(value, { choice: criterion.choice, enabled: true });
  } else if (criterion.kind === "school") {
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
}

function scoreHouse(house, config = loadPrerequisites(), { schools } = {}) {
  const tolerancePercent = clampTolerance(config.tolerancePercent);
  const criteria = Array.isArray(config.criteria) ? config.criteria : defaultCriteria();
  const results = criteria.map((criterion) =>
    scoreCriterion(house, criterion, tolerancePercent, { schools })
  );
  const active = results.filter((r) => {
    const c = criteria.find((item) => item.id === r.id);
    return c && criterionIsActive(c);
  });
  const scored = active.filter((r) => r.status !== "neutral" && r.status !== "off");
  const met = scored.filter((r) => r.met).length;
  return {
    tolerancePercent,
    results,
    summary: {
      met,
      total: scored.length,
      active: active.length,
      unknown: active.length - scored.length,
    },
  };
}

function yearBuiltAgeHint(year, now = new Date()) {
  const y = toFiniteNumber(year);
  if (y == null) return null;
  const age = now.getFullYear() - Math.round(y);
  if (!Number.isFinite(age)) return null;
  if (age < 0) return `Threshold year ${Math.round(y)} (future / new construction)`;
  if (age === 0) return `Threshold year ${Math.round(y)} (built this year)`;
  if (age === 1) return `Threshold year ${Math.round(y)} ≈ 1 year old`;
  return `Threshold year ${Math.round(y)} ≈ ${age} years old`;
}

function criterionDef(id) {
  return CRITERION_DEFS.find((item) => item.id === id) || null;
}

module.exports = {
  CRITERION_DEFS,
  SKIPPED_CRITERIA,
  DEFAULT_TOLERANCE_PERCENT,
  SCHOOL_RATING_TOLERANCE,
  DEFAULT_SURVEY_DB_PATH,
  getSurveyDbPath,
  openPrerequisitesDb,
  closePrerequisitesDb,
  resetPrerequisitesDb,
  loadPrerequisites,
  savePrerequisites,
  defaultConfig,
  normalizeConfig,
  houseValueForCriterion,
  schoolRatingForHouse,
  scoreValue,
  scoreBoolean,
  scoreCriterion,
  scoreHouse,
  yearBuiltAgeHint,
  criterionDef,
  criterionIsActive,
  toFiniteNumber,
  clampTolerance,
  parseBooleanField,
};
