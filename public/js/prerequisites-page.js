import { yearBuiltAgeHint } from "./prerequisites-shared.js";

const listEl = document.querySelector("#prereq-list");
const toleranceInput = document.querySelector("#tolerance-input");
const skippedEl = document.querySelector("#prereq-skipped");
const statusEl = document.querySelector("#prereq-status");
const saveBtn = document.querySelector("#prereq-save");

let config = null;
let dirty = false;

function setStatus(message, kind = "") {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.className = `prereq-status muted${kind ? ` ${kind}` : ""}`;
}

function setDirty(value) {
  dirty = Boolean(value);
  if (dirty) setStatus("Unsaved changes.", "warn");
}

function directionLabel(criterion) {
  if (criterion.kind === "boolean") return "Preference";
  if (criterion.kind === "school") return "Min rating";
  return criterion.direction === "max" ? "Max" : "Min";
}

function inputStep(criterion) {
  if (criterion.inputMode === "decimal") return "0.01";
  if (criterion.inputMode === "currency") return "1";
  if (criterion.inputMode === "year") return "1";
  if (criterion.inputMode === "rating") return "1";
  return "1";
}

function inputPlaceholder(criterion) {
  if (criterion.inputMode === "currency") return "e.g. 700000";
  if (criterion.id === "lotSize") return "e.g. 0.2";
  if (criterion.id === "yearBuilt") return "e.g. 1990";
  if (criterion.id === "sqft") return "e.g. 2000";
  if (criterion.inputMode === "rating") return "1–10";
  if (criterion.id === "stories") return "e.g. 2";
  if (criterion.id === "hoa") return "e.g. 0 or 85";
  return "";
}

function renderAgeHint(criterion) {
  if (criterion.id !== "yearBuilt") return "";
  const hint = yearBuiltAgeHint(criterion.threshold);
  if (!hint) {
    return `<p class="prereq-age-hint muted" data-age-for="${criterion.id}" hidden></p>`;
  }
  return `<p class="prereq-age-hint muted" data-age-for="${criterion.id}">${hint}</p>`;
}

function renderThresholdControl(criterion) {
  const thresholdId = `prereq-threshold-${criterion.id}`;
  if (criterion.kind === "boolean") {
    const choice = criterion.choice === "exclude" ? "exclude" : "require";
    return `<label class="field prereq-threshold-field" for="${thresholdId}">
      Preference
      <select
        id="${thresholdId}"
        class="prereq-input prereq-select"
        data-role="choice"
        ${criterion.enabled ? "" : "disabled"}
      >
        <option value="require" ${choice === "require" ? "selected" : ""}>Require pool</option>
        <option value="exclude" ${choice === "exclude" ? "selected" : ""}>Exclude pool</option>
      </select>
    </label>`;
  }

  const threshold =
    criterion.threshold == null || Number.isNaN(Number(criterion.threshold))
      ? ""
      : String(criterion.threshold);
  const minMax =
    criterion.inputMode === "rating" ? `min="1" max="10"` : "";

  return `<label class="field prereq-threshold-field" for="${thresholdId}">
    Threshold
    <span class="prereq-threshold-row">
      <input
        id="${thresholdId}"
        class="prereq-input"
        type="number"
        data-role="threshold"
        step="${inputStep(criterion)}"
        inputmode="decimal"
        placeholder="${inputPlaceholder(criterion)}"
        value="${threshold}"
        ${minMax}
        ${criterion.enabled ? "" : "disabled"}
      />
      <span class="prereq-unit">${criterion.unit || ""}</span>
    </span>
  </label>`;
}

function renderCriterion(criterion) {
  const enabledId = `prereq-enabled-${criterion.id}`;
  const checked = criterion.enabled ? "checked" : "";

  return `<li class="prereq-item" data-id="${criterion.id}" data-kind="${criterion.kind || "number"}">
    <div class="prereq-item-main">
      <label class="prereq-toggle" for="${enabledId}">
        <input type="checkbox" id="${enabledId}" data-role="enabled" ${checked} />
        <span class="prereq-toggle-text">
          <span class="prereq-name">${criterion.label}</span>
          <span class="prereq-dir muted">${directionLabel(criterion)}</span>
        </span>
      </label>
      ${renderThresholdControl(criterion)}
    </div>
    <p class="prereq-item-hint muted">${criterion.hint || ""}</p>
    ${renderAgeHint(criterion)}
  </li>`;
}

