async function request(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function getCounties() {
  return request('/counties');
}

export function getProperties({ county, bounds, q, propertyType, minValue, maxValue, page = 1 }) {
  const params = new URLSearchParams({ page: String(page) });
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
  return request(`/properties?${params.toString()}`);
}

export function getProperty(id) {
  return request(`/properties/${id}`);
}

export function getMarketMetrics(county) {
  return request(`/market-metrics/${encodeURIComponent(county)}`);
}
