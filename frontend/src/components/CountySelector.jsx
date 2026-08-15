import { formatCurrency, formatNumber } from '../format.js';

export default function CountySelector({ counties, selected, onSelect }) {
  const selectedSummary = selected ? counties.find((c) => c.county === selected) : null;

  return (
    <div className="county-selector">
      <select className="county-select" value={selected ?? ''} onChange={(e) => onSelect(e.target.value || null)}>
        <option value="">All Counties</option>
        {counties.map((c) => (
          <option key={c.county} value={c.county}>
            {c.county}
          </option>
        ))}
      </select>
      {selectedSummary && (
        <span className="county-summary">
          {formatNumber(selectedSummary.parcel_count)} parcels · {formatCurrency(selectedSummary.total_assessed_value)} assessed
        </span>
      )}
    </div>
  );
}
