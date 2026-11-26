import {
  escapeHtml,
  fetchHouses,
  housesForDetailsSelect,
  show,
} from "./common.js";
import { initSurveyEdit } from "./survey-edit.js";
import { initSurveyFill } from "./survey-fill.js";
import { parseSurveyUrl, surveyPageUrl } from "./survey-shared.js";

const fillPanel = document.querySelector("#survey-fill");
const editPanel = document.querySelector("#survey-edit");
const modeButtons = document.querySelectorAll(".survey-mode-btn");
const ledeEl = document.querySelector("#survey-lede");
const houseInput = document.querySelector("#survey-house-input");
const houseList = document.querySelector("#survey-house-list");

let mode = "fill";
let houseSlug = "";
let allHouses = [];
let interest = null;
let fillApi = null;
let editReady = false;
let suppressUrl = false;

function setModeButtons(nextMode) {
  for (const btn of modeButtons) {
    const active = btn.dataset.mode === nextMode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function writeUrl({ replace = true } = {}) {
  if (suppressUrl) return;
  const url = surveyPageUrl({ mode, house: houseSlug });
  const method = replace ? "replaceState" : "pushState";
  history[method]({ mode, house: houseSlug }, "", url);
}

function applyMode(nextMode, { replace = true, syncUrl = true } = {}) {
  mode = nextMode === "edit" ? "edit" : "fill";
  setModeButtons(mode);
  if (fillPanel) {
    fillPanel.hidden = mode !== "fill";
    show(fillPanel, mode === "fill");
  }
  if (editPanel) {
    editPanel.hidden = mode !== "edit";
    show(editPanel, mode === "edit");
  }

  if (ledeEl) {
    ledeEl.textContent =
      mode === "edit"
        ? "Edit sections and questions for the shared visit checklist."
        : "Pick a house to fill visit answers, or switch to Edit survey to change the checklist.";
  }

  document.title =
    mode === "edit"
      ? "Edit survey · House Tracker"
      : houseSlug
        ? `Survey · House Tracker`
        : "Survey · House Tracker";

  if (mode === "edit" && !editReady) {
    initSurveyEdit();
    editReady = true;
  }

  if (syncUrl) writeUrl({ replace });
}

function houseOptions() {
  return housesForDetailsSelect(allHouses, interest, houseSlug);
}

function closeHouseList() {
  if (!houseList || !houseInput) return;
  houseList.hidden = true;
  houseInput.setAttribute("aria-expanded", "false");
}

function openHouseList() {
  if (!houseList || !houseInput) return;
  houseList.hidden = false;
  houseInput.setAttribute("aria-expanded", "true");
}

function renderHouseList(filter = "") {
  if (!houseList) return;
  const needle = String(filter || "").trim().toLowerCase();
  const options = houseOptions().filter((house) => {
    if (!needle) return true;
    const hay = `${house.address || ""} ${house.slug || ""}`.toLowerCase();
    return hay.includes(needle);
  });

  if (!options.length) {
    houseList.innerHTML = `<li class="survey-house-empty muted" role="presentation">No matching addresses</li>`;
    openHouseList();
    return;
  }

  houseList.innerHTML = options
    .map((house) => {
      const selected = house.slug === houseSlug ? "true" : "false";
      return `<li role="option" class="survey-house-option" data-slug="${escapeHtml(
        house.slug
      )}" aria-selected="${selected}">
        ${escapeHtml(house.address || house.slug)}
      </li>`;
    })
    .join("");
  openHouseList();
}

function syncHouseInputLabel() {
  if (!houseInput) return;
  const selected = allHouses.find((h) => h.slug === houseSlug);
  if (selected) {
    houseInput.value = selected.address || selected.slug;
  } else if (houseSlug) {
    houseInput.value = houseSlug;
  } else if (document.activeElement !== houseInput) {
    houseInput.value = "";
  }
}

async function selectHouse(slug, { replace = true, syncUrl = true } = {}) {
  houseSlug = String(slug || "").trim();
  syncHouseInputLabel();
  closeHouseList();
  if (fillApi) await fillApi.loadHouse(houseSlug);
  if (syncUrl) writeUrl({ replace });
}

function bindHousePicker() {
  if (!houseInput || !houseList) return;

  houseInput.addEventListener("focus", () => {
    renderHouseList(houseInput.value);
  });

  houseInput.addEventListener("input", () => {
    renderHouseList(houseInput.value);
  });

  houseInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeHouseList();
      houseInput.blur();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      renderHouseList(houseInput.value);
      const first = houseList.querySelector(".survey-house-option");
      first?.focus?.();
      return;
    }
    if (event.key === "Enter") {
      const first = houseList.querySelector(".survey-house-option");
      if (first) {
        event.preventDefault();
        selectHouse(first.dataset.slug, { replace: false });
      }
    }
  });

  houseList.addEventListener("click", (event) => {
    const option = event.target.closest(".survey-house-option");
    if (!option) return;
    selectHouse(option.dataset.slug, { replace: false });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".survey-house-picker") || event.target.closest("#survey-house-list")) {
      return;
    }
    closeHouseList();
    syncHouseInputLabel();
  });
}

function bindModeToggle() {
  for (const btn of modeButtons) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.mode === "edit" ? "edit" : "fill";
      if (next === mode) return;
      applyMode(next, { replace: false });
    });
  }
}

function readStateFromLocation() {
  return parseSurveyUrl(window.location.href);
}

async function bootFromUrl({ replace = true } = {}) {
  const state = readStateFromLocation();
  suppressUrl = true;
  applyMode(state.mode, { replace, syncUrl: false });
  if (state.house) {
    await selectHouse(state.house, { replace, syncUrl: false });
  } else if (fillApi) {
    await fillApi.loadHouse("");
  }
  suppressUrl = false;
  writeUrl({ replace });
}

async function init() {
  bindModeToggle();
  bindHousePicker();

  const payload = await fetchHouses().catch(() => ({ houses: [], interest: null }));
  allHouses = payload.houses || [];
  interest = payload.interest || null;

  fillApi = initSurveyFill({
    onHouseTitle(title) {
      if (mode === "fill" && title) {
        document.title = `Survey · ${title} · House Tracker`;
      }
    },
  });

  window.addEventListener("popstate", () => {
    bootFromUrl({ replace: true });
  });

  await bootFromUrl({ replace: true });
}

init().catch((err) => {
  console.error("[survey] failed to start", err);
});
