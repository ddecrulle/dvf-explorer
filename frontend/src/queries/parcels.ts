import { useMemo } from 'react';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import { api } from '../api';
import { PARCEL_ZOOM } from '../cadastralMap';
import type { ParcelsResponse, Status, Viewport } from '../types';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

export interface MutationFilters {
  year: number;
  kind: string;
  min: string;
  max: string;
  start: string;
  end: string;
}
export const defaultFilters: MutationFilters = {
  year: 0,
  kind: '',
  min: '',
  max: '',
  start: '',
  end: '',
};
export const emptyParcels: ParcelsResponse = {
  parcels: [],
  total: 0,
  mutations: 0,
};
export const emptyStatus: Status = { imports: [], job: { state: 'idle' } };

export function normalizeViewport(view: Viewport): Viewport {
  const round = (n: number) => Number(n.toFixed(5));
  return {
    zoom: Math.floor(view.zoom),
    west: round(view.west),
    east: round(view.east),
    south: round(view.south),
    north: round(view.north),
  };
}
export function sameViewport(a: Viewport, b: Viewport) {
  return (
    a.zoom === b.zoom &&
    a.west === b.west &&
    a.east === b.east &&
    a.south === b.south &&
    a.north === b.north
  );
}
export function requiresZoom(view: Viewport) {
  return (
    view.zoom < PARCEL_ZOOM ||
    view.east <= view.west ||
    view.north <= view.south ||
    view.east - view.west > 1.5 ||
    view.north - view.south > 1
  );
}
export function filterError(filters: MutationFilters) {
  const min = Number(filters.min || 0),
    max = Number(filters.max || 100000000);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0)
    return 'Prices must be positive numbers.';
  if (min > max) return 'The minimum price must not exceed the maximum.';
  if (filters.start && filters.end && filters.start > filters.end)
    return 'The start date must precede the end date.';
  return '';
}
export function parcelsOptions(
  view: Viewport,
  filters: MutationFilters,
  release?: string,
) {
  const params = new URLSearchParams({
    ...Object.fromEntries(
      Object.entries(view).map(([key, value]) => [key, String(value)]),
    ),
    year: String(filters.year),
    kind: filters.kind,
    price_min: String(Number(filters.min || 0)),
    price_max: String(Number(filters.max || 100000000)),
  });
  if (release) params.set('release', release);
  if (filters.start) params.set('start', filters.start);
  if (filters.end) params.set('end', filters.end);
  return queryOptions({
    queryKey: ['parcels', params.toString()],
    queryFn: ({ signal }) =>
      api<ParcelsResponse>('/api/parcels?' + params.toString(), { signal }),
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}
export function useParcels(
  viewport: Viewport,
  filters: MutationFilters,
  status: Status | undefined,
) {
  const input = useMemo(() => ({ viewport, filters }), [viewport, filters]);
  const settled = useDebouncedValue(input, 250);
  const zoomRequired = requiresZoom(viewport);
  const validation = filterError(filters);
  const enabled =
    !!status &&
    !zoomRequired &&
    !validation &&
    !filterError(settled.filters) &&
    !requiresZoom(settled.viewport);
  const parcels = useQuery({
    ...parcelsOptions(
      settled.viewport,
      settled.filters,
      status?.dataset?.release,
    ),
    enabled,
    placeholderData: keepPreviousData,
  });
  const previousYear = settled.filters.year - 1;
  const comparison = useQuery({
    ...parcelsOptions(
      settled.viewport,
      { ...settled.filters, year: previousYear, start: '', end: '' },
      status?.dataset?.release,
    ),
    enabled:
      enabled && previousYear > 0 && !!status?.years?.includes(previousYear),
  });
  return {
    data: zoomRequired ? emptyParcels : (parcels.data ?? emptyParcels),
    comparison:
      enabled &&
      input === settled &&
      filters.year === settled.filters.year &&
      filters.year > 0 &&
      status?.years?.includes(filters.year - 1)
        ? comparison.data
        : undefined,
    loading:
      !status ||
      (!zoomRequired &&
        !validation &&
        (input !== settled || parcels.isPending || parcels.isFetching)),
    error: validation || (enabled && parcels.error?.message) || '',
    zoomRequired,
    canRetry: !validation,
    retry: () => (enabled && input === settled ? parcels.refetch() : undefined),
  };
}
