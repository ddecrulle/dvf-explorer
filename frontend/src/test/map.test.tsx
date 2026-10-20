import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ParcelMap from '../components/ParcelMap';
import { parcelReference } from '../mapData';
import type {
  Location,
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
    canvas = { style: { cursor: '' }, setAttribute: vi.fn() };
    setFilter = vi.fn();
    setLayoutProperty = vi.fn();
    easeTo = vi.fn();
    flyTo = vi.fn();
    constructor() {
      state.map = this;
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
      return 16;
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
}: {
  result?: ParcelsResponse;
  focus?: (Location & { zoom: number }) | null;
}) {
  const [selected, setSelected] = useState<ParcelSelection | null>(null);
  return (
    <ParcelMap
      focus={focus}
      release="pinned"
      onViewport={vi.fn()}
      data={result}
      selected={selected}
      onSelect={setSelected}
      onCloseSelection={() => setSelected(null)}
      hidden={false}
      year={0}
      loading={false}
      zoomRequired={false}
    />
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
    expect(state.map.layers.get('cadastre-fill').minzoom).toBe(15);
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
