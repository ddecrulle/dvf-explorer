import { getLocale, i18n, type TranslationKey } from './i18n';
import type { Sale } from './types';

export const money = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat(getLocale(), {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(value);
export const date = (value: string) =>
  new Date(value + 'T12:00:00').toLocaleDateString(getLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const propertyLabels: Record<string, TranslationKey> = {
  Maison: 'property.house',
  Appartement: 'property.flat',
  'Terrain / dépendance': 'property.land',
  Dépendance: 'property.outbuilding',
  Mixte: 'property.mixed',
  'Local industriel. commercial ou assimilé': 'property.commercial',
};
export const propertyLabel = (kind: string) =>
  propertyLabels[kind] ? i18n.t(propertyLabels[kind]) : kind;
export const number = (value: number, options?: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat(getLocale(), options).format(value);
export const calendarDate = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), { timeZone: 'UTC' }).format(
    new Date(value),
  );

export function exportSalesCSV(rows: Sale[], year: number): void {
  const columns = [
    'date',
    'price',
    'address',
    'city',
    'kind',
    'surface',
    'land',
    'parcels',
    'source',
  ] as const;
  // Neutralise spreadsheet formulas while keeping the original DVF values.
  const csv =
    '\ufeff' +
    [columns, ...rows.map((row) => columns.map((column) => row[column]))]
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              String(value ?? '')
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(';'),
      )
      .join('\r\n');
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dvf-${year || 'all-years'}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Parcel exports explicitly identify shared mutation amounts. */
export function exportParcelsCSV(
  rows: import('./types').ParcelSummary[],
  year: number,
) {
  const columns = [
    'parcel',
    'city',
    'matching_mutations',
    'latest_matching_date',
    'whole_mutation_price',
    'mutation_parcel_count',
  ];
  const content = [
    columns,
    ...rows.map((row) => [
      row.id,
      row.city,
      row.matching_mutations,
      row.latest_date,
      row.latest_price,
      row.latest_mutation_parcels,
    ]),
  ];
  const csv =
    '\ufeff' +
    content
      .map((row) =>
        row
          .map(
            (value) =>
              '"' +
              String(value ?? '')
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(';'),
      )
      .join('\r\n');
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dvf-parcels-${year || 'all-years'}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
