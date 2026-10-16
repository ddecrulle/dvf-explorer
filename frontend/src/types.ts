/** Official DVF values remain unchanged in storage and API filters. */
export interface Sale {
  id: string;
  date: string;
  price: number;
  address: string;
  city: string;
  department: string;
  citycode: string;
  kind: string;
  surface: number | null;
  land: number | null;
  rooms: number | null;
  longitude: number;
  latitude: number;
  parcels: string[];
  row_count: number;
  year: number;
  source: string;
  multi: boolean;
  distance: number;
}
export interface SalesResponse {
  sales: Sale[];
  total: number;
  median_price?: number | null;
  median_sqm?: number | null;
  sqm_count?: number;
  truncated?: boolean;
}
export interface Location {
  lon: number;
  lat: number;
  label: string;
  department: string | null;
}
export interface SearchFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    id: string;
    label: string;
    depcode?: string;
    citycode?: string;
  };
}
export interface SearchResponse {
  features: SearchFeature[];
}
export interface ImportSummary {
  department: string;
  year: number;
  count: number;
  located: number;
}
export interface Status {
  imports: ImportSummary[];
  job: {
    state: 'idle' | 'running' | 'done' | 'error' | 'interrupted';
    message?: string;
    id?: string;
  };
  years?: number[];
  archive?: {
    captured_at?: string;
    files: number;
    bytes: number;
    years: number[];
  };
  admin_token_required?: boolean;
}
