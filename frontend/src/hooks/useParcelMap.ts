import { useTranslation } from 'react-i18next';
import { translateMessage } from '../messages';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { initial, parcelReference } from '../mapData';
import { addCadastre, updateCadastre, PARCEL_ZOOM } from '../cadastralMap';
import type {
  Location,
  ParcelSummary,
  ParcelSelection,
  Viewport,
} from '../types';

maplibregl.setWorkerUrl(workerUrl);
interface Options {
  focus: (Location & { zoom: number }) | null;
  onViewport: (viewport: Viewport) => void;
  parcels: ParcelSummary[];
  selectedId?: string;
  onPick: (parcel: ParcelSelection) => void;
}
export function useParcelMap({
  focus,
  onViewport,
  parcels,
  selectedId,
  onPick,
}: Options) {
  const { t } = useTranslation();
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const parcelsRef = useRef<ParcelSummary[]>([]);
  const [mapError, setMapError] = useState('');
  const [cadastreError, setCadastreError] = useState(false);
  const [parcelZoom, setParcelZoom] = useState(false);
  const selectedRef = useRef(selectedId);
  const callbacks = useRef({ onViewport, onPick });
  useEffect(() => {
    callbacks.current = { onViewport, onPick };
  }, [onViewport, onPick]);
  useEffect(() => {
    let m: maplibregl.Map | undefined;
    let observer: ResizeObserver | undefined;
    if (!mapNode.current) return;
    try {
      m = new maplibregl.Map({
        container: mapNode.current,
        center: [initial.lon, initial.lat],
        zoom: 13,
        locale: { 'AttributionControl.ToggleAttribution': 'Attribution' },
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors',
              maxzoom: 19,
            },
          },
          layers: [
            {
              id: 'base',
              type: 'raster',
              source: 'osm',
              paint: {
                'raster-saturation': -0.7,
                'raster-opacity': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  14,
                  0.8,
                  16,
                  0.45,
                ],
              },
            },
          ],
        },
      });
      map.current = m;
      m.on('error', (event) => {
        if ('sourceId' in event && event.sourceId === 'cadastre')
          setCadastreError(true);
        if ('sourceId' in event && event.sourceId === 'osm')
          setMapError(
            'The basemap is unavailable. The sales list is still accessible.',
          );
      });
      m.on('sourcedata', (event) => {
        if (event.sourceId === 'cadastre' && event.isSourceLoaded)
          setCadastreError(false);
        if (event.sourceId === 'osm' && event.isSourceLoaded) setMapError('');
      });
      const loadedMap = m;
      const updateViewport = () => {
        setParcelZoom(loadedMap.getZoom() >= PARCEL_ZOOM);
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
        addCadastre(
          m,
          parcelsRef.current.map((p) => p.id),
          selectedRef.current,
        );
        m.on('click', (e) => {
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
    const update = () => {
      m.flyTo({
        center: [focus.lon, focus.lat],
        zoom: focus.zoom,
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
    if (!m) return;
    m.getCanvas().setAttribute('aria-label', t('map.label'));
  }, [t]);
  return {
    mapNode,
    mapError: translateMessage(mapError),
    cadastreError: cadastreError && parcelZoom,
    parcelZoom,
    zoomIn: () => map.current?.zoomIn(),
    zoomOut: () => map.current?.zoomOut(),
  };
}
