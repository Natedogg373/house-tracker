const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_SURVEY_DB_PATH = path.join(__dirname, "..", "data", "survey.db");

const QUESTION_TYPES = Object.freeze([
  "yes_no",
  "number",
  "rating",
  "date",
  "short_text",
  "multiple_choice",
]);

let db = null;
let openedPath = null;

function getSurveyDbPath(env = process.env) {
  if (env.SURVEY_DB_PATH && String(env.SURVEY_DB_PATH).trim()) {
    return path.resolve(String(env.SURVEY_DB_PATH).trim());
  }
  return DEFAULT_SURVEY_DB_PATH;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJson(text, fallback) {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeConfig(type, config) {
  const src = config && typeof config === "object" ? config : {};
  if (type === "rating") {
    const max = Math.round(Number(src.maxRating ?? src.max ?? 5));
    return { maxRating: Number.isFinite(max) ? Math.min(10, Math.max(2, max)) : 5 };
  }
  if (type === "multiple_choice") {
    const options = Array.isArray(src.options)
      ? src.options.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    return { options };
  }
  return {};
}

function normalizeType(type) {
  const value = String(type || "").trim();
  if (!QUESTION_TYPES.includes(value)) {
    const err = new Error(`Unknown answer type: ${type}`);
    err.code = "INVALID_TYPE";
    err.statusCode = 400;
    throw err;
  }
  return value;
}

function rowToQuestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    config: parseJson(row.config_json, {}),
    sortOrder: row.sort_order,
    archived: Boolean(row.archived),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAnswer(row) {
  if (!row) return null;
  return {
    id: row.id,
    houseSlug: row.house_slug,
    questionId: row.question_id,
    questionVersion: row.question_version,
    questionType: row.question_type,
    questionText: row.question_text,
    questionConfig: parseJson(row.question_config_json, {}),
    value: parseJson(row.value_json, null),
    notes: row.notes || "",
    updatedAt: row.updated_at,
    archived: Boolean(row.archived),
  };
}

function ensureSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS questions (
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

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      house_slug TEXT NOT NULL,
      question_id TEXT NOT NULL,
      question_version INTEGER NOT NULL,
      question_type TEXT NOT NULL,
      question_text TEXT NOT NULL,
      question_config_json TEXT NOT NULL DEFAULT '{}',
      value_json TEXT,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(house_slug, question_id)
    );

    CREATE INDEX IF NOT EXISTS idx_questions_active_order
      ON questions(archived, sort_order);
    CREATE INDEX IF NOT EXISTS idx_answers_house
      ON answers(house_slug);
  `);
}

function openSurveyDb(filePath = getSurveyDbPath()) {
  const resolved = path.resolve(filePath);
  if (db && openedPath === resolved) return db;
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
    openedPath = null;
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  db = new DatabaseSync(resolved);
  openedPath = resolved;
  ensureSchema(db);
  return db;
}

function getDb() {
  return openSurveyDb();
}

function closeSurveyDb() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
  db = null;
  openedPath = null;
}

/** Test helper: point at a fresh DB path and reopen. */
function resetSurveyDb(filePath) {
  closeSurveyDb();
  if (filePath) {
    process.env.SURVEY_DB_PATH = filePath;
    try {
      fs.rmSync(filePath, { force: true });
      fs.rmSync(`${filePath}-wal`, { force: true });
      fs.rmSync(`${filePath}-shm`, { force: true });
    } catch {
      /* ignore */
    }
  }
  return openSurveyDb(getSurveyDbPath());
}

function listQuestions({ includeArchived = false } = {}) {
  const database = getDb();
  const rows = includeArchived
    ? database
        .prepare(
          `SELECT * FROM questions
           ORDER BY archived ASC, sort_order ASC, created_at ASC`
        )
        .all()
    : database
        .prepare(
          `SELECT * FROM questions
           WHERE archived = 0
           ORDER BY sort_order ASC, created_at ASC`
        )
        .all();
  return rows.map(rowToQuestion);
}

function getQuestion(id) {
  const row = getDb().prepare(`SELECT * FROM questions WHERE id = ?`).get(id);
  return rowToQuestion(row);
}

function nextSortOrder(database) {
  const row = database.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM questions`).get();
  return Number(row?.max_order ?? -1) + 1;
}

