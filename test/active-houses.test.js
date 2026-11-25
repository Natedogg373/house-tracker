const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

async function loadCommon() {
  return import("../public/js/common.js");
}

describe("isActiveHouse", async () => {
  const { isActiveHouse } = await loadCommon();
  const interest = {
    notInterested: [{ slug: "skip-me", since: "2026-01-01" }],
    pendingReactivation: [{ slug: "pending-me", requested: "2026-02-01" }],
  };

  it("keeps for-sale and pending listings that are still interested", () => {
    assert.equal(isActiveHouse({ slug: "a", status: "For sale" }, interest), true);
    assert.equal(isActiveHouse({ slug: "b", status: "Pending (since 9/22/2026)" }, interest), true);
    assert.equal(isActiveHouse({ slug: "c", status: "Contingent" }, interest), true);
  });

  it("treats sold houses as inactive (same as the Graveyard sold list)", () => {
    assert.equal(isActiveHouse({ slug: "sold-1", status: "Sold" }, interest), false);
    assert.equal(
      isActiveHouse(
        { slug: "sold-2", status: "Sold (found 11/22/2026; price/date not shown; last listed $549,000)" },
        interest
      ),
      false
    );
  });

  it("treats not-interested and pending-reactivation houses as inactive", () => {
    assert.equal(isActiveHouse({ slug: "skip-me", status: "For sale" }, interest), false);
    assert.equal(isActiveHouse({ slug: "pending-me", status: "For sale" }, interest), false);
  });

  it("rejects missing houses", () => {
    assert.equal(isActiveHouse(null, interest), false);
    assert.equal(isActiveHouse(undefined, interest), false);
  });
});

describe("housesForDetailsSelect", async () => {
  const { housesForDetailsSelect } = await loadCommon();
  const interest = {
    notInterested: [{ slug: "ni-house", since: "2026-01-01" }],
    pendingReactivation: [],
  };
  const houses = [
    { slug: "active-a", address: "1 Active A", status: "For sale" },
    { slug: "sold-house", address: "2 Sold", status: "Sold" },
    { slug: "ni-house", address: "3 Not Interested", status: "For sale" },
    { slug: "active-b", address: "4 Active B", status: "Pending" },
  ];

  it("lists only active houses by default", () => {
    assert.deepEqual(
      housesForDetailsSelect(houses, interest).map((h) => h.slug),
      ["active-a", "active-b"]
    );
  });

  it("keeps a sold graveyard house as the selected entry only when current", () => {
    assert.deepEqual(
      housesForDetailsSelect(houses, interest, "sold-house").map((h) => h.slug),
      ["active-a", "active-b", "sold-house"]
    );
  });

  it("keeps a not-interested graveyard house as the selected entry only when current", () => {
    assert.deepEqual(
      housesForDetailsSelect(houses, interest, "ni-house").map((h) => h.slug),
      ["active-a", "active-b", "ni-house"]
    );
  });

  it("does not invent entries for unknown slugs", () => {
    assert.deepEqual(
      housesForDetailsSelect(houses, interest, "missing").map((h) => h.slug),
      ["active-a", "active-b"]
    );
  });

  it("handles empty input", () => {
    assert.deepEqual(housesForDetailsSelect([], interest, "sold-house"), []);
    assert.deepEqual(housesForDetailsSelect(null, interest), []);
  });
});
