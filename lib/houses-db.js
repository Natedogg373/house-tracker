const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  HOUSES_DIR,
  SAMPLE_DIR,
  isHouseFilename,
  loadHousesFromDir,
  getHousesDir,
} = require("./houses");

const DEFAULT_DB_PATH = path.join(__dirname, "..", "data", "survey.db");
const DEFAULT_INTEREST_PATH = path.join(__dirname, "..", "data", "interest.json");
const DEFAULT_RANKINGS_PATH = path.join(__dirname, "..", "data", "rankings.json");

/** Core columns stored as typed fields (camelCase API ↔ snake_case DB). */
const CORE_FIELDS = Object.freeze([
  "address",
  "zillowUrl",
  "photoUrl",
  "status",
  "listPrice",
  "salePrice",
  "soldDate",
  "yearBuilt",
  "sqft",
  "pricePerSqft",
  "beds",
  "baths",
  "lotAcres",
  "lastUpdated",
  "lat",
  "lng",
  "garageSpaces",
  "hoaMonthly",
  "stories",
  "hasPool",
  "propertyTaxAnnual",
  "daysOnMarket",
]);

const CORE_COLUMN_MAP = Object.freeze({
  address: "address",
  zillowUrl: "zillow_url",
  photoUrl: "photo_url",
  status: "status",
  listPrice: "list_price",
  salePrice: "sale_price",
  soldDate: "sold_date",
  yearBuilt: "year_built",
  sqft: "sqft",
  pricePerSqft: "price_per_sqft",
  beds: "beds",
  baths: "baths",
  lotAcres: "lot_acres",
  lastUpdated: "last_updated",
  lat: "lat",
  lng: "lng",
  garageSpaces: "garage_spaces",
  hoaMonthly: "hoa_monthly",
  stories: "stories",
  hasPool: "has_pool",
  propertyTaxAnnual: "property_tax_annual",
  daysOnMarket: "days_on_market",
});

const TEXT_CORE = new Set([
  "address",
  "zillowUrl",
  "photoUrl",
  "status",
  "soldDate",
  "lastUpdated",
]);

const BOOL_CORE = new Set(["hasPool"]);

const RESERVED_KEYS = new Set([
  "slug",
  "priceHistory",
  "schoolIds",
  "extras",
  "deletedAt",
  "createdAt",
  "updatedAt",
  ...CORE_FIELDS,
]);

let db = null;
let openedPath = null;

function getHousesDbPath(env = process.env) {
  if (env.HOUSES_DB_PATH && String(env.HOUSES_DB_PATH).trim()) {
    return path.resolve(String(env.HOUSES_DB_PATH).trim());
  }
  if (env.SURVEY_DB_PATH && String(env.SURVEY_DB_PATH).trim()) {
    return path.resolve(String(env.SURVEY_DB_PATH).trim());
  }
  return DEFAULT_DB_PATH;
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

function toBoolInt(value) {
  if (value === true || value === false) return value ? 1 : 0;
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0 ? 1 : 0;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(raw)) return 1;
  if (["0", "false", "no", "n"].includes(raw)) return 0;
  return null;
}

function normalizeSchoolIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizePriceHistory(value) {
  if (!Array.isArray(value)) return [];
  const byWeek = new Map();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const week = String(row.week || row.date || "").trim();
    if (!week) continue;
    const price =
      row.price === null || row.price === undefined || row.price === ""
        ? null
        : toFiniteNumber(row.price);
    byWeek.set(week, { week, price });
  }
  return [...byWeek.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)));
}

function splitHousePayload(input = {}) {
  const core = {};
  const extras = {};
  const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};

  for (const key of CORE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      core[key] = src[key];
    }
  }

  if (Object.prototype.hasOwnProperty.call(src, "schoolIds")) {
    core.schoolIds = normalizeSchoolIds(src.schoolIds);
  }

  const incomingExtras =
    src.extras && typeof src.extras === "object" && !Array.isArray(src.extras) ? { ...src.extras } : {};

  for (const [key, value] of Object.entries(src)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key === "lon") {
      if (!Object.prototype.hasOwnProperty.call(core, "lng") && !Object.prototype.hasOwnProperty.call(src, "lng")) {
        core.lng = value;
      }
      continue;
    }
    incomingExtras[key] = value;
  }

  return {
    core,
    schoolIds: Object.prototype.hasOwnProperty.call(src, "schoolIds")
      ? normalizeSchoolIds(src.schoolIds)
      : undefined,
    priceHistory: Object.prototype.hasOwnProperty.call(src, "priceHistory")
      ? normalizePriceHistory(src.priceHistory)
      : undefined,
    extras: incomingExtras,
  };
}

function ensureSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS houses (
      slug TEXT PRIMARY KEY,
      address TEXT,
      zillow_url TEXT,
      photo_url TEXT,
      status TEXT,
      list_price REAL,
      sale_price REAL,
      sold_date TEXT,
      year_built INTEGER,
      sqft REAL,
      price_per_sqft REAL,
      beds REAL,
      baths REAL,
      lot_acres REAL,
      last_updated TEXT,
      lat REAL,
      lng REAL,
      school_ids_json TEXT NOT NULL DEFAULT '[]',
      garage_spaces REAL,
      hoa_monthly REAL,
      stories REAL,
      has_pool INTEGER,
      property_tax_annual REAL,
      days_on_market INTEGER,
      extras_json TEXT NOT NULL DEFAULT '{}',
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      week TEXT NOT NULL,
      price REAL,
      UNIQUE(slug, week),
      FOREIGN KEY (slug) REFERENCES houses(slug) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_slug_week
      ON price_history(slug, week);

    CREATE TABLE IF NOT EXISTS house_interest (
      slug TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('notInterested', 'pendingReactivation')),
      since TEXT,
      requested TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS house_rankings (
      slug TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS house_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_house_audit_slug
      ON house_audit_log(slug, created_at);
  `);
}

function openHousesDb(filePath = getHousesDbPath()) {
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
  return openHousesDb();
}

function closeHousesDb() {
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
function resetHousesDb(filePath) {
  closeHousesDb();
  if (filePath) {
    process.env.HOUSES_DB_PATH = filePath;
    try {
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}-wal`, { force: true });
      fs.rmSync(`${filePath}-shm`, { force: true });
    } catch {
      /* ignore */
    }
  }
  return openHousesDb(getHousesDbPath());
}

