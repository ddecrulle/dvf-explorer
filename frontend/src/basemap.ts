import type { Map, StyleSpecification } from 'maplibre-gl';

export type Basemap = 'plan' | 'satellite';

export const basemapStyle: StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
    satellite: {
      type: 'raster',
      tiles: [
        'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      ],
      tileSize: 256,
      attribution:
        '<a href="https://geoservices.ign.fr/bdortho">© IGN · BD ORTHO</a>',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'base',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-saturation': -0.7,
        'raster-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          14,
          0.8,
          16,
          0.45,
        ],
      },
    },
    {
      id: 'base-satellite',
      type: 'raster',
      source: 'satellite',
      layout: { visibility: 'none' },
    },
  ],
};

export function setBasemap(map: Map, mode: Basemap) {
  map.setLayoutProperty(
    'base',
    'visibility',
    mode === 'plan' ? 'visible' : 'none',
  );
  map.setLayoutProperty(
    'base-satellite',
    'visibility',
    mode === 'satellite' ? 'visible' : 'none',
  );
}
