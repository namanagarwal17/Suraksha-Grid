
/**
 * MapLibre style + view defaults.
 *
 * Primary basemap: MapTiler Streets v2, when its key is configured.
 * Fallback basemap: CARTO Voyager raster tiles.
 *
 * Environment variables:
 *   NEXT_PUBLIC_MAPTILER_KEY
 *   NEXT_PUBLIC_CARTO_API_KEY
 *
 * Keep the required OpenStreetMap and CARTO attribution visible.
 */

import type { MapOptions } from "maplibre-gl";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY ?? "";

const CARTO_RASTER_TILES = [
  "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
  "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
];

/**
 * CARTO Voyager provides an OSM-based raster basemap.
 * Multi-subdomain URLs enable parallel tile downloads without connection bottlenecks.
 * Configured API key is appended as query parameter.
 */
export const CARTO_VOYAGER_STYLE = {
  version: 8 as const,
  sources: {
    "carto-voyager": {
      type: "raster" as const,
      tiles: CARTO_RASTER_TILES.map((url) =>
        CARTO_KEY ? `${url}?key=${encodeURIComponent(CARTO_KEY)}` : url
      ),
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "carto-voyager-layer",
      type: "raster" as const,
      source: "carto-voyager",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

function buildMapStyle(): NonNullable<MapOptions["style"]> {
  if (MAPTILER_KEY) {
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`;
  }

  // CARTO Voyager Vector GL Style provides native high-DPI rendering, crisp street labels,
  // park and landmark styling without raster scaling blur.
  const cartoGlUrl = CARTO_KEY
    ? `https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json?key=${encodeURIComponent(CARTO_KEY)}`
    : "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";

  return cartoGlUrl;
}

export const MAP_STYLE = buildMapStyle();

export const DEFAULT_CENTER: [number, number] = [77.06, 28.46];
export const DEFAULT_ZOOM = 13.2;
export const MAX_FIT_ZOOM = 15.5;
