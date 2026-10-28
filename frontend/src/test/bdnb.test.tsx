import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ParcelDpe } from '../components/ParcelDpe';
import { createQueryClient } from '../queries/client';
import type { BdnbResponse } from '../queries/bdnb';

const parcel = '16358000AY0151';
const evidence: BdnbResponse = {
  parcel,
  fetched_at: '2026-10-28T12:00:00Z',
  truncated: false,
  ademe_unavailable: false,
  buildings: [
    {
      id: 'bdnb-bg-WX3S-753T-TSTR',
      main_parcel: true,
      representative: {
        id: '2416E2621326Z',
        energy_class: 'D',
        climate_class: 'B',
        issued_at_bdnb: '2024-07-18T22:00:00',
        kind: 'maison',
        surface: 97,
        ademe_state: 'found',
        ademe: {
          energy_class: 'D',
          climate_class: 'B',
          established_at: '2024-07-19',
          expires_at: '2034-07-18',
          address: '15 Allee Edith Piaf',
          kind: 'maison',
          surface: 97,
          url: 'https://observatoire-dpe-audit.ademe.fr/afficher-dpe/2416E2621326Z',
        },
      },
    },
  ],
};
function setup(data = evidence, status = 200, date = '2025-01-01') {
  const fetch = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path.endsWith('/bdnb')
            ? data
            : { state: 'ok', diagnostics: [], truncated: false },
        ),
        { status: path.endsWith('/bdnb') ? status : 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <ParcelDpe
        sale={{
          id: 'test',
          date,
          kind: 'Maison',
          surface: 97,
          multi: false,
          parcels: [parcel],
        }}
      />
    </QueryClientProvider>,
  );
  return { client, fetch };
}

it('loads BDNB alongside historical ADEME and identifies representative scope', async () => {
  const { client, fetch } = setup();
  await screen.findByText('BDNB: energy D · GHG B');
  await screen.findByText('ADEME exact identifier: energy D · GHG B');
  expect(
    screen.getByText(/Representative building DPE · not assigned/),
  ).toBeTruthy();
  expect(screen.getByText(/ADEME dates cover the sale date/)).toBeTruthy();
  expect(screen.queryByText('Probable match')).toBeNull();
  expect(fetch.mock.calls.some(([path]) => path.includes('/dpe?'))).toBe(true);
  expect(
    fetch.mock.calls.some(([path]) => path === `/api/parcels/${parcel}/bdnb`),
  ).toBe(true);
  client.clear();
});

it('does not treat a later diagnostic as valid at the sale date', async () => {
  const { client } = setup(evidence, 200, '2022-01-01');
  await screen.findByText(/ADEME dates do not establish validity/);
  expect(screen.queryByText(/ADEME dates cover the sale date/)).toBeNull();
  client.clear();
});

it('shows source disagreement without replacing BDNB grade', async () => {
  const changed = structuredClone(evidence);
  changed.buildings[0].representative!.ademe!.energy_class = 'C';
  const { client } = setup(changed);
  await screen.findByText('BDNB: energy D · GHG B');
  expect(
    screen.getByText('ADEME exact identifier: energy C · GHG B'),
  ).toBeTruthy();
  client.clear();
});

it('keeps ADEME results visible during BDNB failure and offers an independent retry', async () => {
  const { client, fetch } = setup(evidence, 502);
  await screen.findByText(/BDNB is temporarily unavailable/);
  expect(
    screen.getByText(/This does not mean the property has no DPE/),
  ).toBeTruthy();
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry BDNB lookup' }),
  );
  expect(
    fetch.mock.calls.filter(([path]) => path.endsWith('/bdnb')),
  ).toHaveLength(2);
  expect(
    fetch.mock.calls.filter(([path]) => path.includes('/dpe?')),
  ).toHaveLength(1);
  client.clear();
});

it('renders multiple buildings, missing representative and truncation explicitly', async () => {
  const changed = structuredClone(evidence);
  changed.buildings.push({
    id: 'other',
    main_parcel: false,
    representative: null,
  });
  changed.truncated = true;
  const { client } = setup(changed);
  await screen.findByText('Building group other');
  expect(
    screen.getByText('No representative DPE provided for this building.'),
  ).toBeTruthy();
  expect(screen.getByText(/More than 20 linked buildings/)).toBeTruthy();
  client.clear();
});
