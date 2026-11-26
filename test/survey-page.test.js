const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");

describe("survey page URL helpers", () => {
  it("builds fill/edit URLs and parses mode + house from the query", async () => {
    globalThis.CSS = globalThis.CSS || { escape: (value) => String(value) };
    const shared = await import(pathToFileURL(path.join(root, "public/js/survey-shared.js")).href);

    assert.equal(shared.surveyFillUrl("abc"), "/survey?house=abc");
    assert.equal(shared.surveyFillUrl(""), "/survey");
    assert.equal(shared.surveyEditUrl(), "/survey?mode=edit");
    assert.equal(shared.surveyEditUrl("abc"), "/survey?mode=edit&house=abc");
    assert.equal(shared.surveyPageUrl({ mode: "fill", house: "x" }), "/survey?house=x");
    assert.equal(shared.surveyPageUrl({ mode: "edit" }), "/survey?mode=edit");

    assert.deepEqual(shared.parseSurveyUrl("/survey"), { mode: "fill", house: "" });
    assert.deepEqual(shared.parseSurveyUrl("/survey?house=demo"), { mode: "fill", house: "demo" });
    assert.deepEqual(shared.parseSurveyUrl("/survey?mode=edit"), { mode: "edit", house: "" });
    assert.deepEqual(shared.parseSurveyUrl("/survey?mode=setup&house=a"), {
      mode: "edit",
      house: "a",
    });
    assert.deepEqual(shared.parseSurveyUrl("/survey?mode=fill&house=a"), {
      mode: "fill",
      house: "a",
    });
  });

  it("wires the Survey HTML to fill/edit panels and the page controller", () => {
    const html = fs.readFileSync(path.join(root, "public/survey.html"), "utf8");
    assert.match(html, /id="survey-page"/);
    assert.match(html, /data-mode="fill"/);
    assert.match(html, /data-mode="edit"/);
    assert.match(html, /id="survey-fill"/);
    assert.match(html, /id="survey-edit"/);
    assert.match(html, /id="survey-house-input"/);
    assert.match(html, /survey-page\.js/);
    assert.doesNotMatch(html, /survey\.js"/);
  });
});
