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
  housesForDetailsSelect,
  isActiveHouse,
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
  zillowHref,
} from "./common.js";
import {
  answerControlHtml,
  answerHasContent,
  collapseToggleHtml,
  groupQuestionsBySection,
  sectionProgress,
  surveyFillUrl,
} from "./survey-shared.js";
import {
  METRIC_CRITERION_IDS,
  SCHOOL_LEVEL_CRITERION_IDS,
  STATUS_ICONS,
  STATUS_LABELS,
  hasOwnField,
  parseBooleanField,
  scoreHouse as scoreHousePrereqs,
  summaryText as prereqSummaryText,
} from "./prerequisites-shared.js";

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
const prereqSummaryEl = document.querySelector("#prereq-summary");
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
const fillSurveyCta = document.querySelector("#fill-survey-cta");
const surveySectionFill = document.querySelector("#survey-section-fill");
const surveyEmpty = document.querySelector("#survey-empty");
const surveyNoQuestions = document.querySelector("#survey-no-questions");
const surveyAnswersList = document.querySelector("#survey-answers-list");

const STORAGE_KEY = "house-tracker:selected";
let surveyCache = { slug: "", questions: [], sections: [], answers: [], status: null };
let prereqConfig = null;

let chart;
let payload = {
  houses: [],
  budget: 700000,
  source: "sample",
  interest: { notInterested: [], pendingReactivation: [] },
  schools: [],
};

function metric(label, value, extra = "", prereqStatus = "") {
  const status = prereqStatus && prereqStatus !== "off" ? prereqStatus : "";
  const classes = ["metric", extra, status ? `prereq-${status}` : ""]
    .filter(Boolean)
    .join(" ");
  const cue =
    status && STATUS_ICONS[status]
      ? `<span class="prereq-cue" title="${escapeHtml(STATUS_LABELS[status] || status)}" aria-label="${escapeHtml(
          STATUS_LABELS[status] || status
        )}">${STATUS_ICONS[status]}</span>`
      : "";
  return `<article class="${classes}"${status ? ` data-prereq-status="${status}"` : ""}>
    <span class="label">${escapeHtml(label)}${cue}</span>
    <div class="value">${value}</div>
  </article>`;
}

function prereqStatusForMetric(label, scored) {
  if (!scored?.byId) return "";
  const id = METRIC_CRITERION_IDS[label];
  if (!id) return "";
  return scored.byId[id]?.status || "";
}

function renderPrereqSummary(scored) {
  if (!prereqSummaryEl) return;
  const text = prereqSummaryText(scored?.summary);
  if (!text) {
    prereqSummaryEl.hidden = true;
    prereqSummaryEl.textContent = "";
    return;
  }
  prereqSummaryEl.hidden = false;
  prereqSummaryEl.textContent = text;
}

