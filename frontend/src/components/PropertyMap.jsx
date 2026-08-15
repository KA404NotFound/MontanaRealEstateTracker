import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { formatCurrency } from '../format.js';

const DEFAULT_CENTER = [46.8797, -110.3626]; // roughly the center of Montana
const DEFAULT_ZOOM = 6;
const SELECTED_ZOOM = 17;

function valueColor(totalValue) {
  if (totalValue === null || totalValue === undefined) return '#9ca3af';
  if (totalValue < 50_000) return '#60a5fa';
  if (totalValue < 200_000) return '#34d399';
  if (totalValue < 500_000) return '#fbbf24';
  return '#f87171';
}

// Keeps Leaflet's internal size cache in sync when the map container's pixel size
// changes (e.g. the detail panel opening/closing resizes the map pane) — without this,
// fitBounds/flyTo target the wrong viewport and panning/zoom math goes stale.
function ResizeInvalidator() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

// Flies to `bounds` whenever it changes — driven by county selection (or "All"), not by
// whatever properties happen to be loaded (that would be circular now that properties
// are fetched *from* the viewport, not the other way around).
function FlyToBounds({ bounds }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [bounds, map]);

  return null;
}

// Reports the map's current viewport back to the parent — on every pan/zoom, and once
// on initial mount — so property fetches can be scoped to what's actually visible
// instead of a fixed value-sorted slice of the whole county/state.
function BoundsWatcher({ onBoundsChange }) {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds()),
  });

  useEffect(() => {
    onBoundsChange(map.getBounds());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report once on mount only
  }, []);

  return null;
}

// Flies to the selected property specifically. Deliberately keyed only on `selectedId`
// (not the properties list) so this fires on an actual click, not every time the result
// set refreshes while a marker happens to still be selected — and zooms in tight (17)
// rather than sharing whatever bounds the current viewport happens to be at.
function FlyToSelected({ properties, selectedId }) {
  const map = useMap();

  useEffect(() => {
    if (selectedId == null) return;
    const p = properties.find((prop) => prop.id === selectedId);
    if (!p || !p.latitude || !p.longitude) return;
    map.flyTo([p.latitude, p.longitude], SELECTED_ZOOM, { duration: 0.75 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes `properties`
  }, [selectedId, map]);

  return null;
}

export default function PropertyMap({ properties, selectedId, onSelect, flyToBounds, onBoundsChange }) {
  const points = useMemo(() => properties.filter((p) => p.latitude && p.longitude), [properties]);

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ResizeInvalidator />
      <FlyToBounds bounds={flyToBounds} />
      <BoundsWatcher onBoundsChange={onBoundsChange} />
      <FlyToSelected properties={points} selectedId={selectedId} />
      {points.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.latitude, p.longitude]}
          radius={p.id === selectedId ? 9 : 6}
          pathOptions={{
            color: p.id === selectedId ? '#1d4ed8' : valueColor(p.total_value),
            fillColor: valueColor(p.total_value),
            fillOpacity: 0.8,
            weight: p.id === selectedId ? 3 : 1,
          }}
          eventHandlers={{ click: () => onSelect(p.id) }}
        >
          <Popup>
            <strong>{p.owner_name || 'Unknown owner'}</strong>
            <br />
            {p.address_line1 || 'No address on file'}
            <br />
            {formatCurrency(p.total_value)} assessed
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
