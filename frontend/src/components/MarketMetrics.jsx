import { useState } from 'react';
import { formatCurrency, formatNumber } from '../format.js';

// One page per year of monthly data — small enough to keep the table scannable now that
// FRED-backed counties can have a decade-plus of monthly history (fredMarketData.js
// backfills full series history, not just the latest point).
const PAGE_SIZE = 12;

// Two different kinds of rows can appear here, distinguished by `source`:
// - Self-computed: median/average ASSESSED value from our own ingested parcel data (all
//   56 counties, always available, but a tax-assessment proxy, not a market price).
// - FRED-sourced: real median LISTING price / active listings / days on market from
//   Realtor.com via FRED (only where a series exists — populous counties, mostly).
// The Source column matters here beyond just informational value — FRED's citation
// requirement for this data (verified "Copyrighted: Citation Required") means this needs
// to actually be visible wherever the data is shown, not just stored in the database.
export default function MarketMetrics({ county, metrics }) {
  const [page, setPage] = useState(1);

  if (!metrics || metrics.length === 0) {
    return (
      <div className="market-metrics empty-state">
        No market data for {county} yet — this fills in automatically after the next
        ingestion run.
      </div>
    );
  }

  // Newest period first — the API returns rows oldest-first (period_date ASC), but for
  // reading trends the most relevant data is the most recent, with older history paged
  // behind rather than requiring a scroll past it.
  const sorted = [...metrics].sort((a, b) => (a.period_date < b.period_date ? 1 : a.period_date > b.period_date ? -1 : 0));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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
          {pageRows.map((m) => (
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
      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>Page {currentPage} of {formatNumber(totalPages)}</span>
          <button disabled={currentPage >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
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
