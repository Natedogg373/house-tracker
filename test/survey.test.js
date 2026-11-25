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
  createSection,
  listQuestions,
  listSections,
  updateQuestion,
  archiveQuestion,
  reorderQuestions,
  reorderSections,
  deleteSection,
  saveAnswersForHouse,
  listAnswersForHouse,
  surveyStatusForHouse,
  normalizeAnswerValue,
  importSurvey,
  maybeSeedSurveyFromFile,
  countAllQuestions,
  questionDisplayTitle,
  DEFAULT_SURVEY_SEED_PATH,
  openSurveyDb,
} = require("../lib/survey");
const { DatabaseSync } = require("node:sqlite");
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
      title: "Kitchen",
    });
    assert.equal(q.text, "Kitchen updated?");
    assert.equal(q.title, "Kitchen");
    assert.equal(q.type, "yes_no");
    assert.equal(q.version, 1);
    assert.equal(q.archived, false);
    assert.equal(q.sectionId, null);
    assert.equal(listQuestions().length, 1);
  });

  it("normalizes rating, number unit, and multiple-choice config", () => {
    const rating = createQuestion({ type: "rating", config: { maxRating: 7 } });
    assert.deepEqual(rating.config, { maxRating: 7 });
    const number = createQuestion({ type: "number", config: { unit: "years" } });
    assert.deepEqual(number.config, { unit: "years" });
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

  it("creates sections and assigns questions; Other holds unassigned", () => {
    const kitchen = createSection({ title: "Kitchen" });
    const outside = createSection({ title: "Outside" });
    const q1 = createQuestion({ text: "Layout?", type: "rating", sectionId: kitchen.id, title: "Layout" });
    const q2 = createQuestion({ text: "Fence?", type: "yes_no", sectionId: outside.id });
    const q3 = createQuestion({ text: "Notes?", type: "short_text" });
    assert.equal(q1.sectionId, kitchen.id);
    assert.equal(q3.sectionId, null);

    const ordered = listQuestions();
    assert.deepEqual(
      ordered.map((q) => q.id),
      [q1.id, q2.id, q3.id]
    );

    updateQuestion(q3.id, { sectionId: kitchen.id });
    assert.equal(getSectionQuestions(kitchen.id).map((q) => q.id).includes(q3.id), true);

    deleteSection(kitchen.id);
    assert.equal(listSections().length, 1);
    assert.equal(listQuestions().find((q) => q.id === q1.id).sectionId, null);
  });

  it("reorders sections and questions within a section", () => {
    const a = createSection({ title: "A" });
    const b = createSection({ title: "B" });
    reorderSections([b.id, a.id]);
    assert.deepEqual(
      listSections().map((s) => s.id),
      [b.id, a.id]
    );

    const q1 = createQuestion({ text: "One", type: "number", sectionId: a.id });
    const q2 = createQuestion({ text: "Two", type: "number", sectionId: a.id });
    const q3 = createQuestion({ text: "Three", type: "number", sectionId: a.id });
    reorderQuestions([q3.id, q1.id, q2.id], a.id);
    assert.deepEqual(
      getSectionQuestions(a.id).map((q) => q.id),
      [q3.id, q1.id, q2.id]
    );
  });

  it("reorders active questions globally for backward compatibility", () => {
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

  it("falls back display title to truncated question text", () => {
    assert.equal(questionDisplayTitle({ title: "Roof", text: "How old is the roof?" }), "Roof");
    const long = "A".repeat(100);
    const display = questionDisplayTitle({ text: long });
    assert.ok(display.endsWith("…"));
    assert.ok(display.length < long.length);
  });

  it("migrates existing question tables in place without data loss", () => {
    const dbPath = path.join(os.tmpdir(), `survey-migrate-${process.pid}-${Date.now()}.db`);
    closeSurveyDb();
    fs.rmSync(dbPath, { force: true });
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL,
        config_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy
      .prepare(
        `INSERT INTO questions (id, text, type, config_json, sort_order, archived, version, created_at, updated_at)
         VALUES (?, ?, ?, '{}', 0, 0, 1, ?, ?)`
      )
      .run("legacy-q", "Legacy question", "short_text", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    legacy.close();

    process.env.SURVEY_DB_PATH = dbPath;
    openSurveyDb(dbPath);
    const questions = listQuestions();
    assert.equal(questions.length, 1);
    assert.equal(questions[0].id, "legacy-q");
    assert.equal(questions[0].text, "Legacy question");
    assert.equal(questions[0].title, "");
    assert.equal(questions[0].sectionId, null);
  });

  it("imports sections/questions and skips duplicates in the same section", () => {
    const first = importSurvey({
      sections: [
        {
          title: "Kitchen",
          questions: [
            { title: "Layout", text: "How is the layout?", type: "rating", config: { maxRating: 10 } },
            { title: "Cabinets", text: "Enough cabinets?", type: "yes_no" },
          ],
        },
      ],
    });
    assert.equal(first.createdQuestions.length, 2);
    assert.equal(first.createdSections.length, 1);

    const second = importSurvey({
      sections: [
        {
          title: "Kitchen",
          questions: [
            { text: "How is the layout?", type: "rating" },
            { text: "New question?", type: "short_text", title: "New" },
          ],
        },
      ],
    });
    assert.equal(second.createdQuestions.length, 1);
    assert.equal(second.skippedQuestions.length, 1);
    assert.equal(second.skippedQuestions[0].reason, "duplicate_text");
    assert.equal(listQuestions().length, 3);
    assert.equal(listSections().length, 1);
  });

  it("seeds the walkthrough checklist once and skips when any questions exist", () => {
    assert.equal(countAllQuestions(), 0);
    const seeded = maybeSeedSurveyFromFile(DEFAULT_SURVEY_SEED_PATH);
    assert.equal(seeded.seeded, true);
    assert.equal(listSections().length, 6);
    assert.equal(listQuestions().length, 20);

    const kitchenSpace = listQuestions().find((q) => q.title === "Kitchen space");
    assert.ok(kitchenSpace);
    assert.equal(kitchenSpace.type, "rating");
    assert.equal(kitchenSpace.config.maxRating, 5);

    const roof = listQuestions().find((q) => q.title === "Roof age");
    assert.equal(roof.type, "number");
    assert.equal(roof.config.unit, "years");

    const fence = listQuestions().find((q) => q.title === "Fence");
    assert.equal(fence.type, "multiple_choice");
    assert.deepEqual(fence.config.options, ["Has one", "Could add", "No"]);

    const shed = listQuestions().find((q) => q.title === "Shed");
    assert.equal(shed.type, "multiple_choice");
    assert.deepEqual(shed.config.options, ["Has one", "Could add", "No"]);

    const again = maybeSeedSurveyFromFile(DEFAULT_SURVEY_SEED_PATH);
    assert.equal(again.seeded, false);
    assert.equal(again.reason, "already_has_questions");
    assert.equal(listQuestions().length, 20);

    // Soft-deleted questions still block re-seed.
    resetSurveyDb(path.join(os.tmpdir(), `survey-seed-archived-${process.pid}-${Date.now()}.db`));
    createQuestion({ text: "Only archived later", type: "short_text" });
    archiveQuestion(listQuestions()[0].id);
    assert.equal(listQuestions().length, 0);
    assert.equal(countAllQuestions(), 1);
    const blocked = maybeSeedSurveyFromFile(DEFAULT_SURVEY_SEED_PATH);
    assert.equal(blocked.seeded, false);
    assert.equal(blocked.reason, "already_has_questions");
  });
});

function getSectionQuestions(sectionId) {
  return listQuestions().filter((q) => q.sectionId === sectionId);
}

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
    assert.match(setupHtml, /id="add-section"/);
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
      body: JSON.stringify({ text: "Yard size?", type: "short_text", title: "Yard" }),
    });
    assert.equal(created.res.status, 201);
    assert.equal(created.data.question.text, "Yard size?");
    assert.equal(created.data.question.title, "Yard");
    const id = created.data.question.id;

    const second = await jsonRequest(port, "/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({ text: "Rating", type: "rating", config: { maxRating: 10 } }),
    });
    assert.equal(second.res.status, 201);

    const listed = await jsonRequest(port, "/api/survey/questions");
    assert.equal(listed.data.questions.length, 2);
    assert.ok(Array.isArray(listed.data.sections));
    assert.ok(Array.isArray(listed.data.groups));

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

  it("manages sections and import over HTTP", async () => {
    const section = await jsonRequest(port, "/api/survey/sections", {
      method: "POST",
      body: JSON.stringify({ title: "Systems" }),
    });
    assert.equal(section.res.status, 201);
    const sectionId = section.data.section.id;

    const renamed = await jsonRequest(port, `/api/survey/sections/${sectionId}`, {
      method: "PUT",
      body: JSON.stringify({ title: "Systems & Structure" }),
    });
    assert.equal(renamed.res.status, 200);
    assert.equal(renamed.data.section.title, "Systems & Structure");

    const q = await jsonRequest(port, "/api/survey/questions", {
      method: "POST",
      body: JSON.stringify({
        text: "Roof age?",
        title: "Roof",
        type: "number",
        config: { unit: "years" },
        sectionId,
      }),
    });
    assert.equal(q.res.status, 201);
    assert.equal(q.data.question.sectionId, sectionId);
    assert.equal(q.data.question.config.unit, "years");

    const imported = await jsonRequest(port, "/api/survey/import", {
      method: "POST",
      body: JSON.stringify({
        sections: [
          {
            title: "Systems & Structure",
            questions: [
              { title: "Roof", text: "Roof age?", type: "number", unit: "years" },
              { title: "AC", text: "How old is the AC?", type: "number", unit: "years" },
            ],
          },
        ],
      }),
    });
    assert.equal(imported.res.status, 200);
    assert.equal(imported.data.createdQuestions.length, 1);
    assert.equal(imported.data.skippedQuestions.length, 1);

    const deleted = await jsonRequest(port, `/api/survey/sections/${sectionId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.res.status, 200);
    const listed = await jsonRequest(port, "/api/survey/questions");
    assert.ok(listed.data.questions.every((item) => item.sectionId == null));
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
    assert.ok(Array.isArray(loaded.data.sections));

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
