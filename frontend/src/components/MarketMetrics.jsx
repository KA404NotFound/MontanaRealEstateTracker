import { formatCurrency, formatNumber } from '../format.js';

// Two different kinds of rows can appear here, distinguished by `source`:
// - Self-computed: median/average ASSESSED value from our own ingested parcel data (all
//   56 counties, always available, but a tax-assessment proxy, not a market price).
// - FRED-sourced: real median LISTING price / active listings / days on market from
//   Realtor.com via FRED (only where a series exists — populous counties, mostly).
// The Source column matters here beyond just informational value — FRED's citation
// requirement for this data (verified "Copyrighted: Citation Required") means this needs
// to actually be visible wherever the data is shown, not just stored in the database.
export default function MarketMetrics({ county, metrics }) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="market-metrics empty-state">
        No market data for {county} yet — this fills in automatically after the next
        ingestion run.
      </div>
    );
  }

  return (
    <>
      <table className="market-metrics-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Median Price</th>
            <th>Avg Price</th>
            <th>Active Listings</th>
            <th>Avg Days on Market</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id}>
              <td>{m.period_date}</td>
              <td>{formatCurrency(m.median_price)}</td>
              <td>{formatCurrency(m.avg_price)}</td>
              <td>{formatNumber(m.active_listings)}</td>
              <td>{m.avg_days_on_market ?? '—'}</td>
              <td>{m.source || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="market-metrics-note">
        Two kinds of rows can appear here: an assessed-value snapshot (computed from the
        parcel data above — every county, but a tax-assessment proxy, not a market price)
        and, where available, a real median-listing-price/inventory snapshot from
        Realtor.com via FRED (populous counties only — small counties often don't have
        enough listing volume for a series to exist). Neither is a sale price — Montana
        does not publicly disclose those.
      </p>
    </>
  );
}
