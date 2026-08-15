import { formatCurrency, formatAcres } from '../format.js';

export default function PropertyTable({ properties, selectedId, onSelect }) {
  if (properties.length === 0) {
    return <div className="empty-state">No parcels match this search.</div>;
  }

  return (
    <table className="property-table">
      <thead>
        <tr>
          <th>Owner</th>
          <th>Address</th>
          <th>Type</th>
          <th>Acres</th>
          <th>Assessed Value</th>
        </tr>
      </thead>
      <tbody>
        {properties.map((p) => (
          <tr
            key={p.id}
            className={p.id === selectedId ? 'active' : ''}
            onClick={() => onSelect(p.id)}
          >
            <td>{p.owner_name || '—'}</td>
            <td>{p.address_line1 || '—'}</td>
            <td>{p.property_type || '—'}</td>
            <td>{formatAcres(p.total_acres)}</td>
            <td>{formatCurrency(p.total_value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
