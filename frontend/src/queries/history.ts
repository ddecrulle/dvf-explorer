import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import type { ParcelHistory } from '../types';

export function historyOptions(parcel: string, release?: string, offset = 0) {
  const params = new URLSearchParams({ offset: String(offset) });
  if (release) params.set('release', release);
  return queryOptions({
    queryKey: ['parcel-history', parcel, release ?? 'local', offset],
    queryFn: ({ signal }) =>
      api<ParcelHistory>(
        '/api/parcels/' + encodeURIComponent(parcel) + '/mutations?' + params,
        { signal },
      ),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}
