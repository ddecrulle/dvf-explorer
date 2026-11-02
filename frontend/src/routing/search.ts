import { z } from 'zod';
import { initial } from '../mapData';
import { defaultFilters, type MutationFilters } from '../queries/parcels';
import type { Location, MapFocus, ParcelSelection, Viewport } from '../types';
import type { MapArea } from '../geographicMap';
import type { Language } from '../i18n';

export interface ExplorerRoute {
  filters: MutationFilters;
  view: Viewport | null;
  center: Location;
  parcel: ParcelSelection | null;
  mutation: string | null;
  offset: number;
  release?: string;
  query: string;
  search: boolean;
  sort: 'recent' | 'price' | 'distance';
  basemap: 'plan' | 'satellite';
  tab: 'map' | 'list';
  dpe: 'all' | 'sale';
  allDpe: boolean;
  language?: Language;
  area?: MapFocus['searchArea'];
  trail: MapArea[];
}

const optional = <T extends z.ZodType>(schema: T) =>
  schema.optional().catch(undefined);
// TanStack parses JSON scalars. Legacy URLs may contain bare numeric codes/text.
const urlString = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value,
    schema,
  );
const text = (max = 200) => optional(urlString(z.string().max(max)));
const number = (min: number, max: number) =>
  optional(
    z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() ? Number(value) : value,
      z.number().finite().min(min).max(max),
    ),
  );
const date = optional(z.iso.date());
const parcelId = optional(
  urlString(
    z
      .string()
      .toUpperCase()
      .regex(/^[0-9AB]{5}[0-9]{3}[A-Z0-9]{2}[0-9]{4}$/),
  ),
);
const point = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-85).max(85),
]);
const mapBounds = z
  .tuple([point, point])
  .refine(([sw, ne]) => sw[0] < ne[0] && sw[1] < ne[1]);
const flag = optional(
  z.union([z.literal(1), z.literal('1')]).transform(() => 1 as const),
);
const mapArea = z.object({
  level: z.enum(['department', 'commune']),
  code: z.string().regex(/^[0-9AB]{2,5}$/),
  label: z.string().max(200),
  parent: z.string().max(5),
  bounds: mapBounds,
  zoom: z.number().min(0).max(22),
});
const bounds = optional(
  z.string().refine((value) => {
    const parts = value.split(',');
    return (
      parts.length === 4 &&
      parts.every((v) => v.trim() !== '') &&
      mapBounds.safeParse([
        parts.slice(0, 2).map(Number),
        parts.slice(2).map(Number),
      ]).success
    );
  }),
);
// Existing links encode the breadcrumb as JSON. TanStack also accepts the array directly.
const trail = optional(
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }, z.array(mapArea).max(2)),
);

/** Public URL contract. Invalid optional values are ignored independently. */
export const explorerSearchSchema = z.object({
  parcel: parcelId,
  mutation: optional(urlString(z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/))),
  release: optional(
    urlString(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)),
  ),
  offset: number(0, 1000000),
  plon: number(-180, 180),
  plat: number(-85, 85),
  city: text(),
  bbox: bounds,
  zoom: number(0, 22),
  lon: number(-180, 180),
  lat: number(-85, 85),
  label: text(),
  dep: optional(urlString(z.string().regex(/^(?:[0-9]{2,3}|2[AB])$/))),
  year: optional(z.coerce.number().int().min(2010).max(2100)),
  kind: optional(
    z.enum([
      'Maison',
      'Appartement',
      'Terrain / dépendance',
      'Mixte',
      'Non renseigné',
      'Local industriel. commercial ou assimilé',
    ]),
  ),
  min: number(0, Number.MAX_SAFE_INTEGER),
  max: number(0, Number.MAX_SAFE_INTEGER),
  from: date,
  to: date,
  q: text(),
  search: flag,
  sort: optional(z.enum(['recent', 'price', 'distance'])),
  basemap: optional(z.enum(['plan', 'satellite'])),
  view: optional(z.enum(['map', 'list'])),
  dpe: optional(z.enum(['all', 'sale'])),
  dpe_all: flag,
  lang: optional(z.enum(['fr', 'en'])),
  area: optional(z.enum(['municipality', 'street'])),
  citycode: optional(urlString(z.string().regex(/^[0-9AB]{5}$/))),
  street: optional(urlString(z.string().regex(/^[A-Za-z0-9_]{1,80}$/))),
  name: text(),
  trail,
});
export type ExplorerSearch = z.infer<typeof explorerSearchSchema>;
export const validateExplorerSearch = (
  input: Record<string, unknown>,
): ExplorerSearch => explorerSearchSchema.parse(input);

