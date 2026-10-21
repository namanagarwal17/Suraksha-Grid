"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, LngLatLike } from "maplibre-gl";
import type { LngLat, MapMarker, MarkerKind, RouteId, RouteOption, Segment } from "@/types";
import { LEVELS } from "@/lib/constants";
import { levelOf } from "@/lib/utils";
import { DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLE, MAX_FIT_ZOOM, CARTO_VOYAGER_STYLE } from "@/lib/map/style";
import { MapErrorOverlay, MapLoadingOverlay } from "./map-states";
import {
  addCrimeOverlay,
  removeCrimeOverlay,
  setCrimeOverlayVisibility,
  buildDistrictPopupHtml,
  LAYER_FILL as CRIME_LAYER_FILL,
} from "./crime-overlay";
import type { CrimeGeoJSON } from "@/lib/services/crime";

export interface RouteLine { route: RouteOption; coords: LngLat[] }

interface Props {
  segments?: Segment[];
  selectedSegmentId?: string;
  onSelectSegment?: (id: string) => void;
  routeLines?: RouteLine[];
  selectedRouteId?: RouteId | string;
  onSelectRoute?: (id: RouteId) => void;
  markers?: MapMarker[];
  showOverlay?: boolean;  // toggle segment safety layer visibility
  crimeGeoJSON?: CrimeGeoJSON | null;
  showCrimeOverlay?: boolean; // toggle historical crime district polygons
  onSelectCrimeDistrict?: (props: Record<string, unknown>) => void;
  className?: string;
}

const MARKER_COLOR: Record<MarkerKind, string> = {
  you: "#0E7C86", dest: "#0B1F33", report: "#EA580C", help: "#2563EB",
};

// Inject CSS animation for the radar beacon once in the document
if (typeof document !== "undefined" && !document.getElementById("suraksha-map-styles")) {
  const styleEl = document.createElement("style");
  styleEl.id = "suraksha-map-styles";
  styleEl.textContent = `
    @keyframes suraksha-radar {
      0% { transform: scale(0.9); opacity: 0.85; }
      60% { transform: scale(2.3); opacity: 0; }
      100% { transform: scale(0.9); opacity: 0; }
    }
    @keyframes suraksha-pulse-subtle {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }
    .maplibregl-ctrl-scale {
      background-color: rgba(255, 255, 255, 0.9) !important;
      border: 2px solid #0B1F33 !important;
      border-top: none !important;
      font-size: 10px !important;
      font-weight: 600 !important;
      color: #0B1F33 !important;
      padding: 1px 4px !important;
      border-radius: 0 0 4px 4px !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15) !important;
    }
  `;
  document.head.appendChild(styleEl);
}

function markerElement(kind: MarkerKind, label: string): HTMLElement {
  if (kind === "you") {
    const container = document.createElement("div");
    container.setAttribute("aria-label", label);
    container.style.cssText = "position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:default";
    
    const ripple = document.createElement("div");
    ripple.style.cssText = "position:absolute;width:100%;height:100%;border-radius:999px;background:rgba(14,124,134,0.4);animation:suraksha-radar 2.4s ease-out infinite;pointer-events:none";
    
    const core = document.createElement("div");
    core.style.cssText = "position:relative;width:16px;height:16px;border-radius:999px;background:#0E7C86;border:3px solid #ffffff;box-shadow:0 2px 6px rgba(11,31,51,0.45)";
    
    container.appendChild(ripple);
    container.appendChild(core);
    return container;
  }

  if (kind === "dest") {
    const container = document.createElement("div");
    container.setAttribute("aria-label", label);
    container.style.cssText = "position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;filter:drop-shadow(0 3px 6px rgba(11,31,51,0.4))";
    container.innerHTML = `
      <svg width="28" height="34" viewBox="0 0 28 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 20 14 20s14-9.5 14-20c0-7.732-6.268-14-14-14z" fill="#0B1F33"/>
        <circle cx="14" cy="13" r="6" fill="#ffffff"/>
        <circle cx="14" cy="13" r="3.5" fill="#EF4444"/>
      </svg>
    `;
    return container;
  }

  if (kind === "report") {
    const container = document.createElement("div");
    container.setAttribute("aria-label", label);
    container.style.cssText = "position:relative;width:22px;height:22px;border-radius:999px;background:#EA580C;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(234,88,12,0.45);display:flex;align-items:center;justify-content:center;color:white;cursor:pointer";
    container.innerHTML = `
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    `;
    return container;
  }

  // help point
  const container = document.createElement("div");
  container.setAttribute("aria-label", label);
  container.style.cssText = "position:relative;width:22px;height:22px;border-radius:999px;background:#2563EB;border:2.5px solid #ffffff;box-shadow:0 2px 6px rgba(37,99,235,0.45);display:flex;align-items:center;justify-content:center;color:white;cursor:pointer";
  container.innerHTML = `
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  `;
  return container;
}

