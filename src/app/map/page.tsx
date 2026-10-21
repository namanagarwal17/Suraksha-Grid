"use client";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Search,
  LocateFixed,
  Bell,
  Phone,
  Loader2,
  MapPinOff,
  MapPin,
  X,
  Clock,
  Ruler,
  AlertTriangle,
  Zap,
  Scale,
  ShieldCheck,
  Layers,
  Database,
} from "lucide-react";
import { MapLayout } from "@/components/map/map-layout";
import { MapLibreMap } from "@/components/map/maplibre-map";
import { LEVELS, MAP_LEGEND_LABELS } from "@/lib/constants";
import { SafetyLens } from "@/components/safety/safety-lens";
import { AnomalyBanner } from "@/components/safety/anomaly-banner";
import { EmergencyAlert } from "@/components/emergency/emergency-alert";
import { JourneyRecordingBanner } from "@/components/blackbox/journey-recording-banner";
import { buttonVariants } from "@/components/ui/button";
import { getSegments } from "@/lib/services/segments";
import { getReports } from "@/lib/services/reports";
import {
  subscribeToReports,
  subscribeToSegmentUpdates,
  triggerRecalculation,
} from "@/lib/services/realtime";
import { aggregateCommunityEvidence } from "@/lib/community-evidence";
import { useGeolocation } from "@/lib/location";
import { searchDestinations, type SearchResult } from "@/lib/services/geocoding";
import { planRealRoute, type RouteResult } from "@/lib/services/routes";
import { fetchCrimeGeoJSON, type CrimeGeoJSON } from "@/lib/services/crime";
import { cn, timeAgo } from "@/lib/utils";
import type { AnomalyResult, LngLat, MapMarker, RouteId, SafetyReport, Segment } from "@/types";

const ROUTE_MODES: { id: RouteId; label: string; Icon: React.ElementType; desc: string }[] = [
  { id: "fastest",  label: "Fastest",  Icon: Zap,         desc: "Shortest time" },
  { id: "balanced", label: "Balanced", Icon: Scale,       desc: "Time & variety" },
  { id: "safest",   label: "Safest",   Icon: ShieldCheck, desc: "Most indirect" },
];

function clientAnomaly(count: number): AnomalyResult {
  if (count >= 5) {
    return {
      is_anomaly: true,
      severity: "high",
      reason: `${count} reports on this segment.`,
    };
  }
  if (count >= 3) {
    return {
      is_anomaly: true,
      severity: "medium",
      reason: `${count} recent safety reports nearby.`,
    };
  }
  return { is_anomaly: false, severity: "none", reason: "" };
}

