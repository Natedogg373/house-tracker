import { escapeHtml } from "./common.js";

export const TYPE_LABELS = {
  yes_no: "Yes / No",
  number: "Number",
  rating: "Rating",
  date: "Date",
  short_text: "Short text",
  multiple_choice: "Multiple choice",
};

export function surveyFillUrl(slug) {
  return `/survey/fill?house=${encodeURIComponent(slug)}`;
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
    case "number":
      return String(value);
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

function ratingBubblesHtml(question, value, { name, readonly = false } = {}) {
  const max = Math.min(10, Math.max(2, Number(question.config?.maxRating || question.questionConfig?.maxRating || 5)));
  const selected = value == null || value === "" ? null : Number(value);
  const bubbles = [];
  for (let i = 1; i <= max; i += 1) {
    const pressed = selected === i;
    if (readonly) {
      bubbles.push(
        `<span class="rating-bubble ${pressed ? "is-selected" : ""}" aria-hidden="true">${i}</span>`
      );
    } else {
      bubbles.push(
        `<button type="button" class="rating-bubble ${pressed ? "is-selected" : ""}" data-rating="${i}" aria-pressed="${
          pressed ? "true" : "false"
        }">${i}</button>`
      );
    }
  }
  const hidden = readonly
    ? ""
    : `<input type="hidden" name="${escapeHtml(name)}" value="${selected == null ? "" : selected}" />`;
  return `<div class="rating-bubbles" role="group" aria-label="Rating 1 to ${max}">${bubbles.join("")}${hidden}</div>`;
}

export function answerControlHtml(question, value, { name, readonly = false } = {}) {
  const type = question.type || question.questionType;
  const config = question.config || question.questionConfig || {};
  const fieldName = name || `q-${question.id}`;
  const safeValue = value == null ? "" : value;

  if (readonly) {
    if (type === "rating") {
      return ratingBubblesHtml({ ...question, config }, safeValue, { readonly: true });
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
    case "number":
      return `<input class="survey-input" type="number" inputmode="decimal" name="${escapeHtml(
        fieldName
      )}" value="${escapeHtml(safeValue)}" />`;
    case "rating":
      return ratingBubblesHtml({ ...question, config }, safeValue, { name: fieldName });
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
    const hidden = root.querySelector(`input[name="${CSS.escape(name)}"]`);
    if (!hidden || hidden.value === "") return null;
    const n = Number(hidden.value);
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
    const bubble = event.target.closest(".rating-bubble[data-rating]");
    if (bubble && root.contains(bubble)) {
      const wrap = bubble.closest(".rating-bubbles");
      const hidden = wrap?.querySelector('input[type="hidden"]');
      const rating = bubble.dataset.rating;
      if (hidden) {
        const same = hidden.value === rating;
        hidden.value = same ? "" : rating;
        for (const btn of wrap.querySelectorAll(".rating-bubble[data-rating]")) {
          const on = !same && btn.dataset.rating === rating;
          btn.classList.toggle("is-selected", on);
          btn.setAttribute("aria-pressed", on ? "true" : "false");
        }
      }
      return;
    }
    const clear = event.target.closest("[data-clear]");
    if (clear && root.contains(clear)) {
      const name = clear.dataset.clear;
      for (const input of root.querySelectorAll(`input[name="${CSS.escape(name)}"]`)) {
        if (input.type === "radio" || input.type === "checkbox") input.checked = false;
        else input.value = "";
      }
    }
  });
}
