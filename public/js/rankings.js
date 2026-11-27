import { detailsUrl, escapeHtml, fetchHouses, formatMoney, isActiveHouse, show, statusClass } from "./common.js";
import { surveyFillUrl } from "./survey-shared.js";

const listEl = document.querySelector("#rank-list");
const emptyEl = document.querySelector("#empty");
const sampleBanner = document.querySelector("#sample-banner");
const saveStatus = document.querySelector("#save-status");

const EDGE_SCROLL_PX = 56;
const EDGE_SCROLL_MAX = 18;

let houses = [];
let persistTimer = 0;
let dragState = null;

let surveyStatusBySlug = new Map();

function moveToRank(list, fromIndex, rank) {
  const items = list.slice();
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

function moveBySteps(list, fromIndex, steps) {
  const items = list.slice();
  const n = items.length;
  if (!n || fromIndex < 0 || fromIndex >= n) return items;
  const parsed = Number(steps);
  if (!Number.isFinite(parsed) || parsed === 0) return items;
  return moveToRank(items, fromIndex, fromIndex + 1 + Math.round(parsed));
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

function reorderAndSave(nextSlugs, previousSlugs) {
  if (nextSlugs.join("\0") === previousSlugs.join("\0")) return;
  const bySlug = new Map(houses.map((house) => [house.slug, house]));
  persist(nextSlugs.map((slug) => bySlug.get(slug)).filter(Boolean));
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
  reorderAndSave(nextSlugs, slugs);
}

function applyNudge(card, steps) {
  const slugs = currentSlugs();
  const fromIndex = slugs.indexOf(card.dataset.slug);
  const nextSlugs = moveBySteps(slugs, fromIndex, steps);
  reorderAndSave(nextSlugs, slugs);
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
  const href = detailsUrl(house.slug);
  const surveyHref = surveyFillUrl(house.slug);
  const survey = surveyStatusBySlug.get(house.slug);
  let surveyLabel = "Fill survey";
  if (survey?.filled) surveyLabel = "Survey done";
  else if (survey?.started) surveyLabel = "Continue survey";
  const label = escapeHtml(house.address || house.slug);
  const upDisabled = rank <= 1 ? " disabled" : "";
  const downDisabled = rank >= total ? " disabled" : "";
  return `<li class="rank-card" data-slug="${escapeHtml(house.slug)}">
    <button type="button" class="rank-handle" aria-label="Drag to reorder ${label}">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="7" cy="5" r="1.6" />
        <circle cx="13" cy="5" r="1.6" />
        <circle cx="7" cy="10" r="1.6" />
        <circle cx="13" cy="10" r="1.6" />
        <circle cx="7" cy="15" r="1.6" />
        <circle cx="13" cy="15" r="1.6" />
      </svg>
    </button>
    <div class="rank-nudge" role="group" aria-label="Move ${label}">
      <button type="button" class="rank-nudge-btn rank-nudge-up" data-steps="-1" aria-label="Move ${label} up"${upDisabled}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.5 4.5 11h11L10 4.5z"/></svg>
      </button>
      <button type="button" class="rank-nudge-btn rank-nudge-down" data-steps="1" aria-label="Move ${label} down"${downDisabled}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15.5 15.5 9h-11L10 15.5z"/></svg>
      </button>
    </div>
    <label class="rank-number">
      <span class="visually-hidden">Rank for ${label}</span>
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
    <a class="rank-link" href="${escapeHtml(href)}">
      ${thumbHtml(house)}
      <div class="rank-body">
        <p class="rank-address">${escapeHtml(house.address || house.slug)}</p>
        <p class="rank-meta">
          <span>${escapeHtml(price)}</span>
          <span class="pill ${pillClass}">${escapeHtml(status)}</span>
        </p>
      </div>
    </a>
    <a class="rank-survey-link button-link" href="${escapeHtml(surveyHref)}">${escapeHtml(surveyLabel)}</a>
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

  listEl.addEventListener("click", (event) => {
    const nudge = event.target.closest(".rank-nudge-btn");
    if (!nudge || nudge.disabled) return;
    const card = nudge.closest(".rank-card");
    if (!card) return;
    event.preventDefault();
    applyNudge(card, Number(nudge.dataset.steps));
  });

  listEl.addEventListener("pointerdown", onPointerDown);
}

function scrollDeltaForY(clientY) {
  if (clientY < EDGE_SCROLL_PX) {
    const t = (EDGE_SCROLL_PX - clientY) / EDGE_SCROLL_PX;
    return -Math.ceil(EDGE_SCROLL_MAX * Math.min(1, Math.max(0, t)));
  }
  const bottom = window.innerHeight - EDGE_SCROLL_PX;
  if (clientY > bottom) {
    const t = (clientY - bottom) / EDGE_SCROLL_PX;
    return Math.ceil(EDGE_SCROLL_MAX * Math.min(1, Math.max(0, t)));
  }
  return 0;
}

function stopAutoScroll() {
  if (!dragState?.scrollRaf) return;
  cancelAnimationFrame(dragState.scrollRaf);
  dragState.scrollRaf = 0;
}

function tickAutoScroll() {
  if (!dragState) return;
  const dy = scrollDeltaForY(dragState.lastY);
  if (dy) {
    window.scrollBy(0, dy);
    positionDraggedCard(dragState.lastY);
    gapFor(dragState.lastY);
  }
  dragState.scrollRaf = requestAnimationFrame(tickAutoScroll);
}

function positionDraggedCard(clientY) {
  if (!dragState) return;
  const { card, offsetY } = dragState;
  card.style.top = `${clientY - offsetY}px`;
}

function gapFor(y) {
  if (!dragState) return;
  const { placeholder } = dragState;
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

function onPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const handle = event.target.closest(".rank-handle");
  if (!handle) return;
  const card = handle.closest(".rank-card");
  if (!card || dragState) return;
  event.preventDefault();

  const startSlugs = currentSlugs();
  const startRect = card.getBoundingClientRect();
  const offsetY = event.clientY - startRect.top;
  const placeholder = document.createElement("li");
  placeholder.className = "rank-placeholder";
  placeholder.style.height = `${startRect.height}px`;
  placeholder.setAttribute("aria-hidden", "true");
  card.after(placeholder);

  card.classList.add("is-dragging");
  card.style.width = `${startRect.width}px`;
  card.style.left = `${startRect.left}px`;
  card.style.top = `${startRect.top}px`;
  document.body.classList.add("is-ranking-drag");

  dragState = {
    card,
    handle,
    placeholder,
    offsetY,
    startSlugs,
    pointerId: event.pointerId,
    lastY: event.clientY,
    scrollRaf: 0,
  };

  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    /* capture is best-effort on older browsers */
  }

  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  dragState.scrollRaf = requestAnimationFrame(tickAutoScroll);
}

function onPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.lastY = event.clientY;
  positionDraggedCard(event.clientY);
  gapFor(event.clientY);
}

function finishDrag(event) {
  if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
  const { card, handle, placeholder, startSlugs, pointerId } = dragState;
  stopAutoScroll();
  handle.removeEventListener("pointermove", onPointerMove);
  handle.removeEventListener("pointerup", finishDrag);
  handle.removeEventListener("pointercancel", finishDrag);
  try {
    if (handle.hasPointerCapture?.(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }
  } catch {
    /* ignore */
  }

  placeholder.replaceWith(card);
  card.classList.remove("is-dragging");
  card.removeAttribute("style");
  document.body.classList.remove("is-ranking-drag");
  dragState = null;

  const nextSlugs = currentSlugs();
  if (nextSlugs.join("\0") === startSlugs.join("\0")) {
    render();
    return;
  }
  reorderAndSave(nextSlugs, startSlugs);
}

async function fetchRankings() {
  const res = await fetch("/api/rankings");
  if (!res.ok) throw new Error("Could not load rankings.");
  return res.json();
}

async function fetchSurveyStatus(slugs) {
  if (!slugs.length) {
    surveyStatusBySlug = new Map();
    return;
  }
  const res = await fetch(`/api/survey/status?slugs=${encodeURIComponent(slugs.join(","))}`);
  if (!res.ok) {
    surveyStatusBySlug = new Map();
    return;
  }
  const data = await res.json().catch(() => ({}));
  surveyStatusBySlug = new Map((data.statuses || []).map((item) => [item.houseSlug, item]));
}

async function init() {
  bindList();
  try {
    const [payload, ranking] = await Promise.all([fetchHouses(), fetchRankings()]);
    sampleBanner.hidden = payload.source !== "sample";
    const interest = payload.interest || { notInterested: [], pendingReactivation: [] };
    houses = orderHouses(payload.houses || [], ranking.slugs || []).filter((house) =>
      isActiveHouse(house, interest)
    );
    await fetchSurveyStatus(houses.map((house) => house.slug));
    render();
  } catch {
    showSave("error", "Could not load houses.");
    houses = [];
    render();
  }
}

init();
