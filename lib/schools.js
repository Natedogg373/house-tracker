const fs = require("fs");
const path = require("path");

const DEFAULT_SCHOOLS_PATH = path.join(__dirname, "..", "data", "schools.json");
const SAMPLE_SCHOOLS_PATH = path.join(__dirname, "..", "data", "sample", "schools.json");
const LEVELS = new Set(["elementary", "middle", "high"]);

function getSchoolsPath(env = process.env) {
  if (env.SCHOOLS_PATH && String(env.SCHOOLS_PATH).trim()) {
    return path.resolve(String(env.SCHOOLS_PATH).trim());
  }
  return DEFAULT_SCHOOLS_PATH;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSchool(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const lat = toFiniteNumber(item.lat);
  const lng = toFiniteNumber(item.lng ?? item.lon);
  if (!id || !name || lat == null || lng == null) return null;
  const levelRaw = String(item.level || "").trim().toLowerCase();
  const level = LEVELS.has(levelRaw) ? levelRaw : null;
  const ratingNum = toFiniteNumber(item.rating);
  const rating = ratingNum == null ? null : Math.min(10, Math.max(0, ratingNum));
  const district = typeof item.district === "string" && item.district.trim() ? item.district.trim() : null;
  return { id, name, level, lat, lng, rating, district };
}

function loadSchoolsFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { schools: [], source: "none" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      console.warn(`[schools] ${filePath} is not an array; ignoring`);
      return { schools: [], source: "none" };
    }
    const seen = new Set();
    const schools = [];
    for (const item of parsed) {
      const school = normalizeSchool(item);
      if (!school || seen.has(school.id)) continue;
      seen.add(school.id);
      schools.push(school);
    }
    return { schools, source: "file" };
  } catch (err) {
    console.error(`[schools] cannot read ${filePath}:`, err.message);
    return { schools: [], source: "none" };
  }
}

function resolveSchools({
  source,
  schoolsPath = getSchoolsPath(),
  samplePath = SAMPLE_SCHOOLS_PATH,
} = {}) {
  if (source === "sample") {
    const loaded = loadSchoolsFromFile(samplePath);
    return { schools: loaded.schools, source: loaded.schools.length ? "sample" : "none" };
  }
  return loadSchoolsFromFile(schoolsPath);
}

module.exports = {
  DEFAULT_SCHOOLS_PATH,
  SAMPLE_SCHOOLS_PATH,
  getSchoolsPath,
  normalizeSchool,
  loadSchoolsFromFile,
  resolveSchools,
};
