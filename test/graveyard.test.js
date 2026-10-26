const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadHousesFromDir, SAMPLE_DIR, HOUSES_DIR } = require("../lib/houses");
const {
  isSoldStatus,
  originalListingPrice,
  lowestListingPrice,
  daysOnMarket,
  buildGraveyard,
} = require("../lib/graveyard");

describe("isSoldStatus", () => {
  it("matches Sold as a word, including dated statuses", () => {
    assert.equal(isSoldStatus("Sold"), true);
    assert.equal(isSoldStatus("sold"), true);
    assert.equal(isSoldStatus("Sold (10/1/2026)"), true);
    assert.equal(isSoldStatus("Sold (found 10/18/2026; price/date not shown; last listed $615,000)"), true);
    assert.equal(isSoldStatus("Recently sold"), true);
  });

  it("does not treat active, pending, or contingent listings as sold", () => {
    assert.equal(isSoldStatus("For sale"), false);
    assert.equal(isSoldStatus("For sale (price cut 9/30/2026)"), false);
    assert.equal(isSoldStatus("Pending"), false);
    assert.equal(isSoldStatus("Pending (since 9/22/2026)"), false);
    assert.equal(isSoldStatus("Contingent (since 10/7/2026)"), false);
    assert.equal(isSoldStatus(""), false);
    assert.equal(isSoldStatus(null), false);
  });
});

describe("price and days helpers", () => {
  const house = {
    listPrice: 600000,
    lastUpdated: "2026-10-25",
    priceHistory: [
      { week: "2026-09-21", price: 590000 },
      { week: "2026-09-07", price: 610000 },
      { week: "2026-09-14", price: null },
      { week: "2026-09-28", price: 580000 },
    ],
  };

  it("uses the first chronological non-null history price as original", () => {
    assert.equal(originalListingPrice(house), 610000);
    assert.equal(originalListingPrice({ listPrice: 500000, priceHistory: [] }), 500000);
    assert.equal(originalListingPrice({}), null);
  });

  it("uses the minimum non-null history price as lowest", () => {
    assert.equal(lowestListingPrice(house), 580000);
    assert.equal(lowestListingPrice({ listPrice: 500000 }), 500000);
  });

  it("computes days on market from first listed week to soldDate, then last listed week", () => {
    assert.equal(daysOnMarket({ ...house, soldDate: "2026-10-12" }), 35);
    assert.equal(daysOnMarket(house), 21);
    assert.equal(daysOnMarket({ lastUpdated: "2026-10-25", listPrice: 1 }), null);
    assert.equal(
      daysOnMarket({
        lastUpdated: "2026-10-25",
        priceHistory: [{ week: "2026-10-05", price: 100 }],
      }),
      0
    );
  });
});

describe("buildGraveyard", () => {
  it("keeps only sold houses, computes fields, and sorts by soldDate then address", () => {
    const houses = [
      {
        slug: "pending-st",
        address: "1 Pending St",
        status: "Pending",
        listPrice: 1,
      },
      {
        slug: "older-sold",
        address: "Zebra Sold St",
        status: "Sold",
        listPrice: 400000,
        salePrice: 390000,
        soldDate: "2026-09-01",
        priceHistory: [
          { week: "2026-08-03", price: 410000 },
          { week: "2026-08-17", price: 400000 },
        ],
      },
      {
        slug: "newer-sold",
        address: "Apple Sold St",
        status: "Sold (10/15/2026)",
        listPrice: 500000,
        soldDate: "2026-10-15",
        priceHistory: [{ week: "2026-09-07", price: 500000 }],
      },
      {
        slug: "no-date-b",
        address: "B No Date St",
        status: "Sold",
        listPrice: 300000,
      },
      {
        slug: "no-date-a",
        address: "A No Date St",
        status: "sold",
        listPrice: 200000,
      },
    ];

    const rows = buildGraveyard(houses);
    assert.deepEqual(
      rows.map((h) => h.slug),
      ["newer-sold", "older-sold", "no-date-a", "no-date-b"]
    );
    assert.equal(rows[0].originalPrice, 500000);
    assert.equal(rows[0].lowestPrice, 500000);
    assert.equal(rows[0].salePrice, null);
    assert.equal(rows[0].daysOnMarket, 38);
    assert.equal(rows[1].originalPrice, 410000);
    assert.equal(rows[1].lowestPrice, 400000);
    assert.equal(rows[1].salePrice, 390000);
    assert.equal(rows[1].daysOnMarket, 29);
  });

  it("includes the two fake sold samples and skips for-sale/pending ones", () => {
    const rows = buildGraveyard(loadHousesFromDir(SAMPLE_DIR));
    assert.deepEqual(
      rows.map((h) => h.slug),
      ["321-willow-sold-st-dallas-tx", "654-birch-closed-ave-garland-tx"]
    );
    const willow = rows[0];
    assert.equal(willow.originalPrice, 689000);
    assert.equal(willow.lowestPrice, 665000);
    assert.equal(willow.salePrice, 655000);
    assert.equal(willow.daysOnMarket, 73);
    const birch = rows[1];
    assert.equal(birch.originalPrice, 599000);
    assert.equal(birch.lowestPrice, 575000);
    assert.equal(birch.salePrice, null);
    assert.equal(birch.daysOnMarket, 56);
  });

  it("shows Clearhurst and White Pine as sold with Unknown sale price and history-based stats", () => {
    const rows = buildGraveyard(loadHousesFromDir(HOUSES_DIR));
    const bySlug = Object.fromEntries(rows.map((h) => [h.slug, h]));
    assert.ok(bySlug["9028-clearhurst-dr-75238"]);
    assert.ok(bySlug["8915-white-pine-ln-75238"]);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((h) => h.slug),
      ["8915-white-pine-ln-75238", "9028-clearhurst-dr-75238"]
    );

    const whitePine = bySlug["8915-white-pine-ln-75238"];
    assert.match(whitePine.status, /\bSold\b/i);
    assert.equal(whitePine.originalPrice, 685000);
    assert.equal(whitePine.lowestPrice, 685000);
    assert.equal(whitePine.salePrice, null);
    assert.equal(whitePine.soldDate, null);
    assert.equal(whitePine.daysOnMarket, 28);

    const clearhurst = bySlug["9028-clearhurst-dr-75238"];
    assert.match(clearhurst.status, /\bSold\b/i);
    assert.equal(clearhurst.originalPrice, 615000);
    assert.equal(clearhurst.lowestPrice, 615000);
    assert.equal(clearhurst.salePrice, null);
    assert.equal(clearhurst.soldDate, null);
    assert.equal(clearhurst.daysOnMarket, 49);
  });
});
