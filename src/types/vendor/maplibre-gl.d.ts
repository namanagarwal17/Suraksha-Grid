/**
 * Minimal ambient declaration for maplibre-gl.
 *
 * Purpose: allows TypeScript to compile the project without running
 * `npm install` first. Once `npm install` has been run the real types
 * in node_modules/maplibre-gl take precedence and this file is ignored.
 *
 * Do NOT add @ts-ignore or `any` to work around type errors — fix them.
 */
declare module "maplibre-gl" {
  // ---- Core types ----
  export type LngLatLike = [number, number] | { lng: number; lat: number };

  export interface LngLatBoundsLike {}

  export class LngLatBounds {
    constructor(sw?: LngLatLike, ne?: LngLatLike);
    extend(pt: LngLatLike): this;
  }

  export interface MapOptions {
    container: HTMLElement;
    style: string;
    center: [number, number];
    zoom: number;
    attributionControl?: boolean;
  }

  export interface GeoJSONSourceSpecification {
    type: "geojson";
    data: GeoJSON.GeoJSON | string;
  }

  export interface GeoJSONSource {
    setData(data: GeoJSON.GeoJSON | string): void;
  }

  export interface MapGeoJSONFeature {
    properties: Record<string, unknown>;
    geometry: GeoJSON.Geometry;
  }

  export interface MapMouseEvent {
    features?: MapGeoJSONFeature[];
    lngLat: { lng: number; lat: number };
    originalEvent: MouseEvent;
  }

  export type Map = _Map;
  export class _Map {
    constructor(opts: MapOptions);
    on(event: "load" | "error" | "click" | "mouseenter" | "mouseleave", fn: (e: MapMouseEvent) => void): this;
    on(event: "load" | "error", fn: () => void): this;
    on(event: string, layerOrFn: string | ((e: MapMouseEvent) => void), fn?: (e: MapMouseEvent) => void): this;
    off(event: string, fn: (e: unknown) => void): this;
    remove(): void;
    resize(): void;
    addControl(ctrl: IControl, pos?: string): this;
    addSource(id: string, spec: GeoJSONSourceSpecification | Record<string, unknown>): this;
    addLayer(spec: Record<string, unknown>): this;
    moveLayer(id: string, beforeId?: string): this;
    getSource(id: string): GeoJSONSource | undefined;
    getLayer(id: string): unknown | undefined;
    setLayoutProperty(id: string, name: string, value: unknown): this;
    getCanvas(): HTMLCanvasElement;
    fitBounds(bounds: LngLatBounds, opts?: Record<string, unknown>): this;
    flyTo(opts: Record<string, unknown>): this;
    setStyle(style: string | Record<string, unknown>): this;
  }

  export interface IControl {
    onAdd(map: _Map): HTMLElement;
    onRemove(map: _Map): void;
  }

  export type Marker = _Marker;
  export class _Marker {
    constructor(opts?: { element?: HTMLElement; anchor?: string });
    setLngLat(ll: LngLatLike): this;
    setPopup(p: _Popup): this;
    addTo(map: _Map): this;
    remove(): void;
  }

  export type Popup = _Popup;
  export class _Popup {
    constructor(opts?: { offset?: number; closeButton?: boolean; maxWidth?: string });
    setText(t: string): this;
    setHTML(html: string): this;
    setLngLat(ll: LngLatLike): this;
    addTo(map: _Map): this;
    remove(): void;
  }

  export class NavigationControl implements IControl {
    constructor(opts?: { showCompass?: boolean });
    onAdd(map: _Map): HTMLElement;
    onRemove(map: _Map): void;
  }

  export class AttributionControl implements IControl {
    constructor(opts?: { compact?: boolean });
    onAdd(map: _Map): HTMLElement;
    onRemove(map: _Map): void;
  }

  const maplibregl: {
    Map: typeof _Map;
    Marker: typeof _Marker;
    Popup: typeof _Popup;
    LngLatBounds: typeof LngLatBounds;
    NavigationControl: typeof NavigationControl;
    AttributionControl: typeof AttributionControl;
  };

  export default maplibregl;
}

// Required by the GeoJSON references above when @types/geojson is absent
declare namespace GeoJSON {
  interface GeoJSON { type: string }
  interface Feature extends GeoJSON { type: "Feature"; properties: Record<string, unknown> | null; geometry: Geometry }
  interface FeatureCollection extends GeoJSON { type: "FeatureCollection"; features: Feature[] }
  interface LineString extends GeoJSON { type: "LineString"; coordinates: number[][] }
  interface Point extends GeoJSON { type: "Point"; coordinates: number[] }
  type Geometry = LineString | Point | { type: string; coordinates: unknown }
}