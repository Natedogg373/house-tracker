import {
  budgetDelta,
  escapeHtml,
  fetchHouses,
  formatDate,
  formatMoney,
  formatNumber,
  formatYear,
  hiddenInterestSlugs,
  houseAge,
  isSoldStatus,
  pricePerSqft,
  schoolLevelLabel,
  schoolRatingClass,
  schoolRatingLabel,
  schoolsForHouse,
  setHouseUrl,
  show,
  slugFromLocation,
  statusClass,
} from "./common.js";

const select = document.querySelector("#house-select");
const includeToggle = document.querySelector("#include-not-interested");
const sampleBanner = document.querySelector("#sample-banner");
const empty = document.querySelector("#empty");
const view = document.querySelector("#house-view");
const addressEl = document.querySelector("#address");
const statusEl = document.querySelector("#status");
const insideBadge = document.querySelector("#inside-badge");
const interestBadge = document.querySelector("#interest-badge");
const notInterestedBtn = document.querySelector("#not-interested-btn");
const budgetBanner = document.querySelector("#budget-banner");
const metricsEl = document.querySelector("#metrics");
const photoEl = document.querySelector("#photo");
const photoFallback = document.querySelector("#photo-fallback");
const mapEl = document.querySelector("#house-map");
const mapPlaceholder = document.querySelector("#map-placeholder");
const mapPlaceholderText = document.querySelector("#map-placeholder-text");
const zillowCta = document.querySelector("#zillow-cta");
const canvas = document.querySelector("#price-chart");
const schoolsSection = document.querySelector("#schools-section");
const schoolsList = document.querySelector("#schools-list");

const STORAGE_KEY = "house-tracker:selected";

let chart;
let payload = {
  houses: [],
  budget: 700000,
  source: "sample",
  interest: { notInterested: [], pendingReactivation: [] },
  schools: [],
};

function metric(label, value, extra = "") {
  return `<article class="metric ${extra}">
    <span class="label">${escapeHtml(label)}</span>
    <div class="value">${value}</div>
  </article>`;
}

function trimHistory(history) {
  const items = Array.isArray(history) ? history.slice() : [];
  while (items.length && items[0]?.price == null) items.shift();
  while (items.length && items[items.length - 1]?.price == null) items.pop();
  return items;
}

const Leaflet = window.L;

const mapPin = Leaflet.divIcon({
  className: "osm-pin",
  iconSize: [28, 42],
  iconAnchor: [14, 42],
  popupAnchor: [0, -36],
});

let leafletMap = null;
let leafletMarker = null;

function zillowHref(house) {
  const url = String(house.zillowUrl || "");
  return /^https?:\/\//i.test(url) ? url : "";
}

function setZillowButton(house) {
  const href = zillowHref(house);
  if (!href) {
    zillowCta.classList.add("hidden");
    zillowCta.removeAttribute("href");
    return;
  }
  zillowCta.href = href;
  zillowCta.classList.remove("hidden");
}

function hideMap() {
  if (leafletMarker) {
    leafletMarker.remove();
    leafletMarker = null;
  }
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
  }
  mapEl.replaceChildren();
  mapEl.hidden = true;
  mapEl.classList.add("hidden");
  mapPlaceholder.hidden = false;
  mapPlaceholder.classList.remove("hidden");
}

function showMap(lat, lon, address) {
  mapPlaceholder.hidden = true;
  mapPlaceholder.classList.add("hidden");
  mapEl.hidden = false;
  mapEl.classList.remove("hidden");
  mapEl.title = address ? `Map of ${address}` : "Map of the selected house";
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    leafletMarker = null;
    mapEl.replaceChildren();
  }
  void mapEl.offsetWidth;
  leafletMap = Leaflet.map(mapEl, { scrollWheelZoom: false, attributionControl: true });
  Leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(leafletMap);
  leafletMap.setView([lat, lon], 16);
  leafletMarker = Leaflet.marker([lat, lon], { icon: mapPin, title: address || "House" }).addTo(leafletMap);
  leafletMap.invalidateSize();
  requestAnimationFrame(() => leafletMap && leafletMap.invalidateSize());
}

