import type { FeatureCollection, Point } from 'geojson';
import type { Location, ParcelSummary, ParcelsResponse } from './types';

export const initial: Location = {
  lon: 0.148008,
  lat: 45.644105,
  label: 'Angoulême',
  department: '16',
};

export function collection(
  parcels: ParcelSummary[],
  clusters: ParcelsResponse['clusters'] = [],
): FeatureCollection<Point> {
  if (clusters.length)
    return {
      type: 'FeatureCollection',
      features: clusters.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
        properties: { aggregated: true, parcel_count: c.count },
      })),
    };
  return {
    type: 'FeatureCollection',
    features: parcels.map((sale) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [sale.longitude, sale.latitude] },
      properties: { id: sale.id, kind: sale.kind, parcel_count: 1 },
    })),
  };
}
