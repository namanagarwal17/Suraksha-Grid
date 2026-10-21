/**
 * Historical Crime Evidence MapLibre Layer
 *
 * Renders verified NCRB district boundary polygons with thematic fill and border.
 * Features interactive popups displaying verified crime categories, incident counts,
 * year, data provenance, and clear area-level disclaimers.
 */
import type { CrimeDistrictProperties, CrimeGeoJSON } from "@/lib/services/crime";

export const LAYER_FILL   = "crime-areas-fill";
export const LAYER_BORDER = "crime-areas-border";
export const SOURCE_ID    = "crime-areas";

export const EMPTY_CRIME_FC: CrimeGeoJSON = { type: "FeatureCollection", features: [] };

type MapInstance = {
  addSource: (id: string, source: any) => void;
  addLayer: (layer: any, beforeId?: string) => void;
  getSource: (id: string) => any;
  getLayer: (id: string) => any;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  setLayoutProperty: (layerId: string, name: string, value: any) => void;
  on: (event: string, layerId: string, listener: (e: any) => void) => void;
  off: (event: string, layerId: string, listener: (e: any) => void) => void;
  getCanvas: () => HTMLElement;
};

export function addCrimeOverlay(
  map: MapInstance,
  fc: CrimeGeoJSON,
  beforeLayerId?: string
): void {
  if (!fc.features.length) return;

  const src = map.getSource(SOURCE_ID);
  if (src && typeof src.setData === "function") {
    src.setData(fc);
  } else if (!src) {
    map.addSource(SOURCE_ID, { type: "geojson", data: fc });
  }

  if (!map.getLayer(LAYER_FILL)) {
    map.addLayer(
      {
        id: LAYER_FILL,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": [
            "interpolate",
            ["linear"],
            ["get", "severity_weight"],
            0.2, "#FEF08A",
            0.5, "#FDBA74",
            0.75, "#F87171",
            1.0, "#DC2626",
          ],
          "fill-opacity": 0.16,
        },
      },
      beforeLayerId
    );
  }

  if (!map.getLayer(LAYER_BORDER)) {
    map.addLayer(
      {
        id: LAYER_BORDER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": "#C2410C",
          "line-width": 1.2,
          "line-opacity": 0.5,
        },
      },
      beforeLayerId
    );
  }
}

export function removeCrimeOverlay(map: MapInstance): void {
  if (map.getLayer(LAYER_BORDER)) map.removeLayer(LAYER_BORDER);
  if (map.getLayer(LAYER_FILL))   map.removeLayer(LAYER_FILL);
  if (map.getSource(SOURCE_ID))   map.removeSource(SOURCE_ID);
}

export function setCrimeOverlayVisibility(map: MapInstance, visible: boolean): void {
  const val = visible ? "visible" : "none";
  if (map.getLayer(LAYER_BORDER)) map.setLayoutProperty(LAYER_BORDER, "visibility", val);
  if (map.getLayer(LAYER_FILL))   map.setLayoutProperty(LAYER_FILL, "visibility", val);
}

export function buildDistrictPopupHtml(props: Record<string, any>): string {
  const district = props.district || "District";
  const state = props.state || "State";
  const total = Number(props.total_incidents || 0).toLocaleString();
  const women = Number(props.women_cases || 0).toLocaleString();
  const children = Number(props.children_cases || 0).toLocaleString();
  const ipc = Number(props.ipc_cases || 0).toLocaleString();
  const sll = Number(props.sll_cases || 0).toLocaleString();
  const level = props.evidence_level || "LOW";
  const year = props.year || 2023;
  const source = props.source || "NCRB";

  const badgeColor =
    level === "HIGH"
      ? "background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5"
      : level === "MODERATE"
      ? "background:#FFEDD5;color:#9A3412;border:1px solid #FDBA74"
      : "background:#FEF9C3;color:#854D0E;border:1px solid #FEF08A";

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:12px;line-height:1.45;color:#0F172A;min-width:230px;max-width:280px;padding:2px 0">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">
        <h4 style="font-weight:700;font-size:14px;margin:0;color:#0F172A">${district}</h4>
        <span style="font-size:10px;font-weight:600;padding:2px 6px;border-radius:999px;${badgeColor}">
          ${level} EXPOSURE
        </span>
      </div>
      <p style="margin:0 0 8px 0;font-size:11px;color:#64748B">${state} · ${year} Evidence</p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:6px 8px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;border-bottom:1px solid #E2E8F0;padding-bottom:4px">
          <span style="font-size:11px;font-weight:600;color:#334155">Total Reported Crimes</span>
          <span style="font-size:13px;font-weight:700;color:#0F172A">${total}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px;color:#475569">
          <tr><td style="padding:1px 0">Crimes against Women</td><td style="font-weight:600;text-align:right;color:#0F172A">${women}</td></tr>
          <tr><td style="padding:1px 0">Crimes against Children</td><td style="font-weight:600;text-align:right;color:#0F172A">${children}</td></tr>
          <tr><td style="padding:1px 0">Cognizable IPC Crimes</td><td style="font-weight:600;text-align:right;color:#0F172A">${ipc}</td></tr>
          <tr><td style="padding:1px 0">Special & Local Laws (SLL)</td><td style="font-weight:600;text-align:right;color:#0F172A">${sll}</td></tr>
        </table>
      </div>

      <div style="font-size:10px;color:#64748B;line-height:1.35;border-top:1px solid #E2E8F0;padding-top:6px">
        <span style="font-weight:600;color:#475569">Source:</span> ${source} (${props.source_dataset || "Crime in India " + year})
        <p style="margin:4px 0 0 0;color:#94A3B8;font-style:italic">
          Area-level historical evidence only. Does not indicate an incident occurred on any specific street or road.
        </p>
      </div>
    </div>
  `;
}