async function resolveCoords(house) {
  if (house.coords && Number.isFinite(Number(house.coords.lat)) && Number.isFinite(Number(house.coords.lon))) {
    return { lat: Number(house.coords.lat), lon: Number(house.coords.lon) };
  }
  if (house.coords === null) return null;
  if (!house.address) return null;
  try {
    const res = await fetch(`/api/geocode?address=${encodeURIComponent(house.address)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.coords) return null;
    return data.coords;
  } catch {
    return null;
  }
}

let mediaGen = 0;

async function showFallback(house) {
  photoEl.hidden = true;
  photoEl.classList.add("hidden");
  photoEl.removeAttribute("src");
  photoEl.alt = "";
  photoFallback.classList.add("visible");
  hideMap();
  mapPlaceholderText.textContent = "Looking up this address on the map…";
  setZillowButton(house);

  const gen = mediaGen;
  const coords = await resolveCoords(house);
  if (gen !== mediaGen) return;
  if (coords) {
    showMap(coords.lat, coords.lon, house.address);
    return;
  }
  mapPlaceholderText.textContent = "No photo, and we couldn’t place this address on the map.";
}

function setMedia(house) {
  mediaGen += 1;
  const gen = mediaGen;
  setZillowButton(house);
  const url = house.photoUrl;

  if (!url) {
    showFallback(house);
    return;
  }

  photoFallback.classList.remove("visible");
  hideMap();
  photoEl.hidden = false;
  photoEl.classList.remove("hidden");
  photoEl.alt = house.address ? `Photo of ${house.address}` : "House photo";
  photoEl.onload = () => {
    if (gen !== mediaGen) return;
    photoFallback.classList.remove("visible");
    photoEl.hidden = false;
  };
  photoEl.onerror = () => {
    if (gen !== mediaGen) return;
    showFallback(house);
  };
  photoEl.src = url;
}

function renderChart(house, budget) {
  const history = trimHistory(house.priceHistory);
  if (chart) {
    chart.destroy();
    chart = null;
  }

  const labels = history.map((row) => formatDate(row.week));
  const prices = history.map((row) => (row.price == null ? null : Number(row.price)));
  const budgetLine = history.map(() => budget);
  const compact = window.matchMedia("(max-width: 839px)").matches;

  chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "List price",
          data: prices,
          spanGaps: false,
          borderColor: "#2c4a3e",
          backgroundColor: "rgba(44, 74, 62, 0.12)",
          fill: true,
          tension: 0.15,
          pointRadius: compact ? 3 : 4,
          pointHoverRadius: compact ? 5 : 6,
          borderWidth: 2.5,
        },
        {
          label: `Budget (${formatMoney(budget)})`,
          data: budgetLine,
          spanGaps: true,
          borderColor: "#c2410c",
          borderDash: [7, 5],
          pointRadius: 0,
          pointHoverRadius: 0,
          borderWidth: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            boxWidth: compact ? 12 : 16,
            boxHeight: compact ? 12 : 16,
            padding: compact ? 10 : 12,
            font: { family: "Outfit, sans-serif", size: compact ? 12 : 13 },
          },
        },
        tooltip: {
          callbacks: {
            title(items) {
              const row = history[items[0]?.dataIndex];
              return row ? formatDate(row.week) : "";
            },
            label(ctx) {
              if (ctx.datasetIndex === 1) return `Budget: ${formatMoney(budget)}`;
              if (ctx.parsed.y == null) return "Not listed that week";
              return `Price: ${formatMoney(ctx.parsed.y)}`;
            },
          },
        },
      },
      layout: {
        padding: compact ? { top: 4, right: 6, bottom: 0, left: 0 } : 0,
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: compact ? 4 : 8,
            font: { family: "Outfit, sans-serif", size: compact ? 10 : 11 },
          },
          grid: { display: false },
        },
        y: {
          ticks: {
            callback: (value) => {
              if (!compact) return formatMoney(value);
              const n = Number(value);
              if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`;
              return formatMoney(n);
            },
            font: { family: "Outfit, sans-serif", size: compact ? 10 : 11 },
            maxTicksLimit: compact ? 5 : 8,
          },
          grace: "8%",
        },
      },
    },
  });
}

