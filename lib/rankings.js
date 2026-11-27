const fs = require("fs");
const path = require("path");

const DEFAULT_RANKINGS_PATH = path.join(__dirname, "..", "data", "rankings.json");

function getRankingsPath(env = process.env) {
  if (env.RANKINGS_PATH && String(env.RANKINGS_PATH).trim()) {
    return path.resolve(String(env.RANKINGS_PATH).trim());
  }
  return DEFAULT_RANKINGS_PATH;
}

function normalizeSlugs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const slugs = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

function loadRankingsFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { slugs: [], source: "default" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { slugs: normalizeSlugs(parsed), source: "file" };
  } catch (err) {
    console.error(`[rankings] cannot read ${filePath}:`, err.message);
    return { slugs: [], source: "default" };
  }
}

/**
 * Load rankings. Pass an explicit filePath to read JSON (tests / import).
 * Otherwise reads from the SQLite houses DB.
 */
function loadRankings(filePath) {
  if (filePath) {
    return loadRankingsFromFile(filePath);
  }
  try {
    const { loadRankingsFromDb, openHousesDb } = require("./houses-db");
    openHousesDb();
    return loadRankingsFromDb();
  } catch (err) {
    console.error("[rankings] DB read failed, falling back to JSON:", err.message);
    return loadRankingsFromFile(getRankingsPath());
  }
}

function applyRankings(houses, savedSlugs) {
  const list = Array.isArray(houses) ? houses : [];
  const bySlug = new Map();
  for (const house of list) {
    if (house && house.slug && !bySlug.has(house.slug)) {
      bySlug.set(house.slug, house);
    }
  }

  const ordered = [];
  const used = new Set();
  for (const slug of normalizeSlugs(savedSlugs)) {
    const house = bySlug.get(slug);
    if (!house || used.has(slug)) continue;
    ordered.push(house);
    used.add(slug);
  }
  for (const house of list) {
    if (!house?.slug || used.has(house.slug)) continue;
    ordered.push(house);
    used.add(house.slug);
  }
  return ordered;
}

function saveRankingsToFile(slugs, filePath = getRankingsPath()) {
  const normalized = normalizeSlugs(slugs);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
  return normalized;
}

/**
 * Save rankings. Pass an explicit filePath to write JSON (tests).
 * Otherwise writes to the SQLite houses DB.
 */
function saveRankings(slugs, filePath) {
  const normalized = normalizeSlugs(slugs);
  if (filePath) {
    return saveRankingsToFile(normalized, filePath);
  }
  try {
    const { saveRankingsToDb, openHousesDb } = require("./houses-db");
    openHousesDb();
    return saveRankingsToDb(normalized, { actor: "ui" });
  } catch (err) {
    console.error("[rankings] DB write failed, falling back to JSON:", err.message);
    return saveRankingsToFile(normalized, getRankingsPath());
  }
}

function moveToRank(list, fromIndex, rank) {
  const items = Array.isArray(list) ? list.slice() : [];
  const n = items.length;
  if (!n || fromIndex < 0 || fromIndex >= n) return items;

  // Empty / whitespace / non-numeric input means "keep current rank".
  if (rank === "" || rank == null) return items;
  const raw = typeof rank === "string" ? rank.trim() : rank;
  if (raw === "") return items;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return items;

  const toIndex = Math.min(n, Math.max(1, Math.round(parsed))) - 1;
  if (toIndex === fromIndex) return items;

  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  return items;
}

/** Move one item by a relative step count (e.g. -1 up, +1 down). */
function moveBySteps(list, fromIndex, steps) {
  const items = Array.isArray(list) ? list.slice() : [];
  const n = items.length;
  if (!n || fromIndex < 0 || fromIndex >= n) return items;
  const parsed = Number(steps);
  if (!Number.isFinite(parsed) || parsed === 0) return items;
  return moveToRank(items, fromIndex, fromIndex + 1 + Math.round(parsed));
}

module.exports = {
  DEFAULT_RANKINGS_PATH,
  getRankingsPath,
  normalizeSlugs,
  loadRankings,
  applyRankings,
  saveRankings,
  moveToRank,
  moveBySteps,
};
