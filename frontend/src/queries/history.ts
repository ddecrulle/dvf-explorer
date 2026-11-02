import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import type { ParcelHistory } from '../types';

export function historyOptions(
  parcel: string,
  release?: string,
  offset = 0,
  mutation?: string | null,
) {
  const params = new URLSearchParams({ offset: String(offset) });
  if (release) params.set('release', release);
  if (mutation) params.set('mutation', mutation);
  return queryOptions({
    queryKey: [
      'parcel-history',
      parcel,
      release ?? 'local',
      mutation ? 0 : offset,
      mutation ?? null,
    ],
    queryFn: ({ signal }) =>
      api<ParcelHistory>(
        '/api/parcels/' + encodeURIComponent(parcel) + '/mutations?' + params,
        { signal },
      ),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
}
