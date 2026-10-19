import { useTranslation } from 'react-i18next';
import { getLocale } from '../i18n';
import { translateMessage } from '../messages';
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { initial, collection } from '../mapData';
import type {
  Location,
  ParcelSummary,
  Viewport,
  ParcelsResponse,
} from '../types';

maplibregl.setWorkerUrl(workerUrl);
interface Options {
  focus: (Location & { zoom: number }) | null;
  onViewport: (viewport: Viewport) => void;
  parcels: ParcelSummary[];
  clusters: ParcelsResponse['clusters'];
  onPick: (parcels: ParcelSummary[]) => void;
}
export function useParcelMap({
  focus,
  onViewport,
  parcels,
  clusters,
  onPick,
}: Options) {
  const { t } = useTranslation();
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const parcelsRef = useRef<ParcelSummary[]>([]);
  const clustersRef = useRef<ParcelsResponse['clusters']>([]);
  const [mapError, setMapError] = useState('');
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
          glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
              paint: { 'raster-saturation': -0.7, 'raster-opacity': 0.8 },
            },
          ],
        },
      });
      map.current = m;
      m.on('error', (event) => {
        if ('sourceId' in event && event.sourceId === 'osm')
          setMapError(
            'The basemap is unavailable. The sales list is still accessible.',
          );
      });
      m.on('sourcedata', (event) => {
        if (event.sourceId === 'osm' && event.isSourceLoaded) setMapError('');
      });
      const loadedMap = m;
      const updateViewport = () => {
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
        m.addSource('sales', {
          type: 'geojson',
          data: collection(parcelsRef.current, clustersRef.current),
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 45,
          clusterProperties: { parcel_count: ['+', ['get', 'parcel_count']] },
        });
        m.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'sales',
          filter: [
            'any',
            ['has', 'point_count'],
            ['==', ['get', 'aggregated'], true],
          ],
          paint: {
            'circle-color': '#2e6955',
            'circle-radius': [
              'step',
              ['get', 'parcel_count'],
              18,
              100,
              24,
              1000,
              30,
            ],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2,
          },
        });
        m.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'sales',
          filter: [
            'any',
            ['has', 'point_count'],
            ['==', ['get', 'aggregated'], true],
          ],
          layout: {
            'text-field': [
              'number-format',
              ['get', 'parcel_count'],
              { locale: getLocale() },
            ],
            'text-font': ['Open Sans Regular'],
            'text-size': 12,
          },
          paint: { 'text-color': '#fff' },
        });
        m.on('click', 'clusters', async (e) => {
          const feature = e.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;
          try {
            const source = m.getSource<maplibregl.GeoJSONSource>('sales');
            if (!source) return;
            const zoom = feature.properties.aggregated
              ? Math.min(20, m.getZoom() + 2)
              : await source.getClusterExpansionZoom(
                  Number(feature.properties.cluster_id),
                );
            if (map.current !== m) return;
            const [longitude, latitude] = feature.geometry.coordinates;
            m.easeTo({ center: [longitude, latitude], zoom });
          } catch {
            // A source update can replace a cluster while its expansion is resolving.
          }
        });
        m.on(
          'mouseenter',
          'clusters',
          () => (m.getCanvas().style.cursor = 'pointer'),
        );
        m.on('mouseleave', 'clusters', () => (m.getCanvas().style.cursor = ''));
        m.addLayer({
          id: 'dots',
          type: 'circle',
          source: 'sales',
          filter: [
            'all',
            ['!', ['has', 'point_count']],
            ['!=', ['get', 'aggregated'], true],
          ],
          paint: {
            'circle-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              9,
              4,
              14,
              8,
              17,
              11,
            ],
            'circle-color': [
              'match',
              ['get', 'kind'],
              'Maison',
              '#2e6955',
              'Appartement',
              '#c7854e',
              '#7a8091',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
            'circle-opacity': 0.95,
          },
        });
        m.on('click', 'dots', (e) => {
          const ids = new Set(
            e.features?.map((feature) => feature.properties.id) ?? [],
          );
          const choices = parcelsRef.current.filter((parcel) =>
            ids.has(parcel.id),
          );
          if (choices.length) callbacks.current.onPick(choices);
        });
        m.on(
          'mouseenter',
          'dots',
          () => (m.getCanvas().style.cursor = 'pointer'),
        );
        m.on('mouseleave', 'dots', () => (m.getCanvas().style.cursor = ''));
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
    clustersRef.current = clusters;
    map.current
      ?.getSource<maplibregl.GeoJSONSource>('sales')
      ?.setData(collection(parcels, clusters));
  }, [parcels, clusters]);
  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    const update = () => {
      m.flyTo({
        center: [focus.lon, focus.lat],
        zoom: focus.zoom,
      });
    };
    if (m.isStyleLoaded()) update();
    else m.once('load', update);
    return () => {
      m.off('load', update);
    };
  }, [focus]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    m.getCanvas().setAttribute('aria-label', t('map.label'));
    const updateLabels = () => {
      if (m.getLayer('cluster-count'))
        m.setLayoutProperty('cluster-count', 'text-field', [
          'number-format',
          ['get', 'parcel_count'],
          { locale: getLocale() },
        ]);
    };
    if (m.isStyleLoaded()) updateLabels();
    else m.once('load', updateLabels);
    return () => {
      m.off('load', updateLabels);
    };
  }, [t]);
  return {
    mapNode,
    mapError: translateMessage(mapError),
    zoomIn: () => map.current?.zoomIn(),
    zoomOut: () => map.current?.zoomOut(),
  };
}
