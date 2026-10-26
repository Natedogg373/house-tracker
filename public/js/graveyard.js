import { formatDate, formatMoney, show, statusClass } from "./common.js";

const sampleBanner = document.querySelector("#sample-banner");
const errorBanner = document.querySelector("#error-banner");
const empty = document.querySelector("#empty");
const view = document.querySelector("#graveyard-view");
const countEl = document.querySelector("#graveyard-count");
const listEl = document.querySelector("#graveyard-list");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zillowHref(url) {
  const value = String(url || "");
  return /^https?:\/\//i.test(value) ? value : "";
}

function formatSalePrice(value) {
  if (value == null) return "Unknown";
  return formatMoney(value);
}

function formatDays(value) {
  if (value == null) return "Unknown";
  return `${Number(value).toLocaleString("en-US")}`;
}

function thumbHtml(house) {
  if (house.photoUrl) {
    return `<img class="grave-thumb" src="${escapeHtml(house.photoUrl)}" alt="" />`;
  }
  return `<div class="grave-thumb grave-thumb-empty" aria-hidden="true"></div>`;
}

function addressHtml(house) {
  const label = escapeHtml(house.address || house.slug || "Unknown address");
  const href = zillowHref(house.zillowUrl);
  if (!href) return label;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function metric(label, value) {
  return `<div class="grave-metric">
    <span class="label">${escapeHtml(label)}</span>
    <div class="value">${value}</div>
  </div>`;
}

function cardHtml(house) {
  const sold = house.soldDate ? ` · Sold ${escapeHtml(formatDate(house.soldDate))}` : "";
  return `<li class="grave-card">
    ${thumbHtml(house)}
    <div class="grave-body">
      <h2 class="grave-address">${addressHtml(house)}</h2>
      <p class="grave-meta">
        <span class="pill ${statusClass(house.status)}">${escapeHtml(house.status || "Sold")}</span>${sold}
      </p>
      <div class="grave-metrics">
        ${metric("Original list", escapeHtml(formatMoney(house.originalPrice)))}
        ${metric("Lowest list", escapeHtml(formatMoney(house.lowestPrice)))}
        ${metric("Sale price", escapeHtml(formatSalePrice(house.salePrice)))}
        ${metric("Days on market", escapeHtml(formatDays(house.daysOnMarket)))}
      </div>
    </div>
  </li>`;
}

function render(payload) {
  const houses = payload.houses || [];
  sampleBanner.hidden = payload.source !== "sample";
  errorBanner.hidden = true;
  if (!houses.length) {
    show(empty, true);
    show(view, false);
    return;
  }
  show(empty, false);
  show(view, true);
  const noun = houses.length === 1 ? "sold house" : "sold houses";
  countEl.textContent = `${houses.length} ${noun}`;
  listEl.innerHTML = houses.map(cardHtml).join("");
}

async function load() {
  try {
    const res = await fetch("/api/graveyard");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load the graveyard.");
    render(data);
  } catch (err) {
    sampleBanner.hidden = true;
    errorBanner.hidden = false;
    errorBanner.textContent = err.message;
    show(empty, false);
    show(view, false);
  }
}

load();
