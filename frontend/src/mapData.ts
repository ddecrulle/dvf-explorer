import type { FeatureCollection, Point } from 'geojson';
import type { Location, Sale, SalesResponse } from './types';

export const initial: Location = {
  lon: 0.148008,
  lat: 45.644105,
  label: 'Angoulême',
  department: '16',
};

export function collection(
  sales: Sale[],
  clusters: SalesResponse['clusters'] = [],
): FeatureCollection<Point> {
  if (clusters.length)
    return {
      type: 'FeatureCollection',
      features: clusters.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
        properties: { aggregated: true, sale_count: c.count },
      })),
    };
  return {
    type: 'FeatureCollection',
    features: sales.map((sale) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [sale.longitude, sale.latitude] },
      properties: { id: sale.id, kind: sale.kind, sale_count: 1 },
    })),
  };
}
