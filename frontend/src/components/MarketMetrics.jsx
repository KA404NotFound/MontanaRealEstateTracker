import { formatCurrency, formatNumber } from '../format.js';

export default function MarketMetrics({ county, metrics }) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="market-metrics empty-state">
        No aggregate market data logged for {county} yet — this is populated from local
        realtor board reports (Phase 4 Week 3), separately from parcel data above.
      </div>
    );
  }

  return (
    <table className="market-metrics-table">
      <thead>
        <tr>
          <th>Period</th>
          <th>Median Price</th>
          <th>Active Listings</th>
          <th>Closed Sales</th>
          <th>Avg DOM</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => (
          <tr key={m.id}>
            <td>{m.period_date}</td>
            <td>{formatCurrency(m.median_price)}</td>
            <td>{formatNumber(m.active_listings)}</td>
            <td>{formatNumber(m.closed_sales)}</td>
            <td>{m.avg_days_on_market ?? '—'}</td>
            <td>{m.source || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
