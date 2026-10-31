import {
  escapeHtml,
  fetchHouses,
  houseLatLng,
  isActiveHouse,
  schoolLevelLabel,
  schoolRatingLabel,
  show,
} from "./common.js";
import { houseTipHtml, schoolTipHtml } from "./map-tips.js";
import {
  MAP_LEVEL_STORAGE_KEY,
  NEUTRAL_HOUSE_COLOR,
  SCHOOL_LEVELS,
  assignSchoolColors,
  colorForHouseAtLevel,
  normalizeSchoolLevel,
  schoolAtLevel,
  schoolPoint,
  schoolsAtLevel,
} from "./school-colors.js";

const Leaflet = window.L;
const mapEl = document.querySelector("#map");
const sampleBanner = document.querySelector("#sample-banner");
const errorBanner = document.querySelector("#error-banner");
const legendList = document.querySelector("#legend-list");
const inAreaCount = document.querySelector("#in-area-count");
const missingCoordsEl = document.querySelector("#missing-coords");
const geofenceList = document.querySelector("#geofence-list");
const geofenceStatus = document.querySelector("#geofence-status");
const drawHint = document.querySelector("#draw-hint");
const levelToggle = document.querySelector("#level-toggle");
const mapFolds = document.querySelectorAll(".map-fold");
const MOBILE_MQ = window.matchMedia("(max-width: 839px)");

let payload = { houses: [], schools: [], geofences: [], interest: {}, source: "houses" };
let map;
let overlay;
let drawer = null;
let fenceLayers = new Map();
let currentLevel = readStoredLevel();
let invalidateTimer = 0;

const FENCE_STYLE = {
  color: "#2c4a3e",
  weight: 2,
  fillColor: "#3d6b57",
  fillOpacity: 0.12,
  dashArray: "6 4",
};

function readStoredLevel() {
  try {
    return normalizeSchoolLevel(window.localStorage.getItem(MAP_LEVEL_STORAGE_KEY));
  } catch {
    return "elementary";
  }
}

function persistLevel(level) {
  try {
    window.localStorage.setItem(MAP_LEVEL_STORAGE_KEY, level);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function activeHouses() {
  return (payload.houses || []).filter((house) => isActiveHouse(house, payload.interest));
}

function mappableHouses() {
  return activeHouses().filter((house) => houseLatLng(house));
}

function visibleSchools() {
  return schoolsAtLevel(payload.schools, currentLevel);
}

function houseIcon(color) {
  return Leaflet.divIcon({
    className: "pin-wrap",
    html: `<span class="house-pin" style="background:${color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    tooltipAnchor: [0, -12],
    popupAnchor: [0, -12],
  });
}

function schoolIcon(color) {
  return Leaflet.divIcon({
    className: "pin-wrap",
    html: `<span class="school-pin" style="background:${color}"><span class="school-pin-mark" aria-hidden="true"></span></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    tooltipAnchor: [0, -12],
    popupAnchor: [0, -12],
  });
}

function bindMapTip(marker, html) {
  marker.bindTooltip(html, {
    direction: "top",
    opacity: 1,
    className: "map-tip",
    interactive: false,
  });
  marker.bindPopup(html, {
    className: "map-tip-popup",
    maxWidth: 280,
    minWidth: 220,
    autoPan: true,
    autoPanPadding: [28, 56],
    keepInView: true,
    closeButton: true,
  });
  marker.on("popupopen", () => {
    marker.closeTooltip();
  });
}

function layerFromFence(fence) {
  const g = fence.geometry;
  if (fence.type === "rect") {
    return Leaflet.rectangle(
      [
        [g.south, g.west],
        [g.north, g.east],
      ],
      FENCE_STYLE
    );
  }
  if (fence.type === "circle") {
    return Leaflet.circle([g.lat, g.lng], { ...FENCE_STYLE, radius: g.radiusMeters });
  }
  if (fence.type === "polygon") {
    return Leaflet.polygon(g.latlngs, FENCE_STYLE);
  }
  return null;
}

function fenceFromLayer(layer, layerType, name) {
  if (layerType === "rectangle" || (layer.getBounds && layerType !== "circle" && layerType !== "polygon" && !layer.getLatLngs)) {
    const bounds = layer.getBounds();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `gf-${Date.now()}`,
      name,
      type: "rect",
      geometry: {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      },
    };
  }
  if (layerType === "circle" || (layer.getRadius && layer.getLatLng)) {
    const center = layer.getLatLng();
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `gf-${Date.now()}`,
      name,
      type: "circle",
      geometry: { lat: center.lat, lng: center.lng, radiusMeters: layer.getRadius() },
    };
  }
  if (layer.getLatLngs) {
    const rings = layer.getLatLngs();
    const ring = Array.isArray(rings[0]) ? rings[0] : rings;
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `gf-${Date.now()}`,
      name,
      type: "polygon",
      geometry: { latlngs: ring.map((point) => [point.lat, point.lng]) },
    };
  }
  return null;
}

