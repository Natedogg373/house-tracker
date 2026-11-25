import { detailsUrl, escapeHtml, fetchHouses, show } from "./common.js";
import {
  TYPE_LABELS,
  answerControlHtml,
  answerHasContent,
  bindAnswerControls,
  collapseToggleHtml,
  groupQuestionsBySection,
  readAnswerValue,
  sectionProgress,
} from "./survey-shared.js";

const listEl = document.querySelector("#question-list");
const emptyEl = document.querySelector("#empty");
const missingEl = document.querySelector("#missing");
const titleEl = document.querySelector("#house-title");
const ledeEl = document.querySelector("#house-lede");
const backLink = document.querySelector("#back-details");
const saveBtn = document.querySelector("#save-answers");
const saveStatus = document.querySelector("#save-status");
const intro = document.querySelector(".survey-intro");

let house = null;
let questions = [];
let sections = [];
let answersById = new Map();
let persistTimer = 0;
/** @type {Set<string>} */
const expandedIds = new Set();

function slugFromQuery() {
  return new URLSearchParams(window.location.search).get("house") || "";
}

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

function liveAnswerForQuestion(question) {
  const card = listEl.querySelector(`.survey-card[data-id="${CSS.escape(question.id)}"]`);
  if (!card) return answersById.get(question.id) || null;
  return {
    value: readAnswerValue(card, question),
    notes: card.querySelector(".answer-notes")?.value || "",
  };
}

function cardHtml(question) {
  const existing = answersById.get(question.id);
  const versionMatch = existing && Number(existing.questionVersion) === Number(question.version);
  const value = versionMatch ? existing.value : null;
  const notes = versionMatch ? existing.notes || "" : "";
  const answered = answerHasContent(versionMatch ? existing : null);
  const expanded = expandedIds.has(question.id);
  const previous =
    existing && !versionMatch
      ? `<p class="survey-previous muted">Previous answer kept (${escapeHtml(
          TYPE_LABELS[existing.questionType] || existing.questionType || "old type"
        )}): <strong>${escapeHtml(
          existing.value === null || existing.value === undefined || existing.value === ""
            ? "—"
            : String(existing.value)
        )}</strong>${
          existing.notes ? ` · notes: ${escapeHtml(existing.notes)}` : ""
        }. Enter a new answer to replace it.</p>`
      : "";
  const status = `<span class="survey-answer-status ${answered ? "is-answered" : "is-unanswered"}">${
    answered ? "Answered" : "Unanswered"
  }</span>`;
  return `<li class="survey-card survey-card-fill ${
    expanded ? "is-expanded" : "is-collapsed"
  }" data-id="${escapeHtml(question.id)}">
    ${collapseToggleHtml(question, { expanded, trailingHtml: status })}
    <div class="survey-collapse-body" ${expanded ? "" : "hidden"}>
      ${previous}
      <div class="survey-answer-control">
        ${answerControlHtml(question, value, { name: `q-${question.id}` })}
      </div>
      <label class="field">
        Notes
        <textarea class="survey-input answer-notes" rows="3" maxlength="2000" placeholder="Visit notes for this question">${escapeHtml(
          notes
        )}</textarea>
      </label>
    </div>
  </li>`;
}

function sectionBlockHtml(group) {
  if (!group.questions.length) return "";
  const progress = sectionProgress(group.questions, answersById);
  return `<li class="survey-section survey-section-fill" data-section-id="${escapeHtml(group.id || "")}">
    <div class="survey-section-head">
      <h2 class="survey-section-title">${escapeHtml(group.title)}</h2>
      <p class="survey-section-progress" aria-label="${progress.answered} of ${progress.total} answered">
        ${progress.answered}/${progress.total} answered
      </p>
    </div>
    <ol class="survey-question-list survey-section-questions">
      ${group.questions.map(cardHtml).join("")}
    </ol>
  </li>`;
}

function render() {
  if (!house) {
    show(intro, false);
    show(missingEl, true);
    show(emptyEl, false);
    listEl.hidden = true;
    return;
  }
  show(missingEl, false);
  show(intro, true);
  titleEl.textContent = house.address || house.slug;
  backLink.href = detailsUrl(house.slug);
  document.title = `Survey · ${house.address || house.slug} · House Tracker`;

  if (!questions.length) {
    show(emptyEl, true);
    listEl.hidden = true;
    saveBtn.disabled = true;
    return;
  }
  show(emptyEl, false);
  listEl.hidden = false;
  saveBtn.disabled = false;
  const groups = groupQuestionsBySection(questions, sections);
  listEl.innerHTML = groups.map(sectionBlockHtml).join("");
}

