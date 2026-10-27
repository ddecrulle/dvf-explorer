import { useState, useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../queries/client';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ParcelMap from '../components/ParcelMap';
import { parcelReference } from '../mapData';
import type {
  MapFocus,
  ParcelSelection,
  ParcelSummary,
  ParcelsResponse,
} from '../types';

const state = vi.hoisted(() => ({ map: null as any }));
vi.mock('maplibre-gl', () => ({
  setWorkerUrl: vi.fn(),
  Map: class {
    listeners = new Map<string, Function[]>();
    layers = new Map();
    sources = new Map();
    features: any[] = [];
    zoom = 16;
    canvas = {
      style: { cursor: '' },
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
    };
    setFeatureState = vi.fn();
    setFilter = vi.fn();
    setLayoutProperty = vi.fn();
    easeTo = vi.fn();
    fitBounds = vi.fn();
    flyTo = vi.fn();
    constructor(options: any) {
      state.map = this;
      for (const layer of options.style.layers)
        this.layers.set(layer.id, layer);
      for (const [id, source] of Object.entries(options.style.sources))
        this.sources.set(id, source);
    }
    on(event: string, ...args: any[]) {
      if (args.length === 1)
        this.listeners.set(event, [
          ...(this.listeners.get(event) ?? []),
          args[0],
        ]);
    }
    off() {}
    once() {}
    emit(event: string, data = {}) {
      for (const fn of this.listeners.get(event) ?? []) fn(data);
    }
    getBounds() {
      return {
        getWest: () => 0.14,
        getEast: () => 0.16,
        getSouth: () => 45.64,
        getNorth: () => 45.66,
      };
    }
    getContainer() {
      return { clientWidth: 1000, clientHeight: 800 };
    }
    getCanvas() {
      return this.canvas;
    }
    getZoom() {
      return this.zoom;
    }
    isStyleLoaded() {
      return false;
    }
    addSource(id: string, source: any) {
      this.sources.set(id, { ...source, setData: vi.fn() });
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    addLayer(layer: any) {
      this.layers.set(layer.id, layer);
    }
    getLayer(id: string) {
      return this.layers.get(id);
    }
    queryRenderedFeatures() {
      return this.features;
    }
    querySourceFeatures() {
      return [];
    }
    cameraForBounds(bounds: number[][]) {
      return {
        center: [
          (bounds[0][0] + bounds[1][0]) / 2,
          (bounds[0][1] + bounds[1][1]) / 2,
        ],
        zoom: 12,
      };
    }
    resize() {}
    remove() {}
  },
}));
vi.mock('../components/ParcelDetails', () => ({
  ParcelDetails: ({ parcel }: { parcel: ParcelSelection }) => (
    <aside aria-label="Selected parcel">{parcel.id}</aside>
  ),
}));

const P1 = '16015000AB0001',
  P2 = '16015000AB0002';
const summary: ParcelSummary = {
  id: P1,
  city: 'Angoulême',
  longitude: 0.15,
  latitude: 45.65,
  kind: 'Maison',
  latest_date: '2025-06-01',
  latest_price: 100000,
  latest_mutation_id: 'm1',
  latest_mutation_parcels: 1,
  matching_mutations: 1,
  surface: 100,
  distance: 0,
};
const data = { parcels: [summary], total: 1, mutations: 1 };
function Harness({
  result = data,
  focus = null,
  zoomRequired = false,
  selectedParcel,
}: {
  result?: ParcelsResponse;
  focus?: MapFocus | null;
  zoomRequired?: boolean;
  selectedParcel?: ParcelSelection;
}) {
  const [client] = useState(createQueryClient);
  useEffect(() => () => client.clear(), [client]);
  const [selected, setSelected] = useState<ParcelSelection | null>(null);
  return (
    <QueryClientProvider client={client}>
      <ParcelMap
        focus={focus}
        release="pinned"
        onViewport={vi.fn()}
        data={result}
        selected={selectedParcel ?? selected}
        onSelect={setSelected}
        onCloseSelection={() => setSelected(null)}
        hidden={false}
        year={0}
        loading={false}
        zoomRequired={zoomRequired}
      />
    </QueryClientProvider>
  );
}
function clickMap(features: any[]) {
  act(() => {
    state.map.features = features;
    state.map.emit('click', {
      point: { x: 100, y: 100 },
      lngLat: { lng: 0.15, lat: 45.65 },
    });
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

describe('parcel map interactions', () => {
  it('switches basemaps while preserving parcel selection and the camera', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => state.map.emit('load'));
    clickMap([{ layer: { id: 'cadastre-fill' }, properties: { id: P2 } }]);
    await user.click(screen.getByRole('button', { name: 'Satellite' }));
    expect(
      screen
        .getByRole('button', { name: 'Satellite' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith(
      'base-satellite',
      'visibility',
      'visible',
    );
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith(
      'base',
      'visibility',
      'none',
    );
    expect(screen.getByLabelText('Selected parcel').textContent).toBe(P2);
    expect(state.map.flyTo).not.toHaveBeenCalled();
    expect(state.map.layers.has('cadastre-selected-line')).toBe(true);
    act(() => state.map.emit('error', { sourceId: 'satellite' }));
    expect(screen.getByText(/This basemap is unavailable/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Map$/ }));
    expect(screen.queryByText(/This basemap is unavailable/)).toBeNull();
    expect(state.map.setLayoutProperty).toHaveBeenCalledWith(
      'base',
      'visibility',
      'visible',
    );
  });
  it('keeps the chosen basemap when toggled before the map has loaded', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Satellite' }));
    act(() => state.map.emit('load'));
    expect(state.map.setLayoutProperty).toHaveBeenLastCalledWith(
      'base-satellite',
      'visibility',
      'visible',
    );
  });

  it('fits all street segments and removes the outline after a new search without geometry', async () => {
    const street = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0.1, 45.6],
              [0.2, 45.7],
            ],
          },
        },
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [0.2, 45.7],
              [0.3, 45.8],
            ],
          },
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(street))),
    );
    const view = render(<Harness />);
    act(() => state.map.emit('load'));
    const focus: MapFocus = {
      lon: 0.16,
      lat: 45.63,
      label: 'Rue de la Croix Lanauve',
      department: '16',
      zoom: 16.5,
      search: true,
      searchArea: {
        kind: 'street',
        citycode: '16015',
        name: 'Rue de la Croix Lanauve',
        street_id: '16015_1275',
      },
    };
    view.rerender(<Harness focus={focus} />);
    await waitFor(() =>
      expect(
        state.map.sources.get('search-outline').setData,
      ).toHaveBeenCalledWith(street),
    );
    expect(state.map.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ center: [0.2, 45.7] }),
    );
    view.rerender(<Harness focus={{ ...focus, searchArea: undefined }} />);
    expect(
      state.map.sources.get('search-outline').setData,
    ).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    expect(
      state.map.sources.get('search-focus').setData,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: [
          expect.objectContaining({ properties: { label: focus.label } }),
        ],
      }),
    );
  });
  it('labels the searched location and clears the marker when focusing a parcel', () => {
    const focus: MapFocus = {
      lon: 0.16,
      lat: 45.63,
      label: 'Rue de la Croix Lanauve',
      department: '16',
      zoom: 16.5,
      search: true,
    };
    const { rerender } = render(<Harness focus={focus} />);
    act(() => state.map.emit('load'));
    // A subsequent search runs after the cadastral source has loaded.
    rerender(<Harness focus={{ ...focus }} />);
    expect(
      state.map.sources.get('search-focus').data.features[0],
    ).toMatchObject({
      properties: { label: focus.label },
      geometry: { coordinates: [focus.lon, focus.lat] },
    });
    expect(state.map.flyTo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zoom: 16.5,
        duration: 900,
      }),
    );
    rerender(<Harness focus={{ ...focus, search: false, zoom: 17 }} />);
    expect(
      state.map.sources.get('search-focus').setData,
    ).toHaveBeenLastCalledWith({
      type: 'FeatureCollection',
      features: [],
    });
  });
  it('centers the exact parcel geometry and ignores a superseded lookup', async () => {
    let late: ((response: Response) => void) | undefined;
    let previousSignal: AbortSignal | undefined;
    const polygon = (id: string, lon: number) => ({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { idu: id },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [lon, 45],
                [lon + 0.01, 45],
                [lon + 0.01, 45.01],
                [lon, 45],
              ],
            ],
          },
        },
      ],
    });
    const fetch = vi
      .fn()
      .mockImplementation(async (url: string, init: RequestInit) => {
        if (url.includes('numero=0001')) {
          previousSignal = init.signal as AbortSignal;
          return new Promise<Response>((resolve) => {
            late = resolve;
          });
        }
        return new Response(JSON.stringify(polygon(P2, 2)));
      });
    vi.stubGlobal('fetch', fetch);
    const focus = (id: string): MapFocus => ({
      parcel: id,
      lon: 0.15,
      lat: 45.65,
      zoom: 17,
      label: '',
      department: '16',
    });
    const view = render(<Harness selectedParcel={summary} focus={focus(P1)} />);
    act(() => state.map.emit('load'));
    const camera = vi.spyOn(state.map, 'cameraForBounds');
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(
      <Harness selectedParcel={{ ...summary, id: P2 }} focus={focus(P2)} />,
    );
    await waitFor(() =>
      expect(camera).toHaveBeenCalledWith(
        [
          [2, 45],
          [2.01, 45.01],
        ],
        expect.objectContaining({ padding: expect.any(Object) }),
      ),
    );
    expect(previousSignal?.aborted).toBe(true);
    await act(async () => {
      late?.(new Response(JSON.stringify(polygon(P1, 10))));
    });
    expect(camera).toHaveBeenCalledTimes(1);
  });
  it('navigates directly from department to commune to parcel, then returns to France', async () => {
    const user = userEvent.setup();
    render(<Harness zoomRequired />);
    act(() => {
      state.map.zoom = 5;
      state.map.emit('load');
    });
    const area = (level: string, properties: Record<string, string>) => ({
      layer: { id: `area-${level}` },
      properties,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.1, 45.6],
            [0.2, 45.6],
            [0.2, 45.7],
            [0.1, 45.7],
            [0.1, 45.6],
          ],
        ],
      },
    });
    clickMap([area('department', { code: '16', nom: 'Charente' })]);
    expect(screen.getByRole('button', { name: 'Charente' })).toBeTruthy();
    expect(state.map.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 11 }),
    );
    act(() => {
      state.map.zoom = 10;
      state.map.emit('moveend');
    });
    clickMap([
      area('commune', { code: '16015', nom: 'Angoulême', departement: '16' }),
    ]);
    expect(screen.getByRole('button', { name: 'Angoulême' })).toBeTruthy();
    expect(state.map.easeTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 13.05 }),
    );
    expect(state.map.layers.has('area-section')).toBe(false);
    act(() => {
      state.map.zoom = 13;
      state.map.emit('moveend');
    });
    clickMap([{ layer: { id: 'cadastre-fill' }, properties: { id: P2 } }]);
    expect(screen.getByLabelText('Selected parcel').textContent).toBe(P2);
    await user.click(screen.getByRole('button', { name: 'France' }));
    expect(screen.queryByLabelText('Selected parcel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Angoulême' })).toBeNull();
    expect(state.map.fitBounds).toHaveBeenLastCalledWith(
      [
        [-5.2, 41.3],
        [9.7, 51.1],
      ],
      { padding: 35, duration: 700 },
    );
  });
  it('does not jump to an arbitrary location when no geographic polygon is available', () => {
    render(<Harness zoomRequired />);
    act(() => {
      state.map.zoom = 5;
      state.map.emit('load');
    });
    clickMap([]);
    expect(state.map.easeTo).not.toHaveBeenCalled();
    expect(state.map.flyTo).not.toHaveBeenCalled();
  });
  it('recenters an initialized map while new tiles are still loading', () => {
    const view = render(<Harness />);
    act(() => state.map.emit('load'));
    view.rerender(
      <Harness
        focus={{ lon: 0.15, lat: 45.65, zoom: 17, label: '', department: '16' }}
      />,
    );
    expect(state.map.flyTo).toHaveBeenCalledWith({
      center: [0.15, 45.65],
      zoom: 17,
      duration: 900,
      padding: 0,
    });
  });
  it('opens the exact cadastral polygon and highlights it without a point layer', () => {
    render(<Harness />);
    act(() => state.map.emit('load'));
    clickMap([{ layer: { id: 'cadastre-fill' }, properties: { id: P2 } }]);
    expect(screen.getByLabelText('Selected parcel').textContent).toBe(P2);
    expect(state.map.setFilter).toHaveBeenCalledWith('cadastre-selected-line', [
      '==',
      ['get', 'id'],
      P2,
    ]);
    expect(state.map.layers.get('cadastre-fill').minzoom).toBe(13);
    expect(state.map.layers.has('dots')).toBe(false);
    expect(state.map.layers.has('clusters')).toBe(false);
    expect(state.map.sources.has('sales')).toBe(false);
  });

  it('validates cadastral references, including padded metropolitan, Corsican and overseas IDs', () => {
    expect(parcelReference('160015000AB0001')).toBe(P1);
    expect(parcelReference('2A0004000AB0001')).toBe('2A004000AB0001');
    expect(parcelReference('971005000AB0001')).toBe('97105000AB0001');
    expect(parcelReference('invalid')).toBeNull();
  });
});
