import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../App';
import { createQueryClient } from '../queries/client';
import {
  changeLanguage,
  i18n,
  languageStorageKey,
  preferredLanguage,
} from '../i18n';
import { money, date, number, propertyLabel } from '../format';
import { translateMessage } from '../messages';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import type { Sale, Status, ParcelSummary, Viewport } from '../types';

// Exercise the real screen, retaining a mounted map boundary without WebGL.
vi.mock('../hooks/useParcelMap', () => ({
  useParcelMap: ({ onViewport }: { onViewport: (view: Viewport) => void }) => {
    useEffect(() => {
      onViewport({
        zoom: 15,
        west: 0.14,
        east: 0.15,
        south: 45.64,
        north: 45.65,
      });
    }, [onViewport]);
    return {
      mapNode: { current: null },
      mapError: '',
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
    };
  },
}));

const sale: Sale = {
  id: 'dvfplus:1',
  date: '2025-06-30',
  price: 123456,
  address: '',
  city: 'Angoulême',
  department: '16',
  citycode: '16015',
  kind: 'Maison',
  surface: 80.5,
  land: 1200,
  rooms: null,
  longitude: 0.148,
  latitude: 45.64,
  parcels: ['16015000AB0001'],
  row_count: 1,
  year: 2025,
  source: 'https://www.data.gouv.fr/',
  multi: false,
  distance: 1.2,
};
const parcel: ParcelSummary = {
  id: sale.parcels[0],
  city: sale.city,
  kind: sale.kind,
  longitude: sale.longitude,
  latitude: sale.latitude,
  latest_date: sale.date,
  latest_price: sale.price,
  latest_mutation_id: sale.id,
  latest_mutation_parcels: 1,
  matching_mutations: 1,
  surface: sale.surface,
  distance: sale.distance,
};
const status: Status = {
  dataset: {
    mode: 'published',
    source: 'DVF+ Cerema',
    release: 'pinned',
    rows: 1,
  },
  years: [2025],
  imports: [{ department: '16', year: 2025, count: 1, located: 1 }],
  job: { state: 'idle' },
};

describe('language preferences', () => {
  it('defaults to French and restores only supported saved choices', () => {
    expect(preferredLanguage()).toBe('fr');
    localStorage.setItem(languageStorageKey, 'en');
    expect(preferredLanguage()).toBe('en');
    localStorage.setItem(languageStorageKey, 'de');
    expect(preferredLanguage()).toBe('fr');
  });

  it('persists a choice and updates document language, title and description', async () => {
    await changeLanguage('fr');
    expect(localStorage.getItem(languageStorageKey)).toBe('fr');
    expect(preferredLanguage()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.title).toBe(fr['app.pageTitle']);
    await changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe(en['app.pageTitle']);
  });

  it('still switches languages when browser storage is disabled', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    expect(preferredLanguage()).toBe('fr');
    await expect(changeLanguage('fr')).resolves.toBeUndefined();
    expect(i18n.resolvedLanguage).toBe('fr');
  });
});

describe('translation catalogs and formats', () => {
  it('has matching complete catalogs and interpolation placeholders', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fr[key].trim()).not.toBe('');
      expect(fr[key].match(/{{.*?}}/g)?.sort()).toEqual(
        en[key].match(/{{.*?}}/g)?.sort(),
      );
    }
  });

  it('formats prices, decimals, dates and plural counts in the selected language', async () => {
    await changeLanguage('fr');
    expect(money(123456)).toBe(
      new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 0,
      }).format(123456),
    );
    expect(number(1.2)).toBe('1,2');
    expect(date('2025-06-30')).toContain('juin');
    expect(propertyLabel('Maison')).toBe('Maison');
    expect(i18n.t('details.parcels', { count: 1 })).toBe(
      '1 parcelle cadastrale',
    );
    expect(i18n.t('details.parcels', { count: 2 })).toBe(
      '2 parcelles cadastrales',
    );
    await changeLanguage('en');
    expect(money(123456)).toBe('€123,456');
    expect(number(1.2)).toBe('1.2');
    expect(date('2025-06-30')).toContain('Jun');
    expect(propertyLabel('Maison')).toBe('House');
    expect(i18n.t('coverage.departments', { count: 1 })).toBe('1 department');
    expect(i18n.t('coverage.departments', { count: 2 })).toBe('2 departments');
    expect(sale.kind).toBe('Maison');
  });

  it('translates cached errors at display time and retains unknown server details', async () => {
    const original = 'The minimum price must not exceed the maximum.';
    await changeLanguage('fr');
    expect(translateMessage(original)).toBe(fr['errors.priceOrder']);
    expect(translateMessage('The service is unavailable (503).')).toBe(
      'Le service est indisponible (503).',
    );
    expect(translateMessage('Failed to fetch')).toBe(fr['errors.network']);
    expect(translateMessage('Specific server diagnostic')).toBe(
      'Specific server diagnostic',
    );
    await changeLanguage('en');
    expect(translateMessage(original)).toBe(original);
  });
});

it('switches the loaded explorer without losing filters, selection, cache or release', async () => {
  const user = userEvent.setup();
  await changeLanguage('fr');
  const fetch = vi.fn().mockImplementation(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path === '/api/parcel-addresses'
            ? { addresses: {}, sources: {}, unavailable: [] }
            : path === '/api/status'
              ? status
              : path.startsWith('/api/parcels?')
                ? {
                    parcels: [parcel],
                    total: 1,
                    mutations: 1,
                    median_price: sale.price,
                  }
                : path.includes('/mutations?')
                  ? {
                      parcel: parcel.id,
                      total: 1,
                      mutations: [sale],
                      first_date: sale.date,
                      last_date: sale.date,
                      offset: 0,
                      next_offset: null,
                      release: 'pinned',
                    }
                  : { state: 'ok', diagnostics: [], truncated: false },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('combobox', { name: 'Langue' })).toBeTruthy();
  await screen.findByRole('button', { name: /Parcelle 16015000AB0001/ });
  await user.click(screen.getByRole('button', { name: /^Maisons$/ }));
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => path.includes('kind=Maison')),
    ).toBe(true),
  );
  expect(
    fetch.mock.calls.some(([path]) => path.startsWith('/api/parcels/')),
  ).toBe(false);
  const card = screen.getByRole('button', { name: /Parcelle 16015000AB0001/ });
  expect(card.textContent).toContain('1 vente dans la sélection');
  await user.click(card);
  await screen.findByText('FICHE PARCELLE');
  const calls = fetch.mock.calls.length;
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Langue' }),
    'en',
  );
  await screen.findByText('PARCEL DETAILS');
  expect(screen.getByRole('button', { name: /^Houses$/ }).className).toBe(
    'active',
  );
  expect(
    screen.getByRole('button', { name: /Parcel 16015000AB0001/ }).textContent,
  ).toContain('1 sale in this selection');
  expect(
    screen.getByText(/No exact address available for this parcel/),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Zoom out' })).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(calls);
  expect(
    fetch.mock.calls.filter(([path]) => path === '/api/status'),
  ).toHaveLength(1);
  expect(
    fetch.mock.calls
      .filter(([path]) => path.startsWith('/api/parcels?'))
      .every(
        ([path]) =>
          new URL(path, 'http://localhost').searchParams.get('release') ===
          'pinned',
      ),
  ).toBe(true);
  await act(async () => {
    await changeLanguage('fr');
  });
  expect(screen.getByText('FICHE PARCELLE')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dézoomer' })).toBeTruthy();
  client.clear();
});