function collectAnswers() {
  return questions.map((question) => {
    const card = listEl.querySelector(`.survey-card[data-id="${CSS.escape(question.id)}"]`);
    const notes = card?.querySelector(".answer-notes")?.value || "";
    return {
      questionId: question.id,
      value: card ? readAnswerValue(card, question) : null,
      notes,
    };
  });
}

function refreshStatusBadges() {
  for (const question of questions) {
    const card = listEl.querySelector(`.survey-card[data-id="${CSS.escape(question.id)}"]`);
    if (!card) continue;
    const answered = answerHasContent(liveAnswerForQuestion(question));
    const badge = card.querySelector(".survey-answer-status");
    if (badge) {
      badge.textContent = answered ? "Answered" : "Unanswered";
      badge.classList.toggle("is-answered", answered);
      badge.classList.toggle("is-unanswered", !answered);
    }
  }
  for (const section of listEl.querySelectorAll(".survey-section-fill")) {
    const sectionId = section.dataset.sectionId || null;
    const groupQuestions = questions.filter((q) => (q.sectionId || null) === (sectionId || null));
    const liveMap = new Map(
      groupQuestions.map((q) => [q.id, liveAnswerForQuestion(q)])
    );
    const progress = sectionProgress(groupQuestions, liveMap);
    const el = section.querySelector(".survey-section-progress");
    if (el) {
      el.textContent = `${progress.answered}/${progress.total} answered`;
      el.setAttribute("aria-label", `${progress.answered} of ${progress.total} answered`);
    }
  }
}

async function save() {
  if (!house) return;
  saveBtn.disabled = true;
  try {
    const res = await fetch(`/api/survey/answers/${encodeURIComponent(house.slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: collectAnswers() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not save answers.");
    answersById = new Map((data.answers || []).map((a) => [a.questionId, a]));
    refreshStatusBadges();
    showSave("ok", "Answers saved.");
  } catch (err) {
    showSave("error", err.message || "Could not save answers.");
  } finally {
    saveBtn.disabled = false;
  }
}

async function init() {
  bindAnswerControls(listEl);
  saveBtn.addEventListener("click", () => {
    save();
  });

  listEl.addEventListener("click", (event) => {
    const toggle = event.target.closest(".survey-collapse-toggle");
    if (!toggle) return;
    const card = toggle.closest(".survey-card");
    if (!card) return;
    const id = card.dataset.id;
    // Preserve in-progress answers across re-render
    const draftAnswers = collectAnswers();
    for (const item of draftAnswers) {
      const prev = answersById.get(item.questionId) || {};
      answersById.set(item.questionId, {
        ...prev,
        questionId: item.questionId,
        questionVersion: questions.find((q) => q.id === item.questionId)?.version,
        value: item.value,
        notes: item.notes,
      });
    }
    if (expandedIds.has(id)) expandedIds.delete(id);
    else expandedIds.add(id);
    render();
  });

  listEl.addEventListener("change", () => refreshStatusBadges());
  listEl.addEventListener("input", () => refreshStatusBadges());

  const slug = slugFromQuery();
  if (!slug) {
    house = null;
    render();
    return;
  }

  try {
    const [housesPayload, surveyPayload] = await Promise.all([
      fetchHouses(),
      fetch(`/api/survey/answers/${encodeURIComponent(slug)}`).then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load survey.");
        return data;
      }),
    ]);
    house = (housesPayload.houses || []).find((item) => item.slug === slug) || null;
    if (!house) {
      house = { slug, address: slug };
      ledeEl.textContent = "This slug is not in the current house list, but answers can still be saved.";
    }
    questions = surveyPayload.questions || [];
    sections = surveyPayload.sections || [];
    answersById = new Map((surveyPayload.answers || []).map((a) => [a.questionId, a]));
    render();
  } catch (err) {
    showSave("error", err.message || "Could not load survey.");
    house = { slug, address: slug };
    questions = [];
    sections = [];
    render();
  }
}

init();
