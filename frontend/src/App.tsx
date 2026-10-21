import { useParcelAddresses } from './queries/addresses';
import { translateMessage } from './messages';
import { LanguageSelector } from './components/LanguageSelector';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useCallback, useState } from 'react';
import { Database, Info, Layers, MapPin } from 'lucide-react';
import { AddressSearch } from './components/AddressSearch';
import { MutationFilters } from './components/MutationFilters';
import { ParcelResults } from './components/ParcelResults';
import { DataPanel } from './components/DataPanel';
import { useDataset } from './queries/dataset';
import {
  defaultFilters,
  emptyStatus,
  normalizeViewport,
  sameViewport,
  useParcels,
} from './queries/parcels';
import { initial } from './mapData';
import { overview } from './geographicMap';
import type {
  Location,
  MapFocus,
  ParcelSelection,
  SearchFeature,
  Viewport,
} from './types';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

const ParcelMap = lazy(() => import('./components/ParcelMap'));
export default function App() {
  const { t } = useTranslation();
  const [center, setCenter] = useState<Location>(initial);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [viewport, setViewport] = useState<Viewport>({
    zoom: overview.zoom,
    west: initial.lon - 0.04,
    east: initial.lon + 0.04,
    south: initial.lat - 0.025,
    north: initial.lat + 0.025,
  });
  const [filters, setFilters] = useState(defaultFilters);
  const [selected, setSelected] = useState<ParcelSelection | null>(null);
  const [panel, setPanel] = useState(false);
  const [tab, setTab] = useState('list');
  const closePanel = useCallback(() => setPanel(false), []);
  const updateViewport = useCallback((view: Viewport) => {
    const normalized = normalizeViewport(view);
    setViewport((previous) =>
      sameViewport(previous, normalized) ? previous : normalized,
    );
  }, []);
  const dataset = useDataset();
  const status = dataset.data ?? emptyStatus;
  const published = status.dataset?.mode === 'published';
  const {
    data,
    comparison,
    loading: salesLoading,
    error: salesError,
    zoomRequired,
    retry,
    canRetry,
  } = useParcels(viewport, filters, dataset.data);
  const addressData = useParcelAddresses(data.parcels.map((p) => p.id));
  const loading = !dataset.error && salesLoading;
  const error = translateMessage(dataset.error?.message || salesError);
  const { year } = filters;
  const years = [
    ...new Set([...(status.years ?? []), ...(status.archive?.years ?? [])]),
  ].sort((a, b) => b - a);
  const availableYears = years.length ? years : [new Date().getFullYear()];
  const period = year || t('common.allYears');
  const loaded =
    published ||
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
  function choose(feature: SearchFeature) {
    const location: Location = {
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      label: feature.properties.label,
      department:
        feature.properties.depcode ||
        feature.properties.citycode?.slice(0, 2) ||
        null,
    };
    setCenter(location);
    setSelected(null);
    const zoom =
      feature.properties.type === 'housenumber'
        ? 18
        : feature.properties.type === 'municipality'
          ? 13.1
          : 16.5;
    setTab('map');
    const { type, citycode, name } = feature.properties;
    setFocus({
      ...location,
      zoom,
      search: true,
      searchArea:
        citycode && (type === 'municipality' || (type === 'street' && name))
          ? {
              kind: type,
              citycode,
              name: name ?? '',
              street_id: feature.properties.id,
            }
          : undefined,
    });
  }
  const chooseParcel = useCallback((sale: ParcelSelection) => {
    setSelected(sale);
    setTab('map');
    setFocus({
      parcel: sale.id,
      lon: sale.longitude,
      lat: sale.latitude,
      zoom: 17,
      label: sale.city,
      department:
        sale.id.startsWith('97') || sale.id.startsWith('98')
          ? sale.id.slice(0, 3)
          : sale.id.slice(0, 2),
    });
  }, []);
  return (
    <div className="app">
      <header>
        <a className="brand" href="/" aria-label={t('app.home')}>
          <span className="brand-icon">
            <Layers size={23} />
          </span>
          <strong>
            dvf<span>explorer</span>
          </strong>
        </a>
        <div className="header-caption">{t('app.tagline')}</div>
        <LanguageSelector />
        <button className="source-button" onClick={() => setPanel(true)}>
          <span className="live-dot" />
          {t('app.officialData')}
          <Database size={15} />
        </button>
      </header>
      <main>
        <section className="sidebar">
          <div className="intro">
            <div className="eyebrow">{t('app.eyebrow')}</div>
            <h1>
              {t('app.headingFirst')}
              <br /> {t('app.headingLast')}
            </h1>
            <p>
              {t('app.introFirst')}
              <br className="desktop" /> {t('app.introLast')}
            </p>
          </div>
          <AddressSearch onChoose={choose} />
          <div className="location">
            <MapPin size={14} />
            <span>
              {Math.abs((viewport.west + viewport.east) / 2 - center.lon) <
                0.01 &&
              Math.abs((viewport.south + viewport.north) / 2 - center.lat) <
                0.01
                ? center.label
                : t('app.visibleArea')}
            </span>
          </div>
          {status.job.state === 'running' && (
            <div className="sync-progress" role="status">
              {t('jobs.running')}
            </div>
          )}
          <MutationFilters
            value={filters}
            onChange={setFilters}
            availableYears={availableYears}
          />
          <ParcelResults
            addresses={addressData.addresses}
            data={data}
            comparison={comparison}
            year={year}
            loading={loading}
            error={error}
            zoomRequired={zoomRequired}
            published={published}
            loaded={loaded}
            pendingLocation={pendingLocation}
            department={center.department}
            selected={selected}
            onSelect={chooseParcel}
            onImport={() => setPanel(true)}
            canRetry={!!dataset.error || canRetry}
            onRetry={() => {
              if (dataset.error) void dataset.refetch();
              else void retry();
            }}
          />
          <footer>
            <span className="live-dot" />
            {status.dataset?.mode === 'published'
              ? status.dataset.source
              : 'DGFiP · DVF'}{' '}
            · {period}
            <button onClick={() => setPanel(true)}>
              {t('app.about')}
              <Info size={13} />
            </button>
          </footer>
        </section>
        <Suspense
          fallback={
            <section className="map-section" aria-label={t('app.loadingMap')} />
          }
        >
          <ParcelMap
            focus={focus}
            onViewport={updateViewport}
            data={data}
            selected={selected}
            onSelect={setSelected}
            onFocusParcel={chooseParcel}
            onCloseSelection={() => setSelected(null)}
            release={status.dataset?.release}
            hidden={tab === 'list'}
            year={year}
            loading={loading}
            zoomRequired={zoomRequired}
          />
        </Suspense>
        <div className="mobile-switch">
          <button onClick={() => setTab(tab === 'map' ? 'list' : 'map')}>
            {tab === 'map' ? t('app.showList') : t('app.showMap')}
          </button>
        </div>
      </main>
      {panel && (
        <DataPanel
          status={status}
          availableYears={availableYears}
          initialDepartment={center.department || '16'}
          initialYear={year || availableYears[0]}
          onClose={closePanel}
        />
      )}
    </div>
  );
}
