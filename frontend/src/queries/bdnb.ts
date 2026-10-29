import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import type { Diagnostic } from './dpe';
import { validParcel } from './dpe';

export interface BdnbResponse {
  diagnostics?: (Omit<Diagnostic, 'expires_at'> & {
    expires_at: string | null;
    replaces?: string | null;
  })[];
  address_diagnostics_unavailable?: boolean;
  parcel: string;
  fetched_at: string;
  truncated: boolean;
  ademe_unavailable: boolean;
  buildings: {
    id: string;
    main_parcel: boolean;
    representative: null | {
      id: string | null;
      energy_class: string | null;
      climate_class: string | null;
      issued_at_bdnb: string | null;
      kind: string | null;
      surface: number | null;
      ademe_state: 'found' | 'not_found' | 'unavailable' | 'no_identifier';
      ademe: null | {
        energy_class: string | null;
        climate_class: string | null;
        established_at: string | null;
        expires_at: string | null;
        address: string;
        kind: string | null;
        surface: number | null;
        url: string;
      };
    };
  }[];
}

export function bdnbOptions(parcel: string) {
  return queryOptions({
    queryKey: ['parcel-bdnb', 2, parcel],
    queryFn: ({ signal }) =>
      api<BdnbResponse>(
        '/api/parcels/' + encodeURIComponent(parcel) + '/bdnb',
        { signal },
      ),
    enabled: validParcel(parcel),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