function disableDraw() {
  if (drawer) {
    drawer.disable();
    drawer = null;
  }
}

function isTouchUi() {
  return window.matchMedia("(pointer: coarse)").matches || MOBILE_MQ.matches;
}

function idleDrawHint() {
  return "Draw a rectangle, circle, or polygon, then name it.";
}

function activeDrawHint() {
  return isTouchUi()
    ? "Tap the map to draw. Use two fingers to pan. Press Esc to cancel."
    : "Click the map to draw. Press Esc to cancel.";
}

function vertexIcon() {
  const size = isTouchUi() ? 22 : 12;
  return new Leaflet.DivIcon({
    iconSize: new Leaflet.Point(size, size),
    className: "leaflet-div-icon leaflet-editing-icon leaflet-touch-icon",
  });
}

function startDraw(type) {
  disableDraw();
  const options = { shapeOptions: { ...FENCE_STYLE, dashArray: null }, touchIcon: vertexIcon(), icon: vertexIcon() };
  if (type === "rect") drawer = new Leaflet.Draw.Rectangle(map, options);
  else if (type === "circle") drawer = new Leaflet.Draw.Circle(map, options);
  else drawer = new Leaflet.Draw.Polygon(map, { ...options, allowIntersection: false });
  drawer.enable();
  drawHint.textContent = activeDrawHint();
}

function scheduleInvalidate() {
  window.clearTimeout(invalidateTimer);
  invalidateTimer = window.setTimeout(() => {
    if (!map) return;
    map.invalidateSize({ animate: false });
  }, 60);
}

function syncMapFolds() {
  for (const fold of mapFolds) {
    fold.open = !MOBILE_MQ.matches;
  }
  scheduleInvalidate();
}

function showFenceStatus(kind, text) {
  geofenceStatus.hidden = false;
  geofenceStatus.className = `banner ${kind}`;
  geofenceStatus.textContent = text;
}

async function persistGeofences(next) {
  const res = await fetch("/api/geofences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geofences: next }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not save geofences.");
  payload.geofences = data.geofences || next;
  const houses = await fetchHouses();
  payload.houses = houses.houses;
  payload.geofences = houses.geofences || payload.geofences;
  payload.interest = houses.interest;
  payload.schools = houses.schools || payload.schools;
  renderAll({ fit: true });
}

function nextAreaName() {
  return `Area ${(payload.geofences || []).length + 1}`;
}

