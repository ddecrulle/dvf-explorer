import { render } from './routing';
import { QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { TestApp as App } from './routing';
import { ParcelDetails } from '../components/ParcelDetails';
import { createQueryClient } from '../queries/client';

vi.mock('../components/ParcelMap', () => ({
  default: (props: any) => (
    <div data-testid="shared-map">
      <output>{JSON.stringify(props.restoredView?.view)}</output>
      {props.selected && (
        <ParcelDetails
          parcel={props.selected}
          release={props.release}
          onSelect={props.onSelect}
          onClose={props.onCloseSelection}
        />
      )}
    </div>
  ),
}));
const parcel = '59350000DI0002';
const old = {
  id: 'dvfplus:old',
  date: '2021-06-30',
  price: 179000,
  address: '',
  city: 'Lille',
  department: '59',
  citycode: '59350',
  kind: 'Appartement',
  surface: 73,
  land: null,
  rooms: null,
  longitude: 3.063,
  latitude: 50.613,
  parcels: [parcel],
  row_count: 1,
  year: 2021,
  source: 'https://example.test',
  multi: false,
};
const recent = {
  ...old,
  id: 'dvfplus:recent',
  price: 325000,
  date: '2023-06-26',
};
const url =
  '/?parcel=' +
  parcel +
  '&mutation=dvfplus%3Aold&release=edition-1&bbox=3.06,50.61,3.07,50.62&zoom=17&year=2023&kind=Appartement&min=100000&from=2023-01-01&q=Rue+Ab%C3%A9lard&sort=price&lang=en';
async function start(missing = false) {
  const fetch = vi.fn().mockImplementation(async (path: string) => {
    const body = path.startsWith('/api/status')
      ? {
          imports: [],
          years: [2023, 2021],
          job: { state: 'idle' },
          dataset: {
            mode: 'published',
            release: 'edition-1',
            source: 'DVF+ Cerema',
          },
        }
      : path.startsWith('/api/parcel-addresses')
        ? { addresses: {}, sources: {}, unavailable: [] }
        : path.includes('/mutations?')
          ? {
              parcel,
              total: 72,
              offset: 50,
              next_offset: null,
              mutation_found: !missing,
              mutations: missing ? [recent] : [recent, old],
            }
          : path.includes('/dpe?')
            ? { state: 'before_coverage', diagnostics: [], truncated: false }
            : path.includes('/bdnb')
              ? { buildings: [], diagnostics: [], truncated: false }
              : { parcels: [], total: 0, mutations: 0 };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);
  const client = createQueryClient();
  const view = await render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  return { fetch, client, view };
}
it('opens and reloads the exact linked transaction with pinned release, filters and a copyable link', async () => {
  window.history.replaceState(null, '', url);
  const user = userEvent.setup();
  const first = await start();
  const detail = await screen.findByRole('region', {
    name: 'Mutation details',
  });
  expect(
    within(detail).getByRole('heading', { level: 2 }).textContent,
  ).toContain('179,000');
  expect((screen.getByLabelText('Sale year') as HTMLSelectElement).value).toBe(
    '2023',
  );
  expect(
    (screen.getByLabelText('Min. price (€)') as HTMLInputElement).value,
  ).toBe('100000');
  expect(
    (
      screen.getByLabelText(
        'Search for an address, municipality or parcel',
      ) as HTMLInputElement
    ).value,
  ).toBe('Rue Abélard');
  expect(
    (screen.getByLabelText('Sort parcels') as HTMLSelectElement).value,
  ).toBe('price');
  expect(
    first.fetch.mock.calls.some(([path]) =>
      path.startsWith('/api/status?release=edition-1'),
    ),
  ).toBe(true);
  expect(
    first.fetch.mock.calls.some(([path]) =>
      path.includes('mutation=dvfplus%3Aold'),
    ),
  ).toBe(true);
  await user.click(
    screen.getByRole('button', { name: 'Copy link to this selection' }),
  );
  await waitFor(() => expect(screen.getByText('Link copied.')).toBeTruthy());
  const copied = await navigator.clipboard.readText();
  expect(new URL(copied).searchParams.get('mutation')).toBe(old.id);
  first.view.unmount();
  first.client.clear();
  window.history.replaceState(
    null,
    '',
    new URL(copied).pathname + new URL(copied).search,
  );
  const second = await start();
  const restored = await screen.findByRole('region', {
    name: 'Mutation details',
  });
  expect(
    within(restored).getByRole('heading', { level: 2 }).textContent,
  ).toContain('179,000');
  second.client.clear();
});
it('explains an unavailable transaction instead of displaying another sale as the shared one', async () => {
  window.history.replaceState(null, '', url);
  const current = await start(true);
  expect(
    await screen.findByText(/linked transaction was not found/),
  ).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Mutation details' })).toBeNull();
  current.client.clear();
});

it('clears a previous geographic trail when searching another address from the normal site', async () => {
  const previousTrail = [
    {
      level: 'department',
      code: '16',
      label: 'Charente',
      parent: '',
      bounds: [
        [-1, 45],
        [1, 46],
      ],
      zoom: 8.5,
    },
  ];
  window.history.replaceState(
    null,
    '',
    '/?trail=' + encodeURIComponent(JSON.stringify(previousTrail)),
  );
  const feature = {
    geometry: { coordinates: [3.0635, 50.6134] },
    properties: {
      id: '59350_0078_00014',
      type: 'housenumber',
      citycode: '59350',
      depcode: '59',
      label: '14 Rue Abélard 59000 Lille',
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.startsWith('/api/search?')
              ? { features: [feature] }
              : path.startsWith('/api/status')
                ? {
                    imports: [],
                    years: [2023],
                    job: { state: 'idle' },
                    dataset: {
                      mode: 'published',
                      release: 'edition-1',
                      source: 'DVF+',
                    },
                  }
                : path.startsWith('/api/parcel-addresses')
                  ? { addresses: {}, sources: {}, unavailable: [] }
                  : { parcels: [], total: 0, mutations: 0 },
          ),
          { status: 200 },
        ),
    ),
  );
  const client = createQueryClient();
  const user = userEvent.setup();
  await render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  await user.type(
    screen.getByRole('combobox', {
      name: 'Search for an address, municipality or parcel',
    }),
    '14 Rue Abélard',
  );
  await user.click(
    await screen.findByRole('option', { name: feature.properties.label }),
  );
  const params = new URLSearchParams(window.location.search);
  expect(params.has('trail')).toBe(false);
  expect(params.has('preview')).toBe(false);
  expect(params.get('q')).toBe(feature.properties.label);
  expect(params.get('lon')).toBe('3.0635');
  expect(params.get('search')).toBe('1');
  client.clear();
});
