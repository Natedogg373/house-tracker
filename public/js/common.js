export const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const moneyExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const HOUSE_COLORS = [
  "#c2410c",
  "#1d4ed8",
  "#7c3aed",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#365314",
  "#0369a1",
  "#9f1239",
  "#4338ca",
  "#047857",
  "#a16207",
  "#6d28d9",
  "#b91c1c",
  "#0e7490",
];

export function formatMoney(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  return Number.isInteger(n) ? money.format(n) : moneyExact.format(n);
}

export function formatNumber(value, suffix = "") {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toLocaleString("en-US")}${suffix}`;
}

export function formatYear(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
  return String(Math.round(Number(value)));
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function houseAge(yearBuilt, now = new Date()) {
  if (yearBuilt == null || Number.isNaN(Number(yearBuilt))) return "—";
  const age = now.getFullYear() - Number(yearBuilt);
  if (age < 0) return "—";
  if (age === 1) return "1 year";
  return `${age} years`;
}

export function pricePerSqft(house) {
  if (house.pricePerSqft != null && !Number.isNaN(Number(house.pricePerSqft))) {
    return `${formatMoney(house.pricePerSqft)} / sq ft`;
  }
  if (house.listPrice && house.sqft) {
    return `${formatMoney(Math.round(Number(house.listPrice) / Number(house.sqft)))} / sq ft`;
  }
  return "—";
}

export function budgetDelta(listPrice, budget) {
  if (listPrice == null || Number.isNaN(Number(listPrice))) return null;
  const delta = Number(listPrice) - Number(budget);
  if (delta > 0) {
    return { kind: "over", text: `Over budget by ${formatMoney(delta)}` };
  }
  if (delta < 0) {
    return { kind: "under", text: `Under budget by ${formatMoney(Math.abs(delta))}` };
  }
  return { kind: "at", text: `Right at the ${formatMoney(budget)} budget` };
}

export function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (/\bsold\b/.test(value)) return "sold";
  if (value.includes("pending")) return "pending";
  if (value.includes("contingent")) return "contingent";
  if (value.includes("sale") || value.includes("listed") || value.includes("active")) return "sale";
  return "";
}

export function isSoldStatus(status) {
  return /\bsold\b/i.test(String(status || "").trim());
}

export function zillowHref(house) {
  const listing = String(house?.zillowUrl || "").trim();
  if (/^https?:\/\//i.test(listing)) return listing;
  const address = String(house?.address || "").trim();
  if (!address) return "";
  return `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function show(el, on) {
  el.classList.toggle("hidden", !on);
}

export async function fetchHouses() {
  const res = await fetch("/api/houses");
  if (!res.ok) throw new Error("Could not load houses.");
  return res.json();
}

export function detailsUrl(slug) {
  return `/?house=${encodeURIComponent(slug)}`;
}

export function slugFromLocation(location = window.location) {
  return new URLSearchParams(location.search).get("house") || "";
}

export function setHouseUrl(slug, { replace = true } = {}) {
  const url = new URL(window.location.href);
  url.pathname = "/";
  if (slug) url.searchParams.set("house", slug);
  else url.searchParams.delete("house");
  const method = replace ? "replaceState" : "pushState";
  history[method]({ house: slug || "" }, "", `${url.pathname}${url.search}${url.hash}`);
}

export function hiddenInterestSlugs(interest) {
  const slugs = new Set();
  for (const entry of interest?.notInterested || []) slugs.add(entry.slug);
  for (const entry of interest?.pendingReactivation || []) slugs.add(entry.slug);
  return slugs;
}

export function isActiveHouse(house, interest) {
  if (!house) return false;
  if (isSoldStatus(house.status)) return false;
  return !hiddenInterestSlugs(interest).has(house.slug);
}

export function houseLatLng(house) {
  const lat = Number(house?.lat ?? house?.coords?.lat);
  const lng = Number(house?.lng ?? house?.lon ?? house?.coords?.lng ?? house?.coords?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function colorForIndex(index) {
  return HOUSE_COLORS[index % HOUSE_COLORS.length];
}

export function schoolLevelLabel(level) {
  if (level === "elementary") return "Elementary";
  if (level === "middle") return "Middle";
  if (level === "high") return "High";
  return "School";
}

export function schoolRatingLabel(rating) {
  if (rating == null || rating === "" || Number.isNaN(Number(rating))) return "Not rated";
  return `${Number(rating)}/10`;
}

export function schoolRatingClass(rating) {
  if (rating == null || rating === "" || Number.isNaN(Number(rating))) return "unrated";
  const n = Number(rating);
  if (n >= 8) return "high";
  if (n >= 5) return "mid";
  return "low";
}

const SCHOOL_LEVEL_ORDER = { elementary: 0, middle: 1, high: 2 };

export function sortSchoolsByLevel(schools) {
  return [...(schools || [])].sort((a, b) => {
    const da = SCHOOL_LEVEL_ORDER[a?.level] ?? 99;
    const db = SCHOOL_LEVEL_ORDER[b?.level] ?? 99;
    if (da !== db) return da - db;
    return String(a?.name || "").localeCompare(String(b?.name || ""), "en", { sensitivity: "base" });
  });
}

export function schoolsForHouse(house, schools) {
  const ids = Array.isArray(house?.schoolIds) ? house.schoolIds : [];
  const byId = new Map((schools || []).map((school) => [school.id, school]));
  const found = [];
  for (const id of ids) {
    const school = byId.get(id);
    if (school) found.push(school);
  }
  return sortSchoolsByLevel(found);
}