function hiddenSet() {
  return hiddenInterestSlugs(payload.interest);
}

function visibleHouses() {
  const houses = payload.houses || [];
  const hidden = hiddenSet();
  const includeHidden = includeToggle.checked;
  return houses.filter((house) => includeHidden || !hidden.has(house.slug));
}

function selectedHouse() {
  const houses = payload.houses || [];
  return houses.find((h) => h.slug === select.value) || visibleHouses()[0] || houses[0];
}

function fillSelect(houses, preferred) {
  select.innerHTML = houses
    .map((house) => {
      const hidden = hiddenSet().has(house.slug);
      const suffix = hidden ? " (not interested)" : "";
      return `<option value="${escapeHtml(house.slug)}">${escapeHtml(
        (house.address || house.slug) + suffix
      )}</option>`;
    })
    .join("");
  const match = houses.some((h) => h.slug === preferred);
  if (match) select.value = preferred;
}

function renderInterestUi(house) {
  const status = house.interestStatus || (hiddenSet().has(house.slug) ? "notInterested" : "active");
  const pending = status === "pendingReactivation";
  const notInterested = status === "notInterested" || pending;
  interestBadge.classList.toggle("hidden", !notInterested);
  if (pending) {
    interestBadge.textContent = "Checking if still active…";
  } else if (notInterested) {
    const entry = (payload.interest?.notInterested || []).find((item) => item.slug === house.slug);
    interestBadge.textContent = entry?.since
      ? `No longer interested · ${formatDate(entry.since)}`
      : "No longer interested";
  }
  show(notInterestedBtn, !notInterested && !isSoldStatus(house.status));
}

function schoolRowHtml(school) {
  const ratingText = schoolRatingLabel(school.rating);
  const ratingClass = schoolRatingClass(school.rating);
  const ratingInner = /^https?:\/\//i.test(String(school.ratingSource || ""))
    ? `<a href="${escapeHtml(school.ratingSource)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ratingText)}</a>`
    : escapeHtml(ratingText);
  const district = school.district ? escapeHtml(school.district) : "District unknown";
  return `<li class="school-row">
    <div>
      <p class="school-row-name">${escapeHtml(school.name)}</p>
      <p class="school-row-meta">${escapeHtml(schoolLevelLabel(school.level))} · ${district}</p>
    </div>
    <span class="pill school-rating ${ratingClass}">${ratingInner}</span>
  </li>`;
}

function renderSchools(house) {
  const schools = schoolsForHouse(house, payload.schools);
  if (!schools.length) {
    schoolsSection.hidden = true;
    schoolsList.innerHTML = "";
    return;
  }
  schoolsSection.hidden = false;
  schoolsList.innerHTML = schools.map(schoolRowHtml).join("");
}

function renderHouse(house) {
  const budget = payload.budget || 700000;
  const delta = budgetDelta(house.listPrice, budget);
  addressEl.textContent = house.address || house.slug || "Unknown address";
  statusEl.textContent = house.status || "Status unknown";
  statusEl.className = `pill ${statusClass(house.status)}`;

  const inside = Array.isArray(house.inside) ? house.inside.filter(Boolean) : [];
  insideBadge.classList.toggle("hidden", inside.length === 0);
  if (inside.length) {
    insideBadge.textContent = `Inside: ${inside.join(", ")}`;
  }

  renderInterestUi(house);

  if (delta) {
    budgetBanner.hidden = false;
    budgetBanner.className = `banner ${delta.kind}`;
    budgetBanner.textContent = delta.text;
  } else {
    budgetBanner.hidden = true;
  }

  const zillowUrl = String(house.zillowUrl || "");
  const zillowSafe = /^https?:\/\//i.test(zillowUrl)
    ? `<a href="${escapeHtml(zillowUrl)}" target="_blank" rel="noopener noreferrer">Open listing</a>`
    : "No listing link";

  const priceClass = delta ? `price ${delta.kind}` : "price";
  metricsEl.innerHTML = [
    metric("List price", escapeHtml(formatMoney(house.listPrice)), priceClass),
    metric("Status", escapeHtml(house.status || "—")),
    metric("Beds", formatNumber(house.beds)),
    metric("Baths", formatNumber(house.baths)),
    metric("Square feet", formatNumber(house.sqft)),
    metric("Price / sq ft", escapeHtml(pricePerSqft(house))),
    metric("Year built", formatYear(house.yearBuilt)),
    metric("Age", escapeHtml(houseAge(house.yearBuilt))),
    metric("Lot acres", house.lotAcres == null ? "—" : escapeHtml(house.lotAcres)),
    metric("Last updated", escapeHtml(formatDate(house.lastUpdated))),
    metric("Zillow", zillowSafe),
  ].join("");

  renderSchools(house);
  setMedia(house);
  renderChart(house, budget);
}

