import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import type { Sale } from '../types';

export interface Diagnostic {
  id: string;
  energy_class: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  climate_class: Diagnostic['energy_class'] | null;
  established_at: string;
  expires_at: string;
  modified_at: string | null;
  kind: string | null;
  surface: number | null;
  address: string;
  consumption: number | null;
  emissions: number | null;
  match: 'probable' | 'parcel' | 'address';
  location_method?: 'geometry' | 'ban_address';
  url: string;
}
export interface ParcelDpe {
  state: 'ok' | 'parcel_unavailable' | 'before_coverage' | 'area_too_large';
  diagnostics: Diagnostic[];
  truncated: boolean;
  source: string;
  parcel: string;
  as_of: string;
  fetched_at: string | null;
  address_lookup_unavailable?: boolean;
}
export const validParcel = (parcel: string) =>
  /^[0-9AB]{5}[0-9]{3}[A-Z0-9]{2}[0-9]{4}$/.test(parcel);
export type DpeContext = Pick<
  Sale,
  'id' | 'date' | 'kind' | 'surface' | 'multi' | 'parcels'
>;
export function dpeOptions(parcel: string, sale: DpeContext) {
  const params = new URLSearchParams({
    at: sale.date,
    kind: sale.kind,
    simple: String(!sale.multi && sale.parcels.length === 1),
  });
  if (sale.surface && Number.isFinite(sale.surface))
    params.set('surface', String(sale.surface));
  return queryOptions({
    queryKey: ['parcel-dpe', parcel, params.toString()],
    queryFn: ({ signal }) =>
      api<ParcelDpe>(
        '/api/parcels/' + encodeURIComponent(parcel) + '/dpe?' + params,
        { signal },
      ),
    enabled: validParcel(parcel),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}
