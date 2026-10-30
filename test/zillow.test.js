const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

async function loadCommon() {
  return import("../public/js/common.js");
}

describe("zillowHref", async () => {
  const { zillowHref } = await loadCommon();

  it("uses zillowUrl when it is an http(s) listing link", () => {
    assert.equal(
      zillowHref({
        zillowUrl: "https://www.zillow.com/homedetails/8915-White-Pine-Ln-Dallas-TX-75238/26912745_zpid/",
        address: "8915 White Pine Ln, Dallas, TX 75238",
      }),
      "https://www.zillow.com/homedetails/8915-White-Pine-Ln-Dallas-TX-75238/26912745_zpid/"
    );
  });

  it("trims zillowUrl and prefers it over the address search", () => {
    assert.equal(
      zillowHref({
        zillowUrl: "  https://www.zillow.com/homedetails/maple  ",
        address: "123 Maple Demo St, Dallas, TX 75201",
      }),
      "https://www.zillow.com/homedetails/maple"
    );
  });

  it("falls back to a Zillow address search when zillowUrl is missing or empty", () => {
    const address = "789 Cedar Placeholder Ln, Plano, TX 75023";
    const expected = `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;
    assert.equal(zillowHref({ zillowUrl: null, address }), expected);
    assert.equal(zillowHref({ zillowUrl: "", address }), expected);
    assert.equal(zillowHref({ zillowUrl: "   ", address }), expected);
    assert.equal(zillowHref({ address }), expected);
  });

  it("ignores non-http zillowUrl values and searches by address", () => {
    const address = "123 Maple Demo St, Dallas, TX 75201";
    assert.equal(
      zillowHref({ zillowUrl: "not-a-url", address }),
      `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`
    );
  });

  it("returns empty when there is no listing URL and no address", () => {
    assert.equal(zillowHref({}), "");
    assert.equal(zillowHref({ zillowUrl: null, address: "" }), "");
    assert.equal(zillowHref(null), "");
  });
});
