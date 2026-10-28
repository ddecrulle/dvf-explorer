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
function setup(
  data = evidence,
  status = 200,
  date = '2025-01-01',
  diagnostics: unknown[] = [],
) {
  const fetch = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path.endsWith('/bdnb')
            ? data
            : { state: 'ok', diagnostics, truncated: false },
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

it('uses the original letter cards in one parcel DPE section', async () => {
  const { client, fetch } = setup();
  const grade = await screen.findByLabelText('Energy class D');
  expect(grade.className).toBe('dpe-grade');
  expect(grade.getAttribute('data-grade')).toBe('D');
  expect(screen.getByText('Climate class B')).toBeTruthy();
  expect(screen.getByText('Representative building DPE')).toBeTruthy();
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  expect(screen.queryByText(/BDNB: energy/)).toBeNull();
  expect(
    screen.queryByText(/This does not mean the property has no DPE/),
  ).toBeNull();
  expect(screen.queryByText('Probable match')).toBeNull();
  expect(fetch.mock.calls.some(([path]) => path.includes('/dpe?'))).toBe(true);
  expect(
    fetch.mock.calls.some(([path]) => path === `/api/parcels/${parcel}/bdnb`),
  ).toBe(true);
  client.clear();
});

it('keeps the same card but flags a diagnostic outside the sale period', async () => {
  const { client } = setup(evidence, 200, '2022-01-01');
  await screen.findByLabelText('Energy class D');
  expect(
    screen.getByText(/does not establish validity at the sale date/),
  ).toBeTruthy();
  client.clear();
});

it('prefers the verified ADEME grade instead of showing competing letters', async () => {
  const changed = structuredClone(evidence);
  changed.buildings[0].representative!.ademe!.energy_class = 'C';
  const { client } = setup(changed);
  await screen.findByLabelText('Energy class C');
  expect(screen.queryByLabelText('Energy class D')).toBeNull();
  client.clear();
});

it('keeps the existing empty state and offers an independent retry on failure', async () => {
  const { client, fetch } = setup(evidence, 502);
  await screen.findByText(/Some diagnostics could not be checked/);
  expect(
    screen.getByText(/This does not mean the property has no DPE/),
  ).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(
    fetch.mock.calls.filter(([path]) => path.endsWith('/bdnb')),
  ).toHaveLength(2);
  expect(
    fetch.mock.calls.filter(([path]) => path.includes('/dpe?')),
  ).toHaveLength(1);
  client.clear();
});

it('does not create empty building cards and flags incomplete results', async () => {
  const changed = structuredClone(evidence);
  changed.buildings.push({
    id: 'other',
    main_parcel: false,
    representative: null,
  });
  changed.truncated = true;
  const { client } = setup(changed);
  await screen.findByLabelText('Energy class D');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText(/this list may be incomplete/)).toBeTruthy();
  client.clear();
});

it('deduplicates a certificate found by both sources', async () => {
  const certificate = evidence.buildings[0].representative!.ademe!;
  const { client } = setup(evidence, 200, '2025-01-01', [
    {
      ...certificate,
      id: '2416E2621326Z',
      match: 'parcel',
      modified_at: null,
      consumption: 195,
      emissions: 7.22,
    },
  ]);
  await screen.findByLabelText('Energy class D');
  await screen.findByText(/Source checked/);
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getAllByRole('link', { name: /View DPE/ })).toHaveLength(1);
  client.clear();
});

it('uses the same card for an unverified BDNB value without invented dates', async () => {
  const changed = structuredClone(evidence);
  changed.buildings[0].representative!.ademe = null;
  changed.buildings[0].representative!.ademe_state = 'unavailable';
  changed.ademe_unavailable = true;
  const { client } = setup(changed);
  await screen.findByLabelText('Energy class D');
  expect(screen.getByText(/Certificate not verified/)).toBeTruthy();
  expect(screen.queryByText('Valid until')).toBeNull();
  expect(screen.queryByRole('link', { name: /View DPE/ })).toBeNull();
  client.clear();
});
