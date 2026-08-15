import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { formatCurrency } from '../format.js';

const DEFAULT_CENTER = [46.8797, -110.3626]; // roughly the center of Montana
const DEFAULT_ZOOM = 6;

function valueColor(totalValue) {
  if (totalValue === null || totalValue === undefined) return '#9ca3af';
  if (totalValue < 50_000) return '#60a5fa';
  if (totalValue < 200_000) return '#34d399';
  if (totalValue < 500_000) return '#fbbf24';
  return '#f87171';
}

function FitToMarkers({ properties }) {
  const map = useMap();

  useEffect(() => {
    const points = properties.filter((p) => p.latitude && p.longitude).map((p) => [p.latitude, p.longitude]);
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 13);
    } else {
      map.fitBounds(points, { padding: [30, 30], maxZoom: 14 });
    }
  }, [properties, map]);

  return null;
}

export default function PropertyMap({ properties, selectedId, onSelect }) {
  const points = properties.filter((p) => p.latitude && p.longitude);

  return (
    <MapContainer center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMarkers properties={points} />
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
