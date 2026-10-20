import type { Map, FilterSpecification } from 'maplibre-gl';

export const PARCEL_ZOOM = 15;

export function cadastralSelection(id?: string): FilterSpecification {
  return ['==', ['get', 'id'], id ?? ''];
}

export function addCadastre(map: Map, sold: string[], selected?: string) {
  map.addSource('cadastre', {
    type: 'vector',
    url: 'https://openmaptiles.data.gouv.fr/data/cadastre.json',
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
    paint: { 'fill-color': '#2e6955', 'fill-opacity': 0.025 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-sales',
    type: 'fill',
    filter: ['in', ['get', 'id'], ['literal', sold]],
    paint: { 'fill-color': '#2e6955', 'fill-opacity': 0.22 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-lines',
    type: 'line',
    paint: { 'line-color': '#526f62', 'line-opacity': 0.65, 'line-width': 1 },
  });
  map.addLayer({
    ...layer,
    id: 'cadastre-selected-fill',
    type: 'fill',
    filter: cadastralSelection(selected),
    paint: { 'fill-color': '#d28c38', 'fill-opacity': 0.3 },
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
    map.setFilter('cadastre-selected-fill', cadastralSelection(selected));
    map.setFilter('cadastre-selected-line', cadastralSelection(selected));
  }
}
