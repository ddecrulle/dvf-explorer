import { useQueries } from '@tanstack/react-query';
import { api } from '../api';

export interface ParcelAddress {
  id: string;
  label: string;
  postcode: string;
  city: string;
  certified: boolean;
}
export type AddressMap = Record<string, ParcelAddress[]>;
interface AddressResponse {
  addresses: AddressMap;
  sources: Record<
    string,
    { url: string; updated_at: string | null; indexed_at: string }
  >;
  unavailable: string[];
}
export function useParcelAddresses(parcels: string[]) {
  const groups = new Map<string, string[]>();
  for (const id of [...new Set(parcels)].sort()) {
    const dep = id.slice(0, /^(97|98)/.test(id) ? 3 : 2);
    if (!groups.has(dep)) groups.set(dep, []);
    groups.get(dep)!.push(id);
  }
  const queries = useQueries({
    queries: [...groups.values()].map((ids) => ({
      queryKey: ['parcel-addresses', ids],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api<AddressResponse>('/api/parcel-addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parcels: ids }),
          signal,
        }),
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: false,
    })),
  });
  return {
    addresses: Object.assign(
      {},
      ...queries.map((q) => q.data?.addresses ?? {}),
    ) as AddressMap,
    loading: queries.some((q) => q.isPending),
    unavailable: queries.some((q) => q.isError || q.data?.unavailable.length),
    sources: Object.assign(
      {},
      ...queries.map((q) => q.data?.sources ?? {}),
    ) as AddressResponse['sources'],
  };
}
