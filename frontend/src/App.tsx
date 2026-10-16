import { SaleCard } from './components/SaleCard';
import { SaleDetails } from './components/SaleDetails';
import { DataPanel } from './components/DataPanel';
import { useSalesMap } from './hooks/useSalesMap';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import type {
  Location,
  Sale,
  SalesResponse,
  Status,
  SearchFeature,
  SearchResponse,
} from './types';
import { api } from './api';
import { money, exportSalesCSV } from './format';
import { initial } from './mapData';

import {
  Search,
  MapPin,
  ArrowUpRight,
  X,
  SlidersHorizontal,
  Database,
  Layers,
  LocateFixed,
  Download,
  Home,
  Building2,
  Trees,
  Info,
} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

export default function App() {
  const [center, setCenter] = useState<Location>(initial);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchFeature[]>([]);
  const [searchError, setSearchError] = useState('');
  const [year, setYear] = useState(0);
  const [radius, setRadius] = useState(3);
  const [kind, setKind] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState<SalesResponse>({ sales: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Sale | null>(null);
  const [sort, setSort] = useState('recent');
  const [status, setStatus] = useState<Status>({
    imports: [],
    job: { state: 'idle' },
  });
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('list');
  const [revision, setRevision] = useState(0);
  const [comparison, setComparison] = useState<SalesResponse | null>(null);

  const [dep, setDep] = useState('16');
  const [importYear, setImportYear] = useState(2026);
  const [showFilters, setShowFilters] = useState(false);
  const closePanel = useCallback(() => setPanel(false), []);
  const years = [
    ...new Set([...(status.years || []), ...(status.archive?.years || [])]),
  ].sort((a, b) => b - a);
  const availableYears = years.length ? years : [new Date().getFullYear()];
  const period = year || 'All years';
  const lastJob = useRef('idle');
  const { mapNode, map, mapError } = useSalesMap({
    center,
    radius,
    sales: data.sales,
    tab,
    setSelected,
  });
  useEffect(() => {
    let live = true;
    const poll = () =>
      api<Status>('/api/status')
        .then((s) => {
          if (!live) return;
          setStatus(s);
          if (lastJob.current === 'running' && s.job.state === 'done')
            setRevision((v) => v + 1);
          lastJob.current = s.job.state;
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (query.trim().length < 3) {
      setSuggestions([]);
      setSearchError('');
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(
      () =>
        api<SearchResponse>('/api/search?q=' + encodeURIComponent(query), {
          signal: abort.signal,
        })
          .then((r) => {
            setSuggestions(r.features || []);
            setSearchError(r.features?.length ? '' : 'No address found.');
          })
          .catch((e) => {
            if (e.name !== 'AbortError') setSearchError(e.message);
          }),
      300,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  useEffect(() => {
    const abort = new AbortController();
    const p = new URLSearchParams({
      lon: String(center.lon),
      lat: String(center.lat),
      radius: String(radius),
      year: String(year),
      kind,
      price_min: min || '0',
      price_max: max || '100000000',
    });
    if (start) p.set('start', start);
    if (end) p.set('end', end);
    setLoading(true);
    setError('');
    setSelected(null);
    setComparison(null);
    api<SalesResponse>('/api/sales?' + p, { signal: abort.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setError(e.message);
          setData({ sales: [], total: 0 });
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    if (
      year > 0 &&
      status.imports.some(
        (i) => i.year === year - 1 && i.department === center.department,
      )
    ) {
      p.set('year', String(year - 1));
      p.delete('start');
      p.delete('end');
      api<SalesResponse>('/api/sales?' + p, { signal: abort.signal })
        .then(setComparison)
        .catch(() => {});
    }
    return () => abort.abort();
  }, [
    center,
    radius,
    year,
    kind,
    min,
    max,
    start,
    end,
    revision,
    status.imports
      .map((i) => `${i.year}-${i.department}-${i.located}`)
      .join(','),
  ]);
  const choose = (f: SearchFeature) => {
    setCenter({
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      label: f.properties.label,
      department:
        f.properties.depcode || f.properties.citycode?.slice(0, 2) || '16',
    });
    setQuery('');
    setSuggestions([]);
  };
  const chooseSale = (s: Sale) => {
    setSelected(s);
    setTab('map');
    map.current?.flyTo({ center: [s.longitude, s.latitude], zoom: 15 });
  };
  const loaded = status.imports.some(
    (i) =>
      (!year || i.year === year) &&
      (!center.department || i.department === center.department),
  );
  const pendingLocation = status.imports.some(
    (i) =>
      (!year || i.year === year) &&
      i.department === center.department &&
      i.count > 0 &&
      i.located === 0,
  );
  const rows = [...data.sales].sort((a, b) =>
    sort === 'price'
      ? a.price - b.price
      : sort === 'distance'
        ? a.distance - b.distance
        : b.date.localeCompare(a.date),
  );
  function exportCSV() {
    exportSalesCSV(rows, year);
  }
  return (
    <div className="app">
      <header>
        <a className="brand" href="/" aria-label="DVF Explorer home">
          <span className="brand-icon">
            <Layers size={23} />
          </span>
          <strong>
            dvf<span>explorer</span>
          </strong>
        </a>
        <div className="header-caption">
          Property sales, straight from the source.
        </div>
        <button className="source-button" onClick={() => setPanel(true)}>
          <span className="live-dot" />
          Official data <Database size={15} />
        </button>
      </header>
      <main>
        <section className="sidebar">
          <div className="intro">
            <div className="eyebrow">EXPLORE THE LOCAL MARKET</div>
            <h1>
              Every sale tells
              <br />a neighbourhood story.
            </h1>
            <p>
              Explore declared sale prices,
              <br className="desktop" /> directly from official DVF records.
            </p>
          </div>
          <div className="search-box">
            <Search size={19} />
            <input
              aria-label="Search for an address or municipality"
              placeholder="An address, a municipality…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                className="icon"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={16} />
              </button>
            )}
            {(suggestions.length > 0 || searchError) && (
              <div className="suggestions">
                {suggestions.map((f) => (
                  <button key={f.properties.id} onClick={() => choose(f)}>
                    <MapPin size={16} />
                    {f.properties.label}
                  </button>
                ))}
                {searchError && <p role="status">{searchError}</p>}
              </div>
            )}
          </div>
          <div className="location">
            <MapPin size={14} />
            <span>{center.label}</span>
          </div>
          {status.job.state === 'running' && (
            <div className="sync-progress" role="status">
              {status.job.message}
            </div>
          )}
          <div className="filter-top">
            <label>
              Sale year
              <select
                value={year}
                onChange={(e) => {
                  setYear(+e.target.value);
                  setStart('');
                  setEnd('');
                }}
              >
                <option value={0}>All years</option>
                {availableYears.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </label>
            <label>
              Within a radius of
              <select
                value={radius}
                onChange={(e) => setRadius(+e.target.value)}
              >
                {[0.5, 1, 3, 5, 10, 20, 30].map((r) => (
                  <option key={r} value={r}>
                    {r.toLocaleString('en-GB')} km
                  </option>
                ))}
              </select>
            </label>
            <button
              className={'filter-btn ' + (showFilters ? 'active' : '')}
              aria-label="Show advanced filters"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal size={19} />
            </button>
          </div>
          <div className="type-tabs">
            {(
              [
                ['', 'All', Layers],
                ['Maison', 'Houses', Home],
                ['Appartement', 'Flats', Building2],
                ['Terrain / dépendance', 'Land', Trees],
              ] satisfies [string, string, LucideIcon][]
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                className={kind === value ? 'active' : ''}
                onClick={() => setKind(value)}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          {showFilters && (
            <div className="advanced">
              <label>
                Min. price (€)
                <input
                  type="number"
                  min="0"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                />
              </label>
              <label>
                Max. price (€)
                <input
                  type="number"
                  min="0"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                />
              </label>
              <label>
                From
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
              <button
                onClick={() => {
                  setMin('');
                  setMax('');
                  setStart('');
                  setEnd('');
                  setKind('');
                }}
              >
                Reset filters
              </button>
            </div>
          )}
          <div className="metrics">
            <div>
              <span>Sales within radius</span>
              <strong>
                {loading ? '…' : data.total.toLocaleString('en-GB')}
              </strong>
            </div>
            <div>
              <span>Median sale price</span>
              <strong>{loading ? '…' : money(data.median_price)}</strong>
            </div>
          </div>
          {comparison && (
            <div className="comparison">
              {year - 1} · {comparison.total} sales · median{' '}
              {money(comparison.median_price)}
              <span>
                Full previous year, with the same price and property filters.
              </span>
            </div>
          )}
          <div className="results-heading">
            <h2>Latest sales</h2>
            <select
              aria-label="Sort sales"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="recent">Most recent</option>
              <option value="price">Lowest price</option>
              <option value="distance">Nearest</option>
            </select>
          </div>
          <div className="results" aria-live="polite">
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {!loaded && !loading && (
              <div className="notice">
                <Database size={19} />
                <strong>This area is ready to explore</strong>
                <p>
                  {year || 'Archived'} sales{' '}
                  {center.department
                    ? `for department ${center.department}`
                    : 'in this area'}{' '}
                  have not been imported yet.
                </p>
                <button
                  onClick={() => {
                    setDep(center.department || '16');
                    setImportYear(year || availableYears[0]);
                    setPanel(true);
                  }}
                >
                  Import data <ArrowUpRight size={15} />
                </button>
              </div>
            )}
            {loaded && !loading && data.total === 0 && !error && (
              <div className="notice">
                <Search size={22} />
                <strong>
                  {pendingLocation
                    ? 'Sales imported, geolocation pending'
                    : 'No sales match your selection'}
                </strong>
                <p>
                  Increase the radius, adjust the filters or import the relevant
                  department through “Official data”.
                </p>
              </div>
            )}
            {loading && <p className="loading">Searching transactions…</p>}
            {!loading &&
              rows.map((s) => (
                <SaleCard
                  key={s.id}
                  sale={s}
                  selected={selected?.id === s.id}
                  onSelect={chooseSale}
                />
              ))}
            {data.truncated && (
              <p className="notice">
                Showing up to 3,000 sales. Reduce the radius to narrow the
                results.
              </p>
            )}
          </div>
          <footer>
            <span className="live-dot" />
            DGFiP · DVF · {period}
            <button onClick={() => setPanel(true)}>
              About the data <Info size={13} />
            </button>
          </footer>
        </section>
        <section
          className={'map-section ' + (tab === 'list' ? 'mobile-hidden' : '')}
          aria-label="Sales map"
        >
          <div className="map" ref={mapNode} />
          <div className="map-top">
            <div className="map-caption">
              <span className="live-dot" />
              <strong>Sales around you</strong>
              <span>
                {period} · {radius} km
              </span>
            </div>
            <button
              className="map-action"
              onClick={() => {
                const p = map.current?.getCenter();
                if (p)
                  setCenter({
                    ...center,
                    lon: p.lng,
                    lat: p.lat,
                    department: null,
                    label: 'Around the map centre',
                  });
              }}
            >
              <LocateFixed size={17} />
              Search this area
            </button>
          </div>
          {mapError && (
            <div className="map-error" role="status">
              {mapError}
            </div>
          )}
          <div className="map-bottom">
            <div className="legend">
              <span>
                <i />
                House
              </span>
              <span>
                <i className="apartment" />
                Flat
              </span>
              <span>
                <i className="other" />
                Other property
              </span>
            </div>
            <button
              className="export"
              disabled={!rows.length}
              onClick={exportCSV}
            >
              <Download size={16} />
              Export selection
            </button>
          </div>
          {selected && (
            <SaleDetails sale={selected} onClose={() => setSelected(null)} />
          )}
        </section>
        <div className="mobile-switch">
          <button onClick={() => setTab(tab === 'map' ? 'list' : 'map')}>
            {tab === 'map' ? 'Show list' : 'Show map'}
          </button>
        </div>
      </main>
      {panel && (
        <DataPanel
          status={status}
          availableYears={availableYears}
          dep={dep}
          setDep={setDep}
          importYear={importYear}
          setImportYear={setImportYear}
          onClose={closePanel}
          onStarted={(message) => {
            setStatus((current) => ({
              ...current,
              job: { state: 'running', message },
            }));
            lastJob.current = 'running';
          }}
        />
      )}
    </div>
  );
}
