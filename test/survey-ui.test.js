const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const root = path.join(__dirname, "..");

describe("survey expand UI helpers", () => {
  it("renders a dual short/full title collapse toggle", async () => {
    const shared = await import(pathToFileURL(path.join(root, "public/js/survey-shared.js")).href);
    const html = shared.collapseToggleHtml(
      { title: "Kitchen space", text: "How good is the kitchen space and layout?" },
      { expanded: false, trailingHtml: '<span class="survey-answer-status">Unanswered</span>' }
    );
    assert.match(html, /survey-title-short[^>]*>Kitchen space</);
    assert.match(html, /survey-title-full[^>]*>How good is the kitchen space and layout\?</);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /survey-answer-status/);
    assert.doesNotMatch(html, /survey-card-index/);
    assert.doesNotMatch(html, /Answer type|Section name/i);
  });

  it("renders rating answers as radio pills with clear", async () => {
    const shared = await import(pathToFileURL(path.join(root, "public/js/survey-shared.js")).href);
    const html = shared.answerControlHtml(
      { id: "q1", type: "rating", config: { maxRating: 5 } },
      3,
      { name: "q-q1" }
    );
    assert.match(html, /role="radiogroup"/);
    assert.match(html, /rating-pills/);
    assert.match(html, /type="radio"[^>]*value="1"/);
    assert.match(html, /type="radio"[^>]*value="5"/);
    assert.match(html, /value="3"[^>]*checked|checked[^>]*value="3"/);
    assert.match(html, /data-clear="q-q1"/);
    assert.doesNotMatch(html, /rating-bubble|type="hidden"/);
  });

  it("reads rating values from checked radio inputs", async () => {
    globalThis.CSS = globalThis.CSS || { escape: (value) => String(value).replace(/"/g, '\\"') };
    const shared = await import(pathToFileURL(path.join(root, "public/js/survey-shared.js")).href);
    const rootEl = {
      querySelector(sel) {
        if (String(sel).includes(":checked")) return this._checked || null;
        return null;
      },
      _checked: { value: "4" },
    };
    assert.equal(shared.readAnswerValue(rootEl, { id: "r1", type: "rating" }), 4);
    rootEl._checked = null;
    assert.equal(shared.readAnswerValue(rootEl, { id: "r1", type: "rating" }), null);
  });

  it("fill/setup/details JS keep expanded body free of type/section display rows", () => {
    const fill = fs.readFileSync(path.join(root, "public/js/survey-fill.js"), "utf8");
    const setup = fs.readFileSync(path.join(root, "public/js/survey.js"), "utf8");
    const dashboard = fs.readFileSync(path.join(root, "public/js/dashboard.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "public/css/styles.css"), "utf8");

    assert.match(fill, /collapseToggleHtml/);
    assert.doesNotMatch(fill, /survey-card-index/);
    assert.doesNotMatch(fill, /survey-question-title/);

    assert.match(setup, /collapseToggleHtml/);
    assert.doesNotMatch(setup, /survey-type-hint/);

    assert.match(dashboard, /collapseToggleHtml/);
    assert.doesNotMatch(dashboard, /survey-answer-meta/);
    assert.doesNotMatch(dashboard, /survey-answer-question/);

    assert.match(css, /prefers-reduced-motion/);
    assert.match(css, /survey-title-short/);
    assert.match(css, /survey-title-full/);
    assert.match(css, /rating-pills/);
  });
});
