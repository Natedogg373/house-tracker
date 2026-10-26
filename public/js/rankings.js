import { fetchHouses, formatMoney, show, statusClass } from "./common.js";

const listEl = document.querySelector("#rank-list");
const emptyEl = document.querySelector("#empty");
const sampleBanner = document.querySelector("#sample-banner");
const saveStatus = document.querySelector("#save-status");

let houses = [];
let persistTimer = 0;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moveToRank(list, fromIndex, rank) {
  const items = list.slice();
  const n = items.length;
  if (!n || fromIndex < 0 || fromIndex >= n) return items;
  const parsed = Number(rank);
  const toIndex = Number.isFinite(parsed)
    ? Math.min(n, Math.max(1, Math.round(parsed))) - 1
    : fromIndex;
  if (toIndex === fromIndex) return items;
  const [item] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, item);
  return items;
}

function orderHouses(all, slugs) {
  const bySlug = new Map(all.map((house) => [house.slug, house]));
  const ordered = [];
  const used = new Set();
  for (const slug of slugs || []) {
    const house = bySlug.get(slug);
    if (!house || used.has(slug)) continue;
    ordered.push(house);
    used.add(slug);
  }
  for (const house of all) {
    if (used.has(house.slug)) continue;
    ordered.push(house);
  }
  return ordered;
}

function currentSlugs() {
  return [...listEl.querySelectorAll(".rank-card")].map((card) => card.dataset.slug);
}

function showSave(kind, text) {
  saveStatus.hidden = false;
  saveStatus.className = `banner ${kind}`;
  saveStatus.textContent = text;
}

async function persist(nextHouses) {
  houses = nextHouses;
  render();
  const slugs = houses.map((house) => house.slug);
  try {
    const res = await fetch("/api/rankings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showSave("error", data.error || "Could not save the ranking.");
      return;
    }
    showSave("ok", "Order saved.");
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      saveStatus.hidden = true;
    }, 2400);
  } catch {
    showSave("error", "Could not save the ranking.");
  }
}

function applyInputRank(card) {
  const input = card.querySelector(".rank-input");
  const slugs = currentSlugs();
  const fromIndex = slugs.indexOf(card.dataset.slug);
  const nextSlugs = moveToRank(slugs, fromIndex, input.value);
  if (nextSlugs.join("\0") === slugs.join("\0")) {
    input.value = String(fromIndex + 1);
    return;
  }
  const bySlug = new Map(houses.map((house) => [house.slug, house]));
  persist(nextSlugs.map((slug) => bySlug.get(slug)).filter(Boolean));
}

function thumbHtml(house) {
  const src = String(house.photoUrl || "");
  const alt = house.address ? `Photo of ${house.address}` : "House photo";
  if (src) {
    return `<img class="rank-thumb" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
  }
  return `<div class="rank-thumb rank-thumb-empty" aria-hidden="true"></div>`;
}

function cardHtml(house, rank, total) {
  const status = house.status || "Status unknown";
  const pillClass = statusClass(house.status);
  const price = formatMoney(house.listPrice);
  return `<li class="rank-card" data-slug="${escapeHtml(house.slug)}">
    <button type="button" class="rank-handle" aria-label="Drag to reorder ${escapeHtml(house.address || house.slug)}">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="7" cy="5" r="1.6" />
        <circle cx="13" cy="5" r="1.6" />
        <circle cx="7" cy="10" r="1.6" />
        <circle cx="13" cy="10" r="1.6" />
        <circle cx="7" cy="15" r="1.6" />
        <circle cx="13" cy="15" r="1.6" />
      </svg>
    </button>
    <label class="rank-number">
      <span class="visually-hidden">Rank for ${escapeHtml(house.address || house.slug)}</span>
      <input
        class="rank-input"
        type="number"
        inputmode="numeric"
        min="1"
        max="${total}"
        step="1"
        value="${rank}"
      />
    </label>
    ${thumbHtml(house)}
    <div class="rank-body">
      <p class="rank-address">${escapeHtml(house.address || house.slug)}</p>
      <p class="rank-meta">
        <span>${escapeHtml(price)}</span>
        <span class="pill ${pillClass}">${escapeHtml(status)}</span>
      </p>
    </div>
  </li>`;
}

function render() {
  const total = houses.length;
  show(emptyEl, total === 0);
  show(listEl, total > 0);
  listEl.innerHTML = houses.map((house, index) => cardHtml(house, index + 1, total)).join("");
  for (const img of listEl.querySelectorAll(".rank-thumb[src]")) {
    img.addEventListener("error", () => {
      img.replaceWith(Object.assign(document.createElement("div"), { className: "rank-thumb rank-thumb-empty" }));
    });
  }
}

function bindList() {
  listEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target.closest(".rank-input");
    if (!input) return;
    event.preventDefault();
    input.blur();
  });

  listEl.addEventListener("focusin", (event) => {
    const input = event.target.closest(".rank-input");
    if (input) input.select();
  });

  listEl.addEventListener("change", (event) => {
    const input = event.target.closest(".rank-input");
    if (!input) return;
    applyInputRank(input.closest(".rank-card"));
  });

  listEl.addEventListener("pointerdown", onPointerDown);
}

function onPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const handle = event.target.closest(".rank-handle");
  if (!handle) return;
  const card = handle.closest(".rank-card");
  if (!card) return;
  event.preventDefault();

  const startSlugs = currentSlugs();
  const startRect = card.getBoundingClientRect();
  const offsetY = event.clientY - startRect.top;
  const placeholder = document.createElement("li");
  placeholder.className = "rank-placeholder";
  placeholder.style.height = `${startRect.height}px`;
  card.after(placeholder);

  card.classList.add("is-dragging");
  card.style.width = `${startRect.width}px`;
  card.style.left = `${startRect.left}px`;
  card.style.top = `${startRect.top}px`;
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    /* capture is best-effort on older browsers */
  }

  function gapFor(y) {
    const others = [...listEl.querySelectorAll(".rank-card:not(.is-dragging)")];
    for (const other of others) {
      const rect = other.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        other.before(placeholder);
        return;
      }
    }
    if (others.length) others[others.length - 1].after(placeholder);
    else listEl.append(placeholder);
  }

  function onMove(moveEvent) {
    card.style.top = `${moveEvent.clientY - offsetY}px`;
    gapFor(moveEvent.clientY);
  }

  function finish() {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    placeholder.replaceWith(card);
    card.classList.remove("is-dragging");
    card.removeAttribute("style");
    const nextSlugs = currentSlugs();
    if (nextSlugs.join("\0") === startSlugs.join("\0")) {
      render();
      return;
    }
    const bySlug = new Map(houses.map((house) => [house.slug, house]));
    persist(nextSlugs.map((slug) => bySlug.get(slug)).filter(Boolean));
  }

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

async function fetchRankings() {
  const res = await fetch("/api/rankings");
  if (!res.ok) throw new Error("Could not load rankings.");
  return res.json();
}

async function init() {
  bindList();
  try {
    const [payload, ranking] = await Promise.all([fetchHouses(), fetchRankings()]);
    sampleBanner.hidden = payload.source !== "sample";
    houses = orderHouses(payload.houses || [], ranking.slugs || []);
    render();
  } catch {
    showSave("error", "Could not load houses.");
    houses = [];
    render();
  }
}

init();