function toGeoJSON(segs: Segment[], selectedId?: string) {
  const features = segs.map((s) => ({
    type: "Feature" as const,
    properties: { id: s.id, color: LEVELS[levelOf(s.score)].hex, selected: s.id === selectedId ? 1 : 0 },
    geometry: { type: "LineString" as const, coordinates: s.coords as number[][] },
  }));
  // Ensure selected road segment is drawn on top
  features.sort((a, b) => (a.properties.selected || 0) - (b.properties.selected || 0));
  return {
    type: "FeatureCollection" as const,
    features,
  };
}

function toRouteGeoJSON(lines: RouteLine[], selectedId?: string) {
  const features = lines.map(({ route, coords }) => {
    const isSelected = route.id === selectedId;
    return {
      type: "Feature" as const,
      properties: {
        id: route.id,
        name: route.name,
        etaMin: route.etaMin,
        distanceKm: route.distanceKm,
        score: route.score,
        color: LEVELS[levelOf(route.score)].hex,
        selected: isSelected ? 1 : 0,
      },
      geometry: { type: "LineString" as const, coordinates: coords as number[][] },
    };
  });

  // Ensure non-selected routes are drawn first and active selected route on top
  features.sort((a, b) => (a.properties.selected || 0) - (b.properties.selected || 0));

  return {
    type: "FeatureCollection" as const,
    features,
  };
}

/**
 * Reusable MapLibre GL map. Client-only, self-cleans on unmount.
 * Takes the same segment/route/marker data shapes the rest of the app uses
 * so pages hold no MapLibre-specific logic.
 */
