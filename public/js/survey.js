import { escapeHtml, show } from "./common.js";
import { TYPE_LABELS, typeSelectHtml } from "./survey-shared.js";

const listEl = document.querySelector("#question-list");
const emptyEl = document.querySelector("#empty");
const addBtn = document.querySelector("#add-question");
const saveStatus = document.querySelector("#save-status");

let questions = [];
let persistTimer = 0;

function showSave(kind, text) {
  saveStatus.hidden = false;
  saveStatus.className = `banner ${kind}`;
  saveStatus.textContent = text;
  window.clearTimeout(persistTimer);
  if (kind === "ok") {
    persistTimer = window.setTimeout(() => {
      saveStatus.hidden = true;
    }, 2400);
  }
}

async function api(pathname, options = {}) {
  const res = await fetch(pathname, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed.");
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function configEditorHtml(question) {
  if (question.type === "rating") {
    const max = Number(question.config?.maxRating || 5);
    return `<label class="field survey-config">
      Max rating
      <input class="survey-input config-max" type="number" min="2" max="10" step="1" value="${max}" />
    </label>`;
  }
  if (question.type === "multiple_choice") {
    const options = Array.isArray(question.config?.options) ? question.config.options : [];
    return `<label class="field survey-config">
      Choices (one per line)
      <textarea class="survey-input config-options" rows="3">${escapeHtml(options.join("\n"))}</textarea>
    </label>`;
  }
  return `<div class="survey-config survey-config-empty" hidden></div>`;
}

function cardHtml(question, index, total) {
  const label = TYPE_LABELS[question.type] || question.type;
  return `<li class="survey-card" data-id="${escapeHtml(question.id)}" data-type="${escapeHtml(question.type)}">
    <div class="survey-card-toolbar">
      <span class="survey-card-index">Q${index + 1}</span>
      <div class="survey-reorder">
        <button type="button" class="icon-btn move-up" aria-label="Move question up" ${
          index === 0 ? "disabled" : ""
        }>↑</button>
        <button type="button" class="icon-btn move-down" aria-label="Move question down" ${
          index >= total - 1 ? "disabled" : ""
        }>↓</button>
      </div>
      <button type="button" class="icon-btn danger-text delete-question" aria-label="Delete question">Delete</button>
    </div>
    <label class="field">
      Question
      <textarea class="survey-input question-text" rows="2" maxlength="500">${escapeHtml(
        question.text || ""
      )}</textarea>
    </label>
    <label class="field">
      Answer type
      ${typeSelectHtml(question.type, { name: "type" })}
    </label>
    ${configEditorHtml(question)}
    <label class="field">
      Notes field
      <textarea class="survey-input" rows="2" disabled placeholder="Filled per house when answering"></textarea>
    </label>
    <p class="survey-type-hint muted">Type: ${escapeHtml(label)}</p>
  </li>`;
}

function render() {
  const total = questions.length;
  show(emptyEl, total === 0);
  listEl.hidden = total === 0;
  listEl.innerHTML = questions.map((q, i) => cardHtml(q, i, total)).join("");
}

function readConfigFromCard(card, type) {
  if (type === "rating") {
    const max = Number(card.querySelector(".config-max")?.value || 5);
    return { maxRating: max };
  }
  if (type === "multiple_choice") {
    const text = card.querySelector(".config-options")?.value || "";
    const options = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return { options };
  }
  return {};
}

async function reload() {
  const data = await api("/api/survey/questions");
  questions = data.questions || [];
  render();
}

async function addQuestion() {
  addBtn.disabled = true;
  try {
    const data = await api("/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({ text: "", type: "short_text" }),
    });
    questions.push(data.question);
    render();
    const card = listEl.querySelector(`.survey-card[data-id="${CSS.escape(data.question.id)}"]`);
    card?.querySelector(".question-text")?.focus();
    showSave("ok", "Question added.");
  } catch (err) {
    showSave("error", err.message || "Could not add question.");
  } finally {
    addBtn.disabled = false;
  }
}

async function persistCard(card, { confirmTypeChange = false } = {}) {
  const id = card.dataset.id;
  const text = card.querySelector(".question-text")?.value ?? "";
  const type = card.querySelector(".survey-type")?.value;
  const config = readConfigFromCard(card, type);
  const data = await api(`/api/survey/questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ text, type, config, confirmTypeChange }),
  });
  const index = questions.findIndex((q) => q.id === id);
  if (index >= 0) questions[index] = data.question;
  card.dataset.type = data.question.type;
  const configHost = card.querySelector(".survey-config") || card.querySelector(".survey-config-empty");
  if (configHost) {
    const wrap = document.createElement("div");
    wrap.innerHTML = configEditorHtml(data.question);
    configHost.replaceWith(wrap.firstElementChild);
  }
  const hint = card.querySelector(".survey-type-hint");
  if (hint) hint.textContent = `Type: ${TYPE_LABELS[data.question.type] || data.question.type}`;
  return data.question;
}

async function onTypeChange(card) {
  const previous = card.dataset.type;
  const next = card.querySelector(".survey-type")?.value;
  if (previous && next && previous !== next) {
    const ok = window.confirm(
      "Changing the answer type keeps old answers as they were recorded, but new answers will use the new type. Continue?"
    );
    if (!ok) {
      card.querySelector(".survey-type").value = previous;
      return;
    }
    try {
      await persistCard(card, { confirmTypeChange: true });
      showSave("ok", "Question type updated. Previous answers are kept.");
    } catch (err) {
      card.querySelector(".survey-type").value = previous;
      showSave("error", err.message || "Could not update type.");
    }
    return;
  }
  try {
    await persistCard(card);
    showSave("ok", "Saved.");
  } catch (err) {
    showSave("error", err.message || "Could not save.");
  }
}

async function deleteQuestion(card) {
  const id = card.dataset.id;
  const question = questions.find((q) => q.id === id);
  const label = (question?.text || "this question").trim() || "this question";
  if (!window.confirm(`Remove “${label}”? Old answers stay viewable as archived on House Details.`)) {
    return;
  }
  try {
    await api(`/api/survey/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
    questions = questions.filter((q) => q.id !== id);
    render();
    showSave("ok", "Question archived.");
  } catch (err) {
    showSave("error", err.message || "Could not delete question.");
  }
}

async function moveQuestion(card, delta) {
  const id = card.dataset.id;
  const index = questions.findIndex((q) => q.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= questions.length) return;
  const copy = questions.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  questions = copy;
  render();
  try {
    const data = await api("/api/survey/questions/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids: questions.map((q) => q.id) }),
    });
    questions = data.questions || questions;
    render();
    showSave("ok", "Order saved.");
  } catch (err) {
    showSave("error", err.message || "Could not reorder.");
    try {
      await reload();
    } catch {
      /* ignore */
    }
  }
}

function bind() {
  addBtn.addEventListener("click", () => {
    addQuestion();
  });

  listEl.addEventListener("change", async (event) => {
    const card = event.target.closest(".survey-card");
    if (!card) return;
    if (event.target.matches(".survey-type")) {
      await onTypeChange(card);
      return;
    }
    if (event.target.matches(".question-text, .config-max, .config-options")) {
      try {
        await persistCard(card);
        showSave("ok", "Saved.");
      } catch (err) {
        showSave("error", err.message || "Could not save.");
      }
    }
  });

  listEl.addEventListener("click", (event) => {
    const card = event.target.closest(".survey-card");
    if (!card) return;
    if (event.target.closest(".delete-question")) {
      deleteQuestion(card);
      return;
    }
    if (event.target.closest(".move-up")) {
      moveQuestion(card, -1);
      return;
    }
    if (event.target.closest(".move-down")) {
      moveQuestion(card, 1);
    }
  });
}

async function init() {
  bind();
  try {
    await reload();
  } catch (err) {
    showSave("error", err.message || "Could not load survey questions.");
  }
}

init();