async function loadPrerequisites() {
  try {
    const res = await fetch("/api/prerequisites");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load prerequisites.");
    prereqConfig = data;
  } catch {
    prereqConfig = null;
  }
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

function activeHouses() {
  return (payload.houses || []).filter((house) => isActiveHouse(house, payload.interest));
}

function selectedHouse() {
  const houses = payload.houses || [];
  return (
    houses.find((h) => h.slug === select.value) ||
    activeHouses()[0] ||
    houses[0]
  );
}

function fillSelect(houses, preferred) {
  select.innerHTML = houses
    .map((house) => {
      const hidden = hiddenSet().has(house.slug);
      const sold = isSoldStatus(house.status);
      const suffix = hidden ? " (not interested)" : sold ? " (sold)" : "";
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

function schoolRowHtml(school, scored) {
  const ratingText = schoolRatingLabel(school.rating);
  const ratingClass = schoolRatingClass(school.rating);
  const ratingInner = /^https?:\/\//i.test(String(school.ratingSource || ""))
    ? `<a href="${escapeHtml(school.ratingSource)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ratingText)}</a>`
    : escapeHtml(ratingText);
  const district = school.district ? escapeHtml(school.district) : "District unknown";
  const criterionId = SCHOOL_LEVEL_CRITERION_IDS[school.level];
  const prereqStatus = criterionId && scored?.byId?.[criterionId]?.status;
  const status = prereqStatus && prereqStatus !== "off" ? prereqStatus : "";
  const classes = ["school-row", status ? `prereq-${status}` : ""].filter(Boolean).join(" ");
  const cue =
    status && STATUS_ICONS[status]
      ? `<span class="prereq-cue" title="${escapeHtml(STATUS_LABELS[status] || status)}" aria-label="${escapeHtml(
          STATUS_LABELS[status] || status
        )}">${STATUS_ICONS[status]}</span>`
      : "";
  return `<li class="${classes}"${status ? ` data-prereq-status="${status}"` : ""}>
    <div>
      <p class="school-row-name">${escapeHtml(school.name)}${cue}</p>
      <p class="school-row-meta">${escapeHtml(schoolLevelLabel(school.level))} · ${district}</p>
    </div>
    <span class="pill school-rating ${ratingClass}">${ratingInner}</span>
  </li>`;
}

function renderSchools(house, scored) {
  const schools = schoolsForHouse(house, payload.schools);
  if (!schools.length) {
    schoolsSection.hidden = true;
    schoolsList.innerHTML = "";
    return;
  }
  schoolsSection.hidden = false;
  schoolsList.innerHTML = schools.map((school) => schoolRowHtml(school, scored)).join("");
}

function surveyAnswerRowHtml(answer, question) {
  const archived = answer.archived;
  const notes = String(answer.notes || "").trim();
  const answered = answerHasContent(answer);
  const questionForTitle = {
    title: question?.title || answer.questionTitle,
    text: answer.questionText,
  };
  const trailing = `<span class="survey-answer-status ${answered ? "is-answered" : "is-unanswered"}">${
    answered ? "Answered" : "Unanswered"
  }</span>${archived ? '<span class="pill">Archived</span>' : ""}`;
  const valueHtml = answerControlHtml(
    {
      id: answer.questionId,
      type: answer.questionType,
      config: answer.questionConfig,
      questionType: answer.questionType,
      questionConfig: answer.questionConfig,
    },
    answer.value,
    { readonly: true }
  );
  return `<li class="survey-answer-row survey-card is-collapsed ${archived ? "is-archived" : ""}" data-answer-id="${escapeHtml(
    answer.id || answer.questionId
  )}">
    ${collapseToggleHtml(questionForTitle, { expanded: false, trailingHtml: trailing })}
    <div class="survey-collapse-body" hidden>
      <div class="survey-answer-control">${valueHtml}</div>
      ${notes ? `<p class="survey-answer-notes">${escapeHtml(notes)}</p>` : ""}
    </div>
  </li>`;
}

function surveySectionAnswersHtml(group, answersByQuestion) {
  if (!group.questions.length) return "";
  const progress = sectionProgress(group.questions, answersByQuestion);
  const rows = group.questions
    .map((q) => {
      const answer = answersByQuestion.get(q.id);
      if (!answer || !answerHasContent(answer)) return "";
      return surveyAnswerRowHtml(answer, q);
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return `<li class="survey-section survey-section-answers">
    <div class="survey-section-head">
      <h3 class="survey-section-title">${escapeHtml(group.title)}</h3>
      <p class="survey-section-progress">${progress.answered}/${progress.total} answered</p>
    </div>
    <ol class="survey-question-list survey-section-questions">${rows.join("")}</ol>
  </li>`;
}

function renderSurveySection(house) {
  const href = surveyFillUrl(house.slug);
  if (fillSurveyCta) fillSurveyCta.href = href;
  if (surveySectionFill) surveySectionFill.href = href;

  const questions = surveyCache.questions || [];
  const sections = surveyCache.sections || [];
  const answers = surveyCache.answers || [];
  const activeIds = new Set(questions.map((q) => q.id));
  const answersByQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const archivedAnswers = answers.filter((a) => a.archived || !activeIds.has(a.questionId));
  const hasContent = answers.some(answerHasContent);

  if (!questions.length && !archivedAnswers.length) {
    surveyNoQuestions.hidden = false;
    surveyEmpty.hidden = true;
    surveyAnswersList.hidden = true;
    surveyAnswersList.innerHTML = "";
    return;
  }

  surveyNoQuestions.hidden = true;
  surveyEmpty.hidden = hasContent;
  if (!hasContent) {
    surveyAnswersList.hidden = true;
    surveyAnswersList.innerHTML = "";
    return;
  }

  const groups = groupQuestionsBySection(questions, sections);
  const sectionRows = groups.map((group) => surveySectionAnswersHtml(group, answersByQuestion)).join("");
  const archivedRows = archivedAnswers
    .filter(answerHasContent)
    .map((answer) => surveyAnswerRowHtml(answer, null))
    .join("");
  const archivedBlock = archivedRows
    ? `<li class="survey-section survey-section-answers">
        <div class="survey-section-head">
          <h3 class="survey-section-title">Archived questions</h3>
        </div>
        <ol class="survey-question-list survey-section-questions">${archivedRows}</ol>
      </li>`
    : "";

  surveyAnswersList.hidden = false;
  surveyAnswersList.innerHTML = `${sectionRows}${archivedBlock}`;
}

async function loadSurvey(slug) {
  if (!slug) {
    surveyCache = { slug: "", questions: [], answers: [], sections: [], status: null };
    return;
  }
  try {
    const res = await fetch(`/api/survey/answers/${encodeURIComponent(slug)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load survey.");
    surveyCache = {
      slug,
      questions: data.questions || [],
      sections: data.sections || [],
      answers: data.answers || [],
      status: data.status || null,
    };
  } catch {
    surveyCache = { slug, questions: [], sections: [], answers: [], status: null };
  }
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
  setZillowButton(house);

  if (delta) {
    budgetBanner.hidden = false;
    budgetBanner.className = `banner ${delta.kind}`;
    budgetBanner.textContent = delta.text;
  } else {
    budgetBanner.hidden = true;
  }

  const listingHref = zillowHref(house);
  const zillowSafe = listingHref
    ? `<a href="${escapeHtml(listingHref)}" target="_blank" rel="noopener noreferrer">View on Zillow</a>`
    : "No listing link";

  const scored = prereqConfig
    ? scoreHousePrereqs(house, prereqConfig, { schools: payload.schools })
    : null;
  renderPrereqSummary(scored);

  const priceClass = delta ? `price ${delta.kind}` : "price";
  const rows = [
    metric("List price", escapeHtml(formatMoney(house.listPrice)), priceClass, prereqStatusForMetric("List price", scored)),
    metric("Status", escapeHtml(house.status || "—")),
    metric("Beds", formatNumber(house.beds), "", prereqStatusForMetric("Beds", scored)),
    metric("Baths", formatNumber(house.baths), "", prereqStatusForMetric("Baths", scored)),
    metric("Square feet", formatNumber(house.sqft), "", prereqStatusForMetric("Square feet", scored)),
    metric("Price / sq ft", escapeHtml(pricePerSqft(house))),
    metric("Year built", formatYear(house.yearBuilt), "", prereqStatusForMetric("Year built", scored)),
    metric("Age", escapeHtml(houseAge(house.yearBuilt)), "", prereqStatusForMetric("Age", scored)),
    metric("Lot acres", house.lotAcres == null ? "—" : escapeHtml(house.lotAcres), "", prereqStatusForMetric("Lot acres", scored)),
  ];

  if (hasOwnField(house, "garageSpaces")) {
    rows.push(
      metric(
        "Garage / parking",
        formatNumber(house.garageSpaces),
        "",
        prereqStatusForMetric("Garage / parking", scored)
      )
    );
  } else if (prereqConfig?.criteria?.some((c) => c.id === "garage" && c.enabled)) {
    // Enabled garage prereq with no field → show neutral box so missing data is visible.
    rows.push(
      metric("Garage / parking", "—", "", prereqStatusForMetric("Garage / parking", scored) || "neutral")
    );
  }

  if (hasOwnField(house, "hoaMonthly")) {
    rows.push(
      metric("HOA / mo", escapeHtml(formatMoney(house.hoaMonthly)), "", prereqStatusForMetric("HOA / mo", scored))
    );
  }

  if (hasOwnField(house, "stories")) {
    rows.push(metric("Stories", formatNumber(house.stories), "", prereqStatusForMetric("Stories", scored)));
  }

  if (hasOwnField(house, "hasPool")) {
    const pool = parseBooleanField(house.hasPool);
    const poolText = pool == null ? "—" : pool ? "Yes" : "No";
    rows.push(metric("Pool", poolText, "", prereqStatusForMetric("Pool", scored)));
  }

  if (hasOwnField(house, "propertyTaxAnnual")) {
    rows.push(
      metric(
        "Property tax / yr",
        escapeHtml(formatMoney(house.propertyTaxAnnual)),
        "",
        prereqStatusForMetric("Property tax / yr", scored)
      )
    );
  }

  if (hasOwnField(house, "daysOnMarket")) {
    rows.push(metric("Days on market", formatNumber(house.daysOnMarket)));
  }

  rows.push(
    metric("Last updated", escapeHtml(formatDate(house.lastUpdated))),
    metric("Zillow", zillowSafe)
  );

  metricsEl.innerHTML = rows.join("");

  renderSchools(house, scored);
  setMedia(house);
  renderChart(house, budget);
  if (surveyCache.slug === house.slug) renderSurveySection(house);
  else {
    loadSurvey(house.slug).then(() => {
      if (selectedHouse()?.slug === house.slug) renderSurveySection(house);
    });
  }
}

function preferredSlug(allHouses) {
  const fromUrl = slugFromLocation();
  if (fromUrl && allHouses.some((house) => house.slug === fromUrl)) return fromUrl;
  const active = allHouses.filter((house) => isActiveHouse(house, payload.interest));
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && active.some((house) => house.slug === stored)) return stored;
  return active[0]?.slug || "";
}

function renderAll() {
  const all = payload.houses || [];
  sampleBanner.hidden = payload.source !== "sample";
  const fromUrl = slugFromLocation();
  if (fromUrl && hiddenSet().has(fromUrl)) {
    includeToggle.checked = true;
  }
  const preferred = preferredSlug(all);
  const houses = housesForDetailsSelect(all, payload.interest, preferred);
  if (!houses.length) {
    show(empty, true);
    show(view, false);
    setHouseUrl("", { replace: true });
    return;
  }
  show(empty, false);
  show(view, true);
  fillSelect(houses, preferred);
  const house = selectedHouse();
  if (house) {
    localStorage.setItem(STORAGE_KEY, house.slug);
    setHouseUrl(house.slug, { replace: true });
    renderHouse(house);
  }
}

function selectHouse(slug, { replace = true } = {}) {
  const all = payload.houses || [];
  if (!all.some((house) => house.slug === slug)) return;
  if (hiddenSet().has(slug)) includeToggle.checked = true;
  fillSelect(housesForDetailsSelect(all, payload.interest, slug), slug);
  if (![...select.options].some((option) => option.value === slug)) return;
  select.value = slug;
  localStorage.setItem(STORAGE_KEY, slug);
  setHouseUrl(slug, { replace });
  const house = selectedHouse();
  if (house) renderHouse(house);
}

surveyAnswersList?.addEventListener("click", (event) => {
  const toggle = event.target.closest(".survey-collapse-toggle");
  if (!toggle || !surveyAnswersList.contains(toggle)) return;
  const row = toggle.closest(".survey-answer-row");
  if (!row) return;
  const body = row.querySelector(".survey-collapse-body");
  const expanding = row.classList.contains("is-collapsed");
  row.classList.toggle("is-collapsed", !expanding);
  row.classList.toggle("is-expanded", expanding);
  toggle.setAttribute("aria-expanded", expanding ? "true" : "false");
  if (body) body.hidden = !expanding;
});

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
      const remaining = activeHouses().filter((item) => item.slug !== house.slug);
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
    const [next] = await Promise.all([fetchHouses(), loadPrerequisites()]);
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
