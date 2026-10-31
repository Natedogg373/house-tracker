const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

async function loadTips() {
  return import("../public/js/map-tips.js");
}

describe("map tips", async () => {
  const { houseTipHtml, schoolTipHtml } = await loadTips();

  it("school tip is only name, level, and rating", () => {
    const html = schoolTipHtml({
      name: "Moss Haven Elementary",
      level: "elementary",
      rating: 8,
    });
    assert.match(html, /Moss Haven Elementary/);
    assert.match(html, /Elementary · 8\/10/);
    assert.doesNotMatch(html, /<ul/);
    assert.doesNotMatch(html, /map-tip-houses/);
    assert.doesNotMatch(html, /No matching active houses/);
    assert.doesNotMatch(html, /Westover/);
    assert.doesNotMatch(html, /href=/);
  });

  it("house tip stays concise and does not list other houses", () => {
    const html = houseTipHtml(
      {
        slug: "9205-moss-farm-ln-75243",
        address: "9205 Moss Farm Ln, Dallas, TX 75243",
        listPrice: 670000,
        photoUrl: "https://example.com/house.jpg",
        inside: ["Lake Highlands"],
      },
      { name: "Moss Haven Elementary" },
      "elementary"
    );
    assert.match(html, /9205 Moss Farm Ln/);
    assert.match(html, /\$670,000/);
    assert.match(html, /Moss Haven Elementary/);
    assert.match(html, /In area/);
    assert.match(html, /View details/);
    assert.match(html, /\?house=9205-moss-farm-ln-75243/);
    assert.doesNotMatch(html, /<ul/);
    assert.doesNotMatch(html, /map-tip-houses/);
    assert.doesNotMatch(html, /Westover/);
    assert.doesNotMatch(html, /Seagrove/);
  });

  it("house tip notes a missing school at the selected level", () => {
    const html = houseTipHtml(
      { slug: "no-school", address: "1 Demo St", listPrice: 100000 },
      null,
      "middle"
    );
    assert.match(html, /No middle school/);
  });
});
