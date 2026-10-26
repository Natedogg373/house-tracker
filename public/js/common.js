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

export function show(el, on) {
  el.classList.toggle("hidden", !on);
}

export async function fetchHouses() {
  const res = await fetch("/api/houses");
  if (!res.ok) throw new Error("Could not load houses.");
  return res.json();
}
