import { detailsUrl, escapeHtml, fetchHouses, show } from "./common.js";
import {
  answerControlHtml,
  bindAnswerControls,
  readAnswerValue,
  TYPE_LABELS,
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
let answersById = new Map();
let persistTimer = 0;

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

function cardHtml(question) {
  const existing = answersById.get(question.id);
  const versionMatch = existing && Number(existing.questionVersion) === Number(question.version);
  const value = versionMatch ? existing.value : null;
  const notes = versionMatch ? existing.notes || "" : "";
  const typeLabel = TYPE_LABELS[question.type] || question.type;
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
  return `<li class="survey-card survey-card-fill" data-id="${escapeHtml(question.id)}">
    <div class="survey-card-toolbar">
      <span class="survey-card-index">${escapeHtml(typeLabel)}</span>
    </div>
    <h2 class="survey-question-title">${escapeHtml(question.text || "Untitled question")}</h2>
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
  listEl.innerHTML = questions.map(cardHtml).join("");
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
    answersById = new Map((surveyPayload.answers || []).map((a) => [a.questionId, a]));
    render();
  } catch (err) {
    showSave("error", err.message || "Could not load survey.");
    house = { slug, address: slug };
    questions = [];
    render();
  }
}

init();
