"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/map/style";
import type { JourneyRecord, JourneyEvent } from "@/types/blackbox";
import { formatCoordinates } from "@/lib/services/geocoding";

interface Props {
  journey: JourneyRecord;
  selectedEventId?: string | null;
  onSelectEvent?: (event: JourneyEvent) => void;
  className?: string;
}

export function JourneyMapPreview({
  journey,
  selectedEventId,
  onSelectEvent,
  className = "h-72 sm:h-96 w-full",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<InstanceType<typeof maplibregl.Marker>[]>([]);
  const popupRef = useRef<InstanceType<typeof maplibregl.Popup> | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;

    let map: any;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-right"
      );

      map.on("load", () => {
        setMapLoaded(true);
      });

      mapRef.current = map;
    } catch (err) {
      console.error("Failed to initialize MapLibre in JourneyMapPreview:", err);
      return;
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw Journey Line & Event Markers when Map and Data are Ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    // Remove existing markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Extract chronological coordinates
    const coordinates: [number, number][] = journey.points.map((p) => [
      p.longitude,
      p.latitude,
    ]);

    // Path Line Source & Layers
    const sourceId = "journey-path-source";
    const layerCasingId = "journey-path-casing";
    const layerLineId = "journey-path-line";

    if (map.getLayer(layerLineId)) map.removeLayer(layerLineId);
    if (map.getLayer(layerCasingId)) map.removeLayer(layerCasingId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    if (coordinates.length >= 2) {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates,
          },
        },
      });

      // Casing layer for contrast
      map.addLayer({
        id: layerCasingId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#ffffff",
          "line-width": 7,
          "line-opacity": 0.9,
        },
      });

      // Main Path layer
      map.addLayer({
        id: layerLineId,
        type: "line",
        source: sourceId,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#0E7C86",
          "line-width": 4.5,
        },
      });

      // Fit bounds to recorded coordinates
      let minLng = coordinates[0][0];
      let maxLng = coordinates[0][0];
      let minLat = coordinates[0][1];
      let maxLat = coordinates[0][1];

      for (const [lng, lat] of coordinates) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }

      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 40, bottom: 40, left: 40, right: 40 },
          maxZoom: 16,
        }
      );
    } else if (coordinates.length === 1) {
      map.setCenter(coordinates[0]);
      map.setZoom(15);
    }

    // Add Timeline Event Markers
    journey.events.forEach((ev) => {
      if (ev.latitude == null || ev.longitude == null) return;

      const el = createEventMarkerElement(ev);

      el.addEventListener("click", () => {
        onSelectEvent?.(ev);
        focusEventOnMap(ev);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([ev.longitude, ev.latitude])
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [journey, mapLoaded, onSelectEvent]);

  // Focus on selected event
  const focusEventOnMap = useCallback(
    (ev: JourneyEvent) => {
      const map = mapRef.current;
      if (!map || ev.latitude == null || ev.longitude == null) return;

      map.flyTo({
        center: [ev.longitude, ev.latitude],
        zoom: Math.max(15, map.getZoom()),
        speed: 1.4,
      });

      if (popupRef.current) popupRef.current.remove();

      const timeStr = new Date(ev.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const popup = new maplibregl.Popup({ offset: 18, closeButton: false })
        .setLngLat([ev.longitude, ev.latitude])
        .setHTML(
          `<div style="font-family:inherit;font-size:12px;padding:2px 4px">
            <strong style="color:#0B1F33;display:block">${ev.name}</strong>
            <span style="color:#0E7C86;font-size:11px;font-weight:600">${timeStr}</span>
            <div style="color:#5B6B7F;font-size:11px;margin-top:2px">${ev.locationName || formatCoordinates(ev.latitude, ev.longitude)}</div>
          </div>`
        )
        .addTo(map);

      popupRef.current = popup;
    },
    []
  );

  useEffect(() => {
    if (!selectedEventId) return;
    const ev = journey.events.find((e) => e.id === selectedEventId);
    if (ev) {
      focusEventOnMap(ev);
    }
  }, [selectedEventId, journey.events, focusEventOnMap]);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line bg-surface shadow-card">
      <div ref={containerRef} className={className} />

      {/* Legend Badge in Map Corner */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-ink shadow-sm border border-line/70 backdrop-blur-sm">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-safer" /> Start
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-elevated" /> Stop
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-concern" /> End
        </span>
        <span className="flex items-center gap-1 text-muted">
          <span className="h-1.5 w-3 rounded bg-brand inline-block" /> Path
        </span>
      </div>

      {journey.points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-xs p-4 text-center">
          <div className="rounded-xl border border-line bg-white p-4 shadow-sm max-w-xs">
            <p className="text-xs font-semibold text-ink">No GPS Coordinates Recorded</p>
            <p className="text-[11px] text-muted mt-1">
              Location permissions may have been denied or telemetry was unavailable during this trip.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function createEventMarkerElement(ev: JourneyEvent): HTMLElement {
  const container = document.createElement("div");
  container.style.cssText =
    "cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform 0.15s ease;";
  container.setAttribute("title", `${ev.name} (${new Date(ev.timestamp).toLocaleTimeString()})`);

  let bg = "#0E7C86";
  let size = 20;
  let border = "2px solid #ffffff";
  let shadow = "0 2px 6px rgba(11,31,51,0.3)";

  if (ev.type === "journey_started") {
    bg = "#16A34A"; // Green
    size = 22;
  } else if (ev.type === "journey_completed") {
    bg = "#DC2626"; // Red
    size = 24;
  } else if (ev.type === "stop_detected") {
    bg = "#EA580C"; // Orange/Amber
    size = 20;
  } else if (ev.type === "journey_resumed") {
    bg = "#2563EB"; // Blue
    size = 18;
  }

  container.innerHTML = `
    <div style="
      width:${size}px;
      height:${size}px;
      border-radius:999px;
      background:${bg};
      border:${border};
      box-shadow:${shadow};
      display:flex;
      align-items:center;
      justify-content:center;
    ">
      <div style="width:6px;height:6px;border-radius:999px;background:#ffffff;"></div>
    </div>
  `;

  return container;
}
