import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import CountySelector from './components/CountySelector.jsx';
import PropertyMap from './components/PropertyMap.jsx';
import PropertyTable from './components/PropertyTable.jsx';
import PropertyDetail from './components/PropertyDetail.jsx';
import MarketMetrics from './components/MarketMetrics.jsx';
import OwnershipInsights from './components/OwnershipInsights.jsx';
import {
  getCounties,
  getProperties,
  getProperty,
  getMarketMetrics,
  getOwnershipSummary,
  getPropertiesExportUrl,
} from './api.js';
import { formatNumber } from './format.js';

// Approximate Montana state extent — used to fly the map out to a statewide view when
// "All Counties" is selected. Fixed constant rather than a query since the state's
// shape doesn't change; per-county bounds (which do need real data) come from the API.
const MONTANA_BOUNDS = [
  [44.0, -116.5],
  [49.5, -104.0],
];

export default function App() {
  const [counties, setCounties] = useState([]);
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mapBounds, setMapBounds] = useState(null);
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [propertyData, setPropertyData] = useState({ results: [], total: 0, pageSize: 200 });
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [marketMetrics, setMarketMetrics] = useState([]);
  const [ownershipSummary, setOwnershipSummary] = useState(null);
  const [loadingOwnership, setLoadingOwnership] = useState(false);
  const [error, setError] = useState(null);

  // Initial county list. Default selection stays null ("All Counties") — don't
  // auto-select the alphabetically-first county.
  useEffect(() => {
    getCounties()
      .then((data) => {
        setCounties(data);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Debounce free-text search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // A new county, search, or map viewport all mean "start over" on pagination.
  useEffect(() => {
    setPage(1);
  }, [selectedCounty, debouncedSearch, mapBounds]);

  // Load properties whenever county/search/page/viewport changes. Bounds are included
  // whenever available (even alongside a selected county) so results reflect what's
  // actually visible on the map, not just a value-sorted slice of the whole county —
  // without this, panning into an ordinary neighborhood shows almost nothing, since
  // typical houses rarely crack a "top 200 by value" cut for an entire county.
  //
  // Panning fires this often, so requests can resolve out of order (a fast response to
  // an old viewport landing after a slower response to a newer one). The AbortController
  // cancels the previous in-flight request whenever this effect re-runs, so a stale
  // response never overwrites a newer one — its promise rejects with AbortError, which
  // is caught and ignored below rather than treated as a real error.
  useEffect(() => {
    if (!selectedCounty && !mapBounds) return;
    const controller = new AbortController();
    setLoadingProperties(true);
    setError(null);
    getProperties({ county: selectedCounty, bounds: mapBounds, q: debouncedSearch, page }, controller.signal)
      .then(setPropertyData)
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProperties(false);
      });
    return () => controller.abort();
  }, [selectedCounty, debouncedSearch, page, mapBounds]);

  // Aggregate market metrics are inherently per-county — nothing meaningful to show
  // under "All Counties".
  useEffect(() => {
    if (!selectedCounty) {
      setMarketMetrics([]);
      return;
    }
    getMarketMetrics(selectedCounty).then(setMarketMetrics).catch(() => setMarketMetrics([]));
  }, [selectedCounty]);

  // Ownership analysis works statewide too (unlike market metrics, which has no
  // meaningful "trend" without a specific county) — scoped to selectedCounty when set,
  // otherwise the whole state. Same stale-response concern as the properties fetch:
  // switching counties quickly could let an older response land after a newer one.
  useEffect(() => {
    const controller = new AbortController();
    setLoadingOwnership(true);
    getOwnershipSummary(selectedCounty, controller.signal)
      .then(setOwnershipSummary)
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setOwnershipSummary(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingOwnership(false);
      });
    return () => controller.abort();
  }, [selectedCounty]);

  // Same stale-response concern as the properties fetch — clicking through several
  // markers quickly could otherwise let an earlier detail fetch resolve after a later
  // one. A ref (not state) holds the controller since this needs to persist across
  // calls without triggering re-renders itself.
  const detailAbortRef = useRef(null);

  const handleSelectProperty = useCallback((id) => {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;

    setSelectedId(id);
    setLoadingDetail(true);
    getProperty(id, controller.signal)
      .then(setSelectedDetail)
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetail(false);
      });
  }, []);

  const handleBoundsChange = useCallback((leafletBounds) => {
    setMapBounds({
      minLat: leafletBounds.getSouth(),
      minLng: leafletBounds.getWest(),
      maxLat: leafletBounds.getNorth(),
      maxLng: leafletBounds.getEast(),
    });
  }, []);

  // Where to fly the map on county selection — the county's real extent (from its
  // parcel geometry) or the whole state for "All Counties". Only changes when the
  // selection itself changes, not on every pan (that would fight the user's own panning).
  const flyToBounds = useMemo(() => {
    if (!selectedCounty) return MONTANA_BOUNDS;
    const c = counties.find((county) => county.county === selectedCounty);
    if (!c || c.min_lat == null) return null;
    return [
      [c.min_lat, c.min_lng],
      [c.max_lat, c.max_lng],
    ];
  }, [selectedCounty, counties]);

  const totalPages = Math.max(1, Math.ceil(propertyData.total / propertyData.pageSize));

  return (
    <div className="app">
      <header className="app-header">
        <h1>Montana Real Estate Tracker</h1>
        <p className="app-subtitle">
          Parcel ownership &amp; assessed value, sourced from Montana's statewide Cadastral API.
        </p>
      </header>

      <CountySelector counties={counties} selected={selectedCounty} onSelect={setSelectedCounty} />

      {error && <div className="error-banner">{error}</div>}

      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by owner name, address, or parcel ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="result-count">
          {loadingProperties ? 'Loading…' : `${formatNumber(propertyData.total)} parcels in view`}
        </span>
        {(selectedCounty || mapBounds) && (
          <a
            className="export-btn"
            href={getPropertiesExportUrl({ county: selectedCounty, bounds: mapBounds, q: debouncedSearch })}
            download
          >
            Export CSV
          </a>
        )}
      </div>

      <div className="content-row">
        <div className="main-layout">
          <div className="table-pane">
            <PropertyTable properties={propertyData.results} selectedId={selectedId} onSelect={handleSelectProperty} />
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span>Page {page} of {formatNumber(totalPages)}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>

          <div className="map-pane">
            <button className="heatmap-toggle" onClick={() => setHeatmapMode((v) => !v)}>
              {heatmapMode ? 'Show Markers' : 'Show Heatmap'}
            </button>
            <PropertyMap
              properties={propertyData.results}
              selectedId={selectedId}
              onSelect={handleSelectProperty}
              flyToBounds={flyToBounds}
              onBoundsChange={handleBoundsChange}
              heatmapMode={heatmapMode}
            />
          </div>
        </div>

        {selectedId && (
          <PropertyDetail
            property={selectedDetail}
            loading={loadingDetail}
            onClose={() => {
              setSelectedId(null);
              setSelectedDetail(null);
            }}
          />
        )}
      </div>

      {selectedCounty && (
        <section className="market-metrics-section">
          <h2>Assessed Value Trends — {selectedCounty}</h2>
          <MarketMetrics county={selectedCounty} metrics={marketMetrics} />
        </section>
      )}

      <OwnershipInsights
        scopeLabel={selectedCounty || 'Statewide'}
        summary={ownershipSummary}
        loading={loadingOwnership}
      />

      <footer className="app-footer">
        <p>
          Parcel, ownership, and assessed-value data: Montana State Library &amp;
          Department of Revenue (Ravalli, Silver Bow, Missoula, Flathead, and Yellowstone
          counties maintain their own parcel data, integrated by the State Library).
          Listing price/inventory data, where shown: Realtor.com, via FRED (Federal
          Reserve Bank of St. Louis). Map tiles: &copy;{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>{' '}
          contributors.
        </p>
      </footer>
    </div>
  );
}
