import { escapeHtml } from "./common.js";

export const TYPE_LABELS = {
  yes_no: "Yes / No",
  number: "Number",
  rating: "Rating",
  date: "Date",
  short_text: "Short text",
  multiple_choice: "Multiple choice",
};

export const OTHER_SECTION_TITLE = "Other";
export const TITLE_FALLBACK_MAX = 72;

/** Fill/view URL on the unified Survey tab (default mode). */
export function surveyFillUrl(slug) {
  const params = new URLSearchParams();
  if (slug) params.set("house", String(slug));
  const query = params.toString();
  return query ? `/survey?${query}` : "/survey";
}

export function surveyEditUrl(slug = "") {
  const params = new URLSearchParams();
  params.set("mode", "edit");
  if (slug) params.set("house", String(slug));
  return `/survey?${params.toString()}`;
}

export function surveyPageUrl({ mode = "fill", house = "" } = {}) {
  const params = new URLSearchParams();
  if (mode === "edit") params.set("mode", "edit");
  if (house) params.set("house", String(house));
  const query = params.toString();
  return query ? `/survey?${query}` : "/survey";
}

export function parseSurveyUrl(href = "") {
  let url;
  try {
    url = new URL(href, "http://local.invalid");
  } catch {
    return { mode: "fill", house: "" };
  }
  const params = url.searchParams;
  const modeRaw = String(params.get("mode") || "").trim().toLowerCase();
  const mode = modeRaw === "edit" || modeRaw === "setup" ? "edit" : "fill";
  const house = String(params.get("house") || "").trim();
  return { mode, house };
}

