"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CornerUpRight,
  Clock,
  Ruler,
  X,
  RotateCw,
  ShieldCheck,
  Phone,
  Loader2,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  AlertCircle,
  Navigation,
  Radio,
} from "lucide-react";
import { MapLayout } from "@/components/map/map-layout";
import { MapLibreMap } from "@/components/map/maplibre-map";
import { ScoreBadge } from "@/components/safety/score";
import { AnomalyBanner } from "@/components/safety/anomaly-banner";
import { EmergencyAlert } from "@/components/emergency/emergency-alert";
import { JourneyRecordingBanner } from "@/components/blackbox/journey-recording-banner";
import { useBlackBox } from "@/lib/services/use-blackbox";
import { buttonVariants } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchRoutes, planRealRoute, type RouteResult } from "@/lib/services/routes";
import { saveRoute, checkIsRouteSaved } from "@/lib/services/profile";
import { getUser } from "@/lib/services/auth";
import { getSegments } from "@/lib/services/segments";
import { subscribeToSegmentUpdates } from "@/lib/services/realtime";
import { aggregateCommunityEvidence } from "@/lib/community-evidence";
import { useGeolocation } from "@/lib/location";
import { minDistanceToPolylineMeters, haversineDistanceMeters } from "@/lib/map/geometry";
import { DESTINATION } from "@/lib/mock-data";
import type { AnomalyResult, LngLat, MapMarker, RouteId, Segment } from "@/types";

const DEVIATION_THRESHOLD_METERS = 60;
const REROUTE_THROTTLE_MS = 10_000;

function checkAnomaly(reportCount: number): AnomalyResult {
  if (reportCount >= 5) {
    return {
      is_anomaly: true,
      severity: "high",
      reason: `${reportCount} recent reports on this segment.`,
    };
  }
  if (reportCount >= 3) {
    return {
      is_anomaly: true,
      severity: "medium",
      reason: `${reportCount} new reports detected nearby.`,
    };
  }
  return { is_anomaly: false, severity: "none", reason: "" };
}

