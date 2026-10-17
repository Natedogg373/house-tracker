const fs = require("fs");
const path = require("path");

const HOUSES_DIR = path.join(__dirname, "..", "data", "houses");
const SAMPLE_DIR = path.join(__dirname, "..", "data", "sample");
const DEFAULT_BUDGET = 700000;

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function isHouseFilename(filename) {
  const base = path.basename(filename);
  return base.toLowerCase().endsWith(".json") && base.toLowerCase() !== "index.json";
}

function loadHousesFromDir(dir) {
  if (!dir || !fs.existsSync(dir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`[houses] cannot read ${dir}:`, err.message);
    return [];
  }

  const houses = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isHouseFilename(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        console.warn(`[houses] skipping ${entry.name}: expected a house object`);
        continue;
      }
      const slug = entry.name.replace(/\.json$/i, "");
      houses.push({ slug, ...parsed });
    } catch (err) {
      console.error(`[houses] skipping ${entry.name}:`, err.message);
    }
  }

  houses.sort((a, b) =>
    String(a.address || a.slug).localeCompare(String(b.address || b.slug), "en", {
      sensitivity: "base",
    })
  );
  return houses;
}

function getHousesDir(env = process.env) {
  if (env.HOUSES_DIR && String(env.HOUSES_DIR).trim()) {
    return path.resolve(String(env.HOUSES_DIR).trim());
  }
  return HOUSES_DIR;
}

function resolveHouses({
  housesDir = getHousesDir(),
  sampleDir = SAMPLE_DIR,
  useSampleData = process.env.USE_SAMPLE_DATA,
} = {}) {
  if (isTruthy(useSampleData)) {
    return { source: "sample", houses: loadHousesFromDir(sampleDir) };
  }

  const houses = loadHousesFromDir(housesDir);
  if (houses.length === 0) {
    return { source: "sample", houses: loadHousesFromDir(sampleDir) };
  }
  return { source: "houses", houses };
}

function getBudget() {
  const raw = Number(process.env.BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BUDGET;
}

module.exports = {
  HOUSES_DIR,
  SAMPLE_DIR,
  DEFAULT_BUDGET,
  isHouseFilename,
  loadHousesFromDir,
  getHousesDir,
  resolveHouses,
  getBudget,
};
