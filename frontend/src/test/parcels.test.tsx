import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ParcelDetails } from '../components/ParcelDetails';
import { createQueryClient } from '../queries/client';
import type { Mutation, ParcelSummary } from '../types';

const P1 = '16015000AB0001',
  P2 = '16015000AB0002';
const parcel: ParcelSummary = {
  id: P1,
  city: 'Angoulême',
  kind: 'Maison',
  longitude: 0.15,
  latitude: 45.65,
  latest_date: '2025-06-01',
  latest_price: 400000,
  latest_mutation_id: 'shared',
  latest_mutation_parcels: 2,
  matching_mutations: 1,
  surface: null,
  distance: 1,
};
const shared: Mutation = {
  id: 'dvfplus:shared',
  date: '2025-06-01',
  price: 400000,
  address: '',
  city: 'Angoulême',
  department: '16',
  citycode: '16015',
  kind: 'Maison',
  surface: null,
  land: 1000,
  rooms: null,
  longitude: 0.15,
  latitude: 45.65,
  parcels: [P1, P2],
  row_count: 1,
  year: 2025,
  source: 'https://example.test',
  multi: true,
};
const old: Mutation = {
  ...shared,
  id: 'dvfplus:old',
  date: '2014-01-02',
  price: 100000,
  parcels: [P1],
  multi: false,
  year: 2014,
  surface: 100,
};
const history = {
  parcel: P1,
  total: 2,
  first_date: old.date,
  last_date: shared.date,
  mutations: [shared, old],
  offset: 0,
  next_offset: null,
  release: 'pinned',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
function setup() {
  const client = createQueryClient();
  client.setQueryData(['parcel-addresses', [P1]], {
    addresses: {},
    sources: {},
    unavailable: [],
  });
  const onSelect = vi.fn();
  const node = (
    <QueryClientProvider client={client}>
      <ParcelDetails
        parcel={parcel}
        release="pinned"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  );
  return { client, node, onSelect };
}

describe('parcel entry point', () => {
  it('loads the complete pinned history and updates DPE dates when selecting an older mutation', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string) =>
        json(
          path.includes('/mutations?')
            ? history
            : { state: 'before_coverage', diagnostics: [], truncated: false },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const { node, client } = setup();
    render(node);
    await screen.findByText('2 known sales');
    expect(
      screen.getByText(/whole mutation involving several parcels/),
    ).toBeTruthy();
    const request = new URL(fetch.mock.calls[0][0], 'http://localhost');
    expect(request.searchParams.get('release')).toBe('pinned');
    expect(request.searchParams.has('year')).toBe(false);
    expect(request.searchParams.has('west')).toBe(false);
    expect(request.searchParams.has('price_min')).toBe(false);
    await user.click(
      screen.getByRole('button', { name: /2 Jan 2014.*€100,000/ }),
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([path]) =>
            path.includes('/dpe?') &&
            new URL(path, 'http://localhost').searchParams.get('at') ===
              '2014-01-02',
        ),
      ).toBe(true),
    );
    expect(
      screen
        .getByRole('button', { name: /2 Jan 2014.*€100,000/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      fetch.mock.calls.filter(([path]) => path.includes('/mutations?')),
    ).toHaveLength(1);
    expect(
      fetch.mock.calls
        .filter(([path]) => path.includes('/dpe?'))
        .every(([path]) => path.startsWith('/api/parcels/' + P1 + '/')),
    ).toBe(true);
    client.clear();
  });

  it('opens another parcel from a shared mutation using its reference', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (path: string) =>
          json(
            path.includes('/mutations?')
              ? history
              : { state: 'ok', diagnostics: [], truncated: false },
          ),
        ),
    );
    const { node, client, onSelect } = setup();
    render(node);
    await screen.findByText('2 known sales');
    await user.click(
      screen.getByRole('button', { name: new RegExp('^' + P2 + '$') }),
    );
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: P2,
        longitude: shared.longitude,
        latitude: shared.latitude,
      }),
    );
    client.clear();
  });

  it('distinguishes failed history from zero known sales and permits retry', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => json({ detail: 'Unavailable' }, 503))
      .mockImplementation(async () =>
        json({ ...history, total: 0, mutations: [] }),
      );
    vi.stubGlobal('fetch', fetch);
    const { node, client } = setup();
    client.setDefaultOptions({ queries: { retry: false } });
    render(node);
    await screen.findByText('History is temporarily unavailable.');
    expect(screen.queryByText(/No known sale/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/No known sale for this reference/);
    expect(fetch).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('paginates with the same immutable release', async () => {
    const user = userEvent.setup();
    const fetch = vi
      .fn()
      .mockImplementation(async (path: string) =>
        json(
          path.includes('/mutations?')
            ? path.includes('offset=50')
              ? { ...history, offset: 50, total: 51, mutations: [old] }
              : { ...history, total: 51, next_offset: 50, mutations: [shared] }
            : { state: 'before_coverage', diagnostics: [], truncated: false },
        ),
      );
    vi.stubGlobal('fetch', fetch);
    const { node, client } = setup();
    render(node);
    await screen.findByText('51 known sales');
    await user.click(screen.getByRole('button', { name: /^Older$/ }));
    await screen.findByText('51–51 of 51');
    const paths = fetch.mock.calls.filter(([path]) =>
      path.includes('/mutations?'),
    );
    expect(paths).toHaveLength(2);
    expect(
      new URL(paths[1][0], 'http://localhost').searchParams.get('release'),
    ).toBe('pinned');
    client.clear();
  });
});
