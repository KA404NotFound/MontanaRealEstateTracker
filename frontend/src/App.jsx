import { useEffect, useState, useCallback } from 'react';
import CountySelector from './components/CountySelector.jsx';
import PropertyMap from './components/PropertyMap.jsx';
import PropertyTable from './components/PropertyTable.jsx';
import PropertyDetail from './components/PropertyDetail.jsx';
import MarketMetrics from './components/MarketMetrics.jsx';
import { getCounties, getProperties, getProperty, getMarketMetrics } from './api.js';
import { formatNumber } from './format.js';

export default function App() {
  const [counties, setCounties] = useState([]);
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [propertyData, setPropertyData] = useState({ results: [], total: 0, pageSize: 200 });
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [marketMetrics, setMarketMetrics] = useState([]);
  const [error, setError] = useState(null);

  // Initial county list.
  useEffect(() => {
    getCounties()
      .then((data) => {
        setCounties(data);
        if (data.length > 0) setSelectedCounty((prev) => prev ?? data[0].county);
      })
      .catch((err) => setError(err.message));
  }, []);

  // Debounce free-text search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [selectedCounty, debouncedSearch]);

  // Load properties whenever county/search/page changes.
  useEffect(() => {
    if (!selectedCounty) return;
    setLoadingProperties(true);
    setError(null);
    getProperties({ county: selectedCounty, q: debouncedSearch, page })
      .then(setPropertyData)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingProperties(false));
  }, [selectedCounty, debouncedSearch, page]);

  // Load aggregate market metrics for the selected county.
  useEffect(() => {
    if (!selectedCounty) return;
    getMarketMetrics(selectedCounty).then(setMarketMetrics).catch(() => setMarketMetrics([]));
  }, [selectedCounty]);

  const handleSelectProperty = useCallback((id) => {
    setSelectedId(id);
    setLoadingDetail(true);
    getProperty(id)
      .then(setSelectedDetail)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingDetail(false));
  }, []);

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
          {loadingProperties ? 'Loading…' : `${formatNumber(propertyData.total)} parcels`}
        </span>
      </div>

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
          <PropertyMap properties={propertyData.results} selectedId={selectedId} onSelect={handleSelectProperty} />
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

      <section className="market-metrics-section">
        <h2>Market Trends — {selectedCounty}</h2>
        <MarketMetrics county={selectedCounty} metrics={marketMetrics} />
      </section>
    </div>
  );
}
