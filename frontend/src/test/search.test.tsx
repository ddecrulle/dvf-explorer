import { render } from './routing';
import { TestRouter } from './routing';
import { QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TestApp as App } from './routing';
import { AddressSearch } from '../components/AddressSearch';
import { createQueryClient } from '../queries/client';
import type { MapFocus, ParcelSelection } from '../types';

vi.mock('../components/ParcelMap', () => ({
  default: ({
    focus,
    selected,
  }: {
    focus: MapFocus;
    selected: ParcelSelection;
  }) => (
    <div data-testid="map-target">
      {focus?.parcel}:{selected?.id}
    </div>
  ),
}));
const feature = {
  geometry: { coordinates: [0.154, 45.648] },
  properties: {
    id: '16015000AK0292',
    type: 'parcel',
    label: '16015000AK0292 · Angoulême',
    city: 'Angoulême',
    citycode: '16015',
    depcode: '16',
  },
};

it('opens the parcel and focuses the map from the same search bar with Enter', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.startsWith('/api/search?')
              ? { features: [feature] }
              : path === '/api/status'
                ? { imports: [], years: [], job: { state: 'idle' } }
                : {
                    parcels: [],
                    total: 0,
                    mutations: 0,
                    addresses: {},
                    sources: {},
                    unavailable: [],
                  },
          ),
        ),
    ),
  );
  const client = createQueryClient();
  await render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  const input = screen.getByRole('combobox', {
    name: 'Search for an address, municipality or parcel',
  });
  await userEvent.type(input, '16015000ak0292');
  await screen.findByRole('option', { name: feature.properties.label });
  await userEvent.keyboard('{Enter}');
  expect((await screen.findByTestId('map-target')).textContent).toBe(
    '16015000AK0292:16015000AK0292',
  );
  expect((input as HTMLInputElement).value).toBe(feature.properties.label);
  expect(new URLSearchParams(location.search).get('parcel')).toBe(
    feature.properties.id,
  );
  client.clear();
});

it('distinguishes a missing parcel from an address with no results', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ features: [] }))),
  );
  const client = createQueryClient();
  await render(
    <QueryClientProvider client={client}>
      <TestRouter>
        <AddressSearch onChoose={vi.fn()} />
      </TestRouter>
    </QueryClientProvider>,
  );
  await userEvent.type(screen.getByRole('combobox'), '16015 000 ak 0292');
  await screen.findByText(
    'No parcel found in the current cadastre for this reference.',
  );
  client.clear();
});
