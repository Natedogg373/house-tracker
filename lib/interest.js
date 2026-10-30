const fs = require("fs");
const path = require("path");

const DEFAULT_INTEREST_PATH = path.join(__dirname, "..", "data", "interest.json");
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function getInterestPath(env = process.env) {
  if (env.INTEREST_PATH && String(env.INTEREST_PATH).trim()) {
    return path.resolve(String(env.INTEREST_PATH).trim());
  }
  return DEFAULT_INTEREST_PATH;
}

function emptyInterest() {
  return { notInterested: [], pendingReactivation: [] };
}

function todayISO(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

function isoDay(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(ISO_DAY);
  return match ? match[0] : null;
}

function normalizeEntry(item, dateKey) {
  if (!item || typeof item !== "object") return null;
  const slug = typeof item.slug === "string" ? item.slug.trim() : "";
  if (!slug) return null;
  return { slug, [dateKey]: isoDay(item[dateKey]) };
}

function normalizeInterest(parsed) {
  const state = emptyInterest();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return state;

  const seenNot = new Set();
  for (const item of Array.isArray(parsed.notInterested) ? parsed.notInterested : []) {
    const entry = normalizeEntry(item, "since");
    if (!entry || seenNot.has(entry.slug)) continue;
    seenNot.add(entry.slug);
    state.notInterested.push({ slug: entry.slug, since: entry.since });
  }

  const seenPending = new Set();
  for (const item of Array.isArray(parsed.pendingReactivation) ? parsed.pendingReactivation : []) {
    const entry = normalizeEntry(item, "requested");
    if (!entry || seenPending.has(entry.slug) || seenNot.has(entry.slug)) continue;
    seenPending.add(entry.slug);
    state.pendingReactivation.push({ slug: entry.slug, requested: entry.requested });
  }

  return state;
}

function loadInterest(filePath = getInterestPath()) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ...emptyInterest(), source: "default" };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { ...normalizeInterest(parsed), source: "file" };
  } catch (err) {
    console.error(`[interest] cannot read ${filePath}:`, err.message);
    return { ...emptyInterest(), source: "default" };
  }
}

function saveInterest(state, filePath = getInterestPath()) {
  const normalized = normalizeInterest(state);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const payload = {
    notInterested: normalized.notInterested,
    pendingReactivation: normalized.pendingReactivation,
  };
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
  return payload;
}

function interestStatus(state, slug) {
  const value = String(slug || "").trim();
  if (!value) return "active";
  if ((state?.pendingReactivation || []).some((entry) => entry.slug === value)) {
    return "pendingReactivation";
  }
  if ((state?.notInterested || []).some((entry) => entry.slug === value)) {
    return "notInterested";
  }
  return "active";
}

function isHiddenFromActive(state, slug) {
  const status = interestStatus(state, slug);
  return status === "notInterested" || status === "pendingReactivation";
}

function hiddenSlugSet(state) {
  const slugs = new Set();
  for (const entry of state?.notInterested || []) slugs.add(entry.slug);
  for (const entry of state?.pendingReactivation || []) slugs.add(entry.slug);
  return slugs;
}

function markNotInterested(state, slug, since = todayISO()) {
  const normalized = normalizeInterest(state);
  const value = String(slug || "").trim();
  if (!value) return normalized;

  normalized.pendingReactivation = normalized.pendingReactivation.filter((entry) => entry.slug !== value);
  const existing = normalized.notInterested.find((entry) => entry.slug === value);
  if (existing) {
    if (!existing.since) existing.since = since;
    return normalized;
  }
  normalized.notInterested.push({ slug: value, since });
  return normalized;
}

function requestReactivation(state, slug, requested = todayISO()) {
  const normalized = normalizeInterest(state);
  const value = String(slug || "").trim();
  if (!value) return normalized;

  const previous = normalized.notInterested.find((entry) => entry.slug === value);
  normalized.notInterested = normalized.notInterested.filter((entry) => entry.slug !== value);
  const existing = normalized.pendingReactivation.find((entry) => entry.slug === value);
  if (existing) {
    if (!existing.requested) existing.requested = requested;
    return normalized;
  }
  normalized.pendingReactivation.push({
    slug: value,
    requested: requested || previous?.since || todayISO(),
  });
  return normalized;
}

function reactivationInput(house) {
  const url = String(house?.zillowUrl || "").trim();
  if (/^https?:\/\//i.test(url)) return url;
  return String(house?.address || house?.slug || "").trim();
}

function findInterestEntry(state, slug) {
  const value = String(slug || "").trim();
  return (
    (state?.pendingReactivation || []).find((entry) => entry.slug === value) ||
    (state?.notInterested || []).find((entry) => entry.slug === value) ||
    null
  );
}

module.exports = {
  DEFAULT_INTEREST_PATH,
  getInterestPath,
  emptyInterest,
  todayISO,
  normalizeInterest,
  loadInterest,
  saveInterest,
  interestStatus,
  isHiddenFromActive,
  hiddenSlugSet,
  markNotInterested,
  requestReactivation,
  reactivationInput,
  findInterestEntry,
};
