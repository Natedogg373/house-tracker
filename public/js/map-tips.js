import {
  detailsUrl,
  escapeHtml,
  formatMoney,
  schoolLevelLabel,
  schoolRatingLabel,
} from "./common.js";

export function insideBadge(house) {
  const names = Array.isArray(house?.inside) ? house.inside.filter(Boolean) : [];
  if (!names.length) return "";
  return `<span class="pill inside">In area</span>`;
}

export function houseTipHtml(house, school, currentLevel) {
  const href = detailsUrl(house.slug);
  const photo = house.photoUrl
    ? `<img class="map-tip-thumb" src="${escapeHtml(house.photoUrl)}" alt="" />`
    : `<div class="map-tip-thumb map-tip-empty" aria-hidden="true"></div>`;
  const schoolLine = school
    ? `<span>${escapeHtml(school.name)}</span>`
    : `<span class="map-tip-muted">No ${escapeHtml(schoolLevelLabel(currentLevel).toLowerCase())} school</span>`;
  return `<div class="map-tip-card">
    ${photo}
    <div class="map-tip-body">
      <strong>${escapeHtml(house.address || house.slug)}</strong>
      <span>${escapeHtml(formatMoney(house.listPrice))}</span>
      ${schoolLine}
      ${insideBadge(house)}
      <a class="map-tip-link" href="${escapeHtml(href)}">View details</a>
    </div>
  </div>`;
}

export function schoolTipHtml(school) {
  return `<div class="map-tip-card map-tip-school">
    <div class="map-tip-body">
      <strong>${escapeHtml(school.name)}</strong>
      <span>${escapeHtml(schoolLevelLabel(school.level))} · ${escapeHtml(schoolRatingLabel(school.rating))}</span>
    </div>
  </div>`;
}
