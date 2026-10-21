import type { Geometry } from 'geojson';
import type { Map, MapGeoJSONFeature } from 'maplibre-gl';
import { PARCEL_ZOOM } from './cadastralMap';

export type AreaLevel = 'department' | 'commune';
export type MapLevel = AreaLevel | 'parcel';
export interface MapArea {
  level: AreaLevel;
  code: string;
  label: string;
  parent: string;
  bounds: [[number, number], [number, number]];
  zoom: number;
}
export const overview = {
  center: [2.35, 46.6] as [number, number],
  zoom: 5.5,
  bounds: [
    [-5.2, 41.3],
    [9.7, 51.1],
  ] as MapArea['bounds'],
};
export const geographicLayers = [
  {
    level: 'department',
    source: 'administrative',
    sourceLayer: 'departements',
    key: 'code',
    min: 0,
    max: 8.5,
    next: 8.5,
    ceiling: 11,
  },
  {
    level: 'commune',
    source: 'administrative',
    sourceLayer: 'communes',
    key: 'code',
    min: 8.5,
    max: PARCEL_ZOOM,
    next: PARCEL_ZOOM,
    ceiling: 14,
  },
] as const;

export function mapLevel(zoom: number): MapLevel {
  return geographicLayers.find((layer) => zoom < layer.max)?.level ?? 'parcel';
}

export function geometryBounds(
  geometries: Geometry[],
): MapArea['bounds'] | null {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  const visit = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (
      typeof coordinates[0] === 'number' &&
      typeof coordinates[1] === 'number'
    ) {
      const [lon, lat] = coordinates;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    } else coordinates.forEach(visit);
  };
  for (const geometry of geometries)
    if ('coordinates' in geometry) visit(geometry.coordinates);
  return Number.isFinite(west)
    ? [
        [west, south],
        [east, north],
      ]
    : null;
}

export function areaFromFeature(
  map: Map,
  feature: MapGeoJSONFeature,
): MapArea | null {
  const layer = geographicLayers.find(
    (item) => feature.layer.id === `area-${item.level}`,
  );
  if (!layer) return null;
  const code = String(feature.properties[layer.key] ?? '');
  if (!code) return null;
  // A polygon can straddle tile boundaries: include every loaded fragment.
  const fragments = map.querySourceFeatures(layer.source, {
    sourceLayer: layer.sourceLayer,
    filter: ['==', ['get', layer.key], code],
  });
  const bounds = geometryBounds([
    feature.geometry,
    ...fragments.map((item) => item.geometry),
  ]);
  if (!bounds) return null;
  const camera = map.cameraForBounds(bounds, { padding: 65 });
  const zoom = Math.max(
    layer.next + 0.05,
    Math.min(layer.ceiling, camera?.zoom ?? layer.next),
  );
  return {
    level: layer.level,
    code,
    bounds,
    zoom,
    label: String(feature.properties.nom ?? feature.properties.code ?? code),
    parent: String(
      feature.properties.departement ?? feature.properties.commune ?? '',
    ),
  };
}

export function addGeographicLayers(map: Map) {
  map.addSource('administrative', {
    type: 'vector',
    url: 'https://openmaptiles.data.gouv.fr/data/decoupage-administratif.json',
    promoteId: { departements: 'code', communes: 'code' },
  });
  for (const layer of geographicLayers) {
    const shared = {
      source: layer.source,
      'source-layer': layer.sourceLayer,
      minzoom: layer.min,
      maxzoom: layer.max,
    };
    map.addLayer({
      ...shared,
      id: `area-${layer.level}`,
      type: 'fill',
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#d28c38',
          '#2e6955',
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.28,
          0.08,
        ],
      },
    });
    map.addLayer({
      ...shared,
      id: `area-${layer.level}-line`,
      type: 'line',
      paint: {
        'line-color': '#2e6955',
        'line-width': layer.level === 'department' ? 1.5 : 1,
        'line-opacity': 0.7,
      },
    });
    map.addLayer({
      ...shared,
      id: `area-${layer.level}-label`,
      type: 'symbol',
      layout: {
        'text-field': ['get', 'nom'],
        'text-font': ['Open Sans Regular'],
        'text-size': layer.level === 'department' ? 12 : 11,
      },
      paint: {
        'text-color': '#214a3a',
        'text-halo-color': '#fff',
        'text-halo-width': 1.5,
      },
    });
  }
}

export function appendArea(trail: MapArea[], area: MapArea): MapArea[] {
  if (area.level === 'department') return [area];
  return [
    ...trail.filter(
      (item) => item.level === 'department' && item.code === area.parent,
    ),
    area,
  ];
}
