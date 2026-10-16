import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type { Location, Sale } from './types';

export const initial: Location = {
  lon: 0.148008,
  lat: 45.644105,
  label: 'Angoulême',
  department: '16',
};

export function collection(sales: Sale[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: sales.map((sale) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [sale.longitude, sale.latitude] },
      properties: { id: sale.id, kind: sale.kind },
    })),
  };
}

/** Approximate visual radius; the API uses great-circle distances for filtering. */
export function circle(center: Location, radius: number): Feature<Polygon> {
  const coordinates: number[][] = [];
  for (let index = 0; index <= 96; index++) {
    const angle = (index / 96) * Math.PI * 2;
    coordinates.push([
      center.lon +
        (radius / 111.32 / Math.cos((center.lat * Math.PI) / 180)) *
          Math.cos(angle),
      center.lat + (radius / 111.32) * Math.sin(angle),
    ]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}
