import { useParcelAddresses } from './queries/addresses';
import { translateMessage } from './messages';
import { LanguageSelector } from './components/LanguageSelector';
import { useTranslation } from 'react-i18next';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useExplorerRoute } from './routing/useExplorerRoute';
import { useMapRestoration } from './routing/useMapRestoration';
import type { ExplorerRoute } from './routing/search';
import { Database, Info, Layers, MapPin } from 'lucide-react';
import { AddressSearch } from './components/AddressSearch';
import { MutationFilters } from './components/MutationFilters';
import { ParcelResults } from './components/ParcelResults';
import { DataPanel } from './components/DataPanel';
import { useDataset } from './queries/dataset';
import {
  emptyStatus,
  emptyParcels,
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
  const { route, navigate } = useExplorerRoute();
  const restoredView = useMapRestoration();
  const center = route.center;
  const filters = route.filters;
  const selected = route.parcel;
  const viewport = route.view ?? {
    zoom: overview.zoom,
    west: initial.lon - 0.04,
    east: initial.lon + 0.04,
    south: initial.lat - 0.025,
    north: initial.lat + 0.025,
  };
  const setFilters = (value: typeof filters) => navigate({ filters: value });
  const setSelected = useCallback(
    (value: ParcelSelection | null) =>
      navigate({ parcel: value, mutation: null, offset: 0 }),
    [navigate],
  );
  const [focus, setFocus] = useState<MapFocus | null>(() =>
    savedMapFocus(route),
  );
  useEffect(() => {
    if (restoredView.revision > 0) setFocus(savedMapFocus(restoredView.route));
  }, [restoredView]);
  const [panel, setPanel] = useState(false);
  const tab = route.tab;
  const setTab = (value: 'list' | 'map') => navigate({ tab: value }, true);
  const closePanel = useCallback(() => setPanel(false), []);
  const updateViewport = useCallback(
    (view: Viewport) => {
      const normalized = {
        ...normalizeViewport(view),
        zoom: Number(view.zoom.toFixed(2)),
      };
      const current = route.view;
      if (!current || !sameViewport(current, normalized))
        navigate({ view: normalized }, true);
    },
    [navigate, route.view],
  );
  const dataset = useDataset(route.release);
  useEffect(() => {
    const release = dataset.data?.dataset?.release;
    if (release && !route.release) navigate({ release }, true);
  }, [dataset.data?.dataset?.release, route.release, navigate]);
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

    if (feature.properties.type === 'parcel') {
      navigate({
        center: location,
        trail: [],
        area: undefined,
        search: false,
        parcel: {
          id: feature.properties.id,
          city: feature.properties.city ?? feature.properties.citycode ?? '',
          longitude: location.lon,
          latitude: location.lat,
        },
        mutation: null,
        offset: 0,
        tab: 'map',
        query: feature.properties.label,
      });
      setFocus({ ...location, parcel: feature.properties.id, zoom: 18 });
      return;
    }
    const zoom =
      feature.properties.type === 'housenumber'
        ? 18
        : feature.properties.type === 'municipality'
          ? 13.1
          : 16.5;
    const { type, citycode, name } = feature.properties;
    const nextFocus: MapFocus = {
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
    };
    navigate({
      center: location,
      trail: [],
      parcel: null,
      mutation: null,
      offset: 0,
      tab: 'map',
      query: feature.properties.label,
      area: nextFocus.searchArea,
      search: true,
    });
    setFocus(nextFocus);
  }
  const chooseParcel = useCallback(
    (sale: ParcelSelection) => {
      navigate({
        parcel: sale,
        mutation: null,
        offset: 0,
        tab: 'map',
        area: undefined,
        search: false,
      });
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
    },
    [navigate],
  );
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
            data={dataset.data ? data : emptyParcels}
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
            restoredView={restoredView}
            onViewport={updateViewport}
            data={dataset.data ? data : emptyParcels}
            selected={selected}
            onSelect={setSelected}
            onFocusParcel={chooseParcel}
            onCloseSelection={() =>
              navigate({ parcel: null, mutation: null, offset: 0 })
            }
            release={route.release ?? status.dataset?.release}
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

function savedMapFocus(route: ExplorerRoute): MapFocus | null {
  if (route.parcel)
    return {
      ...route.center,
      lon: route.parcel.longitude,
      lat: route.parcel.latitude,
      parcel: route.parcel.id,
      zoom: 18,
      restore: !!route.view,
    };
  if (route.search || route.area)
    return {
      ...route.center,
      zoom: 16,
      search: true,
      searchArea: route.area,
      restore: !!route.view,
    };
  return null;
}
