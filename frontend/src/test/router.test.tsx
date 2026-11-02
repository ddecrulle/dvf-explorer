import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  defaultParseSearch,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { createExplorerRouter } from '../router';
import {
  explorerSearch,
  explorerState,
  validateExplorerSearch,
} from '../routing/search';
import { useExplorerRoute } from '../routing/useExplorerRoute';
import { useMapRestoration } from '../routing/useMapRestoration';

const parcel = '59350000DI0002';
const link =
  '?parcel=' +
  parcel +
  '&plon=3.0635&plat=50.6134&mutation=dvfplus:abc&release=edition-1&bbox=3.06,50.61,3.07,50.62&zoom=17.25&year=2023&kind=Appartement&min=100000&max=400000&from=2023-01-01&to=2023-12-31&q=14+rue+Ab%C3%A9lard&label=Lille&lon=3.0635&lat=50.6134&dep=59&sort=price&basemap=satellite&view=map&dpe=sale&dpe_all=1&lang=fr';
const parse = (search: string) =>
  explorerState(validateExplorerSearch(defaultParseSearch(search)));

describe('TanStack explorer routes', () => {
  it('opens existing links and round-trips filters, selected transaction, accented text and zero coordinates', async () => {
    const history = createMemoryHistory({ initialEntries: ['/' + link] });
    const router = createExplorerRouter(history);
    await router.load();
    const state = explorerState(router.state.matches.at(-1)!.search);
    const href = router.buildLocation({
      to: '/',
      search: explorerSearch(state),
    }).href;
    expect(parse(new URL(href, 'https://example.test').search)).toEqual(state);
    expect(state.parcel?.id).toBe(parcel);
    expect(state.query).toBe('14 rue Abélard');
    expect(state.center.department).toBe('59');
    expect(state.view?.zoom).toBe(17.25);
    expect(
      parse('?parcel=' + parcel + '&plon=0&plat=0').parcel?.longitude,
    ).toBe(0);
    expect(parse('?parcel=' + parcel + '&view=list').tab).toBe('list');
  });

  it('ignores malformed optional parameters independently without losing valid filters', () => {
    const state = parse(
      '?parcel=' +
        parcel +
        'extra&mutation=bad%22&release=../../bad&bbox=NaN,0,1,2&zoom=Infinity&year=2023.5&min=-1&max=NaN&from=2023-02-31&trail=%7Bbad&kind=Maison',
    );
    expect(state.parcel).toBeNull();
    expect(state.mutation).toBeNull();
    expect(state.release).toBeUndefined();
    expect(state.view).toBeNull();
    expect(state.filters).toMatchObject({
      year: 0,
      min: '',
      max: '',
      start: '',
      kind: 'Maison',
    });
    expect(state.trail).toEqual([]);
  });

  it('uses TanStack history for back/forward and replaces continuous camera changes', async () => {
    function Probe() {
      const { route, navigate } = useExplorerRoute();
      const restored = useMapRestoration();
      return (
        <>
          <output data-testid="selection">
            {route.mutation}:{route.filters.year}:{route.view?.west}
          </output>
          <output data-testid="restoration">
            {restored.revision}:{restored.view?.west}
          </output>
          <button
            onClick={() =>
              navigate({
                mutation: 'dvfplus:second',
                filters: { ...route.filters, year: 2022 },
              })
            }
          >
            Second
          </button>
          <button
            onClick={() =>
              navigate({ view: { ...route.view!, west: 3.061 } }, true)
            }
          >
            Pan
          </button>
          <button
            onClick={() => {
              void navigate({ query: 'Lille' }, true);
              void navigate({ basemap: 'satellite' }, true);
            }}
          >
            Together
          </button>
        </>
      );
    }
    const history = createMemoryHistory({ initialEntries: ['/' + link] });
    const router = createExplorerRouter(history, Probe);
    await router.load();
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Second'));
    const length = history.length;
    await user.click(screen.getByText('Pan'));
    expect(history.length).toBe(length);
    expect(screen.getByTestId('restoration').textContent).toBe('0:3.06');
    await act(async () => history.back());
    await waitFor(() =>
      expect(screen.getByTestId('selection').textContent).toBe(
        'dvfplus:abc:2023:3.06',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('restoration').textContent).toBe('1:3.06'),
    );
    await act(async () => history.forward());
    await waitFor(() =>
      expect(screen.getByTestId('selection').textContent).toBe(
        'dvfplus:second:2022:3.061',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('restoration').textContent).toBe('2:3.061'),
    );
    await user.click(screen.getByText('Together'));
    expect(parse(history.location.search)).toMatchObject({
      query: 'Lille',
      basemap: 'satellite',
      mutation: 'dvfplus:second',
    });
  });

  it('has DPE new-build inclusion enabled with or without obsolete preview input', () => {
    expect(parse('?preview=dpe-neufs')).toEqual(parse(''));
    const router = createExplorerRouter(createMemoryHistory());
    expect(
      router.buildLocation({
        to: '/',
        search: explorerSearch(parse('?preview=dpe-neufs')),
      }).href,
    ).not.toContain('preview');
  });
});

it('does not crash the imperative map bridge on malformed structured URL values', async () => {
  function Probe() {
    const { route } = useExplorerRoute();
    const camera = useMapRestoration();
    return (
      <output data-testid="safe-map">
        {route.view === null && camera.view === null
          ? 'default camera'
          : 'saved camera'}
      </output>
    );
  }
  const history = createMemoryHistory({
    initialEntries: ['/?bbox=%7B%22west%22%3A1%7D&zoom=17&trail=%7Bbad'],
  });
  const router = createExplorerRouter(history, Probe);
  await router.load();
  render(<RouterProvider router={router} />);
  expect(await screen.findByText('default camera')).toBeTruthy();
});

it('preserves numeric geographic codes and plain scalar queries in existing URLs', () => {
  expect(
    parse('?area=municipality&citycode=59350&dep=59&q=2023'),
  ).toMatchObject({
    center: { department: '59' },
    area: { citycode: '59350', kind: 'municipality' },
    query: '2023',
  });
  expect(parse('?parcel=59350000000002&dep=01').parcel?.id).toBe(
    '59350000000002',
  );
  expect(parse('?dep=01').center.department).toBe('01');
});
