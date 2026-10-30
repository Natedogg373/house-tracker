const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  emptyInterest,
  normalizeInterest,
  markNotInterested,
  requestReactivation,
  interestStatus,
  isHiddenFromActive,
  saveInterest,
  loadInterest,
  reactivationInput,
  todayISO,
} = require("../lib/interest");

describe("interest state transitions", () => {
  it("starts empty and treats unknown slugs as active", () => {
    const state = emptyInterest();
    assert.equal(interestStatus(state, "maple"), "active");
    assert.equal(isHiddenFromActive(state, "maple"), false);
  });

  it("markNotInterested adds a slug with a since date and drops it from pending", () => {
    const pending = {
      notInterested: [],
      pendingReactivation: [{ slug: "maple", requested: "2026-10-01" }],
    };
    const next = markNotInterested(pending, "maple", "2026-10-30");
    assert.deepEqual(next.notInterested, [{ slug: "maple", since: "2026-10-30" }]);
    assert.deepEqual(next.pendingReactivation, []);
    assert.equal(interestStatus(next, "maple"), "notInterested");
    assert.equal(isHiddenFromActive(next, "maple"), true);
  });

  it("requestReactivation moves a slug from notInterested to pendingReactivation", () => {
    const state = markNotInterested(emptyInterest(), "oak", "2026-10-12");
    const next = requestReactivation(state, "oak", "2026-10-30");
    assert.deepEqual(next.notInterested, []);
    assert.deepEqual(next.pendingReactivation, [{ slug: "oak", requested: "2026-10-30" }]);
    assert.equal(interestStatus(next, "oak"), "pendingReactivation");
    assert.equal(isHiddenFromActive(next, "oak"), true);
  });

  it("does not keep a slug on both lists after normalize", () => {
    const messy = normalizeInterest({
      notInterested: [{ slug: "cedar", since: "2026-10-01" }],
      pendingReactivation: [{ slug: "cedar", requested: "2026-10-02" }],
    });
    assert.deepEqual(
      messy.notInterested.map((row) => row.slug),
      ["cedar"]
    );
    assert.deepEqual(messy.pendingReactivation, []);
  });

  it("round-trips through the committed JSON shape", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interest-"));
    const filePath = path.join(dir, "interest.json");
    const saved = saveInterest(
      {
        notInterested: [{ slug: "maple", since: "2026-10-30" }],
        pendingReactivation: [{ slug: "oak", requested: "2026-10-29" }],
      },
      filePath
    );
    assert.deepEqual(saved, {
      notInterested: [{ slug: "maple", since: "2026-10-30" }],
      pendingReactivation: [{ slug: "oak", requested: "2026-10-29" }],
    });
    assert.deepEqual(loadInterest(filePath), { ...saved, source: "file" });
  });

  it("builds a reactivate input from the Zillow URL, else the address", () => {
    assert.equal(
      reactivationInput({
        slug: "maple",
        address: "123 Maple Demo St",
        zillowUrl: "https://www.zillow.com/homedetails/maple",
      }),
      "https://www.zillow.com/homedetails/maple"
    );
    assert.equal(
      reactivationInput({ slug: "oak", address: "456 Oak Sample Ave" }),
      "456 Oak Sample Ave"
    );
    assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  });
});
