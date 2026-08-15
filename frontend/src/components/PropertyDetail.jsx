import { formatCurrency, formatAcres, formatNumber } from '../format.js';

export default function PropertyDetail({ property, loading, onClose }) {
  if (loading) {
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <p>Loading…</p>
      </div>
    );
  }

  if (!property) return null;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <h3>{property.owner_name || 'Unknown owner'}</h3>
        <button className="close-btn" onClick={onClose}>&times;</button>
      </div>

      <dl className="detail-grid">
        <dt>Parcel ID</dt>
        <dd>{property.parcel_id}</dd>

        <dt>Address</dt>
        <dd>{property.address_line1 || '—'} {property.city_state_zip || ''}</dd>

        <dt>Owner mailing address</dt>
        <dd>
          {[property.owner_address_1, property.owner_address_2, property.owner_city, property.owner_state, property.owner_zip]
            .filter(Boolean)
            .join(', ') || '—'}
        </dd>

        <dt>Property type</dt>
        <dd>{property.property_type || '—'}</dd>

        <dt>Total acres</dt>
        <dd>{formatAcres(property.total_acres)}</dd>

        <dt>Land value</dt>
        <dd>{formatCurrency(property.total_land_value)}</dd>

        <dt>Building value</dt>
        <dd>{formatCurrency(property.total_building_value)}</dd>

        <dt>Total assessed value</dt>
        <dd><strong>{formatCurrency(property.total_value)}</strong></dd>

        <dt>Tax year</dt>
        <dd>{property.tax_year ? formatNumber(property.tax_year) : '—'}</dd>

        <dt>Township / Range / Section</dt>
        <dd>{[property.township, property.range, property.section].filter(Boolean).join(' / ') || '—'}</dd>

        <dt>Subdivision</dt>
        <dd>{property.subdivision || '—'}</dd>

        <dt>Levy district</dt>
        <dd>{property.levy_district || '—'}</dd>
      </dl>

      <p className="detail-note">
        Assessed value, not sale price — Montana does not publicly disclose sale prices.
      </p>
    </div>
  );
}
