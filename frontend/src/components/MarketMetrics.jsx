import { formatCurrency } from '../format.js';

// Shows median/average ASSESSED value per period — not sale price or listing activity.
// Montana doesn't publicly disclose sale prices and there's no free structured feed of
// real listing/market activity covering all 56 counties (see Phase 4 Week 3 in the plan
// doc), so this is computed directly from our own ingested parcel data instead — an
// honest, fully-automatic proxy rather than a stand-in for a real MLS feed.
export default function MarketMetrics({ county, metrics }) {
  if (!metrics || metrics.length === 0) {
    return (
      <div className="market-metrics empty-state">
        No assessed-value snapshot for {county} yet — this fills in automatically after
        the next ingestion run.
      </div>
    );
  }

  return (
    <>
      <table className="market-metrics-table">
        <thead>
          <tr>
            <th>Period</th>
            <th>Median Assessed Value</th>
            <th>Avg Assessed Value</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.id}>
              <td>{m.period_date}</td>
              <td>{formatCurrency(m.median_price)}</td>
              <td>{formatCurrency(m.avg_price)}</td>
              <td>{m.source || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="market-metrics-note">
        Assessed value, not sale price — Montana does not publicly disclose sale prices,
        and there's no free structured feed of real listing activity covering all 56
        counties. This is computed from the parcel data above, not a market/MLS feed.
      </p>
    </>
  );
}
