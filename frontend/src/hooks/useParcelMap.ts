import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  parcelGeometryOptions,
  searchGeometryOptions,
} from '../queries/geometry';
import { updateSearchFocus, updateSearchOutline } from '../searchMap';
import { translateMessage } from '../messages';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { initial, parcelReference } from '../mapData';
import { basemapStyle, setBasemap, type Basemap } from '../basemap';
import { addCadastre, updateCadastre, PARCEL_ZOOM } from '../cadastralMap';
import {
  addGeographicLayers,
  appendArea,
  areaFromFeature,
  geographicLayers,
  mapLevel,
  overview,
  type MapArea,
  type MapLevel,
} from '../geographicMap';
import type {
  MapFocus,
  ParcelSummary,
  ParcelSelection,
  Viewport,
} from '../types';

maplibregl.setWorkerUrl(workerUrl);
interface Options {
  focus: MapFocus | null;
  onViewport: (viewport: Viewport) => void;
  parcels: ParcelSummary[];
  selectedId?: string;
  onPick: (parcel: ParcelSelection) => void;
  onNavigate: () => void;
}
export function useParcelMap({
  focus,
  onViewport,
  parcels,
  selectedId,
  onPick,
  onNavigate,
}: Options) {
  const { t } = useTranslation();
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const activeSearch = useRef<MapFocus | null>(null);
  const geometry = useQuery(
    parcelGeometryOptions(
      focus?.parcel === selectedId ? focus?.parcel : undefined,
    ),
  );
  const searchGeometry = useQuery(searchGeometryOptions(focus?.searchArea));
  const parcelsRef = useRef<ParcelSummary[]>([]);
  const [mapError, setMapError] = useState('');
  const [basemap, setBasemapMode] = useState<Basemap>('plan');
  const basemapRef = useRef<Basemap>('plan');
  const [basemapErrors, setBasemapErrors] = useState({
    plan: false,
    satellite: false,
  });
  const [cadastreError, setCadastreError] = useState(false);
  const [parcelZoom, setParcelZoom] = useState(false);
  const [level, setLevel] = useState<MapLevel>('department');
  const [trail, setTrail] = useState<MapArea[]>([]);
  const [hoveredArea, setHoveredArea] = useState('');
  const [geographyError, setGeographyError] = useState(false);
  const selectedRef = useRef(selectedId);
  const callbacks = useRef({ onViewport, onPick, onNavigate });
  useEffect(() => {
    callbacks.current = { onViewport, onPick, onNavigate };
  }, [onViewport, onPick, onNavigate]);
  useEffect(() => {
    let m: maplibregl.Map | undefined;
    let observer: ResizeObserver | undefined;
    if (!mapNode.current) return;
    try {
      m = new maplibregl.Map({
        container: mapNode.current,
        center: [initial.lon, initial.lat],
        zoom: overview.zoom,
        bounds: overview.bounds,
        fitBoundsOptions: { padding: 35 },
        locale: { 'AttributionControl.ToggleAttribution': 'Attribution' },
        style: basemapStyle,
      });
      map.current = m;
      m.on('error', (event) => {
        if ('sourceId' in event && event.sourceId === 'administrative')
          setGeographyError(true);
        if ('sourceId' in event && event.sourceId === 'cadastre')
          setCadastreError(true);
        if (
          'sourceId' in event &&
          (event.sourceId === 'osm' || event.sourceId === 'satellite')
        ) {
          const mode = event.sourceId === 'osm' ? 'plan' : 'satellite';
          setBasemapErrors((previous) => ({ ...previous, [mode]: true }));
        }
      });
      m.on('sourcedata', (event) => {
        if (event.sourceId === 'administrative' && event.isSourceLoaded)
          setGeographyError(false);
        if (event.sourceId === 'cadastre' && event.isSourceLoaded)
          setCadastreError(false);
        if (
          (event.sourceId === 'osm' || event.sourceId === 'satellite') &&
          event.isSourceLoaded
        ) {
          const mode = event.sourceId === 'osm' ? 'plan' : 'satellite';
          setBasemapErrors((previous) =>
            previous[mode] ? { ...previous, [mode]: false } : previous,
          );
        }
      });
      const loadedMap = m;
      const updateViewport = () => {
        setParcelZoom(loadedMap.getZoom() >= PARCEL_ZOOM);
        setLevel(mapLevel(loadedMap.getZoom()));
        setHoveredArea('');
        loadedMap.getCanvas().style.cursor = '';
        const b = loadedMap.getBounds();
        const offset =
          360 * Math.floor(((b.getWest() + b.getEast()) / 2 + 180) / 360);
        if (
          !loadedMap.getContainer().clientWidth ||
          !loadedMap.getContainer().clientHeight
        )
          return;
        callbacks.current.onViewport({
          zoom: Math.floor(loadedMap.getZoom()),
          west: b.getWest() - offset,
          south: Math.max(-85, b.getSouth()),
          east: b.getEast() - offset,
          north: Math.min(85, b.getNorth()),
        });
      };
      m.on('moveend', updateViewport);
      observer = new ResizeObserver(() => {
        if (
          !loadedMap.getContainer().clientWidth ||
          !loadedMap.getContainer().clientHeight
        )
          return;
        loadedMap.resize();
        updateViewport();
      });
      observer.observe(mapNode.current);
      updateViewport();
      m.on('load', () => {
        const m = loadedMap;
        setBasemap(m, basemapRef.current);
        addCadastre(
          m,
          parcelsRef.current.map((p) => p.id),
          selectedRef.current,
        );
        addGeographicLayers(m);
        const areaLayers = geographicLayers.map(
          (layer) => `area-${layer.level}`,
        );
        let hovered: {
          source: string;
          sourceLayer: string;
          id: string;
        } | null = null;
        const clearHover = () => {
          if (hovered) m.setFeatureState(hovered, { hover: false });
          hovered = null;
          setHoveredArea('');
        };
        m.on('mousemove', (e) => {
          const feature = m.queryRenderedFeatures(e.point, {
            layers: areaLayers,
          })[0];
          const layer = geographicLayers.find(
            (item) => feature?.layer.id === `area-${item.level}`,
          );
          if (!feature || !layer) {
            clearHover();
            return;
          }
          const id = String(feature.properties[layer.key] ?? '');
          if (hovered?.id === id && hovered.sourceLayer === layer.sourceLayer)
            return;
          clearHover();
          if (id) {
            hovered = {
              source: layer.source,
              sourceLayer: layer.sourceLayer,
              id,
            };
            m.setFeatureState(hovered, { hover: true });
            setHoveredArea(
              String(feature.properties.nom ?? feature.properties.code ?? id),
            );
          }
        });
        m.on('movestart', clearHover);
        m.on('dragstart', () => {
          activeSearch.current = null;
        });
        m.getCanvas().addEventListener('mouseleave', clearHover);
        for (const id of areaLayers) {
          m.on(
            'mouseenter',
            id,
            () => (m.getCanvas().style.cursor = 'pointer'),
          );
          m.on('mouseleave', id, () => (m.getCanvas().style.cursor = ''));
        }
        m.on('click', (e) => {
          if (m.getZoom() < PARCEL_ZOOM) {
            const feature = m.queryRenderedFeatures(e.point, {
              layers: areaLayers,
            })[0];
            const area = feature && areaFromFeature(m, feature);
            if (!area) return;
            activeSearch.current = null;
            updateSearchOutline(m);
            updateSearchFocus(m, null);
            clearHover();
            callbacks.current.onNavigate();
            setTrail((previous) => appendArea(previous, area));
            const camera = m.cameraForBounds(area.bounds, { padding: 65 });
            if (camera) m.easeTo({ ...camera, zoom: area.zoom, duration: 700 });
            return;
          }
          const features = m.queryRenderedFeatures(e.point, {
            layers: ['cadastre-fill'],
          });
          const cadastral = features.find(
            (f) => f.layer.id === 'cadastre-fill',
          );
          const id = parcelReference(cadastral?.properties.id);
          if (id) {
            callbacks.current.onPick({
              id,
              city: '',
              longitude: e.lngLat.lng,
              latitude: e.lngLat.lat,
            });
            return;
          }
        });
        m.on(
          'mouseenter',
          'cadastre-fill',
          () => (m.getCanvas().style.cursor = 'pointer'),
        );
        m.on(
          'mouseleave',
          'cadastre-fill',
          () => (m.getCanvas().style.cursor = ''),
        );
        updateViewport();
      });
    } catch {
      setMapError('The map requires WebGL. Please use the sales list.');
    }
    return () => {
      observer?.disconnect();
      m?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    parcelsRef.current = parcels;
  }, [parcels]);
  useEffect(() => {
    selectedRef.current = selectedId;
    updateCadastre(
      map.current,
      parcels.map((p) => p.id),
      selectedId,
    );
  }, [parcels, selectedId]);
  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    activeSearch.current = focus;
    const update = () => {
      updateSearchOutline(m);
      updateSearchFocus(m, focus);
      m.flyTo({
        center: [focus.lon, focus.lat],
        zoom: focus.zoom,
        duration: 900,
        padding: focus.search
          ? { top: 100, bottom: 100, left: 35, right: 35 }
          : 0,
      });
    };
    // isStyleLoaded() also becomes false while viewport tiles are loading;
    // the one-time map load event will not fire again in that case.
    if (m.getSource('cadastre')) update();
    else m.once('load', update);
    return () => {
      m.off('load', update);
    };
  }, [focus]);
  useEffect(() => {
    const m = map.current;
    const result = searchGeometry.data;
    if (
      !m ||
      !focus?.searchArea ||
      !result?.bounds ||
      activeSearch.current !== focus
    )
      return;
    const update = () => {
      updateSearchOutline(m, result.data);
      const camera = m.cameraForBounds(result.bounds!, {
        padding: { top: 120, bottom: 110, left: 55, right: 55 },
      });
      if (camera)
        m.easeTo({
          ...camera,
          zoom: Math.min(
            focus.searchArea?.kind === 'street' ? 17 : 16,
            camera.zoom ?? focus.zoom,
          ),
          padding: 0,
          duration: 700,
        });
    };
    if (m.getSource('cadastre')) update();
    else m.once('load', update);
    return () => {
      m.off('load', update);
    };
  }, [focus, searchGeometry.data]);
  useEffect(() => {
    const m = map.current;
    const bounds = geometry.data;
    if (!m || !bounds || !focus?.parcel || focus.parcel !== selectedId) return;
    const update = () => {
      const container = mapNode.current;
      if (!container) return;
      const width = container.clientWidth;
      const detail =
        container.parentElement?.querySelector<HTMLElement>('.parcel-detail');
      const right = detail
        ? Math.min(width * 0.55, detail.offsetWidth + 45)
        : 40;
      const camera = m.cameraForBounds(bounds, {
        padding: { top: 110, bottom: 100, left: 35, right },
      });
      if (camera)
        m.easeTo({
          ...camera,
          zoom: Math.max(PARCEL_ZOOM + 0.05, Math.min(19, camera.zoom ?? 17)),
          duration: 700,
        });
    };
    if (m.getSource('cadastre')) update();
    else m.once('load', update);
    return () => {
      m.off('load', update);
    };
  }, [geometry.data, focus, selectedId]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.getCanvas().setAttribute('aria-label', t('map.label'));
  }, [t]);
  return {
    mapNode,
    mapError:
      translateMessage(mapError) ||
      (basemapErrors[basemap] ? t('map.basemapUnavailable') : ''),
    basemap,
    changeBasemap: (mode: Basemap) => {
      basemapRef.current = mode;
      setBasemapMode(mode);
      const m = map.current;
      if (m?.getLayer('base')) setBasemap(m, mode);
    },
    cadastreError: cadastreError && parcelZoom,
    parcelZoom,
    level,
    trail,
    hoveredArea,
    geographyError: geographyError && level !== 'parcel',
    navigateToArea: (index: number) => {
      const m = map.current;
      if (!m) return;
      activeSearch.current = null;
      updateSearchOutline(m);
      updateSearchFocus(m, null);
      callbacks.current.onNavigate();
      setTrail((previous) => previous.slice(0, index + 1));
      const area = trail[index];
      if (!area) {
        m.fitBounds(overview.bounds, { padding: 35, duration: 700 });
        return;
      }
      const camera = m.cameraForBounds(area.bounds, { padding: 65 });
      if (camera) m.easeTo({ ...camera, zoom: area.zoom, duration: 700 });
    },
    zoomIn: () => map.current?.zoomIn(),
    zoomOut: () => map.current?.zoomOut(),
  };
}