function render() {
  if (!config || !listEl) return;
  listEl.innerHTML = config.criteria.map(renderCriterion).join("");

  if (toleranceInput) {
    toleranceInput.value = String(config.tolerancePercent ?? 10);
  }

  if (skippedEl) {
    const skipped = Array.isArray(config.skipped) ? config.skipped : [];
    if (skipped.length) {
      skippedEl.hidden = false;
      skippedEl.textContent = skipped
        .map((item) => `Skipped: ${item.label} — ${item.reason}`)
        .join(" ");
    } else {
      skippedEl.hidden = true;
      skippedEl.textContent = "";
    }
  }
}

function readFormIntoConfig() {
  if (!config) return null;
  const tolerancePercent = Number(toleranceInput?.value);
  config.tolerancePercent = Number.isFinite(tolerancePercent) ? tolerancePercent : 10;

  for (const item of listEl.querySelectorAll(".prereq-item")) {
    const id = item.getAttribute("data-id");
    const criterion = config.criteria.find((c) => c.id === id);
    if (!criterion) continue;
    const enabled = item.querySelector('[data-role="enabled"]');
    criterion.enabled = Boolean(enabled?.checked);

    const choice = item.querySelector('[data-role="choice"]');
    if (choice) {
      criterion.choice = choice.value === "exclude" ? "exclude" : "require";
      choice.disabled = !criterion.enabled;
    }

    const threshold = item.querySelector('[data-role="threshold"]');
    if (threshold) {
      const raw = threshold.value;
      const n = raw === "" || raw == null ? null : Number(raw);
      criterion.threshold = Number.isFinite(n) ? n : null;
      threshold.disabled = !criterion.enabled;
    }

    const ageEl = item.querySelector(`[data-age-for="${id}"]`);
    if (ageEl) {
      const hint = yearBuiltAgeHint(criterion.threshold);
      if (hint) {
        ageEl.hidden = false;
        ageEl.textContent = hint;
      } else {
        ageEl.hidden = true;
        ageEl.textContent = "";
      }
    }
  }
  return config;
}

async function load() {
  setStatus("Loading…");
  try {
    const res = await fetch("/api/prerequisites");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load prerequisites.");
    config = data;
    render();
    setDirty(false);
    setStatus("Loaded.");
  } catch (err) {
    setStatus(err.message || "Failed to load.", "error");
  }
}

async function save() {
  const body = readFormIntoConfig();
  if (!body) return;
  saveBtn.disabled = true;
  setStatus("Saving…");
  try {
    const res = await fetch("/api/prerequisites", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tolerancePercent: body.tolerancePercent,
        criteria: body.criteria.map((c) => ({
          id: c.id,
          enabled: c.enabled,
          threshold: c.threshold,
          choice: c.choice,
        })),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save.");
    config = data;
    render();
    setDirty(false);
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus(err.message || "Failed to save.", "error");
  } finally {
    saveBtn.disabled = false;
  }
}

listEl?.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.matches('[data-role="enabled"]')) {
    const item = target.closest(".prereq-item");
    item?.querySelectorAll('[data-role="threshold"], [data-role="choice"]').forEach((el) => {
      el.disabled = !target.checked;
    });
  }
  readFormIntoConfig();
  setDirty(true);
});

listEl?.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.matches('[data-role="threshold"], [data-role="choice"]')) {
    readFormIntoConfig();
    setDirty(true);
  }
});

toleranceInput?.addEventListener("input", () => {
  readFormIntoConfig();
  setDirty(true);
});

saveBtn?.addEventListener("click", () => {
  save();
});

load();
