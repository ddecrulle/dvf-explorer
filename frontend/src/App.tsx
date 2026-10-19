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
  Viewport,
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
  const [viewport, setViewport] = useState<Viewport>({
    zoom: 13,
    west: initial.lon - 0.04,
    south: initial.lat - 0.025,
    east: initial.lon + 0.04,
    north: initial.lat + 0.025,
  });
  const [statusReady, setStatusReady] = useState(false);
  const queryCache = useRef(new Map<string, SalesResponse>());
  const updateViewport = useCallback((view: Viewport) => {
    const rounded = Object.fromEntries(
      Object.entries(view).map(([k, v]) => [k, Number(v.toFixed(5))]),
    ) as unknown as Viewport;
    setViewport((previous) =>
      JSON.stringify(previous) === JSON.stringify(rounded) ? previous : rounded,
    );
  }, []);
  const zoomRequired =
    viewport.east <= viewport.west ||
    viewport.north <= viewport.south ||
    viewport.east - viewport.west > 1.5 ||
    viewport.north - viewport.south > 1;

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
  const refreshStatus = useRef<() => void>(() => {});
  const { mapNode, map, mapError } = useSalesMap({
    center,
    onViewport: updateViewport,
    sales: data.sales,
    clusters: data.clusters,
    tab,
    setSelected,
  });
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    const poll = async () => {
      if (!live || active) return;
      const request = new AbortController();
      active = request;
      try {
        const s = await api<Status>('/api/status', { signal: request.signal });
        if (!live) return;
        setStatus(s);
        setStatusReady(true);
        if (lastJob.current === 'running' && s.job.state === 'done') {
          queryCache.current.clear();
          setRevision((v) => v + 1);
        }
        lastJob.current = s.job.state;
        // Published metadata is read once per visit. Only an active legacy
        // import requires progress polling.
        if (s.dataset?.mode !== 'published' && s.job.state === 'running')
          timer = setTimeout(poll, 2500);
      } catch (e) {
        if (live && !request.signal.aborted) {
          setError(
            e instanceof Error ? e.message : 'Unable to load data status.',
          );
          setLoading(false);
        }
      } finally {
        active = undefined;
      }
    };
    refreshStatus.current = () => {
      clearTimeout(timer);
      void poll();
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      active?.abort();
      refreshStatus.current = () => {};
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
    if (!statusReady) return;
    if (zoomRequired) {
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    const p = new URLSearchParams({
      west: String(viewport.west),
      south: String(viewport.south),
      east: String(viewport.east),
      north: String(viewport.north),
      zoom: String(viewport.zoom),
      year: String(year),
      kind,
      price_min: min || '0',
      price_max: max || '100000000',
    });
    if (status.dataset?.release) p.set('release', status.dataset.release);
    if (start) p.set('start', start);
    if (end) p.set('end', end);
    setLoading(true);
    setError('');
    setComparison(null);
    const load = async (params: URLSearchParams): Promise<SalesResponse> => {
      const key = params.toString();
      const cached = queryCache.current.get(key);
      if (cached) {
        queryCache.current.delete(key);
        queryCache.current.set(key, cached);
        return cached;
      }
      const result = await api<SalesResponse>('/api/sales?' + key, {
        signal: abort.signal,
      });
      if (!abort.signal.aborted) {
        if (queryCache.current.size >= 12)
          queryCache.current.delete(queryCache.current.keys().next().value!);
        queryCache.current.set(key, result);
      }
      return result;
    };
    // Wait until a pan/zoom has settled; keep the previous points on screen.
    const timer = setTimeout(() => {
      void load(p)
        .then((result) => {
          if (!abort.signal.aborted) setData(result);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
      if (year > 0 && status.years?.includes(year - 1)) {
        const previous = new URLSearchParams(p);
        previous.set('year', String(year - 1));
        previous.delete('start');
        previous.delete('end');
        void load(previous)
          .then((result) => {
            if (!abort.signal.aborted) setComparison(result);
          })
          .catch(() => {});
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [
    viewport,
    zoomRequired,
    statusReady,
    status.dataset?.release,
    status.years,
    year,
    kind,
    min,
    max,
    start,
    end,
    revision,
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
  const loaded =
    status.dataset?.mode === 'published' ||
    status.imports.some(
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
            <span>
              {Math.abs((viewport.west + viewport.east) / 2 - center.lon) <
                0.01 &&
              Math.abs((viewport.south + viewport.north) / 2 - center.lat) <
                0.01
                ? center.label
                : 'Visible map area'}
            </span>
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
              <span>Sales in view</span>
              <strong>
                {zoomRequired
                  ? 'Zoom in'
                  : loading
                    ? '…'
                    : data.total.toLocaleString('en-GB')}
              </strong>
            </div>
            <div>
              <span>Median sale price</span>
              <strong>
                {zoomRequired ? '—' : loading ? '…' : money(data.median_price)}
              </strong>
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
              <option value="distance">Nearest map centre</option>
            </select>
          </div>
          <div className="results" aria-live="polite" aria-busy={loading}>
            {zoomRequired && (
              <p className="notice">Zoom in to explore individual sales.</p>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {!zoomRequired && !loaded && !loading && !error && (
              <div className="notice">
                <Database size={19} />
                <strong>
                  {status.dataset?.mode === 'published'
                    ? 'No published coverage for this selection'
                    : 'Data preparation required'}
                </strong>
                <p>
                  {year || 'Published'} sales{' '}
                  {center.department
                    ? `for department ${center.department}`
                    : 'in this area'}{' '}
                  {status.dataset?.mode === 'published'
                    ? 'are not available in this release.'
                    : 'have not been prepared yet.'}
                </p>
                {status.dataset?.mode !== 'published' && (
                  <button
                    onClick={() => {
                      setDep(center.department || '16');
                      setImportYear(year || availableYears[0]);
                      setPanel(true);
                    }}
                  >
                    Import data <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
            )}
            {!zoomRequired &&
              loaded &&
              !loading &&
              data.total === 0 &&
              !error && (
                <div className="notice">
                  <Search size={22} />
                  <strong>
                    {pendingLocation
                      ? 'Sales imported, geolocation pending'
                      : 'No sales match your selection'}
                  </strong>
                  <p>
                    {status.dataset?.mode === 'published'
                      ? 'Move the map or adjust the filters.'
                      : 'Move the map, adjust the filters or import the relevant department through “Official data”.'}
                  </p>
                </div>
              )}
            {loading && <p className="loading">Searching transactions…</p>}
            {!zoomRequired &&
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
                Showing the latest 3,000 sales in view. Zoom in to see more
                detail.
              </p>
            )}
          </div>
          <footer>
            <span className="live-dot" />
            {status.dataset?.mode === 'published'
              ? status.dataset.source
              : 'DGFiP · DVF'}{' '}
            · {period}
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
              <strong>Sales in view</strong>
              <span>{period}</span>
            </div>
            <span className="map-action" role="status">
              {zoomRequired
                ? 'Zoom in to see sales'
                : loading
                  ? 'Loading sales…'
                  : 'Move the map to explore'}
            </span>
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
            refreshStatus.current();
          }}
        />
      )}
    </div>
  );
}
