import { detailsUrl, escapeHtml, formatDate, formatMoney, show, statusClass } from "./common.js";

const sampleBanner = document.querySelector("#sample-banner");
const errorBanner = document.querySelector("#error-banner");
const actionBanner = document.querySelector("#action-banner");
const empty = document.querySelector("#empty");
const view = document.querySelector("#graveyard-view");
const soldSection = document.querySelector("#sold-section");
const notSection = document.querySelector("#not-interested-section");
const countEl = document.querySelector("#graveyard-count");
const notCountEl = document.querySelector("#not-interested-count");
const listEl = document.querySelector("#graveyard-list");
const notListEl = document.querySelector("#not-interested-list");

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

function addressHtml(house, { details = false } = {}) {
  const label = escapeHtml(house.address || house.slug || "Unknown address");
  if (details && house.slug) {
    return `<a href="${escapeHtml(detailsUrl(house.slug))}">${label}</a>`;
  }
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

function soldCardHtml(house) {
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

function notInterestedCardHtml(house) {
  const pending = Boolean(house.pending);
  const since = house.since || house.requested;
  const action = pending
    ? `<p class="grave-status">Checking if still active…</p>`
    : `<div class="actions">
        <button type="button" class="secondary reactivate-btn" data-slug="${escapeHtml(house.slug)}">
          Move back to interested
        </button>
      </div>`;
  return `<li class="grave-card" data-slug="${escapeHtml(house.slug)}">
    ${thumbHtml(house)}
    <div class="grave-body">
      <h2 class="grave-address">${addressHtml(house, { details: true })}</h2>
      <p class="grave-meta">
        <span class="pill not-interested">${pending ? "Checking" : "No longer interested"}</span>
        ${since ? `<span>Since ${escapeHtml(formatDate(since))}</span>` : ""}
      </p>
      <div class="grave-metrics">
        ${metric("Last list price", escapeHtml(formatMoney(house.listPrice)))}
        ${metric("Since", escapeHtml(formatDate(since)))}
      </div>
      ${action}
    </div>
  </li>`;
}

function showAction(kind, text) {
  actionBanner.hidden = false;
  actionBanner.className = `banner ${kind}`;
  actionBanner.textContent = text;
}

function render(payload) {
  const sold = payload.sold || payload.houses || [];
  const notInterested = payload.notInterested || [];
  sampleBanner.hidden = payload.source !== "sample";
  errorBanner.hidden = true;
  if (!sold.length && !notInterested.length) {
    show(empty, true);
    show(view, false);
    return;
  }
  show(empty, false);
  show(view, true);

  show(soldSection, sold.length > 0);
  if (sold.length) {
    const noun = sold.length === 1 ? "sold house" : "sold houses";
    countEl.textContent = `${sold.length} ${noun}`;
    listEl.innerHTML = sold.map(soldCardHtml).join("");
  }

  show(notSection, notInterested.length > 0);
  if (notInterested.length) {
    const noun = notInterested.length === 1 ? "house" : "houses";
    notCountEl.textContent = `${notInterested.length} ${noun}`;
    notListEl.innerHTML = notInterested.map(notInterestedCardHtml).join("");
  }
}

notListEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".reactivate-btn");
  if (!button) return;
  const slug = button.dataset.slug;
  const card = button.closest(".grave-card");
  const label = card?.querySelector(".grave-address")?.textContent?.trim() || slug;
  if (!window.confirm(`Ask House Tracker to check whether ${label} is still active?`)) return;
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const res = await fetch("/api/interest/reactivate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && data.code !== "WEBHOOK_NOT_CONFIGURED" && data.code !== "WEBHOOK_FAILED") {
      showAction("error", data.error || "Could not request reactivation.");
      button.disabled = false;
      button.textContent = "Move back to interested";
      return;
    }
    if (!res.ok) {
      showAction("error", data.error || "Webhook failed; we’ll still show this house as checking.");
    } else {
      showAction("ok", "House Tracker is checking whether this listing is still active.");
    }
    await load();
  } catch {
    showAction("error", "Could not reach the local server.");
    button.disabled = false;
    button.textContent = "Move back to interested";
  }
});

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
