import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { initial, circle, collection } from '../mapData';
import type { Location, Sale } from '../types';

maplibregl.setWorkerUrl(workerUrl);
interface Options {
  center: Location;
  radius: number;
  sales: Sale[];
  tab: string;
  setSelected: (sale: Sale) => void;
}
export function useSalesMap({
  center,
  radius,
  sales,
  tab,
  setSelected,
}: Options) {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const salesRef = useRef<Sale[]>([]);
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
      m.on('load', () => {
        const m = loadedMap;
        m.addSource('radius', { type: 'geojson', data: circle(initial, 3) });
        m.addLayer({
          id: 'area',
          type: 'fill',
          source: 'radius',
          paint: { 'fill-color': '#477664', 'fill-opacity': 0.06 },
        });
        m.addLayer({
          id: 'outline',
          type: 'line',
          source: 'radius',
          paint: {
            'line-color': '#477664',
            'line-dasharray': [3, 3],
            'line-width': 1.3,
          },
        });
        m.addSource('sales', {
          type: 'geojson',
          data: collection(salesRef.current),
        });
        m.addLayer({
          id: 'dots',
          type: 'circle',
          source: 'sales',
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
      });
    } catch {
      setMapError('The map requires WebGL. Please use the sales list.');
    }
    return () => {
      m?.remove();
      map.current = null;
    };
  }, [setSelected]);
  useEffect(() => {
    salesRef.current = sales;
    map.current
      ?.getSource<maplibregl.GeoJSONSource>('sales')
      ?.setData(collection(sales));
  }, [sales]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const update = () => {
      m.getSource<maplibregl.GeoJSONSource>('radius')?.setData(
        circle(center, radius),
      );
      m.flyTo({
        center: [center.lon, center.lat],
        zoom: radius <= 1 ? 14 : radius <= 3 ? 12.4 : radius <= 10 ? 11 : 9.8,
      });
    };
    if (m.isStyleLoaded()) update();
    else m.once('load', update);
    return () => {
      m.off('load', update);
    };
  }, [center, radius]);
  useEffect(() => {
    const t = setTimeout(() => map.current?.resize(), 50);
    return () => clearTimeout(t);
  }, [tab]);
  return { mapNode, map, mapError };
}
