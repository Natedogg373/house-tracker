import {
  budgetDelta,
  fetchHouses,
  formatDate,
  formatMoney,
  formatNumber,
  formatYear,
  houseAge,
  pricePerSqft,
  show,
  statusClass,
} from "./common.js";

const select = document.querySelector("#house-select");
const sampleBanner = document.querySelector("#sample-banner");
const empty = document.querySelector("#empty");
const view = document.querySelector("#house-view");
const addressEl = document.querySelector("#address");
const statusEl = document.querySelector("#status");
const budgetBanner = document.querySelector("#budget-banner");
const metricsEl = document.querySelector("#metrics");
const photoEl = document.querySelector("#photo");
const photoFallback = document.querySelector("#photo-fallback");
const mapEl = document.querySelector("#house-map");
const mapPlaceholder = document.querySelector("#map-placeholder");
const mapPlaceholderText = document.querySelector("#map-placeholder-text");
const zillowCta = document.querySelector("#zillow-cta");
const canvas = document.querySelector("#price-chart");

const STORAGE_KEY = "house-tracker:selected";

let chart;
let payload = { houses: [], budget: 700000, source: "sample" };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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
          pointRadius: 4,
          pointHoverRadius: 6,
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
          labels: { boxWidth: 16, font: { family: "Outfit, sans-serif" } },
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
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            font: { family: "Outfit, sans-serif", size: 11 },
          },
          grid: { display: false },
        },
        y: {
          ticks: {
            callback: (value) => formatMoney(value),
            font: { family: "Outfit, sans-serif", size: 11 },
          },
          grace: "8%",
        },
      },
    },
  });
}

function renderHouse(house) {
  const budget = payload.budget || 700000;
  const delta = budgetDelta(house.listPrice, budget);
  addressEl.textContent = house.address || house.slug || "Unknown address";
  statusEl.textContent = house.status || "Status unknown";
  statusEl.className = `pill ${statusClass(house.status)}`;

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

  setMedia(house);
  renderChart(house, budget);
}

function selectedHouse() {
  return payload.houses.find((h) => h.slug === select.value) || payload.houses[0];
}

function fillSelect(houses, preferred) {
  select.innerHTML = houses
    .map(
      (house) =>
        `<option value="${escapeHtml(house.slug)}">${escapeHtml(house.address || house.slug)}</option>`
    )
    .join("");
  const match = houses.some((h) => h.slug === preferred);
  if (match) select.value = preferred;
}

function renderAll() {
  const houses = payload.houses || [];
  sampleBanner.hidden = payload.source !== "sample";
  if (!houses.length) {
    show(empty, true);
    show(view, false);
    return;
  }
  show(empty, false);
  show(view, true);
  fillSelect(houses, localStorage.getItem(STORAGE_KEY));
  renderHouse(selectedHouse());
}

select.addEventListener("change", () => {
  localStorage.setItem(STORAGE_KEY, select.value);
  const house = selectedHouse();
  if (house) renderHouse(house);
});

async function load() {
  try {
    payload = await fetchHouses();
    renderAll();
  } catch (err) {
    sampleBanner.hidden = false;
    sampleBanner.className = "banner error";
    sampleBanner.textContent = err.message;
  }
}

load();
setInterval(load, 30000);