export function questionDisplayTitle(question, maxLen = TITLE_FALLBACK_MAX) {
  const short = String(question?.title || question?.questionTitle || "").trim();
  if (short) return short;
  const text = String(question?.text || question?.questionText || "").trim() || "Untitled question";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export function questionFullText(question) {
  return String(question?.text || question?.questionText || "").trim() || "Untitled question";
}

/**
 * Shared collapse header: short title crossfades into full question text in-place.
 * Optional trailing status/meta HTML (answered badge, etc.).
 */
export function collapseToggleHtml(question, { expanded = false, trailingHtml = "" } = {}) {
  const short = questionDisplayTitle(question);
  const full = questionFullText(question);
  return `<button type="button" class="survey-collapse-toggle" aria-expanded="${expanded ? "true" : "false"}">
    <span class="survey-collapse-heading">
      <span class="survey-title-short">${escapeHtml(short)}</span>
      <span class="survey-title-full">${escapeHtml(full)}</span>
    </span>
    ${trailingHtml}
    <span class="survey-collapse-chevron" aria-hidden="true"></span>
  </button>`;
}

export function answerHasContent(answer) {
  if (!answer) return false;
  if (String(answer.notes || "").trim()) return true;
  if (answer.value === null || answer.value === undefined || answer.value === "") return false;
  return true;
}

export function groupQuestionsBySection(questions = [], sections = []) {
  const bySection = new Map(sections.map((s) => [s.id, []]));
  const other = [];
  for (const q of questions) {
    if (q.sectionId && bySection.has(q.sectionId)) bySection.get(q.sectionId).push(q);
    else other.push(q);
  }
  const groups = sections.map((section) => ({
    id: section.id,
    title: section.title || "Untitled section",
    questions: bySection.get(section.id) || [],
  }));
  groups.push({
    id: null,
    title: OTHER_SECTION_TITLE,
    questions: other,
  });
  return groups;
}

export function sectionProgress(questions, answersById) {
  const total = questions.length;
  let answered = 0;
  for (const q of questions) {
    if (answerHasContent(answersById.get(q.id))) answered += 1;
  }
  return { answered, total };
}

export function formatAnswerValue(answer) {
  if (!answer) return "—";
  const type = answer.questionType || answer.type;
  const value = answer.value;
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "yes_no":
      return value === true ? "Yes" : value === false ? "No" : "—";
    case "rating": {
      const max = Number(answer.questionConfig?.maxRating || answer.config?.maxRating || 5);
      return `${value} / ${max}`;
    }
    case "number": {
      const unit = String(answer.questionConfig?.unit || answer.config?.unit || "").trim();
      return unit ? `${value} ${unit}` : String(value);
    }
    case "date": {
      const date = new Date(`${value}T00:00:00`);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    case "multiple_choice":
    case "short_text":
      return String(value);
    default:
      return String(value);
  }
}

export function typeSelectHtml(selected, { id, name = "type", disabled = false } = {}) {
  const options = Object.entries(TYPE_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";
  return `<select class="survey-type"${idAttr} name="${escapeHtml(name)}" ${
    disabled ? "disabled" : ""
  }>${options}</select>`;
}

function ratingPillsHtml(question, value, { name, readonly = false } = {}) {
  const max = Math.min(10, Math.max(2, Number(question.config?.maxRating || question.questionConfig?.maxRating || 5)));
  const selected = value == null || value === "" ? null : Number(value);
  if (readonly) {
    const pills = [];
    for (let i = 1; i <= max; i += 1) {
      const on = selected === i;
      pills.push(
        `<span class="choice-chip rating-pill ${on ? "is-selected" : ""}" aria-hidden="true"><span>${i}</span></span>`
      );
    }
    return `<div class="choice-list rating-pills" role="group" aria-label="Rating 1 to ${max}">${pills.join(
      ""
    )}</div>`;
  }
  const pills = [];
  for (let i = 1; i <= max; i += 1) {
    pills.push(
      `<label class="choice-chip rating-pill">
        <input type="radio" name="${escapeHtml(name)}" value="${i}" ${selected === i ? "checked" : ""} />
        <span>${i}</span>
      </label>`
    );
  }
  return `<div class="choice-list rating-pills" role="radiogroup" aria-label="Rating 1 to ${max}">
    ${pills.join("")}
    <button type="button" class="text-btn clear-rating" data-clear="${escapeHtml(name)}">Clear</button>
  </div>`;
}

export function answerControlHtml(question, value, { name, readonly = false } = {}) {
  const type = question.type || question.questionType;
  const config = question.config || question.questionConfig || {};
  const fieldName = name || `q-${question.id}`;
  const safeValue = value == null ? "" : value;

  if (readonly) {
    if (type === "rating") {
      return ratingPillsHtml({ ...question, config }, safeValue, { readonly: true });
    }
    return `<p class="survey-answer-value">${escapeHtml(formatAnswerValue({
      questionType: type,
      questionConfig: config,
      value: safeValue,
    }))}</p>`;
  }

  switch (type) {
    case "yes_no":
      return `<div class="yes-no" role="group" aria-label="Yes or no">
        <label class="choice-chip">
          <input type="radio" name="${escapeHtml(fieldName)}" value="true" ${safeValue === true ? "checked" : ""} />
          <span>Yes</span>
        </label>
        <label class="choice-chip">
          <input type="radio" name="${escapeHtml(fieldName)}" value="false" ${safeValue === false ? "checked" : ""} />
          <span>No</span>
        </label>
        <button type="button" class="text-btn clear-yes-no" data-clear="${escapeHtml(fieldName)}">Clear</button>
      </div>`;
    case "number": {
      const unit = String(config.unit || "").trim();
      const input = `<input class="survey-input" type="number" inputmode="decimal" name="${escapeHtml(
        fieldName
      )}" value="${escapeHtml(safeValue)}" />`;
      if (!unit) return input;
      return `<div class="survey-number-with-unit">
        ${input}
        <span class="survey-unit-label">${escapeHtml(unit)}</span>
      </div>`;
    }
    case "rating":
      return ratingPillsHtml({ ...question, config }, safeValue, { name: fieldName });
    case "date":
      return `<input class="survey-input" type="date" name="${escapeHtml(fieldName)}" value="${escapeHtml(
        safeValue
      )}" />`;
    case "short_text":
      return `<input class="survey-input" type="text" name="${escapeHtml(
        fieldName
      )}" value="${escapeHtml(safeValue)}" maxlength="500" autocomplete="off" />`;
    case "multiple_choice": {
      const options = Array.isArray(config.options) ? config.options : [];
      if (!options.length) {
        return `<p class="muted">Add choices on the Survey setup page.</p>`;
      }
      return `<div class="choice-list" role="group">
        ${options
          .map(
            (option) => `<label class="choice-chip">
              <input type="radio" name="${escapeHtml(fieldName)}" value="${escapeHtml(option)}" ${
                String(safeValue) === String(option) ? "checked" : ""
              } />
              <span>${escapeHtml(option)}</span>
            </label>`
          )
          .join("")}
        <button type="button" class="text-btn clear-choice" data-clear="${escapeHtml(fieldName)}">Clear</button>
      </div>`;
    }
    default:
      return `<input class="survey-input" type="text" name="${escapeHtml(fieldName)}" value="${escapeHtml(
        safeValue
      )}" />`;
  }
}

export function readAnswerValue(root, question) {
  const name = `q-${question.id}`;
  const type = question.type;
  if (type === "yes_no") {
    const checked = root.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
    if (!checked) return null;
    return checked.value === "true";
  }
  if (type === "rating") {
    const checked = root.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
    if (!checked) return null;
    const n = Number(checked.value);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "multiple_choice") {
    const checked = root.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
    return checked ? checked.value : null;
  }
  if (type === "number") {
    const input = root.querySelector(`input[name="${CSS.escape(name)}"]`);
    if (!input || input.value === "") return null;
    const n = Number(input.value);
    return Number.isFinite(n) ? n : null;
  }
  const input = root.querySelector(`[name="${CSS.escape(name)}"]`);
  if (!input) return null;
  const value = input.value;
  return value === "" ? null : value;
}

export function bindAnswerControls(root) {
  root.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-clear]");
    if (clear && root.contains(clear)) {
      const name = clear.dataset.clear;
      for (const input of root.querySelectorAll(`input[name="${CSS.escape(name)}"]`)) {
        if (input.type === "radio" || input.type === "checkbox") input.checked = false;
        else input.value = "";
      }
      clear.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}