function createQuestion(input = {}) {
  const type = normalizeType(input.type || "short_text");
  const text = String(input.text ?? "").trim();
  const config = normalizeConfig(type, input.config);
  const id = String(input.id || crypto.randomUUID());
  const stamp = nowIso();
  const database = getDb();
  const sortOrder =
    input.sortOrder == null || !Number.isFinite(Number(input.sortOrder))
      ? nextSortOrder(database)
      : Math.round(Number(input.sortOrder));

  database
    .prepare(
      `INSERT INTO questions
        (id, text, type, config_json, sort_order, archived, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`
    )
    .run(id, text, type, JSON.stringify(config), sortOrder, stamp, stamp);

  return getQuestion(id);
}

function updateQuestion(id, input = {}) {
  const existing = getQuestion(id);
  if (!existing) {
    const err = new Error("Question not found.");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (existing.archived) {
    const err = new Error("Archived questions cannot be edited.");
    err.statusCode = 409;
    err.code = "ARCHIVED";
    throw err;
  }

  const nextText = input.text !== undefined ? String(input.text ?? "").trim() : existing.text;
  const typeChanging = input.type !== undefined && String(input.type) !== existing.type;
  const nextType = typeChanging ? normalizeType(input.type) : existing.type;
  const nextConfig =
    input.config !== undefined || typeChanging
      ? normalizeConfig(nextType, input.config !== undefined ? input.config : existing.config)
      : normalizeConfig(nextType, existing.config);

  let version = existing.version;
  if (typeChanging) {
    if (!input.confirmTypeChange) {
      const err = new Error("Changing the answer type requires confirmation.");
      err.statusCode = 400;
      err.code = "CONFIRM_TYPE_CHANGE";
      throw err;
    }
    version += 1;
  } else {
    const prev = JSON.stringify(normalizeConfig(existing.type, existing.config));
    const next = JSON.stringify(nextConfig);
    if (prev !== next) version += 1;
  }

  const sortOrder =
    input.sortOrder == null || !Number.isFinite(Number(input.sortOrder))
      ? existing.sortOrder
      : Math.round(Number(input.sortOrder));

  getDb()
    .prepare(
      `UPDATE questions
       SET text = ?, type = ?, config_json = ?, sort_order = ?, version = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextText, nextType, JSON.stringify(nextConfig), sortOrder, version, nowIso(), id);

  return getQuestion(id);
}

function archiveQuestion(id) {
  const existing = getQuestion(id);
  if (!existing) {
    const err = new Error("Question not found.");
    err.statusCode = 404;
    err.code = "NOT_FOUND";
    throw err;
  }
  if (existing.archived) return existing;
  getDb()
    .prepare(`UPDATE questions SET archived = 1, updated_at = ? WHERE id = ?`)
    .run(nowIso(), id);
  return getQuestion(id);
}

function reorderQuestions(ids) {
  if (!Array.isArray(ids)) {
    const err = new Error('Send { "ids": ["question-id", ...] }.');
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }
  const active = listQuestions({ includeArchived: false });
  const byId = new Map(active.map((q) => [q.id, q]));
  const ordered = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id) || !byId.has(id)) continue;
    ordered.push(id);
    seen.add(id);
  }
  for (const q of active) {
    if (!seen.has(q.id)) ordered.push(q.id);
  }
  const database = getDb();
  const stamp = nowIso();
  const update = database.prepare(
    `UPDATE questions SET sort_order = ?, updated_at = ? WHERE id = ? AND archived = 0`
  );
  database.exec("BEGIN");
  try {
    ordered.forEach((id, index) => update.run(index, stamp, id));
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
  return listQuestions({ includeArchived: false });
}

function normalizeAnswerValue(type, value) {
  if (value === undefined) return null;
  if (value === null || value === "") return null;
  switch (type) {
    case "yes_no":
      if (value === true || value === "true" || value === "yes" || value === 1 || value === "1") return true;
      if (value === false || value === "false" || value === "no" || value === 0 || value === "0") return false;
      return null;
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case "rating": {
      const n = Math.round(Number(value));
      return Number.isFinite(n) ? n : null;
    }
    case "date": {
      const text = String(value).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
      return text;
    }
    case "short_text":
      return String(value);
    case "multiple_choice":
      return String(value);
    default:
      return value;
  }
}

function listAnswersForHouse(houseSlug) {
  const slug = String(houseSlug || "").trim();
  if (!slug) return [];
  const rows = getDb()
    .prepare(
      `SELECT a.*, q.archived AS archived, q.sort_order AS sort_order, q.created_at AS question_created_at
       FROM answers a
       LEFT JOIN questions q ON q.id = a.question_id
       WHERE a.house_slug = ?
       ORDER BY COALESCE(q.archived, 1) ASC,
                COALESCE(q.sort_order, 999999) ASC,
                a.updated_at ASC`
    )
    .all(slug);
  return rows.map(rowToAnswer);
}

function answerHasContent(answer) {
  if (!answer) return false;
  if (String(answer.notes || "").trim()) return true;
  if (answer.value === null || answer.value === undefined || answer.value === "") return false;
  return true;
}

function surveyStatusForHouse(houseSlug, activeQuestions = listQuestions({ includeArchived: false })) {
  const answers = listAnswersForHouse(houseSlug);
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  let answered = 0;
  for (const q of activeQuestions) {
    if (answerHasContent(byQuestion.get(q.id))) answered += 1;
  }
  const total = activeQuestions.length;
  return {
    houseSlug,
    totalQuestions: total,
    answeredQuestions: answered,
    filled: total > 0 && answered === total,
    started: answered > 0,
    empty: answered === 0,
  };
}

function saveAnswersForHouse(houseSlug, items) {
  const slug = String(houseSlug || "").trim();
  if (!slug) {
    const err = new Error("Missing house slug.");
    err.statusCode = 400;
    err.code = "MISSING_SLUG";
    throw err;
  }
  if (!Array.isArray(items)) {
    const err = new Error('Send { "answers": [{ "questionId", "value", "notes" }, ...] }.');
    err.statusCode = 400;
    err.code = "INVALID_BODY";
    throw err;
  }

  const active = listQuestions({ includeArchived: false });
  const byId = new Map(active.map((q) => [q.id, q]));
  const database = getDb();
  const stamp = nowIso();
  const existingRows = database
    .prepare(`SELECT * FROM answers WHERE house_slug = ?`)
    .all(slug);
  const existingByQuestion = new Map(existingRows.map((row) => [row.question_id, row]));
  const upsert = database.prepare(
    `INSERT INTO answers (
        id, house_slug, question_id, question_version, question_type, question_text,
        question_config_json, value_json, notes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(house_slug, question_id) DO UPDATE SET
        question_version = excluded.question_version,
        question_type = excluded.question_type,
        question_text = excluded.question_text,
        question_config_json = excluded.question_config_json,
        value_json = excluded.value_json,
        notes = excluded.notes,
        updated_at = excluded.updated_at`
  );

  database.exec("BEGIN");
  try {
    for (const item of items) {
      const questionId = String(item?.questionId || "").trim();
      const question = byId.get(questionId);
      if (!question) continue;
      const value = normalizeAnswerValue(question.type, item?.value);
      const notes = item?.notes == null ? "" : String(item.notes);
      const existing = existingByQuestion.get(question.id);
      const hasContent = value !== null || String(notes).trim() !== "";
      // After a type/version change, keep the prior snapshot until the user enters a new answer.
      if (
        existing &&
        Number(existing.question_version) !== Number(question.version) &&
        !hasContent
      ) {
        continue;
      }
      upsert.run(
        crypto.randomUUID(),
        slug,
        question.id,
        question.version,
        question.type,
        question.text,
        JSON.stringify(question.config || {}),
        JSON.stringify(value),
        notes,
        stamp
      );
    }
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }

  return {
    answers: listAnswersForHouse(slug),
    status: surveyStatusForHouse(slug, active),
  };
}

function houseAnswerSummaries(slugs) {
  const active = listQuestions({ includeArchived: false });
  const list = Array.isArray(slugs) ? slugs : [];
  return list.map((slug) => surveyStatusForHouse(slug, active));
}

module.exports = {
  QUESTION_TYPES,
  DEFAULT_SURVEY_DB_PATH,
  getSurveyDbPath,
  openSurveyDb,
  closeSurveyDb,
  resetSurveyDb,
  listQuestions,
  getQuestion,
  createQuestion,
  updateQuestion,
  archiveQuestion,
  reorderQuestions,
  listAnswersForHouse,
  saveAnswersForHouse,
  surveyStatusForHouse,
  houseAnswerSummaries,
  normalizeAnswerValue,
  answerHasContent,
};
