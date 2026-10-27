import type { GeoJSONSource, Map } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import type { MapFocus } from './types';

export function updateSearchOutline(
  map: Map,
  data: FeatureCollection = { type: 'FeatureCollection', features: [] },
) {
  const source = map.getSource('search-outline') as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource('search-outline', {
    type: 'geojson',
    data,
    attribution:
      '<a href="https://geoservices.ign.fr/bdtopo">© IGN · BD TOPO</a> · <a href="https://geo.api.gouv.fr/">API Découpage administratif</a>',
  });
  map.addLayer({
    id: 'search-outline-fill',
    source: 'search-outline',
    type: 'fill',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#0877ff', 'fill-opacity': 0.05 },
  });
  map.addLayer({
    id: 'search-outline-halo',
    source: 'search-outline',
    type: 'line',
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'search-outline-line',
    source: 'search-outline',
    type: 'line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#0877ff', 'line-width': 3.5 },
  });
}

export function updateSearchFocus(map: Map, focus: MapFocus | null) {
  const data: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: focus?.search
      ? [
          {
            type: 'Feature',
            properties: { label: focus.label },
            geometry: { type: 'Point', coordinates: [focus.lon, focus.lat] },
          },
        ]
      : [],
  };
  const source = map.getSource('search-focus') as GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource('search-focus', { type: 'geojson', data });
  map.addLayer({
    id: 'search-focus-halo',
    source: 'search-focus',
    type: 'circle',
    paint: {
      'circle-radius': 18,
      'circle-color': '#0877ff',
      'circle-opacity': 0.2,
    },
  });
  map.addLayer({
    id: 'search-focus-point',
    source: 'search-focus',
    type: 'circle',
    paint: {
      'circle-radius': 7,
      'circle-color': '#0877ff',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'search-focus-label',
    source: 'search-focus',
    type: 'symbol',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Regular'],
      'text-size': 14,
      'text-anchor': 'top',
      'text-offset': [0, 1.4],
      'text-max-width': 22,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#1b2e4b',
      'text-halo-color': '#ffffff',
      'text-halo-width': 3,
    },
  });
}
