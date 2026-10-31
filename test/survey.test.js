const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

process.env.GIT_PULL_ENABLED = "false";
process.env.USE_SAMPLE_DATA = "true";
process.env.GEOCODE_PREFETCH = "false";
process.env.GEOCODE_CACHE_PATH = path.join(os.tmpdir(), `geocode-survey-${process.pid}.json`);
process.env.RANKINGS_PATH = path.join(os.tmpdir(), `rankings-survey-${process.pid}.json`);
process.env.INTEREST_PATH = path.join(os.tmpdir(), `interest-survey-${process.pid}.json`);
process.env.GEOFENCES_PATH = path.join(os.tmpdir(), `geofences-survey-${process.pid}.json`);
process.env.SURVEY_DB_PATH = path.join(os.tmpdir(), `survey-${process.pid}.db`);
delete process.env.HOUSE_TRACKER_WEBHOOK_URL;
delete process.env.HOUSE_TRACKER_WEBHOOK_AUTH;

const {
  resetSurveyDb,
  closeSurveyDb,
  createQuestion,
  listQuestions,
  updateQuestion,
  archiveQuestion,
  reorderQuestions,
  saveAnswersForHouse,
  listAnswersForHouse,
  surveyStatusForHouse,
  normalizeAnswerValue,
} = require("../lib/survey");
const { app } = require("../server");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function jsonRequest(port, pathname, options = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

describe("survey storage", () => {
  beforeEach(() => {
    const dbPath = path.join(os.tmpdir(), `survey-unit-${process.pid}-${Date.now()}.db`);
    resetSurveyDb(dbPath);
  });

  after(() => {
    closeSurveyDb();
  });

  it("starts with no questions and creates typed questions", () => {
    assert.deepEqual(listQuestions(), []);
    const q = createQuestion({
      text: "Kitchen updated?",
      type: "yes_no",
    });
    assert.equal(q.text, "Kitchen updated?");
    assert.equal(q.type, "yes_no");
    assert.equal(q.version, 1);
    assert.equal(q.archived, false);
    assert.equal(listQuestions().length, 1);
  });

  it("normalizes rating and multiple-choice config", () => {
    const rating = createQuestion({ type: "rating", config: { maxRating: 7 } });
    assert.deepEqual(rating.config, { maxRating: 7 });
    const mc = createQuestion({
      type: "multiple_choice",
      config: { options: [" Great ", "", "Ok"] },
    });
    assert.deepEqual(mc.config, { options: ["Great", "Ok"] });
  });

  it("soft-deletes questions and keeps answers viewable as archived", () => {
    const q = createQuestion({ text: "Noise?", type: "short_text" });
    saveAnswersForHouse("demo-slug", [
      { questionId: q.id, value: "Quiet street", notes: "Visited Saturday" },
    ]);
    archiveQuestion(q.id);
    assert.equal(listQuestions().length, 0);
    assert.equal(listQuestions({ includeArchived: true }).length, 1);
    const answers = listAnswersForHouse("demo-slug");
    assert.equal(answers.length, 1);
    assert.equal(answers[0].archived, true);
    assert.equal(answers[0].value, "Quiet street");
    assert.equal(answers[0].notes, "Visited Saturday");
  });

  it("requires confirmation to change type and preserves prior answer snapshots", () => {
    const q = createQuestion({ text: "Flood risk?", type: "yes_no" });
    saveAnswersForHouse("house-a", [{ questionId: q.id, value: true, notes: "Seller said no" }]);

    assert.throws(() => updateQuestion(q.id, { type: "short_text" }), (err) => {
      assert.equal(err.code, "CONFIRM_TYPE_CHANGE");
      return true;
    });

    const updated = updateQuestion(q.id, { type: "short_text", confirmTypeChange: true });
    assert.equal(updated.type, "short_text");
    assert.equal(updated.version, 2);

    const beforeResave = listAnswersForHouse("house-a")[0];
    assert.equal(beforeResave.questionType, "yes_no");
    assert.equal(beforeResave.value, true);
    assert.equal(beforeResave.questionVersion, 1);

    // Empty save after type change must not wipe the old snapshot.
    saveAnswersForHouse("house-a", [{ questionId: q.id, value: null, notes: "" }]);
    const kept = listAnswersForHouse("house-a")[0];
    assert.equal(kept.questionType, "yes_no");
    assert.equal(kept.value, true);

    saveAnswersForHouse("house-a", [{ questionId: q.id, value: "Low", notes: "Re-checked" }]);
    const replaced = listAnswersForHouse("house-a")[0];
    assert.equal(replaced.questionType, "short_text");
    assert.equal(replaced.value, "Low");
    assert.equal(replaced.questionVersion, 2);
  });

  it("reorders active questions", () => {
    const a = createQuestion({ text: "A", type: "number" });
    const b = createQuestion({ text: "B", type: "number" });
    const c = createQuestion({ text: "C", type: "number" });
    const ordered = reorderQuestions([c.id, a.id, b.id]);
    assert.deepEqual(
      ordered.map((q) => q.id),
      [c.id, a.id, b.id]
    );
  });

  it("tracks fill status per house", () => {
    const q1 = createQuestion({ text: "One", type: "short_text" });
    createQuestion({ text: "Two", type: "short_text" });
    let status = surveyStatusForHouse("slug-1");
    assert.equal(status.totalQuestions, 2);
    assert.equal(status.empty, true);
    saveAnswersForHouse("slug-1", [{ questionId: q1.id, value: "done", notes: "" }]);
    status = surveyStatusForHouse("slug-1");
    assert.equal(status.started, true);
    assert.equal(status.filled, false);
    assert.equal(status.answeredQuestions, 1);
  });

  it("normalizes answer values by type", () => {
    assert.equal(normalizeAnswerValue("yes_no", "yes"), true);
    assert.equal(normalizeAnswerValue("yes_no", "no"), false);
    assert.equal(normalizeAnswerValue("number", "12.5"), 12.5);
    assert.equal(normalizeAnswerValue("rating", "3"), 3);
    assert.equal(normalizeAnswerValue("date", "2026-10-31"), "2026-10-31");
    assert.equal(normalizeAnswerValue("date", "not-a-date"), null);
  });
});

describe("survey API", () => {
  let server;
  let port;
  let dbPath;

  before(async () => {
    dbPath = path.join(os.tmpdir(), `survey-api-${process.pid}.db`);
    process.env.SURVEY_DB_PATH = dbPath;
    resetSurveyDb(dbPath);
    server = http.createServer(app);
    port = await listen(server);
  });

  beforeEach(() => {
    resetSurveyDb(dbPath);
  });

  after(() => {
    server.close();
    closeSurveyDb();
    fs.rmSync(dbPath, { force: true });
  });

  it("serves survey setup and fill pages", async () => {
    const setup = await fetch(`http://127.0.0.1:${port}/survey`);
    const setupHtml = await setup.text();
    assert.equal(setup.status, 200);
    assert.match(setupHtml, /House Survey/);
    assert.match(setupHtml, /id="add-question"/);
    assert.match(setupHtml, /href="\/survey"/);

    const fill = await fetch(`http://127.0.0.1:${port}/survey/fill?house=demo`);
    const fillHtml = await fill.text();
    assert.equal(fill.status, 200);
    assert.match(fillHtml, /id="save-answers"/);
    assert.match(fillHtml, /House survey/);
  });

  it("creates, lists, updates, reorders, and archives questions over HTTP", async () => {
    const created = await jsonRequest(port, "/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({ text: "Yard size?", type: "short_text" }),
    });
    assert.equal(created.res.status, 201);
    assert.equal(created.data.question.text, "Yard size?");
    const id = created.data.question.id;

    const second = await jsonRequest(port, "/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({ text: "Rating", type: "rating", config: { maxRating: 5 } }),
    });
    assert.equal(second.res.status, 201);

    const listed = await jsonRequest(port, "/api/survey/questions");
    assert.equal(listed.data.questions.length, 2);

    const updated = await jsonRequest(port, `/api/survey/questions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ text: "Backyard size?", type: "number", confirmTypeChange: true }),
    });
    assert.equal(updated.res.status, 200);
    assert.equal(updated.data.question.type, "number");
    assert.equal(updated.data.question.version, 2);

    const reordered = await jsonRequest(port, "/api/survey/questions/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids: [second.data.question.id, id] }),
    });
    assert.equal(reordered.res.status, 200);
    assert.deepEqual(
      reordered.data.questions.map((q) => q.id),
      [second.data.question.id, id]
    );

    const archived = await jsonRequest(port, `/api/survey/questions/${id}`, {
      method: "DELETE",
    });
    assert.equal(archived.res.status, 200);
    assert.equal(archived.data.question.archived, true);

    const active = await jsonRequest(port, "/api/survey/questions");
    assert.equal(active.data.questions.length, 1);
  });

  it("saves and loads per-house answers", async () => {
    const created = await jsonRequest(port, "/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({
        text: "Condition",
        type: "multiple_choice",
        config: { options: ["Great", "Ok", "Needs work"] },
      }),
    });
    const questionId = created.data.question.id;
    const slug = "123-maple-demo-st-dallas-tx";

    const saved = await jsonRequest(port, `/api/survey/answers/${slug}`, {
      method: "PUT",
      body: JSON.stringify({
        answers: [{ questionId, value: "Ok", notes: "Carpet worn in living room" }],
      }),
    });
    assert.equal(saved.res.status, 200);
    assert.equal(saved.data.answers.length, 1);
    assert.equal(saved.data.answers[0].value, "Ok");
    assert.equal(saved.data.status.started, true);

    const loaded = await jsonRequest(port, `/api/survey/answers/${slug}`);
    assert.equal(loaded.res.status, 200);
    assert.equal(loaded.data.answers[0].notes, "Carpet worn in living room");

    const status = await jsonRequest(port, `/api/survey/status?slugs=${slug}`);
    assert.equal(status.res.status, 200);
    assert.equal(status.data.statuses[0].answeredQuestions, 1);
  });

  it("rejects type changes without confirmation over HTTP", async () => {
    const created = await jsonRequest(port, "/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({ text: "Date seen", type: "date" }),
    });
    const id = created.data.question.id;
    const { res, data } = await jsonRequest(port, `/api/survey/questions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ type: "short_text" }),
    });
    assert.equal(res.status, 400);
    assert.equal(data.code, "CONFIRM_TYPE_CHANGE");
  });
});
