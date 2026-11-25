import { escapeHtml, show } from "./common.js";
import {
  OTHER_SECTION_TITLE,
  TYPE_LABELS,
  groupQuestionsBySection,
  questionDisplayTitle,
  typeSelectHtml,
} from "./survey-shared.js";

const listEl = document.querySelector("#question-list");
const emptyEl = document.querySelector("#empty");
const addBtn = document.querySelector("#add-question");
const addSectionBtn = document.querySelector("#add-section");
const saveStatus = document.querySelector("#save-status");

let questions = [];
let sections = [];
let persistTimer = 0;
/** @type {Set<string>} */
const expandedIds = new Set();

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
  if (question.type === "number") {
    const unit = String(question.config?.unit || "");
    return `<label class="field survey-config">
      Unit / suffix
      <input class="survey-input config-unit" type="text" maxlength="24" placeholder="e.g. years" value="${escapeHtml(
        unit
      )}" />
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

function sectionSelectHtml(selectedId) {
  const options = [
    `<option value="" ${selectedId == null ? "selected" : ""}>${escapeHtml(OTHER_SECTION_TITLE)}</option>`,
    ...sections.map(
      (s) =>
        `<option value="${escapeHtml(s.id)}" ${selectedId === s.id ? "selected" : ""}>${escapeHtml(
          s.title || "Untitled section"
        )}</option>`
    ),
  ];
  return `<select class="survey-type question-section" name="section" aria-label="Section">${options.join(
    ""
  )}</select>`;
}

function cardHtml(question, index, total, sectionId) {
  const label = TYPE_LABELS[question.type] || question.type;
  const expanded = expandedIds.has(question.id);
  const display = questionDisplayTitle(question);
  return `<li class="survey-card ${expanded ? "is-expanded" : "is-collapsed"}" data-id="${escapeHtml(
    question.id
  )}" data-type="${escapeHtml(question.type)}" data-section="${escapeHtml(sectionId || "")}">
    <button type="button" class="survey-collapse-toggle" aria-expanded="${expanded ? "true" : "false"}">
      <span class="survey-collapse-title">${escapeHtml(display)}</span>
      <span class="survey-collapse-meta">${escapeHtml(label)}</span>
      <span class="survey-collapse-chevron" aria-hidden="true"></span>
    </button>
    <div class="survey-collapse-body" ${expanded ? "" : "hidden"}>
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
        Short title
        <input class="survey-input question-title" type="text" maxlength="120" placeholder="Optional short label" value="${escapeHtml(
          question.title || ""
        )}" />
      </label>
      <label class="field">
        Question
        <textarea class="survey-input question-text" rows="2" maxlength="500">${escapeHtml(
          question.text || ""
        )}</textarea>
      </label>
      <label class="field">
        Section
        ${sectionSelectHtml(question.sectionId)}
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
    </div>
  </li>`;
}

function sectionBlockHtml(group, sectionIndex, sectionTotal) {
  const isOther = group.id == null;
  const questionsHtml = group.questions
    .map((q, i) => cardHtml(q, i, group.questions.length, group.id))
    .join("");
  const controls = isOther
    ? `<span class="survey-section-badge">Unassigned</span>`
    : `<div class="survey-section-controls">
        <button type="button" class="icon-btn move-section-up" aria-label="Move section up" ${
          sectionIndex === 0 ? "disabled" : ""
        }>↑</button>
        <button type="button" class="icon-btn move-section-down" aria-label="Move section down" ${
          sectionIndex >= sectionTotal - 1 ? "disabled" : ""
        }>↓</button>
        <button type="button" class="icon-btn danger-text delete-section" aria-label="Delete section">Delete</button>
      </div>`;

  const titleControl = isOther
    ? `<h2 class="survey-section-title">${escapeHtml(group.title)}</h2>`
    : `<label class="survey-section-title-field">
        <span class="visually-hidden">Section title</span>
        <input class="survey-input section-title-input" type="text" maxlength="120" value="${escapeHtml(
          group.title || ""
        )}" />
      </label>`;

  return `<li class="survey-section" data-section-id="${escapeHtml(group.id || "")}">
    <div class="survey-section-head">
      ${titleControl}
      <p class="survey-section-progress">${group.questions.length} question${
        group.questions.length === 1 ? "" : "s"
      }</p>
      ${controls}
    </div>
    <ol class="survey-question-list survey-section-questions" aria-label="${escapeHtml(
      group.title || "Section"
    )} questions">
      ${questionsHtml || `<li class="survey-section-empty muted">No questions in this section yet.</li>`}
    </ol>
    ${
      isOther
        ? ""
        : `<button type="button" class="text-btn add-question-here">+ Add question here</button>`
    }
  </li>`;
}

function render() {
  const groups = groupQuestionsBySection(questions, sections);
  const namedGroups = groups.filter((g) => g.id != null);
  const hasAnything = questions.length > 0 || sections.length > 0;
  show(emptyEl, !hasAnything);
  listEl.hidden = !hasAnything;
  if (!hasAnything) {
    listEl.innerHTML = "";
    return;
  }
  listEl.innerHTML = groups
    .map((group, index) => {
      if (group.id == null) {
        // Hide empty Other when there are named sections and no unassigned questions.
        if (!group.questions.length && sections.length > 0) return "";
        return sectionBlockHtml(group, 0, 0);
      }
      return sectionBlockHtml(group, namedGroups.findIndex((g) => g.id === group.id), namedGroups.length);
    })
    .join("");
}

function readConfigFromCard(card, type) {
  if (type === "rating") {
    const max = Number(card.querySelector(".config-max")?.value || 5);
    return { maxRating: max };
  }
  if (type === "number") {
    const unit = String(card.querySelector(".config-unit")?.value || "").trim();
    return unit ? { unit } : {};
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
  sections = data.sections || [];
  render();
}

async function addQuestion(sectionId = null) {
  addBtn.disabled = true;
  if (addSectionBtn) addSectionBtn.disabled = true;
  try {
    const body = { text: "", type: "short_text" };
    if (sectionId) body.sectionId = sectionId;
    const data = await api("/api/survey/questions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    questions.push(data.question);
    expandedIds.add(data.question.id);
    render();
    const card = listEl.querySelector(`.survey-card[data-id="${CSS.escape(data.question.id)}"]`);
    card?.querySelector(".question-text")?.focus();
    showSave("ok", "Question added.");
  } catch (err) {
    showSave("error", err.message || "Could not add question.");
  } finally {
    addBtn.disabled = false;
    if (addSectionBtn) addSectionBtn.disabled = false;
  }
}

async function addSection() {
  if (addSectionBtn) addSectionBtn.disabled = true;
  try {
    const data = await api("/api/survey/sections", {
      method: "POST",
      body: JSON.stringify({ title: "New section" }),
    });
    sections.push(data.section);
    render();
    const block = listEl.querySelector(
      `.survey-section[data-section-id="${CSS.escape(data.section.id)}"]`
    );
    block?.querySelector(".section-title-input")?.focus();
    showSave("ok", "Section added.");
  } catch (err) {
    showSave("error", err.message || "Could not add section.");
  } finally {
    if (addSectionBtn) addSectionBtn.disabled = false;
  }
}

async function persistCard(card, { confirmTypeChange = false } = {}) {
  const id = card.dataset.id;
  const text = card.querySelector(".question-text")?.value ?? "";
  const title = card.querySelector(".question-title")?.value ?? "";
  const type = card.querySelector(".survey-type:not(.question-section)")?.value;
  const sectionRaw = card.querySelector(".question-section")?.value;
  const sectionId = sectionRaw === "" ? null : sectionRaw;
  const config = readConfigFromCard(card, type);
  const data = await api(`/api/survey/questions/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ text, title, type, config, sectionId, confirmTypeChange }),
  });
  const index = questions.findIndex((q) => q.id === id);
  if (index >= 0) questions[index] = data.question;
  else questions.push(data.question);
  questions = questions.slice().sort((a, b) => {
    // Keep local list roughly ordered; reload can refresh fully after section moves.
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
  card.dataset.type = data.question.type;
  card.dataset.section = data.question.sectionId || "";
  const configHost = card.querySelector(".survey-config") || card.querySelector(".survey-config-empty");
  if (configHost) {
    const wrap = document.createElement("div");
    wrap.innerHTML = configEditorHtml(data.question);
    configHost.replaceWith(wrap.firstElementChild);
  }
  const hint = card.querySelector(".survey-type-hint");
  if (hint) hint.textContent = `Type: ${TYPE_LABELS[data.question.type] || data.question.type}`;
  const titleSpan = card.querySelector(".survey-collapse-title");
  if (titleSpan) titleSpan.textContent = questionDisplayTitle(data.question);
  return data.question;
}

async function onTypeChange(card) {
  const previous = card.dataset.type;
  const next = card.querySelector(".survey-type:not(.question-section)")?.value;
  if (previous && next && previous !== next) {
    const ok = window.confirm(
      "Changing the answer type keeps old answers as they were recorded, but new answers will use the new type. Continue?"
    );
    if (!ok) {
      card.querySelector(".survey-type:not(.question-section)").value = previous;
      return;
    }
    try {
      await persistCard(card, { confirmTypeChange: true });
      showSave("ok", "Question type updated. Previous answers are kept.");
    } catch (err) {
      card.querySelector(".survey-type:not(.question-section)").value = previous;
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
  const label = questionDisplayTitle(question || {});
  if (!window.confirm(`Remove “${label}”? Old answers stay viewable as archived on House Details.`)) {
    return;
  }
  try {
    await api(`/api/survey/questions/${encodeURIComponent(id)}`, { method: "DELETE" });
    questions = questions.filter((q) => q.id !== id);
    expandedIds.delete(id);
    render();
    showSave("ok", "Question archived.");
  } catch (err) {
    showSave("error", err.message || "Could not delete question.");
  }
}

async function moveQuestion(card, delta) {
  const id = card.dataset.id;
  const question = questions.find((q) => q.id === id);
  if (!question) return;
  const sectionId = question.sectionId || null;
  const siblings = questions.filter((q) => (q.sectionId || null) === sectionId);
  const index = siblings.findIndex((q) => q.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= siblings.length) return;
  const copy = siblings.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  const orderedIds = copy.map((q) => q.id);
  const byId = new Map(questions.map((q) => [q.id, q]));
  questions = [
    ...sections.flatMap((section) =>
      section.id === sectionId
        ? orderedIds.map((qid) => byId.get(qid))
        : questions.filter((q) => q.sectionId === section.id)
    ),
    ...(sectionId == null
      ? orderedIds.map((qid) => byId.get(qid))
      : questions.filter((q) => q.sectionId == null)),
  ].filter(Boolean);
  render();
  try {
    const data = await api("/api/survey/questions/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids: orderedIds, sectionId }),
    });
    questions = data.questions || questions;
    sections = data.sections || sections;
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

async function persistSectionTitle(block) {
  const id = block.dataset.sectionId;
  if (!id) return;
  const title = block.querySelector(".section-title-input")?.value ?? "";
  const data = await api(`/api/survey/sections/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ title }),
  });
  const index = sections.findIndex((s) => s.id === id);
  if (index >= 0) sections[index] = data.section;
  showSave("ok", "Section saved.");
}

async function deleteSectionBlock(block) {
  const id = block.dataset.sectionId;
  if (!id) return;
  const section = sections.find((s) => s.id === id);
  const label = section?.title || "this section";
  if (
    !window.confirm(
      `Delete “${label}”? Questions in it move to ${OTHER_SECTION_TITLE}; answers are kept.`
    )
  ) {
    return;
  }
  try {
    await api(`/api/survey/sections/${encodeURIComponent(id)}`, { method: "DELETE" });
    sections = sections.filter((s) => s.id !== id);
    for (const q of questions) {
      if (q.sectionId === id) q.sectionId = null;
    }
    render();
    showSave("ok", "Section deleted.");
  } catch (err) {
    showSave("error", err.message || "Could not delete section.");
  }
}

async function moveSection(block, delta) {
  const id = block.dataset.sectionId;
  if (!id) return;
  const index = sections.findIndex((s) => s.id === id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= sections.length) return;
  const copy = sections.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  sections = copy;
  render();
  try {
    const data = await api("/api/survey/sections/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids: sections.map((s) => s.id) }),
    });
    sections = data.sections || sections;
    render();
    showSave("ok", "Section order saved.");
  } catch (err) {
    showSave("error", err.message || "Could not reorder sections.");
    try {
      await reload();
    } catch {
      /* ignore */
    }
  }
}

function bind() {
  addBtn.addEventListener("click", () => {
    addQuestion(null);
  });
  addSectionBtn?.addEventListener("click", () => {
    addSection();
  });

  listEl.addEventListener("change", async (event) => {
    const card = event.target.closest(".survey-card");
    if (card) {
      if (event.target.matches(".survey-type:not(.question-section)")) {
        await onTypeChange(card);
        return;
      }
      if (
        event.target.matches(
          ".question-text, .question-title, .config-max, .config-unit, .config-options, .question-section"
        )
      ) {
        try {
          const beforeSection = card.dataset.section || "";
          await persistCard(card);
          const afterSection = card.dataset.section || "";
          if (beforeSection !== afterSection) {
            await reload();
          } else {
            render();
          }
          showSave("ok", "Saved.");
        } catch (err) {
          showSave("error", err.message || "Could not save.");
        }
      }
      return;
    }
    const section = event.target.closest(".survey-section");
    if (section && event.target.matches(".section-title-input")) {
      try {
        await persistSectionTitle(section);
      } catch (err) {
        showSave("error", err.message || "Could not save section.");
      }
    }
  });

  listEl.addEventListener("click", (event) => {
    const toggle = event.target.closest(".survey-collapse-toggle");
    if (toggle) {
      const card = toggle.closest(".survey-card");
      if (!card) return;
      const id = card.dataset.id;
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      render();
      return;
    }

    const card = event.target.closest(".survey-card");
    if (card) {
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
        return;
      }
    }

    const section = event.target.closest(".survey-section");
    if (!section) return;
    if (event.target.closest(".delete-section")) {
      deleteSectionBlock(section);
      return;
    }
    if (event.target.closest(".move-section-up")) {
      moveSection(section, -1);
      return;
    }
    if (event.target.closest(".move-section-down")) {
      moveSection(section, 1);
      return;
    }
    if (event.target.closest(".add-question-here")) {
      const sectionId = section.dataset.sectionId || null;
      addQuestion(sectionId);
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