function preferredSlug(houses) {
  const fromUrl = slugFromLocation();
  if (fromUrl && houses.some((house) => house.slug === fromUrl)) return fromUrl;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && houses.some((house) => house.slug === stored)) return stored;
  return houses[0]?.slug || "";
}

function renderAll() {
  const all = payload.houses || [];
  sampleBanner.hidden = payload.source !== "sample";
  const fromUrl = slugFromLocation();
  if (fromUrl && hiddenSet().has(fromUrl)) {
    includeToggle.checked = true;
  }
  const houses = visibleHouses();
  if (!houses.length) {
    show(empty, true);
    show(view, false);
    setHouseUrl("", { replace: true });
    return;
  }
  show(empty, false);
  show(view, true);
  const preferred = preferredSlug(houses);
  fillSelect(houses, preferred);
  const house = selectedHouse();
  if (house) {
    localStorage.setItem(STORAGE_KEY, house.slug);
    setHouseUrl(house.slug, { replace: true });
    renderHouse(house);
  }
}

function selectHouse(slug, { replace = true } = {}) {
  const houses = visibleHouses();
  if (!houses.some((house) => house.slug === slug) && payload.houses.some((house) => house.slug === slug)) {
    includeToggle.checked = true;
    fillSelect(visibleHouses(), slug);
  }
  if (![...select.options].some((option) => option.value === slug)) return;
  select.value = slug;
  localStorage.setItem(STORAGE_KEY, slug);
  setHouseUrl(slug, { replace });
  const house = selectedHouse();
  if (house) renderHouse(house);
}

select.addEventListener("change", () => {
  selectHouse(select.value, { replace: false });
});

includeToggle.addEventListener("change", () => {
  const current = select.value;
  renderAll();
  if (current && [...select.options].some((option) => option.value === current)) {
    selectHouse(current);
  }
});

window.addEventListener("popstate", () => {
  const slug = slugFromLocation();
  if (slug) selectHouse(slug);
  else renderAll();
});

notInterestedBtn.addEventListener("click", async () => {
  const house = selectedHouse();
  if (!house) return;
  const label = house.address || house.slug;
  if (!window.confirm(`Move ${label} to No longer interested?`)) return;
  notInterestedBtn.disabled = true;
  try {
    const res = await fetch("/api/interest/not-interested", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: house.slug }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || "Could not update interest.");
      return;
    }
    payload.interest = data.interest;
    const updated = payload.houses.find((item) => item.slug === house.slug);
    if (updated) updated.interestStatus = "notInterested";
    if (!includeToggle.checked) {
      const remaining = visibleHouses().filter((item) => item.slug !== house.slug);
      if (remaining[0]) setHouseUrl(remaining[0].slug);
      else setHouseUrl("");
    }
    renderAll();
  } catch {
    window.alert("Could not reach the local server.");
  } finally {
    notInterestedBtn.disabled = false;
  }
});

async function load() {
  try {
    const next = await fetchHouses();
    const keepSlug = select.value || slugFromLocation();
    payload = next;
    renderAll();
    if (keepSlug && [...select.options].some((option) => option.value === keepSlug)) {
      selectHouse(keepSlug);
    }
  } catch (err) {
    sampleBanner.hidden = false;
    sampleBanner.className = "banner error";
    sampleBanner.textContent = err.message;
  }
}

load();
setInterval(load, 30000);
