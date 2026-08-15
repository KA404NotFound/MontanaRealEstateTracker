async function request(path, signal) {
  const res = await fetch(`/api${path}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function buildPropertyParams({ county, bounds, q, propertyType, minValue, maxValue, page }) {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  if (county) params.set('county', county);
  if (bounds) {
    params.set('minLat', bounds.minLat);
    params.set('minLng', bounds.minLng);
    params.set('maxLat', bounds.maxLat);
    params.set('maxLng', bounds.maxLng);
  }
  if (q) params.set('q', q);
  if (propertyType) params.set('property_type', propertyType);
  if (minValue) params.set('min_value', minValue);
  if (maxValue) params.set('max_value', maxValue);
  return params;
}

export function getCounties() {
  return request('/counties');
}

export function getProperties({ county, bounds, q, propertyType, minValue, maxValue, page = 1 }, signal) {
  const params = buildPropertyParams({ county, bounds, q, propertyType, minValue, maxValue, page });
  return request(`/properties?${params.toString()}`, signal);
}

// Not a fetch — returns a URL for a real browser navigation/download (the server sets
// Content-Disposition: attachment), so this just needs to mirror getProperties' filters.
export function getPropertiesExportUrl({ county, bounds, q, propertyType, minValue, maxValue }) {
  const params = buildPropertyParams({ county, bounds, q, propertyType, minValue, maxValue });
  return `/api/properties/export?${params.toString()}`;
}

export function getProperty(id, signal) {
  return request(`/properties/${id}`, signal);
}

export function getMarketMetrics(county) {
  return request(`/market-metrics/${encodeURIComponent(county)}`);
}

export function getOwnershipSummary(county) {
  const qs = county ? `?county=${encodeURIComponent(county)}` : '';
  return request(`/ownership/summary${qs}`);
}