function Nav() {
  const searchParams = useSearchParams();
  const initial = (searchParams.get("route") as RouteId) || "balanced";
  const destLngParam = searchParams.get("destLng");
  const destLatParam = searchParams.get("destLat");
  const destNameParam = searchParams.get("destName");

  const profileParam =
    (searchParams.get("profile") as "foot-walking" | "driving-car" | "cycling-regular") ||
    "foot-walking";

  const [routes, setRoutes] = useState<RouteResult[] | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [id, setId] = useState<RouteId>(initial);
  const [anomaly, setAnomaly] = useState<AnomalyResult | null>(null);
  const [changed, setChanged] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);
  const [userName, setUserName] = useState<string>("App User");
  const [recalcState, setRecalcState] = useState<"idle" | "loading" | "done">("idle");
  const [rerouteMessage, setRerouteMessage] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [arrived, setArrived] = useState(false);

  const reportCounts = useRef<Record<string, number>>({});
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);
  const lastRerouteTime = useRef<number>(0);
  const offRouteCount = useRef<number>(0);

  // Real GPS position with continuous watch
  const { lngLat: userLngLat } = useGeolocation({ autoRequest: true, watch: true });
  const { isActive: isBlackBoxActive, startJourney: startBlackBox } = useBlackBox();

  // Load authenticated user profile
  useEffect(() => {
    void getUser().then((u) => {
      if (u) {
        const name =
          (u.user_metadata?.full_name as string) ||
          (u.email ? u.email.split("@")[0] : "App User");
        setUserName(name);
      }
    });
  }, []);

  useEffect(() => {
    let alive = true;

    // Check if active route was stored in sessionStorage by routes page
    let restoredRoute: RouteResult | null = null;
    try {
      const stored = sessionStorage.getItem("suraksha_active_route");
      if (stored) {
        restoredRoute = JSON.parse(stored) as RouteResult;
      }
    } catch {
      // ignore
    }

    // Determine target destination coordinates
    let targetDest: LngLat | null = null;
    if (destLngParam && destLatParam) {
      const lng = parseFloat(destLngParam);
      const lat = parseFloat(destLatParam);
      if (!isNaN(lng) && !isNaN(lat)) {
        targetDest = [lng, lat];
      }
    }

    if (restoredRoute && restoredRoute.coords && restoredRoute.coords.length >= 2) {
      setRoutes([restoredRoute]);
      setId(restoredRoute.id);
    }

    // Load segment context in parallel
    void getSegments().then((segmentData) => {
      if (alive) setSegments(segmentData);
    });

    if (targetDest) {
      // Plan fresh real route to the explicit destination if GPS is available
      if (userLngLat) {
        planRealRoute({
          origin: userLngLat,
          destination: targetDest,
          profile: profileParam,
        })
          .then((res) => {
            if (!alive) return;
            if (res.source === "openrouteservice" && res.routes.length > 0) {
              setRoutes(res.routes);
              const matching =
                res.routes.find((r) => r.id === initial) ??
                res.routes.find((r) => r.recommended) ??
                res.routes[0];
              if (matching) setId(matching.id);
            }
          })
          .catch(() => {
            // If fresh plan fails, keep restored route if available
          });
      }
      return;
    }

    // If no explicit destination param and no restored route, do not fabricate routes
    if (!restoredRoute) {
      setRoutes([]);
    }

    return () => {
      alive = false;
    };
  }, [initial, destLngParam, destLatParam, userLngLat, profileParam]);

  const route = useMemo(
    () =>
      routes?.find((item) => item.id === id) ??
      routes?.find((item) => item.recommended) ??
      routes?.[0],
    [routes, id],
  );

  // Dynamic reroute calculation using existing ORS routing flow
  const recalculateFromPosition = useCallback(
    async (currentPosition: LngLat, reason: "deviation" | "safety" | "manual") => {
      const now = Date.now();
      if (now - lastRerouteTime.current < REROUTE_THROTTLE_MS) {
        return;
      }
      lastRerouteTime.current = now;

      // Extract actual destination coordinates
      let destination: LngLat | null = null;
      if (destLngParam && destLatParam) {
        const lng = parseFloat(destLngParam);
        const lat = parseFloat(destLatParam);
        if (!isNaN(lng) && !isNaN(lat)) {
          destination = [lng, lat];
        }
      }
      if (!destination && route?.coords && route.coords.length >= 2) {
        destination = route.coords[route.coords.length - 1];
      }
      if (!destination) {
        destination = DESTINATION;
      }

      setRecalcState("loading");
      setRerouteMessage(
        reason === "deviation"
          ? "Off-route detected. Recalculating directions…"
          : reason === "safety"
          ? "Safety changes on route. Finding safer options…"
          : "Recalculating route…"
      );

      try {
        const res = await planRealRoute({
          origin: currentPosition,
          destination,
          profile: "foot-walking",
        });

        if (res.source === "openrouteservice" && res.routes.length > 0) {
          setRoutes(res.routes);
          const matching =
            res.routes.find((r) => r.id === id) ??
            res.routes.find((r) => r.recommended) ??
            res.routes[0];
          setId(matching.id);
          setAnomaly(null);
          setChanged(false);
          setRecalcState("done");
          setRerouteMessage(
            reason === "deviation"
              ? "Rerouted to destination from your current position."
              : "Updated to safest available route."
          );
          offRouteCount.current = 0;
          setTimeout(() => {
            setRecalcState("idle");
            setRerouteMessage(null);
          }, 3500);
        } else {
          setRecalcState("idle");
          setRerouteMessage(res.error ?? "Could not recalculate. Continuing on current route.");
          setTimeout(() => setRerouteMessage(null), 3500);
        }
      } catch (err) {
        setRecalcState("idle");
        setRerouteMessage(
          err instanceof Error ? err.message : "Rerouting unavailable."
        );
        setTimeout(() => setRerouteMessage(null), 3500);
      }
    },
    [route?.coords, id, destLngParam, destLatParam]
  );

  // Dynamic Rerouting: monitor GPS position vs route polyline
  useEffect(() => {
    if (!userLngLat || !route?.coords || route.coords.length < 2) return;

    const destination = route.coords[route.coords.length - 1];
    const distToDest = haversineDistanceMeters(userLngLat, destination);

    if (distToDest < 25) {
      setArrived(true);
      return;
    }

    const distToRoute = minDistanceToPolylineMeters(userLngLat, route.coords);

    if (distToRoute > DEVIATION_THRESHOLD_METERS) {
      offRouteCount.current += 1;
      if (offRouteCount.current >= 2 && recalcState !== "loading") {
        void recalculateFromPosition(userLngLat, "deviation");
      }
    } else {
      offRouteCount.current = 0;
    }
  }, [userLngLat, route?.coords, recalculateFromPosition, recalcState]);

  // Realtime safety updates & significant safety degradation detection
  useEffect(() => {
    let alive = true;

    subscribeToSegmentUpdates((seg) => {
      if (!alive) return;

      setSegments((current) =>
        current.map((segment) =>
          segment.id === seg.id
            ? { ...segment, score: seg.safety_score }
            : segment,
        ),
      );

      reportCounts.current[seg.id] = (reportCounts.current[seg.id] ?? 0) + 1;
      const a = checkAnomaly(reportCounts.current[seg.id]);

      const affectsCurrentRoute = route?.segmentIds?.includes(seg.id);

      if (a.is_anomaly && affectsCurrentRoute) {
        setAnomaly(a);
        setChanged(true);
        if (userLngLat) {
          void recalculateFromPosition(userLngLat, "safety");
        }
      }
    }).then((sub) => {
      if (alive) subRef.current = sub;
      else sub.unsubscribe();
    });

    return () => {
      alive = false;
      subRef.current?.unsubscribe();
      subRef.current = null;
    };
  }, [route?.segmentIds, userLngLat, recalculateFromPosition]);

  const handleRecalculate = useCallback(() => {
    if (userLngLat) {
      void recalculateFromPosition(userLngLat, "manual");
    } else if (route?.coords?.[0]) {
      void recalculateFromPosition(route.coords[0], "manual");
    }
  }, [userLngLat, route?.coords, recalculateFromPosition]);

  const upcoming = useMemo(() => {
    if (!route) return undefined;
    const nextId = route.segmentIds.find(
      (segmentId) => segmentId !== route.segmentIds[0],
    );
    return segments.find((segment) => segment.id === nextId);
  }, [route, segments]);

  const evidence = useMemo(
    () =>
      aggregateCommunityEvidence(
        Object.entries(reportCounts.current).flatMap(([segmentId, count]) =>
          route?.segmentIds.includes(segmentId)
            ? Array.from({ length: count }, () => ({
                category: "report",
                severity: 3,
                ageHours: 0.5,
              }))
            : [],
        ),
        false,
      ),
    [route, changed],
  );

  useEffect(() => {
    let alive = true;
    setSaveMessage(null);
    setSaveError(null);

    void checkIsRouteSaved({
      routeId: route?.dbId,
      routeType: id,
    }).then((saved) => {
      if (alive) setIsSaved(saved);
    });

    return () => {
      alive = false;
    };
  }, [id, route?.dbId]);

  const handleSaveRoute = useCallback(async () => {
    if (!route || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const user = await getUser();
      if (!user) {
        setSaveError("Please sign in to save routes to your profile.");
        setSaving(false);
        return;
      }

      const res = await saveRoute({
        routeId: route.dbId,
        routeType: id,
        name: route.name,
      });

      if (res.ok) {
        setIsSaved(true);
        setSaveMessage(
          res.alreadySaved
            ? "Route is already saved in your Profile."
            : "Route saved! You can access it anytime from your Profile."
        );
      } else {
        setSaveError(res.error ?? "Failed to save route.");
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save route.");
    } finally {
      setSaving(false);
    }
  }, [route, id, saving]);

  if (routes === null) {
    return (
      <MapLayout
        map={
          <div className="relative h-full w-full">
            <MapLibreMap
              className="h-full w-full"
              segments={segments}
              markers={
                userLngLat
                  ? [
                      {
                        id: "you",
                        x: 0,
                        y: 0,
                        lng: userLngLat[0],
                        lat: userLngLat[1],
                        kind: "you",
                        label: "You (Live GPS)",
                      },
                    ]
                  : []
              }
            />
            <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
              <div className="flex items-center gap-2 rounded-full border border-line bg-white/95 px-4 py-2 text-xs font-semibold text-foreground shadow-md backdrop-blur">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                <span>Loading route navigation…</span>
              </div>
            </div>
          </div>
        }
        panel={
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        }
      />
    );
  }

  if (!route) {
    return (
      <MapLayout
        map={
          <MapLibreMap
            className="h-full w-full"
            segments={segments}
            markers={
              userLngLat
                ? [
                    {
                      id: "you",
                      x: 0,
                      y: 0,
                      lng: userLngLat[0],
                      lat: userLngLat[1],
                      kind: "you",
                      label: "You (Live GPS)",
                    },
                  ]
                : []
            }
          />
        }
        panel={
          <div className="space-y-4 rounded-2xl border border-line bg-surface/50 p-6 text-center text-sm text-muted">
            <Navigation className="mx-auto h-8 w-8 text-brand/60" />
            <div>
              <p className="font-semibold text-foreground">No active route selected</p>
              <p className="mt-1 text-xs">
                Select a destination from the routes planner to begin turn-by-turn safe navigation.
              </p>
            </div>
            <Link
              href="/routes"
              className={cn(buttonVariants(), "w-full")}
            >
              Choose a destination
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <>
      <MapLayout
        map={
          <div className="relative h-full">
            <MapLibreMap
              className="h-full w-full"
              routeLines={routes.map((item) => ({
                route: item,
                coords: item.coords,
              }))}
              selectedRouteId={id}
              markers={[
                ...(userLngLat
                  ? [
                      {
                        id: "you",
                        x: 0,
                        y: 0,
                        lng: userLngLat[0],
                        lat: userLngLat[1],
                        kind: "you" as const,
                        label: "You (Live GPS)",
                      },
                    ]
                  : route.coords?.[0]
                  ? [
                      {
                        id: "start",
                        x: 0,
                        y: 0,
                        lng: route.coords[0][0],
                        lat: route.coords[0][1],
                        kind: "dest" as const,
                        label: "Route Start",
                      },
                    ]
                  : []),
                ...(route?.coords && route.coords.length >= 2
                  ? [
                      {
                        id: "dest",
                        x: 0,
                        y: 0,
                        lng: route.coords[route.coords.length - 1][0],
                        lat: route.coords[route.coords.length - 1][1],
                        kind: "dest" as const,
                        label: destNameParam ? decodeURIComponent(destNameParam) : "Destination",
                      },
                    ]
                  : []),
              ]}
            />

            <div className="pointer-events-none absolute inset-x-3 top-3 z-[5]">
              <div className="flex items-center gap-3 rounded-2xl bg-ink p-4 text-white shadow-card">
                <CornerUpRight className="h-9 w-9 shrink-0" />
                <div>
                  <p className="text-xs text-white/70">
                    {arrived ? "Destination reached" : "Live navigation"}
                  </p>
                  <p className="text-lg font-bold leading-tight">
                    {arrived
                      ? "You have arrived at your destination"
                      : `Continue toward ${upcoming?.name ?? "your destination"}`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        }
        panel={
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {route.name} route
                </p>
                <p className="flex items-center gap-4 text-2xl font-bold">
                  <span className="flex items-center gap-1">
                    <Clock className="h-5 w-5 text-muted" />
                    {route.etaMin} min
                  </span>
                  <span className="flex items-center gap-1 text-lg text-muted">
                    <Ruler className="h-4 w-4" />
                    {route.distanceKm} km
                  </span>
                </p>
              </div>
              <ScoreBadge score={route.score} />
            </div>

            {/* Arrival Notice */}
            {arrived && (
              <Card className="flex items-center gap-2.5 bg-safer/10 p-3.5 text-sm font-semibold text-safer">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span>You have arrived at your destination.</span>
              </Card>
            )}

            {/* Reroute Status Message */}
            {rerouteMessage && (
              <Card className={cn(
                "flex items-center gap-2 p-3 text-xs font-semibold",
                recalcState === "loading"
                  ? "bg-brand/10 text-brand"
                  : recalcState === "done"
                  ? "bg-safer/10 text-safer"
                  : "bg-surface text-ink"
              )}>
                {recalcState === "loading" ? (
                  <RotateCw className="h-4 w-4 shrink-0 animate-spin text-brand" />
                ) : recalcState === "done" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-safer" />
                ) : (
                  <Navigation className="h-4 w-4 shrink-0 text-muted" />
                )}
                <span>{rerouteMessage}</span>
              </Card>
            )}

            {changed && anomaly && (
              <AnomalyBanner
                anomaly={anomaly}
                segmentName={upcoming?.name}
                onRecalculate={() => void handleRecalculate()}
                onDismiss={() => {
                  setChanged(false);
                  setAnomaly(null);
                }}
              />
            )}

            {recalcState === "loading" && !rerouteMessage && (
              <Card className="flex items-center gap-2 text-sm text-muted">
                <RotateCw className="h-4 w-4 animate-spin text-brand" />
                Recalculating routes…
              </Card>
            )}

            {!changed && recalcState === "idle" && (
              <Card className="flex items-start gap-2 bg-safer/5 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-safer" />
                <div>
                  <p className="font-semibold text-safer">
                    Safety status: stable
                  </p>
                  <p className="text-muted">
                    Monitoring route in real time. Dynamic rerouting activates if safety degrades or if you deviate.
                  </p>
                  <button
                    type="button"
                    onClick={handleRecalculate}
                    className="mt-2 text-xs font-semibold text-brand hover:underline"
                  >
                    Check for safer route alternative ↗
                  </button>
                </div>
              </Card>
            )}

            {evidence.reportCount > 0 && (
              <p className="text-xs text-muted/70 text-center">
                {evidence.label}
              </p>
            )}

            <button
              onClick={() => setShowEmergency(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-concern py-3 text-sm font-bold text-concern transition hover:bg-concern/5"
            >
              <Phone className="h-4 w-4" />
              Emergency Safety Alert
            </button>

            <button
              type="button"
              onClick={() => void handleSaveRoute()}
              disabled={saving}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-2xl border py-2.5 text-sm font-semibold transition",
                isSaved
                  ? "border-safer/40 bg-safer/10 text-safer"
                  : "border-line bg-white hover:border-brand/40 text-foreground",
              )}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-brand" />
                  Saving route…
                </>
              ) : isSaved ? (
                <>
                  <BookmarkCheck className="h-4 w-4 text-safer" />
                  Route saved to Profile
                </>
              ) : (
                <>
                  <Bookmark className="h-4 w-4 text-muted" />
                  Save this route
                </>
              )}
            </button>

            {saveMessage && (
              <div className="flex items-center gap-2 rounded-xl bg-safer/10 p-2.5 text-xs font-semibold text-safer">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{saveMessage}</span>
              </div>
            )}

            {saveError && (
              <div className="flex items-center gap-2 rounded-xl bg-concern/10 p-2.5 text-xs font-semibold text-concern">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            {!isBlackBoxActive ? (
              <button
                type="button"
                onClick={() => {
                  void startBlackBox({
                    destinationName: destNameParam || "Destination",
                    startLocationName: "Trip Origin",
                    initialCoords: userLngLat ? { latitude: userLngLat[1], longitude: userLngLat[0] } : undefined,
                  });
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface/70 py-2.5 text-xs font-semibold text-ink transition hover:bg-surface hover:border-brand active:scale-[0.98]"
              >
                <Radio className="h-4 w-4 text-brand" />
                Record Journey (Safety Black Box)
              </button>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-brand/40 bg-brand-soft/60 p-2.5 text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-brand-dark">
                  <Radio className="h-3.5 w-3.5 animate-pulse text-brand" />
                  Black Box Recording Active
                </span>
                <Link
                  href="/safety/black-box"
                  className="font-bold text-brand hover:underline"
                >
                  View
                </Link>
              </div>
            )}

            <Link
              href="/routes"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "w-full",
              )}
            >
              <X className="h-4 w-4" />
              End navigation
            </Link>
          </div>
        }
      />

      {showEmergency && (
        <EmergencyAlert
          userName={userName}
          destination="Destination"
          routeName={route.name}
          onClose={() => setShowEmergency(false)}
        />
      )}

      <JourneyRecordingBanner />
    </>
  );
}

export default function NavigationPage() {
  return (
    <Suspense
      fallback={
        <div className="grid h-64 place-items-center text-muted">
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
        </div>
      }
    >
      <Nav />
    </Suspense>
  );
}