function renderLevelToggle() {
  if (!levelToggle) return;
  for (const button of levelToggle.querySelectorAll("[data-level]")) {
    const on = button.dataset.level === currentLevel;
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function renderLegend(colors) {
  const items = visibleSchools()
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" }))
    .map((school) => {
      const color = colors.get(school.id);
      return `<li>
        <div class="legend-school">
          <span class="legend-swatch school-swatch" style="background:${color}"></span>
          <span class="legend-school-text">
            <span class="legend-school-name">${escapeHtml(school.name)}</span>
            <span class="legend-school-rating">${escapeHtml(schoolRatingLabel(school.rating))}</span>
          </span>
        </div>
      </li>`;
    });
  const levelName = schoolLevelLabel(currentLevel).toLowerCase();
  legendList.innerHTML =
    items.join("") || `<li class="map-note">No ${escapeHtml(levelName)} schools with coordinates yet.</li>`;
}

function renderGeofences() {
  const fences = payload.geofences || [];
  const houses = mappableHouses();
  geofenceList.innerHTML = fences
    .map((fence) => {
      const count = houses.filter((house) => (house.inside || []).includes(fence.name)).length;
      const noun = count === 1 ? "house" : "houses";
      return `<li class="geofence-item" data-id="${escapeHtml(fence.id)}">
        <div>
          <strong>${escapeHtml(fence.name)}</strong>
          <span class="map-note">${escapeHtml(fence.type)} · ${count} ${noun}</span>
        </div>
        <div class="geofence-actions">
          <button type="button" class="secondary rename-fence" data-id="${escapeHtml(fence.id)}">Rename</button>
          <button type="button" class="danger delete-fence" data-id="${escapeHtml(fence.id)}">Delete</button>
        </div>
      </li>`;
    })
    .join("");
  if (!fences.length) {
    geofenceList.innerHTML = `<li class="map-note">No saved areas yet.</li>`;
  }
}

function renderPins(colors) {
  if (overlay) overlay.clearLayers();
  else overlay = Leaflet.layerGroup().addTo(map);
  fenceLayers = new Map();

  for (const fence of payload.geofences || []) {
    const layer = layerFromFence(fence);
    if (!layer) continue;
    layer.bindTooltip(escapeHtml(fence.name), { sticky: true, className: "map-tip-plain" });
    overlay.addLayer(layer);
    fenceLayers.set(fence.id, layer);
  }

  for (const house of mappableHouses()) {
    const point = houseLatLng(house);
    const school = schoolAtLevel(house, payload.schools, currentLevel);
    const color = colorForHouseAtLevel(house, colors, payload.schools, currentLevel);
    const marker = Leaflet.marker([point.lat, point.lng], {
      icon: houseIcon(color),
      title: house.address || house.slug,
      riseOnHover: true,
    });
    bindMapTip(marker, houseTipHtml(house, school, currentLevel));
    overlay.addLayer(marker);
  }

  for (const school of visibleSchools()) {
    const point = schoolPoint(school);
    if (!point) continue;
    const color = colors.get(school.id) || NEUTRAL_HOUSE_COLOR;
    const marker = Leaflet.marker([point.lat, point.lng], {
      icon: schoolIcon(color),
      title: school.name,
      riseOnHover: true,
      zIndexOffset: 200,
    });
    bindMapTip(marker, schoolTipHtml(school));
    overlay.addLayer(marker);
  }
}

function fitMap() {
  const bounds = Leaflet.latLngBounds([]);
  for (const house of mappableHouses()) {
    const point = houseLatLng(house);
    bounds.extend([point.lat, point.lng]);
  }
  for (const school of visibleSchools()) {
    const point = schoolPoint(school);
    if (point) bounds.extend([point.lat, point.lng]);
  }
  for (const layer of fenceLayers.values()) {
    if (layer.getBounds && layer.getBounds().isValid()) bounds.extend(layer.getBounds());
  }
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13 });
  } else {
    map.setView([32.82, -96.75], 11);
  }
}

