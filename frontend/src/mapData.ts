import type { Location } from './types';

export function parcelReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let id = value.trim().toUpperCase();
  if (id.length === 15) {
    const padding = /^(97|98)/.test(id) ? 3 : 2;
    if (id[padding] !== '0') return null;
    id = id.slice(0, padding) + id.slice(padding + 1);
  }
  return /^[0-9AB]{5}[0-9]{3}[A-Z0-9]{2}[0-9]{4}$/.test(id) ? id : null;
}

export const initial: Location = {
  lon: 2.35,
  lat: 46.6,
  label: 'France',
  department: null,
};
