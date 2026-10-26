function isSoldStatus(status) {
  return /\bsold\b/i.test(String(status || "").trim());
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listedEntries(house) {
  const history = Array.isArray(house?.priceHistory) ? house.priceHistory.slice() : [];
  history.sort((a, b) => String(a?.week || "").localeCompare(String(b?.week || "")));
  return history
    .map((row) => ({ week: row?.week, price: toNumber(row?.price) }))
    .filter((row) => row.price != null);
}

function originalListingPrice(house) {
  const listed = listedEntries(house);
  if (listed.length) return listed[0].price;
  return toNumber(house?.listPrice);
}

function lowestListingPrice(house) {
  const listed = listedEntries(house);
  if (listed.length) return Math.min(...listed.map((row) => row.price));
  return originalListingPrice(house);
}

function parseDay(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(date.getTime()) ||
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysOnMarket(house) {
  const listed = listedEntries(house);
  const start = listed.length ? parseDay(listed[0].week) : null;
  if (!start) return null;

  const end =
    parseDay(house?.soldDate) ||
    (listed.length ? parseDay(listed[listed.length - 1].week) : null) ||
    parseDay(house?.lastUpdated);
  if (!end) return null;

  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  return days < 0 ? null : days;
}

function compareGraveyard(a, b) {
  const aSold = a.soldDate ? String(a.soldDate) : "";
  const bSold = b.soldDate ? String(b.soldDate) : "";
  if (aSold && bSold && aSold !== bSold) {
    return bSold.localeCompare(aSold);
  }
  if (aSold && !bSold) return -1;
  if (!aSold && bSold) return 1;
  return String(a.address || a.slug || "").localeCompare(String(b.address || b.slug || ""), "en", {
    sensitivity: "base",
  });
}

function toGraveyardHouse(house) {
  return {
    slug: house.slug,
    address: house.address || house.slug || "",
    status: house.status || null,
    photoUrl: house.photoUrl || null,
    zillowUrl: house.zillowUrl || null,
    listPrice: toNumber(house.listPrice),
    salePrice: toNumber(house.salePrice),
    soldDate: house.soldDate || null,
    lastUpdated: house.lastUpdated || null,
    originalPrice: originalListingPrice(house),
    lowestPrice: lowestListingPrice(house),
    daysOnMarket: daysOnMarket(house),
  };
}

function buildGraveyard(houses) {
  return (houses || [])
    .filter((house) => isSoldStatus(house?.status))
    .map(toGraveyardHouse)
    .sort(compareGraveyard);
}

module.exports = {
  isSoldStatus,
  toNumber,
  listedEntries,
  originalListingPrice,
  lowestListingPrice,
  parseDay,
  daysOnMarket,
  compareGraveyard,
  toGraveyardHouse,
  buildGraveyard,
};