export default function MapPage() {
  const [sel, setSel] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [liveAlert, setLiveAlert] = useState<SafetyReport | null>(null);
  const liveAlertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [anomaly, setAnomaly] = useState<AnomalyResult | null>(null);
  const [showEmergency, setShowEmergency] = useState(false);
  const [loading, setLoading] = useState(true);

  // Browser Geolocation
  const {
    lngLat: userLngLat,
    isLoading: isLocating,
    error: locationError,
    requestLocation,
  } = useGeolocation({ autoRequest: true });

  // Destination Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedDestination, setSelectedDestination] = useState<SearchResult | null>(null);

  // OpenRouteService Routing State
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteResult | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routingError, setRoutingError] = useState<string | null>(null);
  // Route mode: the user-chosen label
  const [routeMode, setRouteMode] = useState<RouteId | null>(null);
  // Safety overlay toggle
  const [showOverlay, setShowOverlay] = useState(true);
  // NCRB Crime overlay toggle and data
  const [showCrimeOverlay, setShowCrimeOverlay] = useState(true);
  const [crimeGeoJSON, setCrimeGeoJSON] = useState<CrimeGeoJSON | null>(null);

  const reportCounts = useRef<Record<string, number>>({});
  const subRefs = useRef<{ unsubscribe: () => void }[]>([]);

  useEffect(() => {
    let alive = true;

    Promise.all([getSegments(), getReports(), fetchCrimeGeoJSON()])
      .then(([segmentData, reportData, crimeData]) => {
        if (!alive) return;
        setSegments(segmentData);
        setReports(reportData);
        if (crimeData && crimeData.features.length > 0) {
          setCrimeGeoJSON(crimeData);
        }
        setSel((current) =>
          current && segmentData.some((segment) => segment.id === current)
            ? current
            : segmentData[0]?.id ?? "",
        );
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    Promise.all([
      subscribeToReports((row) => {
        if (!alive) return;

        const report: SafetyReport = {
          id: row.id,
          place: `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`,
          tag: row.category,
          minutesAgo: 0,
          note: row.description ?? "",
          latitude: row.latitude,
          longitude: row.longitude,
          segmentId: row.road_segment_id ?? undefined,
        };

        setReports((previous) => [report, ...previous].slice(0, 50));
        setAlertCount((count) => count + 1);

        // Show ephemeral banner ONLY for new incoming live reports during this session
        setLiveAlert(report);
        if (liveAlertTimer.current) clearTimeout(liveAlertTimer.current);
        liveAlertTimer.current = setTimeout(() => {
          setLiveAlert(null);
        }, 6000);

        const affectedSegId = row.road_segment_id;
        if (!affectedSegId) return;

        reportCounts.current[affectedSegId] =
          (reportCounts.current[affectedSegId] ?? 0) + 1;

        const a = clientAnomaly(reportCounts.current[affectedSegId]);
        if (a.is_anomaly) setAnomaly(a);

        void triggerRecalculation(affectedSegId);
      }),
      subscribeToSegmentUpdates((row) => {
        if (!alive) return;

        setSegments((previous) =>
          previous.map((segment) =>
            segment.id === row.id
              ? { ...segment, score: row.safety_score }
              : segment,
          ),
        );

        setAnomaly(null);
      }),
    ]).then((subscriptions) => {
      if (!alive) {
        subscriptions.forEach((subscription) => subscription.unsubscribe());
        return;
      }
      subRefs.current = subscriptions;
    });

    return () => {
      alive = false;
      subRefs.current.forEach((subscription) => subscription.unsubscribe());
      subRefs.current = [];
    };
  }, []);

  // Route calculation callback
  const calculateRoute = useCallback(
    async (origin: LngLat, destination: LngLat) => {
      setRoutes([]);
      setSelectedRoute(null);
      setRouteMode(null);
      setIsRouting(true);
      setRoutingError(null);

      try {
        const res = await planRealRoute({
          origin,
          destination,
          profile: "foot-walking",
        });

        if (res.source === "openrouteservice" && res.routes.length > 0) {
          setRoutes(res.routes);
          // Select the recommended route (balanced) by default, or first available
          const preferred = res.routes.find((r) => r.recommended) ?? res.routes[0];
          setSelectedRoute(preferred);
          setRouteMode(preferred.id as RouteId);
        } else {
          setRoutes([]);
          setSelectedRoute(null);
          setRouteMode(null);
          setRoutingError(
            res.error || "Could not find a road route to this destination."
          );
        }
      } catch (err) {
        setRoutes([]);
        setSelectedRoute(null);
        setRouteMode(null);
        setRoutingError(
          err instanceof Error ? err.message : "Route calculation failed."
        );
      } finally {
        setIsRouting(false);
      }
    },
    []
  );

  // Destination selection callback
  const handleSelectDestination = useCallback(
    (dest: SearchResult) => {
      setSelectedDestination(dest);
      setSearchQuery(dest.name);
      setShowSuggestions(false);

      // Immediately focus map on genuine search result
      window.dispatchEvent(
        new CustomEvent("suraksha-grid:recenter", {
          detail: { lng: dest.coordinates[0], lat: dest.coordinates[1] },
        }),
      );

      if (userLngLat) {
        void calculateRoute(userLngLat, dest.coordinates);
      } else {
        void requestLocation().then((loc) => {
          if (loc.lngLat) {
            void calculateRoute(loc.lngLat, dest.coordinates);
          } else {
            setRoutingError(
              "Your location is unavailable. Please allow browser location access to plan routes from your position."
            );
          }
        });
      }
    },
    [userLngLat, requestLocation, calculateRoute]
  );

  const handleSearchSubmit = useCallback(async () => {
    if (searchResults.length > 0) {
      handleSelectDestination(searchResults[0]);
      return;
    }
    const q = searchQuery.trim();
    if (q.length >= 2) {
      setIsSearching(true);
      try {
        const results = await searchDestinations(q, userLngLat);
        setIsSearching(false);
        if (results.length > 0) {
          setSearchResults(results);
          handleSelectDestination(results[0]);
        } else {
          setShowSuggestions(true);
        }
      } catch {
        setIsSearching(false);
      }
    }
  }, [searchResults, searchQuery, userLngLat, handleSelectDestination]);

  // Auto-search from ?to= query parameter
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const toParam = params.get("to");
    if (toParam && !selectedDestination && !searchQuery) {
      setSearchQuery(toParam);
      setIsSearching(true);
      searchDestinations(toParam, userLngLat)
        .then((results) => {
          setIsSearching(false);
          if (results.length > 0) {
            handleSelectDestination(results[0]);
          }
        })
        .catch(() => {
          setIsSearching(false);
        });
    }
  }, [userLngLat, selectedDestination, searchQuery, handleSelectDestination]);

  // Debounced place search
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    if (selectedDestination && searchQuery === selectedDestination.name) {
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(() => {
      let alive = true;
      searchDestinations(searchQuery, userLngLat)
        .then((results) => {
          if (alive) {
            setSearchResults(results);
            setShowSuggestions(true);
            setIsSearching(false);
          }
        })
        .catch(() => {
          if (alive) {
            setSearchResults([]);
            setIsSearching(false);
          }
        });

      return () => {
        alive = false;
      };
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, userLngLat, selectedDestination]);

  const onSelect = useCallback((id: string) => setSel(id), []);
  const segment = useMemo(
    () => segments.find((item) => item.id === sel),
    [segments, sel],
  );

  const reportMarkers = useMemo<MapMarker[]>(
    () =>
      reports.flatMap((report): MapMarker[] => {
        if (
          report.latitude === undefined ||
          report.longitude === undefined
        ) {
          return [];
        }
        return [
          {
            id: `report-${report.id}`,
            x: 0,
            y: 0,
            lng: report.longitude,
            lat: report.latitude,
            kind: "report",
            label: report.tag,
          },
        ];
      }),
    [reports],
  );

  const mapMarkers = useMemo(
    () => {
      // 1. Current user GPS marker (only when live GPS position is available)
      const youMarker: MapMarker | undefined = userLngLat
        ? {
            id: "you",
            x: 0,
            y: 0,
            lng: userLngLat[0],
            lat: userLngLat[1],
            kind: "you",
            label: "You",
          }
        : undefined;

      // 2. Real selected destination marker
      const destMarker: MapMarker | undefined = selectedDestination
        ? {
            id: "dest",
            x: 0,
            y: 0,
            lng: selectedDestination.coordinates[0],
            lat: selectedDestination.coordinates[1],
            kind: "dest",
            label: selectedDestination.name,
          }
        : undefined;

      return [
        ...(youMarker ? [youMarker] : []),
        ...(destMarker ? [destMarker] : []),
        ...reportMarkers,
      ];
    },
    [userLngLat, selectedDestination, reportMarkers],
  );

  const routeLines = useMemo(
    () =>
      routes.map((r) => ({
        route: r,
        coords: r.coords,
      })),
    [routes],
  );

  const evidence = aggregateCommunityEvidence(
    reports.slice(0, 20).map((report) => ({
      category: report.tag,
      severity: 2,
      ageHours: report.minutesAgo / 60,
    })),
    false,
  );

  return (
    <>
      <MapLayout
        map={
          <div className="relative h-full">
            <MapLibreMap
              className="h-full w-full"
              segments={segments}
              selectedSegmentId={sel}
              onSelectSegment={onSelect}
              routeLines={routeLines}
              selectedRouteId={selectedRoute?.id}
              onSelectRoute={(id) => {
                const r = routes.find((item) => item.id === id);
                if (r) setSelectedRoute(r);
              }}
              markers={mapMarkers}
              showOverlay={showOverlay}
              crimeGeoJSON={crimeGeoJSON}
              showCrimeOverlay={showCrimeOverlay}
            />
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[5] space-y-2 [&>*]:pointer-events-auto">
              {/* Destination Search Box */}
              <div className="relative">
                <div className="flex items-center gap-2 rounded-2xl bg-white px-3 shadow-card">
                  <button
                    type="button"
                    aria-label="Search destination"
                    title="Search"
                    onClick={() => void handleSearchSubmit()}
                    className="p-1 text-muted hover:text-brand transition cursor-pointer"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                  <input
                    aria-label="Search destination"
                    placeholder="Search destination (e.g. Cyber Hub, Metro…)"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onFocus={() => {
                      if (searchResults.length > 0) setShowSuggestions(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSearchSubmit();
                      }
                    }}
                    className="h-12 flex-1 bg-transparent text-sm outline-none"
                  />
                  {isSearching && (
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                  )}
                  {searchQuery && !isSearching && (
                    <button
                      type="button"
                      aria-label="Clear destination"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchResults([]);
                        setShowSuggestions(false);
                        setSelectedDestination(null);
                        setRoutes([]);
                        setSelectedRoute(null);
                        setRoutingError(null);
                      }}
                      className="p-1 text-muted hover:text-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {alertCount > 0 && !isSearching && (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-elevated text-[11px] font-bold text-white">
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </div>

                {/* Suggestions Dropdown */}
                {showSuggestions && (
                  <div className="absolute left-0 right-0 top-14 z-20 max-h-60 overflow-y-auto rounded-2xl border border-line bg-white shadow-sheet">
                    {isSearching && searchResults.length === 0 && (
                      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                        Searching places…
                      </div>
                    )}
                    {!isSearching &&
                      searchResults.length === 0 &&
                      searchQuery.trim().length >= 2 && (
                        <div className="px-4 py-3 text-xs text-muted">
                          No places found for &quot;{searchQuery}&quot;
                        </div>
                      )}
                    {searchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => handleSelectDestination(result)}
                        className="flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-surface"
                      >
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">
                            {result.name}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {result.fullName}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Safety Score & NCRB Crime Overlay Legend */}
              <div className="rounded-xl bg-white/95 px-3 py-2.5 text-xs shadow-card space-y-2">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      <Layers className="h-3.5 w-3.5 text-brand" />
                      Road Safety Scores
                    </span>
                    <span className="text-[10px] text-muted">
                      {showOverlay ? "Click road for details" : "Overlay hidden"}
                    </span>
                  </div>
                  {showOverlay ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {(["safer", "moderate", "elevated", "concern"] as const).map((k) => (
                        <span key={k} className="flex items-center gap-1 text-[11px]">
                          <i className="h-2 w-2 rounded-full" style={{ background: LEVELS[k].hex }} />
                          {MAP_LEGEND_LABELS[k]}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted">
                      Tap layers button to show road safety overlay.
                    </p>
                  )}
                </div>

                <div className="border-t border-line/80 pt-1.5">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      <Database className="h-3.5 w-3.5 text-brand" />
                      NCRB Historical Crime Evidence (2023)
                    </span>
                    <span className="text-[10px] text-muted">
                      {showCrimeOverlay ? "Click district for stats" : "Hidden"}
                    </span>
                  </div>
                  {showCrimeOverlay ? (
                    <div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                        <span className="flex items-center gap-1">
                          <i className="h-2 w-2 rounded-sm border border-amber-400 bg-[#FEF08A]" />
                          Low Exposure
                        </span>
                        <span className="flex items-center gap-1">
                          <i className="h-2 w-2 rounded-sm border border-orange-500 bg-[#FDBA74]" />
                          Moderate Exposure
                        </span>
                        <span className="flex items-center gap-1">
                          <i className="h-2 w-2 rounded-sm border border-red-600 bg-[#DC2626]" />
                          High Exposure
                        </span>
                      </div>
                      <p className="mt-1 text-[10px] text-muted/80">
                        Official NCRB 2023 district data · Historical index, not live crime probability.
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted">
                      Tap database button to show NCRB district crime boundaries.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="absolute left-3 bottom-20 z-[5] flex flex-col gap-2 pointer-events-none [&>*]:pointer-events-auto">
              {loading && (
                <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-muted shadow-card">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                  Loading safety data…
                </div>
              )}
              {isLocating && !loading && (
                <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-muted shadow-card">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                  Finding your location…
                </div>
              )}
              {isRouting && (
                <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-muted shadow-card">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                  Calculating road route…
                </div>
              )}
              {locationError && (
                <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-muted shadow-card">
                  <MapPinOff className="h-3.5 w-3.5 text-elevated" />
                  <span>
                    {locationError.code === "PERMISSION_DENIED"
                      ? "Location access denied"
                      : locationError.code === "TIMEOUT"
                      ? "Location request timed out"
                      : "Location unavailable"}
                  </span>
                </div>
              )}
            </div>

            {/* NCRB Crime overlay toggle */}
            <button
              type="button"
              aria-label={showCrimeOverlay ? "Hide NCRB crime overlay" : "Show NCRB crime overlay"}
              title={showCrimeOverlay ? "Hide NCRB crime overlay" : "Show NCRB crime overlay"}
              onClick={() => setShowCrimeOverlay((v) => !v)}
              className={cn(
                "absolute bottom-[calc(15rem+env(safe-area-inset-bottom))] right-3 z-[5] grid h-11 w-11 place-items-center rounded-full bg-white shadow-card transition lg:bottom-40",
                showCrimeOverlay ? "text-brand" : "text-muted hover:text-ink",
              )}
            >
              <Database className="h-5 w-5" />
            </button>

            {/* Safety overlay toggle */}
            <button
              type="button"
              aria-label={showOverlay ? "Hide safety overlay" : "Show safety overlay"}
              title={showOverlay ? "Hide safety overlay" : "Show safety overlay"}
              onClick={() => setShowOverlay((v) => !v)}
              className={cn(
                "absolute bottom-[calc(11.5rem+env(safe-area-inset-bottom))] right-3 z-[5] grid h-11 w-11 place-items-center rounded-full bg-white shadow-card transition lg:bottom-28",
                showOverlay ? "text-brand" : "text-muted hover:text-ink",
              )}
            >
              <Layers className="h-5 w-5" />
            </button>

            <button
              aria-label="Recenter map"
              onClick={() => {
                if (userLngLat) {
                  window.dispatchEvent(
                    new CustomEvent("suraksha-grid:recenter", {
                      detail: { lng: userLngLat[0], lat: userLngLat[1] },
                    }),
                  );
                } else {
                  void requestLocation().then((loc) => {
                    if (loc.lngLat) {
                      window.dispatchEvent(
                        new CustomEvent("suraksha-grid:recenter", {
                          detail: { lng: loc.lngLat[0], lat: loc.lngLat[1] },
                        }),
                      );
                    }
                  });
                }
              }}
              className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom))] right-3 z-[5] grid h-11 w-11 place-items-center rounded-full bg-white shadow-card lg:bottom-16"
            >
              <LocateFixed className="h-5 w-5 text-brand" />
            </button>

            {liveAlert && (
              <div className="animate-rise pointer-events-none absolute inset-x-3 top-20 z-[6] flex items-start gap-2 rounded-2xl bg-ink p-3 text-sm text-white shadow-sheet lg:left-auto lg:right-4 lg:top-4 lg:w-72">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-elevated" />
                <div>
                  <p className="font-semibold">New community report</p>
                  <p className="text-white/70">
                    {liveAlert.tag} · Just now
                  </p>
                </div>
              </div>
            )}
          </div>
        }
        panel={
          <div className="space-y-4">
            {/* Route Mode Toggle — shown when routes are available */}
            {routes.length > 1 && selectedDestination && (
              <div className="rounded-2xl border border-line bg-surface p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Route options
                </p>
                <div className="flex gap-1.5">
                  {ROUTE_MODES.filter((m) => routes.some((r) => r.id === m.id)).map(
                    ({ id, label, Icon, desc }) => {
                      const isActive = routeMode === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            const r = routes.find((rt) => rt.id === id);
                            if (r) {
                              setSelectedRoute(r);
                              setRouteMode(id);
                            }
                          }}
                          className={cn(
                            "flex flex-1 flex-col items-center gap-0.5 rounded-xl border px-1.5 py-2 text-center transition",
                            isActive
                              ? "border-brand bg-brand/10 text-brand"
                              : "border-line bg-white text-muted hover:border-brand/40 hover:text-ink",
                          )}
                        >
                          <Icon className={cn("h-4 w-4", isActive ? "text-brand" : "text-muted")} />
                          <span className="text-[11px] font-semibold">{label}</span>
                          <span className="text-[9px] opacity-70">{desc}</span>
                        </button>
                      );
                    },
                  )}
                </div>
              </div>
            )}

            {/* Active Real Route Card */}
            {selectedRoute && selectedDestination && (
              <div className="rounded-2xl border border-line bg-surface p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
                    {(() => {
                      const mode = ROUTE_MODES.find((m) => m.id === selectedRoute.id);
                      return mode ? (
                        <>
                          <mode.Icon className="h-3.5 w-3.5" />
                          {selectedRoute.name}
                        </>
                      ) : selectedRoute.name;
                    })()}
                  </span>
                  <button
                    onClick={() => {
                      setRoutes([]);
                      setSelectedRoute(null);
                      setSelectedDestination(null);
                      setSearchQuery("");
                      setRouteMode(null);
                      setRoutingError(null);
                    }}
                    className="text-xs text-muted hover:text-ink"
                  >
                    Clear route
                  </button>
                </div>
                <div>
                  <p className="font-bold text-ink">{selectedDestination.name}</p>
                  <p className="truncate text-xs text-muted">{selectedDestination.fullName}</p>
                </div>
                <div className="flex items-center gap-4 text-sm font-semibold text-ink pt-1">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-brand" />
                    {selectedRoute.etaMin} min walk
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Ruler className="h-4 w-4 text-brand" />
                    {selectedRoute.distanceKm} km
                  </span>
                </div>
                {/* Real Safety Engine score */}
                <div className="flex items-center gap-3 rounded-xl bg-white/70 px-3 py-2">
                  <div className="flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Safety Score</p>
                    <p className={cn(
                      "text-lg font-bold",
                      selectedRoute.score >= 75 ? "text-safer" :
                      selectedRoute.score >= 55 ? "text-moderate" :
                      "text-concern"
                    )}>
                      {selectedRoute.score}
                      <span className="text-xs font-normal text-muted">/100</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Confidence</p>
                    <p className="text-sm font-semibold text-ink">{selectedRoute.confidence}%</p>
                    {selectedRoute.confidence < 35 && (
                      <p className="text-[9px] text-muted/70">Low data</p>
                    )}
                  </div>
                </div>
                {/* Risk / Positive factors from Safety Engine */}
                {(selectedRoute.riskFactors?.length ?? 0) > 0 && (
                  <div className="space-y-0.5">
                    {selectedRoute.riskFactors!.slice(0, 2).map((f) => (
                      <p key={f} className="flex items-center gap-1 text-[10px] text-concern">
                        <AlertTriangle className="h-3 w-3 shrink-0" />{f}
                      </p>
                    ))}
                  </div>
                )}
                {(selectedRoute.positiveFactors?.length ?? 0) > 0 && (
                  <div className="space-y-0.5">
                    {selectedRoute.positiveFactors!.slice(0, 2).map((f) => (
                      <p key={f} className="flex items-center gap-1 text-[10px] text-safer">
                        <ShieldCheck className="h-3 w-3 shrink-0" />{f}
                      </p>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted/70">
                  {selectedRoute.confidence < 35
                    ? "Limited road-segment data in this area — score is a baseline estimate."
                    : "Scores are safety indices (0–100), not probabilities."}
                </p>
              </div>
            )}

            {/* Routing Error Notice */}
            {routingError && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-concern/30 bg-concern/5 p-3.5 text-xs text-concern">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-semibold">Route calculation notice</p>
                  <p className="opacity-90">{routingError}</p>
                </div>
              </div>
            )}

            {/* Route Location Truthful Notice */}
            {selectedDestination && !userLngLat && !isRouting && routes.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface p-3.5 text-xs text-muted">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="flex-1">
                  <p className="font-semibold text-ink">Route from Demo Location</p>
                  <p>Directions calculated from Bengaluru center. Enable GPS to get directions from your real position.</p>
                  <button
                    type="button"
                    onClick={() => void requestLocation().then((loc) => {
                      if (loc.lngLat) void calculateRoute(loc.lngLat, selectedDestination.coordinates);
                    })}
                    className="mt-2 rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white"
                  >
                    Enable GPS
                  </button>
                </div>
              </div>
            )}
            {selectedDestination && !userLngLat && !isRouting && routes.length === 0 && !routingError && (
              <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-surface p-3.5 text-xs text-muted">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div className="flex-1">
                  <p className="font-semibold text-ink">Location for route</p>
                  <p>Location is needed to calculate walking directions to {selectedDestination.name}.</p>
                  <button
                    type="button"
                    onClick={() => void requestLocation().then((loc) => {
                      if (loc.lngLat) {
                        void calculateRoute(loc.lngLat, selectedDestination.coordinates);
                      } else {
                        setRoutingError("Location access unavailable. Please enable browser location permissions.");
                      }
                    })}
                    className="mt-2 rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white"
                  >
                    Enable location to route
                  </button>
                </div>
              </div>
            )}

            {anomaly && (
              <AnomalyBanner
                anomaly={anomaly}
                segmentName={segment?.name}
                onRecalculate={() => {
                  setAnomaly(null);
                  if (segment?.id) void triggerRecalculation(segment.id);
                }}
                onDismiss={() => setAnomaly(null)}
              />
            )}

            <SafetyLens segment={segment} />

            {evidence.reportCount > 0 && (
              <p className="text-[11px] text-muted/70 text-center">
                {evidence.label}
              </p>
            )}

            <Link
              href="/routes"
              className={cn(buttonVariants(), "w-full")}
            >
              Plan a route
            </Link>

            <button
              onClick={() => setShowEmergency(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-concern py-3 text-sm font-bold text-concern transition hover:bg-concern/5"
            >
              <Phone className="h-4 w-4" />
              Emergency Safety Alert
            </button>
          </div>
        }
      />

      {showEmergency && (
        <EmergencyAlert
          destination={selectedDestination?.name}
          routeName={selectedRoute?.name}
          onClose={() => setShowEmergency(false)}
        />
      )}

      <JourneyRecordingBanner />
    </>
  );
}
