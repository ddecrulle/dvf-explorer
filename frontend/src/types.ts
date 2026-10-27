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
  dependency_count?: number | null;
  distance: number;
}
export interface SalesResponse {
  clusters?: { longitude: number; latitude: number; count: number }[];
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
export type MapFocus = Location & {
  zoom: number;
  parcel?: string;
  search?: boolean;
  searchArea?: {
    kind: 'municipality' | 'street';
    citycode: string;
    name: string;
    street_id?: string;
  };
};
export interface Viewport {
  zoom: number;
  west: number;
  south: number;
  east: number;
  north: number;
}
export interface SearchFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    id: string;
    label: string;
    depcode?: string;
    citycode?: string;
    type?: string;
    name?: string;
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
  dataset?: {
    mode: 'local' | 'published';
    source: string;
    release?: string;
    created_at?: string;
    rows?: number;
  };
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

/** One cadastral reference; displayed prices still belong to whole mutations. */
export interface ParcelSelection {
  id: string;
  city: string;
  longitude: number;
  latitude: number;
}
export interface ParcelSummary extends ParcelSelection {
  kind: string;
  latest_date: string;
  latest_address?: string;
  latest_price: number;
  latest_mutation_id: string;
  latest_mutation_parcels: number;
  matching_mutations: number;
  surface: number | null;
  distance: number;
}
export interface ParcelsResponse {
  parcels: ParcelSummary[];
  total: number;
  mutations: number;
  median_price?: number | null;
  clusters?: { longitude: number; latitude: number; count: number }[];
  truncated?: boolean;
}
export type Mutation = Omit<Sale, 'distance' | 'longitude' | 'latitude'> & {
  longitude: number | null;
  latitude: number | null;
};
export interface ParcelHistory {
  parcel: string;
  total: number;
  first_date: string | null;
  last_date: string | null;
  mutations: Mutation[];
  offset: number;
  next_offset: number | null;
  release: string | null;
}
