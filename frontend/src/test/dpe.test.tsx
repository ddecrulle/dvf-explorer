import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ParcelDpe } from '../components/ParcelDpe';
import { createQueryClient } from '../queries/client';
import { changeLanguage } from '../i18n';
import type { ParcelDpe as DpeResponse, Diagnostic } from '../queries/dpe';
import type { Sale } from '../types';

const sale: Sale = {
  id: 'dvfplus:1',
  date: '2025-06-30',
  price: 150000,
  address: '',
  city: 'Angoulême',
  citycode: '16015',
  department: '16',
  kind: 'Maison',
  surface: 100,
  land: 1000,
  rooms: null,
  longitude: 0.148,
  latitude: 45.64,
  parcels: ['16015000AB0001'],
  row_count: 1,
  year: 2025,
  source: 'https://www.data.gouv.fr/',
  multi: false,
  distance: 1,
};
const diagnostic: Diagnostic = {
  id: '2516E0000001A',
  energy_class: 'D',
  climate_class: 'B',
  established_at: '2025-01-01',
  expires_at: '2035-01-01',
  modified_at: '2026-01-01',
  kind: 'maison',
  surface: 100,
  address: '1 rue Exemple',
  consumption: 200,
  emissions: 8,
  match: 'probable',
  url: 'https://observatoire-dpe-audit.ademe.fr/afficher-dpe/2516E0000001A',
};
const evidence: DpeResponse = {
  state: 'ok',
  diagnostics: [diagnostic],
  truncated: false,
  source: 'https://data.ademe.fr/datasets/dpe03existant',
  parcel: sale.parcels[0],
  as_of: sale.date,
  fetched_at: '2026-10-19T10:00:00Z',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function setup() {
  const client = createQueryClient();
  function Screen({
    selected = sale,
    release,
  }: {
    selected?: Sale;
    release?: string;
  }) {
    return (
      <QueryClientProvider client={client}>
        <ParcelDpe key={selected.id} sale={selected} release={release} />
      </QueryClientProvider>
    );
  }
  return { client, Screen };
}

describe('parcel diagnostics in the sale detail', () => {
  it('labels an address-based candidate without suggesting it is the sale certificate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        json({
          ...evidence,
          diagnostics: [
            {
              ...diagnostic,
              match: 'address',
              location_method: 'ban_address',
            },
          ],
        }),
      ),
    );
    const { Screen, client } = setup();
    render(<Screen />);
    await screen.findByText('Linked address · verify');
    expect(screen.getByText(/current BAN/)).toBeTruthy();
    expect(screen.queryByText('Probable match')).toBeNull();
    expect(screen.getByLabelText('Energy class D')).toBeTruthy();
    client.clear();
  });

  it('identifies a declared-sale-address C/C diagnostic and pins its data release', async () => {
    const fetch = vi.fn().mockResolvedValue(
      json({
        ...evidence,
        diagnostics: [
          {
            ...diagnostic,
            id: '2216E0711456J',
            energy_class: 'C',
            climate_class: 'C',
            surface: 138,
            match: 'address',
            location_method: 'dvf_address',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const { Screen, client } = setup();
    render(<Screen release="pinned" />);
    await screen.findByText('Sale address · verify');
    expect(screen.getByLabelText('Energy class C')).toBeTruthy();
    expect(screen.getByText('Climate class C')).toBeTruthy();
    expect(screen.getByText('138 m²')).toBeTruthy();
    expect(
      screen.getByText(/address declared for this sale in DVF/),
    ).toBeTruthy();
    expect(screen.queryByText('Probable match')).toBeNull();
    expect(
      new URL(fetch.mock.calls[0][0], 'http://localhost').searchParams.get(
        'release',
      ),
    ).toBe('pinned');
    client.clear();
  });

  it('loads on mount, exposes evidence and reuses the cache when reopened', async () => {
    const fetch = vi.fn().mockImplementation(async () => json(evidence));
    vi.stubGlobal('fetch', fetch);
    const { Screen, client } = setup();
    expect(fetch).not.toHaveBeenCalled();
    const first = render(<Screen />);
    await screen.findByText('Probable match');
    expect(screen.getByLabelText('Energy class D')).toBeTruthy();
    expect(screen.getByText('Climate class B')).toBeTruthy();
    expect(
      screen.getByText(/may have been revised after the sale/),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /View DPE/ }).getAttribute('href'),
    ).toBe(diagnostic.url);
    const params = new URL(fetch.mock.calls[0][0], 'http://localhost')
      .searchParams;
    expect(params.get('at')).toBe(sale.date);
    expect(params.get('simple')).toBe('true');
    first.unmount();
    render(<Screen />);
    await screen.findByText('Probable match');
    expect(fetch).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('distinguishes an empty result from a temporary failure with manual retry', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () =>
        json({ detail: 'DPE services are temporarily unavailable.' }, 502),
      )
      .mockImplementation(async () => json({ ...evidence, diagnostics: [] }));
    vi.stubGlobal('fetch', fetch);
    const { Screen, client } = setup();
    render(<Screen />);
    await screen.findByText(/DPE lookup is temporarily unavailable/);
    expect(screen.queryByText(/No DPE found/)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/This does not mean the property has no DPE/);
    expect(fetch).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('queries only the chosen parcel and cancels obsolete lookups', async () => {
    const user = userEvent.setup();
    let signal: AbortSignal | undefined;
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string, init: RequestInit) => {
        if (path.includes('AB0001')) {
          signal = init.signal as AbortSignal;
          return new Promise(() => {});
        }
        return json({
          ...evidence,
          diagnostics: [{ ...diagnostic, match: 'parcel' }],
        });
      });
    vi.stubGlobal('fetch', fetch);
    const { Screen, client } = setup();
    render(
      <Screen
        selected={{
          ...sale,
          multi: true,
          parcels: [...sale.parcels, '16015000AB0002'],
        }}
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await user.selectOptions(
      screen.getByLabelText('Select a parcel'),
      '16015000AB0002',
    );
    await screen.findByText('Parcel only');
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.every(
        ([path]) =>
          new URL(path, 'http://localhost').searchParams.get('simple') ===
          'false',
      ),
    ).toBe(true);
    client.clear();
  });

  it('switches language without refetching or changing the diagnostic', async () => {
    const fetch = vi.fn().mockImplementation(async () => json(evidence));
    vi.stubGlobal('fetch', fetch);
    const { Screen, client } = setup();
    render(<Screen />);
    await screen.findByText('Probable match');
    await act(async () => {
      await changeLanguage('fr');
    });
    expect(screen.getByText('Rapprochement probable')).toBeTruthy();
    expect(screen.getByLabelText('Classe énergie D')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it.each([
    ['before_coverage', /Earlier diagnostics are outside/],
    ['parcel_unavailable', /not found in the current cadastre/],
    ['area_too_large', /too large for a targeted DPE lookup/],
  ] as const)(
    'explains %s rather than reporting no certificate',
    async (state, text) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation(async () =>
            json({ ...evidence, state, diagnostics: [] }),
          ),
      );
      const { Screen, client } = setup();
      render(<Screen />);
      await screen.findByText(text);
      expect(screen.queryByText(/No DPE found/)).toBeNull();
      client.clear();
    },
  );

  it('does not query an invalid cadastral reference', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { Screen, client } = setup();
    render(<Screen selected={{ ...sale, parcels: ['not-a-parcel'] }} />);
    expect(
      screen.getByText(/valid cadastral reference is required/),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    client.clear();
  });
});

// These tests isolate historical ADEME and parcel behavior; BDNB has integration tests.
vi.mock('../components/ParcelBdnb', () => ({ ParcelBdnb: () => null }));
