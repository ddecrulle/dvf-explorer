import type { Sale } from './types';

export const money = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(value);
export const date = (value: string) =>
  new Date(value + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const propertyLabels: Record<string, string> = {
  Maison: 'House',
  Appartement: 'Flat',
  'Terrain / dépendance': 'Land / outbuilding',
  Dépendance: 'Outbuilding',
  Mixte: 'Mixed use',
  'Local industriel. commercial ou assimilé': 'Commercial / industrial',
};
export const propertyLabel = (kind: string) => propertyLabels[kind] ?? kind;

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
