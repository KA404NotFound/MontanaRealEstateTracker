import { formatCurrency, formatNumber } from '../format.js';

function Breakdown({ title, rows }) {
  const total = rows.reduce((sum, r) => sum + r.parcel_count, 0);
  const sorted = [...rows].sort((a, b) => b.parcel_count - a.parcel_count);

  return (
    <div className="ownership-breakdown">
      <h3>{title}</h3>
      <ul className="breakdown-list">
        {sorted.map((r) => {
          const pct = total ? (r.parcel_count / total) * 100 : 0;
          return (
            <li key={r.category} className="breakdown-row">
              <span className="breakdown-label">{r.category}</span>
              <span className="breakdown-bar-track">
                <span className="breakdown-bar-fill" style={{ width: `${pct}%` }} />
              </span>
              <span className="breakdown-value">
                {formatNumber(r.parcel_count)} ({pct.toFixed(1)}%)
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function OwnershipInsights({ scopeLabel, summary, loading }) {
  return (
    <section className="ownership-insights">
      <h2>Ownership Insights — {scopeLabel}</h2>
      <p className="ownership-note">
        Derived from owner-name and mailing-address text patterns already in the assessor
        data — a heuristic, not an official classification (an LLC or trust with an
        unusual name could get missed).
      </p>

      {loading && <div className="empty-state">Loading…</div>}

      {!loading && summary && (
        <>
          <div className="ownership-breakdowns">
            <Breakdown title="Ownership Residency" rows={summary.residency} />
            <Breakdown title="Ownership Type" rows={summary.entityType} />
          </div>

          <h3>Top Multi-Parcel Owners</h3>
          {summary.topOwners.length === 0 ? (
            <div className="empty-state">No owners with more than one parcel in this scope.</div>
          ) : (
            <table className="ownership-table">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Location</th>
                  <th>Parcels</th>
                  <th>Total Assessed Value</th>
                </tr>
              </thead>
              <tbody>
                {summary.topOwners.map((o) => (
                  <tr key={o.owner_name}>
                    <td>{o.owner_name}</td>
                    <td>{[o.owner_city, o.owner_state].filter(Boolean).join(', ') || '—'}</td>
                    <td>{formatNumber(o.parcel_count)}</td>
                    <td>{formatCurrency(o.total_assessed_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