function renderAll({ fit = true } = {}) {
  sampleBanner.hidden = payload.source !== "sample";
  const colors = assignSchoolColors(visibleSchools());
  const mapped = mappableHouses();
  const active = activeHouses();
  const missing = active.length - mapped.length;
  show(missingCoordsEl, missing > 0);
  if (missing > 0) {
    const noun = missing === 1 ? "house is" : "houses are";
    missingCoordsEl.textContent = `${missing} ${noun} missing coordinates, so they are off the map.`;
  }
  const inArea = mapped.filter((house) => (house.inside || []).length > 0).length;
  const noun = inArea === 1 ? "house" : "houses";
  inAreaCount.textContent = `${inArea} ${noun} in area`;
  renderLevelToggle();
  renderLegend(colors);
  renderGeofences();
  renderPins(colors);
  scheduleInvalidate();
  if (fit) {
    requestAnimationFrame(() => {
      if (!map) return;
      map.invalidateSize({ animate: false });
      fitMap();
    });
  }
}

function setLevel(level, { persist = true, fit = false } = {}) {
  const next = normalizeSchoolLevel(level);
  if (next === currentLevel && persist) {
    renderLevelToggle();
    return;
  }
  currentLevel = next;
  if (persist) persistLevel(currentLevel);
  renderAll({ fit });
}

function initMap() {
  map = Leaflet.map(mapEl, { scrollWheelZoom: true, tapTolerance: 25 });
  Leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.setView([32.82, -96.75], 11);
  map.on("draw:created", async (event) => {
    disableDraw();
    drawHint.textContent = idleDrawHint();
    const name = window.prompt("Name this area", nextAreaName());
    if (!name || !name.trim()) return;
    const fence = fenceFromLayer(event.layer, event.layerType, name.trim());
    if (!fence) return;
    try {
      await persistGeofences([...(payload.geofences || []), fence]);
      showFenceStatus("ok", "Area saved.");
    } catch (err) {
      showFenceStatus("error", err.message);
    }
  });
  map.on("draw:drawstop", () => {
    drawer = null;
    drawHint.textContent = idleDrawHint();
  });
  window.addEventListener("resize", scheduleInvalidate);
  if (MOBILE_MQ.addEventListener) MOBILE_MQ.addEventListener("change", syncMapFolds);
  else MOBILE_MQ.addListener(syncMapFolds);
  for (const fold of mapFolds) {
    fold.addEventListener("toggle", () => {
      if (!MOBILE_MQ.matches) fold.open = true;
      scheduleInvalidate();
    });
  }
  syncMapFolds();
}

document.querySelector("#draw-rect").addEventListener("click", () => startDraw("rect"));
document.querySelector("#draw-circle").addEventListener("click", () => startDraw("circle"));
document.querySelector("#draw-polygon").addEventListener("click", () => startDraw("polygon"));

if (levelToggle) {
  levelToggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (!button || !SCHOOL_LEVELS.includes(button.dataset.level)) return;
    setLevel(button.dataset.level);
  });
}

geofenceList.addEventListener("click", async (event) => {
  const rename = event.target.closest(".rename-fence");
  const remove = event.target.closest(".delete-fence");
  const id = (rename || remove)?.dataset.id;
  if (!id) return;
  const fences = payload.geofences || [];
  const fence = fences.find((item) => item.id === id);
  if (!fence) return;
  if (rename) {
    const name = window.prompt("Rename area", fence.name);
    if (!name || !name.trim() || name.trim() === fence.name) return;
    try {
      await persistGeofences(fences.map((item) => (item.id === id ? { ...item, name: name.trim() } : item)));
      showFenceStatus("ok", "Area renamed.");
    } catch (err) {
      showFenceStatus("error", err.message);
    }
    return;
  }
  if (!window.confirm(`Delete “${fence.name}”?`)) return;
  try {
    await persistGeofences(fences.filter((item) => item.id !== id));
    showFenceStatus("ok", "Area deleted.");
  } catch (err) {
    showFenceStatus("error", err.message);
  }
});

async function load() {
  try {
    payload = await fetchHouses();
    errorBanner.hidden = true;
    currentLevel = readStoredLevel();
    renderAll({ fit: true });
  } catch (err) {
    errorBanner.hidden = false;
    errorBanner.textContent = err.message;
  }
}

initMap();
load();
