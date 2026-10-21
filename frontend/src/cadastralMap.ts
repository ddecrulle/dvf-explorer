import type { Map, FilterSpecification } from 'maplibre-gl';

export const PARCEL_ZOOM = 13;

export function cadastralSelection(id?: string): FilterSpecification {
  return ['==', ['get', 'id'], id ?? ''];
}

export function addCadastre(map: Map, sold: string[], selected?: string) {
  map.addSource('cadastre', {
    type: 'vector',
    url: 'https://openmaptiles.data.gouv.fr/data/cadastre.json',
    promoteId: { parcelles: 'id' },
  });
  const layer = {
    source: 'cadastre',
    'source-layer': 'parcelles',
    minzoom: PARCEL_ZOOM,
  };
  map.addLayer({
    ...layer,
    id: 'cadastre-fill',
    type: 'fill',
    paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-sales',
    type: 'fill',
    filter: ['in', ['get', 'id'], ['literal', sold]],
    paint: { 'fill-color': '#00875a', 'fill-opacity': 0.6 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-lines',
    type: 'line',
    paint: { 'line-color': '#85918b', 'line-opacity': 0.4, 'line-width': 0.7 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-sales-lines',
    type: 'line',
    filter: ['in', ['get', 'id'], ['literal', sold]],
    paint: { 'line-color': '#006644', 'line-opacity': 0.95, 'line-width': 1.5 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-selected-fill',
    type: 'fill',
    filter: cadastralSelection(selected),
    paint: { 'fill-color': '#f2ab3c', 'fill-opacity': 0.85 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-selected-line',
    type: 'line',
    filter: cadastralSelection(selected),
    paint: { 'line-color': '#a9661f', 'line-width': 3 },
  });
}

export function updateCadastre(
  map: Map | null,
  sold: string[],
  selected?: string,
) {
  if (map?.getLayer('cadastre-sales')) {
    map.setFilter('cadastre-sales', ['in', ['get', 'id'], ['literal', sold]]);
    map.setFilter('cadastre-sales-lines', [
      'in',
      ['get', 'id'],
      ['literal', sold],
    ]);
    map.setFilter('cadastre-selected-fill', cadastralSelection(selected));
    map.setFilter('cadastre-selected-line', cadastralSelection(selected));
  }
}