/** Map the validated, flat URL contract to the explorer's domain model. */
export function explorerState(s: ExplorerSearch): ExplorerRoute {
  const b = s.bbox?.split(',').map(Number);
  return {
    filters: {
      ...defaultFilters,
      year: s.year ?? 0,
      kind: s.kind ?? '',
      min: s.min == null ? '' : String(s.min),
      max: s.max == null ? '' : String(s.max),
      start: s.from ?? '',
      end: s.to ?? '',
    },
    view:
      b && s.zoom != null
        ? { west: b[0], south: b[1], east: b[2], north: b[3], zoom: s.zoom }
        : null,
    center: {
      lon: s.lon ?? initial.lon,
      lat: s.lat ?? initial.lat,
      label: s.label || initial.label,
      department: s.dep ?? null,
    },
    parcel: s.parcel
      ? {
          id: s.parcel,
          city: s.city ?? '',
          longitude: s.plon ?? s.lon ?? initial.lon,
          latitude: s.plat ?? s.lat ?? initial.lat,
        }
      : null,
    mutation: s.parcel ? (s.mutation ?? null) : null,
    offset: Math.floor((s.offset ?? 0) / 50) * 50,
    release: s.release,
    query: s.q ?? '',
    search: s.search === 1,
    sort: s.sort ?? 'recent',
    basemap: s.basemap ?? 'plan',
    tab: s.view ?? (s.parcel ? 'map' : 'list'),
    dpe: s.dpe ?? 'all',
    allDpe: s.dpe_all === 1,
    language: s.lang,
    area:
      s.area && s.citycode
        ? {
            kind: s.area,
            citycode: s.citycode,
            name: s.name ?? '',
            street_id: s.street,
          }
        : undefined,
    trail: s.trail ?? [],
  };
}

/** Return a search object; TanStack owns its serialization and browser history. */
export function explorerSearch(route: ExplorerRoute): ExplorerSearch {
  const { parcel, filters: f, view: v, center: c, area } = route;
  const located = c.label !== initial.label || area;
  return validateExplorerSearch({
    parcel: parcel?.id,
    plon: parcel?.longitude,
    plat: parcel?.latitude,
    city: parcel?.city || undefined,
    mutation: parcel ? (route.mutation ?? undefined) : undefined,
    offset: parcel && route.offset ? route.offset : undefined,
    release: route.release,
    bbox: v
      ? [v.west, v.south, v.east, v.north]
          .map((n) => Number(n.toFixed(5)))
          .join(',')
      : undefined,
    zoom: v ? Number(v.zoom.toFixed(2)) : undefined,
    lon: located ? c.lon : undefined,
    lat: located ? c.lat : undefined,
    label: located ? c.label : undefined,
    dep: located ? (c.department ?? undefined) : undefined,
    year: f.year || undefined,
    kind: f.kind || undefined,
    min: f.min === '' ? undefined : f.min,
    max: f.max === '' ? undefined : f.max,
    from: f.start || undefined,
    to: f.end || undefined,
    q: route.query || undefined,
    search: route.search ? 1 : undefined,
    sort: route.sort === 'recent' ? undefined : route.sort,
    basemap: route.basemap === 'plan' ? undefined : route.basemap,
    view: route.tab === 'map' || parcel ? route.tab : undefined,
    dpe: route.dpe === 'all' ? undefined : route.dpe,
    dpe_all: route.allDpe ? 1 : undefined,
    lang: route.language,
    area: area?.kind,
    citycode: area?.citycode,
    name: area?.name,
    street: area?.street_id,
    trail: route.trail.length ? route.trail : undefined,
  });
}