export function MapLibreMap({
  segments = [], selectedSegmentId, onSelectSegment,
  routeLines = [], selectedRouteId, onSelectRoute,
  markers = [], showOverlay = true,
  crimeGeoJSON, showCrimeOverlay = false, onSelectCrimeDistrict,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<InstanceType<typeof maplibregl.Map> | null>(null);
  const markerRefs = useRef<InstanceType<typeof maplibregl.Marker>[]>([]);
  const hasFit = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);

  // ---- init ----
  useEffect(() => {
    if (!containerRef.current) return;
    setStatus("loading");
    hasFit.current = false;
    let map: InstanceType<typeof maplibregl.Map>;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
      });
    } catch {
      setStatus("error");
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    const hasLoadedRef = { current: false };
    const onLoad = () => {
      hasLoadedRef.current = true;
      setStatus("ready");
    };
    const onError = (e: unknown) => {
      if (!hasLoadedRef.current) {
        console.warn("[MapLibre] Style load issue, attempting raster fallback:", e);
        try {
          map.setStyle(CARTO_VOYAGER_STYLE as unknown as string);
        } catch {
          setStatus("error");
        }
      }
    };
    map.on("load", onLoad);
    map.on("error", onError);

    const ro = new ResizeObserver(() => map.resize());
    if (containerRef.current) ro.observe(containerRef.current);

    const onRecenter = (e: Event) => {
      const ce = e as CustomEvent<{ lng: number; lat: number }>;
      if (ce.detail && mapRef.current) {
        mapRef.current.flyTo({
          center: [ce.detail.lng, ce.detail.lat],
          zoom: 15,
          speed: 1.2,
          curve: 1.4,
        });
      }
    };
    window.addEventListener("suraksha-grid:recenter", onRecenter);

    return () => {
      ro.disconnect();
      window.removeEventListener("suraksha-grid:recenter", onRecenter);
      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];
      segmentPopupRef.current?.remove();
      map.off("load", onLoad as (e: unknown) => void);
      map.off("error", onError as (e: unknown) => void);
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const segmentPopupRef = useRef<InstanceType<typeof maplibregl.Popup> | null>(null);
  const crimePopupRef = useRef<InstanceType<typeof maplibregl.Popup> | null>(null);

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const showOverlayRef = useRef(showOverlay);
  showOverlayRef.current = showOverlay;

  const showCrimeOverlayRef = useRef(showCrimeOverlay);
  showCrimeOverlayRef.current = showCrimeOverlay;

  const onSelectSegmentRef = useRef(onSelectSegment);
  onSelectSegmentRef.current = onSelectSegment;

  const onSelectRouteRef = useRef(onSelectRoute);
  onSelectRouteRef.current = onSelectRoute;

  const onSelectCrimeDistrictRef = useRef(onSelectCrimeDistrict);
  onSelectCrimeDistrictRef.current = onSelectCrimeDistrict;

  // ---- crime district overlay layer ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    if (!crimeGeoJSON || !crimeGeoJSON.features.length) {
      removeCrimeOverlay(map as any);
      return;
    }

    addCrimeOverlay(
      map as any,
      crimeGeoJSON,
      map.getLayer("segments-casing") ? "segments-casing" : undefined
    );
    setCrimeOverlayVisibility(map as any, showCrimeOverlay);

    const crimePopup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: "300px",
    });

    const onClickCrime = (e: any) => {
      if (!showCrimeOverlayRef.current) return;
      const props = e.features?.[0]?.properties;
      if (!props) return;
      onSelectCrimeDistrictRef.current?.(props);
      crimePopup
        .setLngLat(e.lngLat)
        .setHTML(buildDistrictPopupHtml(props))
        .addTo(map);
      crimePopupRef.current = crimePopup;
    };

    const onEnterCrime = () => {
      if (showCrimeOverlayRef.current) map.getCanvas().style.cursor = "pointer";
    };

    const onLeaveCrime = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", CRIME_LAYER_FILL, onClickCrime);
    map.on("mouseenter", CRIME_LAYER_FILL, onEnterCrime);
    map.on("mouseleave", CRIME_LAYER_FILL, onLeaveCrime);

    return () => {
      (map as any).off("click", CRIME_LAYER_FILL, onClickCrime);
      (map as any).off("mouseenter", CRIME_LAYER_FILL, onEnterCrime);
      (map as any).off("mouseleave", CRIME_LAYER_FILL, onLeaveCrime);
      crimePopup.remove();
    };
  }, [crimeGeoJSON, status]);

  // ---- crime overlay toggle ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    setCrimeOverlayVisibility(map as any, showCrimeOverlay);
    if (!showCrimeOverlay) {
      crimePopupRef.current?.remove();
    }
  }, [showCrimeOverlay, status]);

  // ---- segment layer ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const fc = toGeoJSON(segments, selectedSegmentId);
    const src = map.getSource("segments") as GeoJSONSource | undefined;
    if (src) { src.setData(fc); return; }
    if (!segments.length) return;
    map.addSource("segments", { type: "geojson", data: fc });
    const initialVisibility = showOverlay ? "visible" : "none";
    map.addLayer({ id: "segments-casing", type: "line", source: "segments", layout: { "line-cap": "round", "line-join": "round", visibility: initialVisibility }, paint: { "line-color": "#ffffff", "line-width": ["case", ["==", ["get", "selected"], 1], 8, 5] } });
    map.addLayer({ id: "segments-line",   type: "line", source: "segments", layout: { "line-cap": "round", "line-join": "round", visibility: initialVisibility }, paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "selected"], 1], 5.5, 3.5] } });

    // Click popup — shows real Safety Engine data from latest Segment object
    const segmentPopup = new maplibregl.Popup({
      closeButton: true,
      maxWidth: "260px",
    });

    map.on("click", "segments-line", (e) => {
      if (!showOverlayRef.current) return;
      const props = e.features?.[0]?.properties as Record<string, unknown> | undefined;
      if (!props) return;
      const id = props["id"] as string;
      if (!id) return;

      onSelectSegmentRef.current?.(id);

      const seg = segmentsRef.current.find((s) => s.id === id);
      if (!seg) return;
      const levelLabel = seg.score >= 80 ? "Higher Safety Score"
                       : seg.score >= 65 ? "Moderate"
                       : seg.score >= 50 ? "Elevated Caution"
                       : "Higher Caution";
      const color = seg.score >= 80 ? "#16A34A"
                  : seg.score >= 65 ? "#CA9A04"
                  : seg.score >= 50 ? "#EA580C"
                  : "#DC2626";
      const reportsRow = seg.recentReportCount
        ? `<tr><td style="color:#EA580C;padding:1px 0">Recent reports</td><td style="font-weight:600;text-align:right;color:#EA580C">${seg.recentReportCount}</td></tr>`
        : "";
      const explanationSnip = seg.explanation
        ? `<p style="margin:6px 0 0;color:#6b7280;font-size:11px;border-top:1px solid #e5e7eb;padding-top:5px">${seg.explanation.slice(0, 130)}${seg.explanation.length > 130 ? "\u2026" : ""}</p>`
        : "";
      segmentPopup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.5">
            <p style="font-weight:700;font-size:13px;margin:0 0 6px 0">${seg.name}</p>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
              <span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${color};flex-shrink:0"></span>
              <span style="font-weight:600;color:${color}">${levelLabel}</span>
            </div>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="color:#6b7280;padding:1px 0">Safety Score</td><td style="font-weight:600;text-align:right">${seg.score}<span style="font-weight:400;color:#9ca3af">/100</span></td></tr>
              <tr><td style="color:#6b7280;padding:1px 0">Confidence</td><td style="font-weight:600;text-align:right">${seg.confidence}%</td></tr>
              <tr><td style="color:#6b7280;padding:1px 0">Lighting</td><td style="font-weight:600;text-align:right">${seg.lighting}/100</td></tr>
              <tr><td style="color:#6b7280;padding:1px 0">Activity</td><td style="font-weight:600;text-align:right">${seg.activity}/100</td></tr>
              <tr><td style="color:#6b7280;padding:1px 0">Emergency</td><td style="font-weight:600;text-align:right">${seg.emergency}</td></tr>
              ${reportsRow}
            </table>
            ${explanationSnip}
            <p style="margin:5px 0 0;color:#9ca3af;font-size:10px">Score is a safety index (0–100), not a crime probability.</p>
          </div>`
        )
        .addTo(map);
      segmentPopupRef.current = segmentPopup;
    });

    map.on("mouseenter", "segments-line", () => {
      if (showOverlayRef.current) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "segments-line", () => {
      map.getCanvas().style.cursor = "";
    });
  }, [segments, selectedSegmentId, status, showOverlay]);

  // ---- overlay visibility toggle ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const visibility = showOverlay ? "visible" : "none";
    if (map.getLayer("segments-casing")) map.setLayoutProperty("segments-casing", "visibility", visibility);
    if (map.getLayer("segments-line"))   map.setLayoutProperty("segments-line",   "visibility", visibility);
    if (!showOverlay) {
      segmentPopupRef.current?.remove();
    }
  }, [showOverlay, status]);

  // ---- route lines ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    const fc = toRouteGeoJSON(routeLines, selectedRouteId);
    const src = map.getSource("route-lines") as GeoJSONSource | undefined;
    if (src) { src.setData(fc); return; }
    if (!routeLines.length) return;
    map.addSource("route-lines", { type: "geojson", data: fc });

    // 1. Crisp white outer casing
    map.addLayer({
      id: "route-casing",
      type: "line",
      source: "route-lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["==", ["get", "selected"], 1], 10, 5.5],
        "line-opacity": ["case", ["==", ["get", "selected"], 1], 1.0, 0.65],
      },
    });

    // 2. Main route path (vibrant safety color for active, muted slate for alternatives)
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route-lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["case", ["==", ["get", "selected"], 1], ["get", "color"], "#64748B"],
        "line-width": ["case", ["==", ["get", "selected"], 1], 6.5, 3.5],
        "line-opacity": ["case", ["==", ["get", "selected"], 1], 1.0, 0.6],
      },
    });

    // 3. Inner 3D specular highlight for selected route
    map.addLayer({
      id: "route-inner",
      type: "line",
      source: "route-lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["case", ["==", ["get", "selected"], 1], 2, 0],
        "line-opacity": ["case", ["==", ["get", "selected"], 1], 0.45, 0],
      },
    });

    const routePopup = new maplibregl.Popup({
      closeButton: false,
      offset: 10,
    });

    map.on("click", "route-line", (e) => {
      const id = e.features?.[0]?.properties?.["id"] as RouteId | undefined;
      if (id) onSelectRouteRef.current?.(id);
    });

    map.on("mouseenter", "route-line", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const props = e.features?.[0]?.properties;
      if (!props) return;
      const isSelected = props["selected"] === 1;
      const name = props["name"] || "Route";
      const eta = props["etaMin"] ? `${props["etaMin"]} min` : "";
      const dist = props["distanceKm"] ? `${props["distanceKm"]} km` : "";
      const score = props["score"] !== undefined ? `Safety: ${props["score"]}/100` : "";

      if (!isSelected) {
        routePopup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:system-ui,sans-serif;font-size:11px;padding:3px 6px">
              <strong>${name}</strong> · ${eta} (${dist})
              <div style="color:#0E7C86;font-size:10px;margin-top:2px">${score} · Click to select</div>
            </div>`
          )
          .addTo(map);
      }
    });

    map.on("mouseleave", "route-line", () => {
      map.getCanvas().style.cursor = "";
      routePopup.remove();
    });
  }, [routeLines, selectedRouteId, status]);

  // ---- z-order: crime -> segments -> route layers ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    if (map.getLayer("crime-areas-fill")) map.moveLayer("crime-areas-fill");
    if (map.getLayer("crime-areas-border")) map.moveLayer("crime-areas-border");
    if (map.getLayer("segments-casing")) map.moveLayer("segments-casing");
    if (map.getLayer("segments-line")) map.moveLayer("segments-line");
    if (map.getLayer("route-casing")) map.moveLayer("route-casing");
    if (map.getLayer("route-line")) map.moveLayer("route-line");
    if (map.getLayer("route-inner")) map.moveLayer("route-inner");
  }, [selectedRouteId, selectedSegmentId, showCrimeOverlay, status]);

  // ---- markers ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;
    markerRefs.current.forEach((m) => m.remove());
    markerRefs.current = markers.map((m) => {
      const anchor: maplibregl.PositionAnchor = m.kind === "dest" ? "bottom" : "center";
      return new maplibregl.Marker({ element: markerElement(m.kind, m.label), anchor })
        .setLngLat([m.lng, m.lat] as LngLatLike)
        .setPopup(new maplibregl.Popup({ offset: m.kind === "dest" ? 34 : 14, closeButton: false }).setText(m.label))
        .addTo(map);
    });
  }, [markers, status]);

  // ---- fit bounds once on initial data ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || hasFit.current) return;
    const all: LngLat[] = [
      ...segments.flatMap((s) => s.coords),
      ...routeLines.flatMap((r) => r.coords),
      ...markers.map((m): LngLat => [m.lng, m.lat]),
    ];
    if (!all.length) return;
    const bounds = all.reduce(
      (b, c) => b.extend(c as LngLatLike),
      new maplibregl.LngLatBounds(all[0] as LngLatLike, all[0] as LngLatLike)
    );
    map.fitBounds(bounds, { padding: 56, duration: 0, maxZoom: MAX_FIT_ZOOM });
    hasFit.current = true;
  }, [segments, routeLines, markers, status]);

  // ---- fit bounds to route when active route lines update ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || !routeLines.length) return;
    const allRouteCoords = routeLines.flatMap((r) => r.coords);
    if (!allRouteCoords.length) return;
    const bounds = allRouteCoords.reduce(
      (b, c) => b.extend(c as LngLatLike),
      new maplibregl.LngLatBounds(allRouteCoords[0] as LngLatLike, allRouteCoords[0] as LngLatLike)
    );
    const isMobile = typeof window !== "undefined" && window.innerWidth < 1024;
    map.fitBounds(bounds, {
      padding: {
        top: 80,
        bottom: isMobile ? 220 : 120,
        left: 50,
        right: 50,
      },
      duration: 600,
      maxZoom: MAX_FIT_ZOOM,
    });
  }, [routeLines, status]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={containerRef} className="h-full w-full" />
      {status === "loading" && <MapLoadingOverlay />}
      {status === "error"   && <MapErrorOverlay onRetry={() => setRetryKey((k) => k + 1)} />}
    </div>
  );
}