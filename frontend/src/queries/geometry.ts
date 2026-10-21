import { queryOptions } from '@tanstack/react-query';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { MapFocus } from '../types';
import { api } from '../api';
import { parcelReference } from '../mapData';
import { geometryBounds } from '../geographicMap';

export function searchGeometryOptions(area?: MapFocus['searchArea']) {
  return queryOptions({
    queryKey: ['search-geometry', area],
    enabled: !!area,
    queryFn: async ({ signal }) => {
      if (!area) return null;
      const data = await api<FeatureCollection>(
        '/api/search/geometry?' +
          new URLSearchParams({
            kind: area.kind,
            citycode: area.citycode,
            street_id: area.kind === 'street' ? (area.street_id ?? '') : '',
          }),
        { signal },
      );
      return {
        data,
        bounds: geometryBounds(data.features.map((f) => f.geometry)),
      };
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });
}

export function parcelGeometryOptions(parcel?: string) {
  return queryOptions({
    queryKey: ['parcel-geometry', parcel],
    enabled: !!parcel && parcelReference(parcel) === parcel,
    queryFn: async ({ signal }) => {
      if (!parcel) return null;
      const params = new URLSearchParams({
        code_insee: parcel.slice(0, 5),
        prefixe: parcel.slice(5, 8),
        section: parcel.slice(8, 10),
        numero: parcel.slice(10),
      });
      const data = await api<FeatureCollection<Polygon | MultiPolygon>>(
        'https://apicarto.ign.fr/api/cadastre/parcelle?' + params,
        { signal },
      );
      return geometryBounds(
        data.features
          .filter(
            (feature) =>
              feature.properties?.idu === parcel &&
              ['Polygon', 'MultiPolygon'].includes(feature.geometry.type),
          )
          .map((feature) => feature.geometry),
      );
    },
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
