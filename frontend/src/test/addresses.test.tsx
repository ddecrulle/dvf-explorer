import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ParcelCard } from '../components/ParcelCard';
import { useParcelAddresses } from '../queries/addresses';
import { createQueryClient } from '../queries/client';
import type { ParcelSummary } from '../types';
const parcel: ParcelSummary = {
  id: '16015000AN0074',
  city: 'Angoulême',
  kind: 'Appartement',
  longitude: 0.15,
  latitude: 45.65,
  latest_date: '2025-12-31',
  latest_price: 175000,
  latest_mutation_id: 'test',
  latest_mutation_parcels: 1,
  matching_mutations: 16,
  surface: 72,
  distance: 0,
};
it('shows a unique address but does not choose an arbitrary address among several', () => {
  const address = {
    id: 'one',
    label: '9 Impasse d’Austerlitz',
    postcode: '16000',
    city: 'Angoulême',
    certified: true,
  };
  const { rerender } = render(
    <ParcelCard
      parcel={parcel}
      addresses={[address]}
      selected={false}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole('button').textContent).toContain(address.label);
  expect(screen.getByText('72 m²')).toBeTruthy();
  rerender(
    <ParcelCard
      parcel={parcel}
      addresses={[address, { ...address, id: 'two', label: '11 Rue Test' }]}
      selected={false}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByText('Parcel 16015000AN0074')).toBeTruthy();
  expect(screen.queryByText(address.label)).toBeNull();
  expect(screen.queryByText('11 Rue Test')).toBeNull();
  expect(screen.getByText(/2 addresses/)).toBeTruthy();
  rerender(<ParcelCard parcel={parcel} selected={false} onSelect={vi.fn()} />);
  expect(screen.getByText('Parcel 16015000AN0074')).toBeTruthy();
});
it('falls back to the declared sale address only for single-parcel sales', () => {
  const { rerender } = render(
    <ParcelCard
      parcel={{ ...parcel, latest_address: '5 IMP JACQUES BREL' }}
      selected={false}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByText('5 IMP JACQUES BREL')).toBeTruthy();
  expect(screen.getByText('Address declared at the sale · DVF')).toBeTruthy();
  rerender(
    <ParcelCard
      parcel={{
        ...parcel,
        latest_address: '5 IMP JACQUES BREL',
        latest_mutation_parcels: 2,
      }}
      selected={false}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.queryByText('5 IMP JACQUES BREL')).toBeNull();
});

it('looks up exact references in one batch and reuses the cache after reordering', async () => {
  const fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        addresses: {
          [parcel.id]: [{ id: 'one', label: '9 Impasse d’Austerlitz' }],
        },
        sources: {},
        unavailable: [],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  function Probe({ ids }: { ids: string[] }) {
    const data = useParcelAddresses(ids);
    return <p>{data.addresses[parcel.id]?.[0].label ?? 'Pending'}</p>;
  }
  const client = createQueryClient();
  const wrapper = ({ ids }: { ids: string[] }) => (
    <QueryClientProvider client={client}>
      <Probe ids={ids} />
    </QueryClientProvider>
  );
  const ids = [parcel.id, '16015000AN0075'];
  const { rerender } = render(wrapper({ ids }));
  await screen.findByText('9 Impasse d’Austerlitz');
  expect(JSON.parse(fetch.mock.calls[0][1].body).parcels).toEqual(ids);
  rerender(wrapper({ ids: [...ids].reverse() }));
  expect(fetch).toHaveBeenCalledTimes(1);
  client.clear();
});
