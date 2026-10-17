const fs = require("fs");
const path = require("path");

const DEFAULT_CACHE_PATH = path.join(__dirname, "..", "data", "geocode-cache.json");
const DEFAULT_USER_AGENT =
  "HouseTracker/1.0 (https://github.com/Natedogg373/house-tracker; local house-hunting dashboard)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = 1000;

function cacheKey(address) {
  return String(address || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readCacheFile(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Missing or unreadable cache starts empty.
  }
  return {};
}

function writeCacheFile(cachePath, cache) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`);
  fs.renameSync(tmp, cachePath);
}

function coordsFromEntry(entry) {
  if (!entry || !entry.found) return null;
  return { lat: entry.lat, lon: entry.lon, displayName: entry.displayName || null };
}

function createGeocoder({
  cachePath = DEFAULT_CACHE_PATH,
  userAgent = DEFAULT_USER_AGENT,
  fetchFn = fetch,
  minIntervalMs = MIN_INTERVAL_MS,
  now = () => Date.now(),
  sleepFn = sleep,
  nominatimUrl = NOMINATIM_URL,
} = {}) {
  const cache = readCacheFile(cachePath);
  const inflight = new Map();
  const prefetched = new Set();
  let lastNetworkAt = 0;
  let queue = Promise.resolve();

  function peek(address) {
    const key = cacheKey(address);
    if (!key) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cache, key)) return undefined;
    return coordsFromEntry(cache[key]);
  }

  function persist(key, entry) {
    cache[key] = entry;
    try {
      writeCacheFile(cachePath, cache);
    } catch (err) {
      console.error("[geocode] failed to write cache:", err.message);
    }
  }

  function scheduleNetwork(fn) {
    const run = queue.then(async () => {
      const wait = minIntervalMs - (now() - lastNetworkAt);
      if (lastNetworkAt && wait > 0) await sleepFn(wait);
      lastNetworkAt = now();
      return fn();
    });
    queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function lookupNominatim(address) {
    const url = new URL(nominatimUrl);
    url.searchParams.set("q", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const response = await fetchFn(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Nominatim returned ${response.status}`);
    }
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      return { found: false, lat: null, lon: null, displayName: null };
    }
    const lat = Number(results[0].lat);
    const lon = Number(results[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return { found: false, lat: null, lon: null, displayName: null };
    }
    return {
      found: true,
      lat,
      lon,
      displayName: results[0].display_name || null,
    };
  }

  async function geocode(address) {
    const key = cacheKey(address);
    if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(cache, key)) {
      return coordsFromEntry(cache[key]);
    }
    if (inflight.has(key)) return inflight.get(key);

    const pending = scheduleNetwork(async () => {
      if (Object.prototype.hasOwnProperty.call(cache, key)) {
        return coordsFromEntry(cache[key]);
      }
      try {
        const entry = await lookupNominatim(String(address).trim());
        persist(key, { ...entry, updatedAt: new Date(now()).toISOString() });
        return coordsFromEntry(entry);
      } catch (err) {
        console.error(`[geocode] ${address}:`, err.message);
        throw err;
      }
    }).then(
      (coords) => coords,
      () => null
    );

    inflight.set(key, pending);
    pending.finally(() => inflight.delete(key));
    return pending;
  }

  function prefetch(addresses) {
    const unique = [...new Set((addresses || []).map((a) => String(a || "").trim()).filter(Boolean))];
    for (const address of unique) {
      const key = cacheKey(address);
      if (!key || prefetched.has(key) || inflight.has(key)) continue;
      if (Object.prototype.hasOwnProperty.call(cache, key)) continue;
      prefetched.add(key);
      geocode(address).catch(() => {});
    }
  }

  return { geocode, peek, prefetch, cachePath, userAgent };
}

let instance;

function createGeocoderFromEnv(env = process.env) {
  const cachePath = env.GEOCODE_CACHE_PATH ? path.resolve(env.GEOCODE_CACHE_PATH) : DEFAULT_CACHE_PATH;
  return createGeocoder({
    cachePath,
    userAgent: env.NOMINATIM_USER_AGENT || DEFAULT_USER_AGENT,
  });
}

function getGeocoder() {
  if (!instance) instance = createGeocoderFromEnv();
  return instance;
}

function configureGeocoder(opts) {
  instance = createGeocoder(opts);
  return instance;
}

function resetGeocoder() {
  instance = null;
}

function isPrefetchEnabled(env = process.env) {
  const value = String(env.GEOCODE_PREFETCH || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(value)) return false;
  return true;
}

module.exports = {
  DEFAULT_CACHE_PATH,
  DEFAULT_USER_AGENT,
  MIN_INTERVAL_MS,
  cacheKey,
  createGeocoder,
  createGeocoderFromEnv,
  getGeocoder,
  configureGeocoder,
  resetGeocoder,
  isPrefetchEnabled,
};
