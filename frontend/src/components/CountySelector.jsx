import { formatCurrency, formatNumber } from '../format.js';

export default function CountySelector({ counties, selected, onSelect }) {
  return (
    <div className="county-selector">
      {counties.map((c) => (
        <button
          key={c.county}
          className={`county-card ${selected === c.county ? 'active' : ''}`}
          onClick={() => onSelect(c.county)}
        >
          <div className="county-card-name">{c.county}</div>
          <div className="county-card-stat">{formatNumber(c.parcel_count)} parcels</div>
          <div className="county-card-stat">{formatCurrency(c.total_assessed_value)} assessed</div>
        </button>
      ))}
    </div>
  );
}
