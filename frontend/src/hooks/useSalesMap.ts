import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { initial, collection } from '../mapData';
import type { Location, Sale, Viewport, SalesResponse } from '../types';

maplibregl.setWorkerUrl(workerUrl);
interface Options {
  center: Location;
  onViewport: (viewport: Viewport) => void;
  sales: Sale[];
  clusters: SalesResponse['clusters'];
  tab: string;
  setSelected: (sale: Sale) => void;
}
export function useSalesMap({
  center,
  onViewport,
  sales,
  clusters,
  tab,
  setSelected,
}: Options) {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const salesRef = useRef<Sale[]>([]);
  const clustersRef = useRef<SalesResponse['clusters']>([]);
  const [mapError, setMapError] = useState('');
  useEffect(() => {
    let m: maplibregl.Map | undefined;
    if (!mapNode.current) return;
    try {
      m = new maplibregl.Map({
        container: mapNode.current,
        center: [initial.lon, initial.lat],
        zoom: 12.4,
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
      m.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        'bottom-right',
      );
      m.on('error', () =>
        setMapError(
          'The basemap is unavailable. The sales list is still accessible.',
        ),
      );
      const loadedMap = m;
      const updateViewport = () => {
        const b = loadedMap.getBounds();
        const offset =
          360 * Math.floor(((b.getWest() + b.getEast()) / 2 + 180) / 360);
        onViewport({
          zoom: Math.floor(loadedMap.getZoom()),
          west: b.getWest() - offset,
          south: Math.max(-85, b.getSouth()),
          east: b.getEast() - offset,
          north: Math.min(85, b.getNorth()),
        });
      };
      m.on('moveend', updateViewport);
      m.on('load', () => {
        const m = loadedMap;
        m.addSource('sales', {
          type: 'geojson',
          data: collection(salesRef.current, clustersRef.current),
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 45,
          clusterProperties: { sale_count: ['+', ['get', 'sale_count']] },
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
              ['get', 'sale_count'],
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
            'text-field': ['to-string', ['get', 'sale_count']],
            'text-font': ['Open Sans Regular'],
            'text-size': 12,
          },
          paint: { 'text-color': '#fff' },
        });
        m.on('click', 'clusters', async (e) => {
          const feature = e.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;
          const zoom = feature.properties.aggregated
            ? Math.min(20, m.getZoom() + 2)
            : await m
                .getSource<maplibregl.GeoJSONSource>('sales')!
                .getClusterExpansionZoom(Number(feature.properties.cluster_id));
          m.easeTo({
            center: feature.geometry.coordinates as [number, number],
            zoom,
          });
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
          const found = salesRef.current.find(
            (s) => s.id === e.features?.[0]?.properties.id,
          );
          if (found) setSelected(found);
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
      m?.remove();
      map.current = null;
    };
  }, [setSelected, onViewport]);
  useEffect(() => {
    salesRef.current = sales;
    clustersRef.current = clusters;
    map.current
      ?.getSource<maplibregl.GeoJSONSource>('sales')
      ?.setData(collection(sales, clusters));
  }, [sales, clusters]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const update = () => {
      m.flyTo({
        center: [center.lon, center.lat],
        zoom: 13,
      });
    };
    if (m.isStyleLoaded()) update();
    else m.once('load', update);
    return () => {
      m.off('load', update);
    };
  }, [center]);
  useEffect(() => {
    const t = setTimeout(() => map.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [tab]);
  return { mapNode, map, mapError };
}
