#!/usr/bin/env node
/**
 * Bulk-import survey sections + questions from a JSON file.
 *
 * Usage:
 *   npm run survey:import -- path/to/file.json
 *
 * Payload shape:
 * {
 *   "sections": [
 *     {
 *       "title": "Kitchen",
 *       "questions": [
 *         { "title": "Updated?", "text": "Has the kitchen been updated?", "type": "yes_no" },
 *         { "text": "Condition", "type": "multiple_choice", "options": ["Great", "Ok", "Needs work"] }
 *       ]
 *     }
 *   ]
 * }
 *
 * Idempotent-ish: reuses sections by title; skips questions whose text already
 * exists in the same section.
 */
const fs = require("fs");
const path = require("path");
const { importSurvey, closeSurveyDb, getSurveyDbPath } = require("../lib/survey");

function usage() {
  console.error("Usage: npm run survey:import -- <file.json>");
  console.error("       node scripts/survey-import.js <file.json>");
}

function main() {
  const fileArg = process.argv[2];
  if (!fileArg || fileArg === "-h" || fileArg === "--help") {
    usage();
    process.exit(fileArg ? 0 : 1);
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`Could not parse JSON: ${err.message}`);
    process.exit(1);
  }

  try {
    const result = importSurvey(payload);
    console.log(`Survey DB: ${getSurveyDbPath()}`);
    console.log(
      `Sections created: ${result.createdSections.length}, reused: ${result.reusedSections.length}`
    );
    console.log(
      `Questions created: ${result.createdQuestions.length}, skipped: ${result.skippedQuestions.length}`
    );
    if (result.skippedQuestions.length) {
      for (const skip of result.skippedQuestions) {
        console.log(`  skip (${skip.reason}): ${skip.text || "(empty)"}`);
      }
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  } finally {
    closeSurveyDb();
  }
}

main();