function writeAudit(database, { slug = null, action, actor = "system", detail = {} }) {
  database
    .prepare(
      `INSERT INTO house_audit_log (slug, action, actor, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(slug, action, actor, JSON.stringify(detail || {}), nowIso());
}

function countHouses({ includeDeleted = false } = {}) {
  const database = getDb();
  const row = includeDeleted
    ? database.prepare(`SELECT COUNT(*) AS n FROM houses`).get()
    : database.prepare(`SELECT COUNT(*) AS n FROM houses WHERE deleted_at IS NULL`).get();
  return Number(row?.n || 0);
}

function loadPriceHistoryForSlug(database, slug) {
  return database
    .prepare(`SELECT week, price FROM price_history WHERE slug = ? ORDER BY week ASC`)
    .all(slug)
    .map((row) => ({
      week: row.week,
      price: row.price == null ? null : Number(row.price),
    }));
}

function rowToHouse(row, priceHistory) {
  if (!row) return null;
  const extras = parseJson(row.extras_json, {});
  const house = {
    slug: row.slug,
    address: row.address || null,
    zillowUrl: row.zillow_url || null,
    photoUrl: row.photo_url || null,
    status: row.status || null,
    listPrice: row.list_price == null ? null : Number(row.list_price),
    salePrice: row.sale_price == null ? null : Number(row.sale_price),
    soldDate: row.sold_date || null,
    yearBuilt: row.year_built == null ? null : Number(row.year_built),
    sqft: row.sqft == null ? null : Number(row.sqft),
    pricePerSqft: row.price_per_sqft == null ? null : Number(row.price_per_sqft),
    beds: row.beds == null ? null : Number(row.beds),
    baths: row.baths == null ? null : Number(row.baths),
    lotAcres: row.lot_acres == null ? null : Number(row.lot_acres),
    lastUpdated: row.last_updated || null,
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    schoolIds: normalizeSchoolIds(parseJson(row.school_ids_json, [])),
    garageSpaces: row.garage_spaces == null ? null : Number(row.garage_spaces),
    hoaMonthly: row.hoa_monthly == null ? null : Number(row.hoa_monthly),
    stories: row.stories == null ? null : Number(row.stories),
    hasPool: row.has_pool == null ? null : Boolean(row.has_pool),
    propertyTaxAnnual: row.property_tax_annual == null ? null : Number(row.property_tax_annual),
    daysOnMarket: row.days_on_market == null ? null : Number(row.days_on_market),
    priceHistory: Array.isArray(priceHistory) ? priceHistory : [],
    updatedAt: row.updated_at || null,
    createdAt: row.created_at || null,
  };
  if (row.deleted_at) house.deletedAt = row.deleted_at;

  for (const [key, value] of Object.entries(extras || {})) {
    if (RESERVED_KEYS.has(key) || key === "deletedAt" || key === "createdAt" || key === "updatedAt") {
      continue;
    }
    if (house[key] === undefined) house[key] = value;
  }
  return house;
}

function getHouseRow(slug, { includeDeleted = false } = {}) {
  const database = getDb();
  const value = String(slug || "").trim();
  if (!value) return null;
  const row = includeDeleted
    ? database.prepare(`SELECT * FROM houses WHERE slug = ?`).get(value)
    : database.prepare(`SELECT * FROM houses WHERE slug = ? AND deleted_at IS NULL`).get(value);
  if (!row) return null;
  return rowToHouse(row, loadPriceHistoryForSlug(database, value));
}

function listHouses({ includeDeleted = false } = {}) {
  const database = getDb();
  const rows = includeDeleted
    ? database.prepare(`SELECT * FROM houses ORDER BY address COLLATE NOCASE ASC, slug ASC`).all()
    : database
        .prepare(
          `SELECT * FROM houses WHERE deleted_at IS NULL
           ORDER BY address COLLATE NOCASE ASC, slug ASC`
        )
        .all();
  return rows.map((row) => rowToHouse(row, loadPriceHistoryForSlug(database, row.slug)));
}

function replacePriceHistory(database, slug, history) {
  database.prepare(`DELETE FROM price_history WHERE slug = ?`).run(slug);
  const insert = database.prepare(
    `INSERT INTO price_history (slug, week, price) VALUES (?, ?, ?)`
  );
  for (const row of normalizePriceHistory(history)) {
    insert.run(slug, row.week, row.price);
  }
}

function coerceCoreValue(field, value) {
  if (value === undefined) return undefined;
  if (TEXT_CORE.has(field)) {
    if (value == null) return null;
    return String(value);
  }
  if (BOOL_CORE.has(field)) {
    const bit = toBoolInt(value);
    return bit;
  }
  return toFiniteNumber(value);
}

function buildCoreParams(core, existing = null) {
  const params = {};
  for (const field of CORE_FIELDS) {
    const column = CORE_COLUMN_MAP[field];
    if (Object.prototype.hasOwnProperty.call(core, field)) {
      params[column] = coerceCoreValue(field, core[field]);
    } else if (existing) {
      params[column] = existing[column];
    } else {
      params[column] = null;
    }
  }
  return params;
}

function upsertHouse(slug, input = {}, { actor = "api", mergeExtras = true } = {}) {
  const value = String(slug || "").trim();
  if (!value) {
    const err = new Error("Missing house slug.");
    err.statusCode = 400;
    err.code = "MISSING_SLUG";
    throw err;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const err = new Error("Send a house object.");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const database = getDb();
  const existing = database.prepare(`SELECT * FROM houses WHERE slug = ?`).get(value);
  const { core, schoolIds, priceHistory, extras } = splitHousePayload(input);
  const stamp = nowIso();

  const schoolIdsJson = JSON.stringify(
    schoolIds !== undefined
      ? schoolIds
      : normalizeSchoolIds(parseJson(existing?.school_ids_json, []))
  );

  let nextExtras = {};
  if (existing && mergeExtras) {
    nextExtras = { ...parseJson(existing.extras_json, {}) };
  }
  Object.assign(nextExtras, extras || {});

  // Drop any keys that landed in extras but belong to core (defensive).
  for (const key of RESERVED_KEYS) {
    delete nextExtras[key];
  }

  const coreParams = buildCoreParams(core, existing || null);
  const createdAt = existing?.created_at || stamp;

  database.exec("BEGIN");
  try {
    database
      .prepare(
        `INSERT INTO houses (
          slug, address, zillow_url, photo_url, status, list_price, sale_price, sold_date,
          year_built, sqft, price_per_sqft, beds, baths, lot_acres, last_updated, lat, lng,
          school_ids_json, garage_spaces, hoa_monthly, stories, has_pool, property_tax_annual,
          days_on_market, extras_json, deleted_at, created_at, updated_at
        ) VALUES (
          @slug, @address, @zillow_url, @photo_url, @status, @list_price, @sale_price, @sold_date,
          @year_built, @sqft, @price_per_sqft, @beds, @baths, @lot_acres, @last_updated, @lat, @lng,
          @school_ids_json, @garage_spaces, @hoa_monthly, @stories, @has_pool, @property_tax_annual,
          @days_on_market, @extras_json, NULL, @created_at, @updated_at
        )
        ON CONFLICT(slug) DO UPDATE SET
          address = excluded.address,
          zillow_url = excluded.zillow_url,
          photo_url = excluded.photo_url,
          status = excluded.status,
          list_price = excluded.list_price,
          sale_price = excluded.sale_price,
          sold_date = excluded.sold_date,
          year_built = excluded.year_built,
          sqft = excluded.sqft,
          price_per_sqft = excluded.price_per_sqft,
          beds = excluded.beds,
          baths = excluded.baths,
          lot_acres = excluded.lot_acres,
          last_updated = excluded.last_updated,
          lat = excluded.lat,
          lng = excluded.lng,
          school_ids_json = excluded.school_ids_json,
          garage_spaces = excluded.garage_spaces,
          hoa_monthly = excluded.hoa_monthly,
          stories = excluded.stories,
          has_pool = excluded.has_pool,
          property_tax_annual = excluded.property_tax_annual,
          days_on_market = excluded.days_on_market,
          extras_json = excluded.extras_json,
          deleted_at = NULL,
          updated_at = excluded.updated_at`
      )
      .run({
        slug: value,
        ...coreParams,
        school_ids_json: schoolIdsJson,
        extras_json: JSON.stringify(nextExtras),
        created_at: createdAt,
        updated_at: stamp,
      });

    if (priceHistory !== undefined) {
      replacePriceHistory(database, value, priceHistory);
    } else if (!existing) {
      replacePriceHistory(database, value, []);
    }

    writeAudit(database, {
      slug: value,
      action: existing ? "upsert" : "create",
      actor,
      detail: { fields: Object.keys(input) },
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  return getHouseRow(value, { includeDeleted: true });
}

function appendPricePoint(slug, input = {}, { actor = "api" } = {}) {
  const value = String(slug || "").trim();
  if (!value) {
    const err = new Error("Missing house slug.");
    err.statusCode = 400;
    err.code = "MISSING_SLUG";
    throw err;
  }
  const week = String(input.week || input.date || "").trim();
  if (!week) {
    const err = new Error('Send { "week": "YYYY-MM-DD", "price": number|null }.');
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(week)) {
    const err = new Error("week must be an ISO date (YYYY-MM-DD).");
    err.statusCode = 400;
    err.code = "INVALID_WEEK";
    throw err;
  }
  const hasPrice = Object.prototype.hasOwnProperty.call(input, "price");
  if (!hasPrice) {
    const err = new Error('Send { "week": "YYYY-MM-DD", "price": number|null }.');
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  const price =
    input.price === null || input.price === ""
      ? null
      : (() => {
          const n = toFiniteNumber(input.price);
          if (n == null) {
            const err = new Error("price must be a number or null.");
            err.statusCode = 400;
            err.code = "INVALID_PRICE";
            throw err;
          }
          return n;
        })();

  const database = getDb();
  const existing = database.prepare(`SELECT slug FROM houses WHERE slug = ?`).get(value);
  if (!existing) {
    const err = new Error("House not found.");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const stamp = nowIso();
  database.exec("BEGIN");
  try {
    database
      .prepare(
        `INSERT INTO price_history (slug, week, price) VALUES (?, ?, ?)
         ON CONFLICT(slug, week) DO UPDATE SET price = excluded.price`
      )
      .run(value, week.slice(0, 10), price);
    database.prepare(`UPDATE houses SET updated_at = ?, deleted_at = NULL WHERE slug = ?`).run(stamp, value);
    writeAudit(database, {
      slug: value,
      action: "price",
      actor,
      detail: { week: week.slice(0, 10), price },
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return getHouseRow(value);
}

function patchHouseStatus(slug, input = {}, { actor = "api" } = {}) {
  const value = String(slug || "").trim();
  if (!value) {
    const err = new Error("Missing house slug.");
    err.statusCode = 400;
    err.code = "MISSING_SLUG";
    throw err;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const err = new Error("Send a status patch object.");
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const database = getDb();
  const existing = database.prepare(`SELECT * FROM houses WHERE slug = ?`).get(value);
  if (!existing) {
    const err = new Error("House not found.");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const stamp = nowIso();
  const updates = [];
  const params = [];
  const detail = {};

  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    updates.push("status = ?");
    params.push(input.status == null ? null : String(input.status));
    detail.status = params[params.length - 1];
  }
  if (Object.prototype.hasOwnProperty.call(input, "soldDate")) {
    updates.push("sold_date = ?");
    params.push(input.soldDate == null ? null : String(input.soldDate));
    detail.soldDate = params[params.length - 1];
  }
  if (Object.prototype.hasOwnProperty.call(input, "salePrice")) {
    updates.push("sale_price = ?");
    const salePrice =
      input.salePrice === null || input.salePrice === ""
        ? null
        : toFiniteNumber(input.salePrice);
    if (input.salePrice != null && input.salePrice !== "" && salePrice == null) {
      const err = new Error("salePrice must be a number or null.");
      err.statusCode = 400;
      err.code = "INVALID_SALE_PRICE";
      throw err;
    }
    params.push(salePrice);
    detail.salePrice = salePrice;
  }
  if (Object.prototype.hasOwnProperty.call(input, "listPrice")) {
    updates.push("list_price = ?");
    const listPrice =
      input.listPrice === null || input.listPrice === ""
        ? null
        : toFiniteNumber(input.listPrice);
    if (input.listPrice != null && input.listPrice !== "" && listPrice == null) {
      const err = new Error("listPrice must be a number or null.");
      err.statusCode = 400;
      err.code = "INVALID_LIST_PRICE";
      throw err;
    }
    params.push(listPrice);
    detail.listPrice = listPrice;
  }

  const interestKind = Object.prototype.hasOwnProperty.call(input, "interest")
    ? String(input.interest || "").trim()
    : Object.prototype.hasOwnProperty.call(input, "interestStatus")
      ? String(input.interestStatus || "").trim()
      : null;

  if (
    !updates.length &&
    interestKind == null &&
    !Object.prototype.hasOwnProperty.call(input, "interest") &&
    !Object.prototype.hasOwnProperty.call(input, "interestStatus")
  ) {
    const err = new Error(
      'Send status, soldDate, salePrice, listPrice, and/or interest ("active"|"notInterested"|"pendingReactivation").'
    );
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  database.exec("BEGIN");
  try {
    if (updates.length) {
      updates.push("updated_at = ?", "deleted_at = NULL");
      params.push(stamp, value);
      database.prepare(`UPDATE houses SET ${updates.join(", ")} WHERE slug = ?`).run(...params);
    } else {
      database
        .prepare(`UPDATE houses SET updated_at = ?, deleted_at = NULL WHERE slug = ?`)
        .run(stamp, value);
    }

    if (interestKind != null) {
      const normalized = interestKind.toLowerCase();
      if (normalized === "active" || normalized === "" || normalized === "interested") {
        database.prepare(`DELETE FROM house_interest WHERE slug = ?`).run(value);
        detail.interest = "active";
      } else if (normalized === "notinterested" || normalized === "not-interested") {
        const since =
          (input.since && String(input.since).slice(0, 10)) || stamp.slice(0, 10);
        database
          .prepare(
            `INSERT INTO house_interest (slug, kind, since, requested, updated_at)
             VALUES (?, 'notInterested', ?, NULL, ?)
             ON CONFLICT(slug) DO UPDATE SET
               kind = 'notInterested',
               since = COALESCE(house_interest.since, excluded.since),
               requested = NULL,
               updated_at = excluded.updated_at`
          )
          .run(value, since, stamp);
        detail.interest = "notInterested";
        detail.since = since;
      } else if (
        normalized === "pendingreactivation" ||
        normalized === "pending-reactivation" ||
        normalized === "pending"
      ) {
        const requested =
          (input.requested && String(input.requested).slice(0, 10)) || stamp.slice(0, 10);
        database
          .prepare(
            `INSERT INTO house_interest (slug, kind, since, requested, updated_at)
             VALUES (?, 'pendingReactivation', NULL, ?, ?)
             ON CONFLICT(slug) DO UPDATE SET
               kind = 'pendingReactivation',
               since = NULL,
               requested = COALESCE(house_interest.requested, excluded.requested),
               updated_at = excluded.updated_at`
          )
          .run(value, requested, stamp);
        detail.interest = "pendingReactivation";
        detail.requested = requested;
      } else {
        const err = new Error(
          'interest must be "active", "notInterested", or "pendingReactivation".'
        );
        err.statusCode = 400;
        err.code = "INVALID_INTEREST";
        throw err;
      }
    }

    writeAudit(database, {
      slug: value,
      action: "status",
      actor,
      detail,
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  return getHouseRow(value);
}

function softDeleteHouse(slug, { actor = "api" } = {}) {
  const value = String(slug || "").trim();
  if (!value) {
    const err = new Error("Missing house slug.");
    err.statusCode = 400;
    err.code = "MISSING_SLUG";
    throw err;
  }
  const database = getDb();
  const existing = database.prepare(`SELECT * FROM houses WHERE slug = ?`).get(value);
  if (!existing) {
    const err = new Error("House not found.");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (existing.deleted_at) {
    return getHouseRow(value, { includeDeleted: true });
  }
  const stamp = nowIso();
  database.exec("BEGIN");
  try {
    database.prepare(`UPDATE houses SET deleted_at = ?, updated_at = ? WHERE slug = ?`).run(stamp, stamp, value);
    writeAudit(database, {
      slug: value,
      action: "soft_delete",
      actor,
      detail: {},
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return getHouseRow(value, { includeDeleted: true });
}

function loadInterestFromDb() {
  const database = getDb();
  const rows = database
    .prepare(`SELECT slug, kind, since, requested FROM house_interest ORDER BY slug ASC`)
    .all();
  const notInterested = [];
  const pendingReactivation = [];
  for (const row of rows) {
    if (row.kind === "notInterested") {
      notInterested.push({ slug: row.slug, since: row.since || null });
    } else if (row.kind === "pendingReactivation") {
      pendingReactivation.push({ slug: row.slug, requested: row.requested || null });
    }
  }
  return { notInterested, pendingReactivation, source: "db" };
}

function saveInterestToDb(state, { actor = "ui" } = {}) {
  const database = getDb();
  const stamp = nowIso();
  const notInterested = Array.isArray(state?.notInterested) ? state.notInterested : [];
  const pendingReactivation = Array.isArray(state?.pendingReactivation)
    ? state.pendingReactivation
    : [];

  database.exec("BEGIN");
  try {
    database.prepare(`DELETE FROM house_interest`).run();
    const insert = database.prepare(
      `INSERT INTO house_interest (slug, kind, since, requested, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const seen = new Set();
    for (const item of notInterested) {
      const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      insert.run(slug, "notInterested", item.since || null, null, stamp);
    }
    for (const item of pendingReactivation) {
      const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      insert.run(slug, "pendingReactivation", null, item.requested || null, stamp);
    }
    writeAudit(database, {
      slug: null,
      action: "interest_save",
      actor,
      detail: {
        notInterested: notInterested.length,
        pendingReactivation: pendingReactivation.length,
      },
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return loadInterestFromDb();
}

function loadRankingsFromDb() {
  const database = getDb();
  const rows = database
    .prepare(`SELECT slug FROM house_rankings ORDER BY sort_order ASC, slug ASC`)
    .all();
  return { slugs: rows.map((row) => row.slug), source: "db" };
}

function saveRankingsToDb(slugs, { actor = "ui" } = {}) {
  const database = getDb();
  const stamp = nowIso();
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(slugs) ? slugs : []) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    normalized.push(slug);
  }

  database.exec("BEGIN");
  try {
    database.prepare(`DELETE FROM house_rankings`).run();
    const insert = database.prepare(
      `INSERT INTO house_rankings (slug, sort_order, updated_at) VALUES (?, ?, ?)`
    );
    normalized.forEach((slug, index) => insert.run(slug, index, stamp));
    writeAudit(database, {
      slug: null,
      action: "rankings_save",
      actor,
      detail: { count: normalized.length },
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return normalized;
}

function importHousesFromDisk({
  housesDir = getHousesDir(),
  interestPath = process.env.INTEREST_PATH
    ? path.resolve(String(process.env.INTEREST_PATH).trim())
    : DEFAULT_INTEREST_PATH,
  rankingsPath = process.env.RANKINGS_PATH
    ? path.resolve(String(process.env.RANKINGS_PATH).trim())
    : DEFAULT_RANKINGS_PATH,
  actor = "import",
  force = false,
} = {}) {
  openHousesDb();
  const existingCount = countHouses({ includeDeleted: true });
  if (existingCount > 0 && !force) {
    return {
      imported: false,
      reason: "already_has_houses",
      houseCount: existingCount,
    };
  }

  const houses = loadHousesFromDir(housesDir);
  const database = getDb();
  let importedHouses = 0;
  let importedPrices = 0;
  let interest = { notInterested: [], pendingReactivation: [] };
  let rankingSlugs = [];

  if (interestPath && fs.existsSync(interestPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(interestPath, "utf8"));
      interest = {
        notInterested: Array.isArray(parsed?.notInterested) ? parsed.notInterested : [],
        pendingReactivation: Array.isArray(parsed?.pendingReactivation)
          ? parsed.pendingReactivation
          : [],
      };
    } catch (err) {
      console.error(`[houses-db] interest import skipped: ${err.message}`);
    }
  }

  if (rankingsPath && fs.existsSync(rankingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(rankingsPath, "utf8"));
      if (Array.isArray(parsed)) {
        const seen = new Set();
        for (const item of parsed) {
          if (typeof item !== "string") continue;
          const slug = item.trim();
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);
          rankingSlugs.push(slug);
        }
      }
    } catch (err) {
      console.error(`[houses-db] rankings import skipped: ${err.message}`);
    }
  }

  database.exec("BEGIN");
  try {
    if (force && existingCount > 0) {
      database.prepare(`DELETE FROM price_history`).run();
      database.prepare(`DELETE FROM houses`).run();
    }

    for (const house of houses) {
      const { slug, ...rest } = house;
      const { core, schoolIds, priceHistory, extras } = splitHousePayload(rest);
      const stamp = nowIso();
      const coreParams = buildCoreParams(core, null);
      for (const key of RESERVED_KEYS) delete extras[key];

      database
        .prepare(
          `INSERT INTO houses (
            slug, address, zillow_url, photo_url, status, list_price, sale_price, sold_date,
            year_built, sqft, price_per_sqft, beds, baths, lot_acres, last_updated, lat, lng,
            school_ids_json, garage_spaces, hoa_monthly, stories, has_pool, property_tax_annual,
            days_on_market, extras_json, deleted_at, created_at, updated_at
          ) VALUES (
            @slug, @address, @zillow_url, @photo_url, @status, @list_price, @sale_price, @sold_date,
            @year_built, @sqft, @price_per_sqft, @beds, @baths, @lot_acres, @last_updated, @lat, @lng,
            @school_ids_json, @garage_spaces, @hoa_monthly, @stories, @has_pool, @property_tax_annual,
            @days_on_market, @extras_json, NULL, @created_at, @updated_at
          )`
        )
        .run({
          slug,
          ...coreParams,
          school_ids_json: JSON.stringify(schoolIds || []),
          extras_json: JSON.stringify(extras || {}),
          created_at: stamp,
          updated_at: stamp,
        });
      importedHouses += 1;

      const history = priceHistory || [];
      const insertPrice = database.prepare(
        `INSERT INTO price_history (slug, week, price) VALUES (?, ?, ?)`
      );
      for (const row of history) {
        insertPrice.run(slug, row.week, row.price);
        importedPrices += 1;
      }
    }

    database.prepare(`DELETE FROM house_interest`).run();
    const insertInterest = database.prepare(
      `INSERT INTO house_interest (slug, kind, since, requested, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const stamp = nowIso();
    const seenInterest = new Set();
    for (const item of interest.notInterested) {
      const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
      if (!slug || seenInterest.has(slug)) continue;
      seenInterest.add(slug);
      insertInterest.run(slug, "notInterested", item.since || null, null, stamp);
    }
    for (const item of interest.pendingReactivation) {
      const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
      if (!slug || seenInterest.has(slug)) continue;
      seenInterest.add(slug);
      insertInterest.run(slug, "pendingReactivation", null, item.requested || null, stamp);
    }

    database.prepare(`DELETE FROM house_rankings`).run();
    const insertRank = database.prepare(
      `INSERT INTO house_rankings (slug, sort_order, updated_at) VALUES (?, ?, ?)`
    );
    rankingSlugs.forEach((slug, index) => insertRank.run(slug, index, stamp));

    writeAudit(database, {
      slug: null,
      action: "import",
      actor,
      detail: {
        houses: importedHouses,
        pricePoints: importedPrices,
        interestNotInterested: interest.notInterested.length,
        interestPending: interest.pendingReactivation.length,
        rankings: rankingSlugs.length,
        housesDir,
        force: Boolean(force),
      },
    });
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  return {
    imported: true,
    houseCount: importedHouses,
    pricePoints: importedPrices,
    rankings: rankingSlugs.length,
    interest: {
      notInterested: interest.notInterested.length,
      pendingReactivation: interest.pendingReactivation.length,
    },
    housesDir,
  };
}

/**
 * On startup: if houses table is empty, seed from committed JSON.
 * Idempotent — never re-imports when any house row exists.
 */
function maybeImportHousesFromDisk(options = {}) {
  openHousesDb();
  if (countHouses({ includeDeleted: true }) > 0) {
    return { imported: false, reason: "already_has_houses", houseCount: countHouses({ includeDeleted: true }) };
  }
  const housesDir = options.housesDir || getHousesDir();
  if (!fs.existsSync(housesDir)) {
    return { imported: false, reason: "houses_dir_missing", housesDir };
  }
  const files = fs.readdirSync(housesDir).filter((name) => isHouseFilename(name));
  if (files.length === 0) {
    return { imported: false, reason: "no_house_files", housesDir };
  }
  return importHousesFromDisk({ ...options, housesDir, force: false });
}

function exportAllData() {
  const houses = listHouses({ includeDeleted: true });
  const interest = loadInterestFromDb();
  const rankings = loadRankingsFromDb();
  return {
    exportedAt: nowIso(),
    houses,
    interest: {
      notInterested: interest.notInterested,
      pendingReactivation: interest.pendingReactivation,
    },
    rankings: rankings.slugs,
  };
}

function csvEscape(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function exportCsv() {
  const data = exportAllData();
  const interestBySlug = new Map();
  for (const entry of data.interest.notInterested) {
    interestBySlug.set(entry.slug, { interestStatus: "notInterested", since: entry.since, requested: null });
  }
  for (const entry of data.interest.pendingReactivation) {
    interestBySlug.set(entry.slug, {
      interestStatus: "pendingReactivation",
      since: null,
      requested: entry.requested,
    });
  }
  const rankIndex = new Map(data.rankings.map((slug, index) => [slug, index + 1]));

  const headers = [
    "slug",
    "address",
    "status",
    "listPrice",
    "salePrice",
    "soldDate",
    "yearBuilt",
    "sqft",
    "pricePerSqft",
    "beds",
    "baths",
    "lotAcres",
    "garageSpaces",
    "hoaMonthly",
    "stories",
    "hasPool",
    "propertyTaxAnnual",
    "daysOnMarket",
    "lat",
    "lng",
    "zillowUrl",
    "photoUrl",
    "lastUpdated",
    "schoolIds",
    "interestStatus",
    "interestSince",
    "interestRequested",
    "rank",
    "latestPrice",
    "latestPriceWeek",
    "deletedAt",
    "updatedAt",
  ];

  const lines = [headers.join(",")];
  for (const house of data.houses) {
    const interest = interestBySlug.get(house.slug) || {
      interestStatus: "active",
      since: null,
      requested: null,
    };
    const history = Array.isArray(house.priceHistory) ? house.priceHistory : [];
    let latest = null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].price != null) {
        latest = history[i];
        break;
      }
    }
    const row = {
      slug: house.slug,
      address: house.address,
      status: house.status,
      listPrice: house.listPrice,
      salePrice: house.salePrice,
      soldDate: house.soldDate,
      yearBuilt: house.yearBuilt,
      sqft: house.sqft,
      pricePerSqft: house.pricePerSqft,
      beds: house.beds,
      baths: house.baths,
      lotAcres: house.lotAcres,
      garageSpaces: house.garageSpaces,
      hoaMonthly: house.hoaMonthly,
      stories: house.stories,
      hasPool: house.hasPool,
      propertyTaxAnnual: house.propertyTaxAnnual,
      daysOnMarket: house.daysOnMarket,
      lat: house.lat,
      lng: house.lng,
      zillowUrl: house.zillowUrl,
      photoUrl: house.photoUrl,
      lastUpdated: house.lastUpdated,
      schoolIds: (house.schoolIds || []).join("|"),
      interestStatus: interest.interestStatus,
      interestSince: interest.since,
      interestRequested: interest.requested,
      rank: rankIndex.get(house.slug) || "",
      latestPrice: latest?.price ?? "",
      latestPriceWeek: latest?.week ?? "",
      deletedAt: house.deletedAt || "",
      updatedAt: house.updatedAt || "",
    };
    lines.push(headers.map((key) => csvEscape(row[key])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  CORE_FIELDS,
  DEFAULT_DB_PATH,
  getHousesDbPath,
  openHousesDb,
  closeHousesDb,
  resetHousesDb,
  ensureSchema,
  countHouses,
  listHouses,
  getHouseRow,
  upsertHouse,
  appendPricePoint,
  patchHouseStatus,
  softDeleteHouse,
  loadInterestFromDb,
  saveInterestToDb,
  loadRankingsFromDb,
  saveRankingsToDb,
  importHousesFromDisk,
  maybeImportHousesFromDisk,
  exportAllData,
  exportCsv,
  splitHousePayload,
  HOUSES_DIR,
  SAMPLE_DIR,
};
