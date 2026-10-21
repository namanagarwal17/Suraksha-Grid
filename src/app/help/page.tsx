"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { HelpList } from "@/components/help/help-list";
import { MapLayout } from "@/components/map/map-layout";
import { MapLibreMap } from "@/components/map/maplibre-map";
import { Chip, EmptyState, Skeleton } from "@/components/ui/card";
import { getHelpPoints } from "@/lib/services/help";
import { useGeolocation } from "@/lib/location";
import type { HelpKind, HelpPoint, MapMarker } from "@/types";

const FILTERS: { k: HelpKind | "all"; l: string }[] = [
  { k: "all", l: "All" },
  { k: "police", l: "Police" },
  { k: "hospital", l: "Hospitals" },
  { k: "help", l: "Help points" },
];

export default function HelpPage() {
  const [f, setF] = useState<HelpKind | "all">("all");
  const [points, setPoints] = useState<HelpPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const {
    lngLat: userLngLat,
    isLoading: geoLoading,
    error: geoError,
    requestLocation,
  } = useGeolocation({ autoRequest: true });

  useEffect(() => {
    let alive = true;

    if (!userLngLat) {
      setPoints([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [lng, lat] = userLngLat;

    getHelpPoints(lng, lat, 5000)
      .then((data) => {
        if (!alive) return;
        setPoints(data);
        setLoading(false);
      })
      .catch((err) => {
        if (alive) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load genuine emergency help points. Please check network connection."
          );
          setLoading(false);
        }
      });

    return () => {
      alive = false;
    };
  }, [userLngLat, reloadKey]);

  const filtered = useMemo(
    () =>
      points
        .filter((p) => f === "all" || p.kind === f)
        .sort((a, b) => a.distanceKm - b.distanceKm),
    [points, f],
  );

  const maxDistance = useMemo(
    () => (points.length ? Math.max(...points.map((p) => p.distanceKm)) : 0),
    [points],
  );

  const helpMarkers: MapMarker[] = useMemo(
    () => [
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
        : []),
      ...filtered.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        lng: p.lng,
        lat: p.lat,
        kind: "help" as const,
        label: p.name,
      })),
    ],
    [filtered, userLngLat],
  );

  return (
    <MapLayout
      map={
        <MapLibreMap
          className="h-full w-full"
          markers={helpMarkers}
          segments={[]}
        />
      }
      panel={
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-bold">Nearby help</h1>
              <p className="mt-0.5 text-xs">
                {userLngLat ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-safer">
                    <span className="inline-block h-2 w-2 rounded-full bg-safer" />
                    Live GPS Location · Genuine places sorted nearest-first
                  </span>
                ) : geoLoading ? (
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <Loader2 className="h-3 w-3 animate-spin text-brand" />
                    Acquiring your GPS position…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-muted">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    GPS required to discover nearby emergency services
                  </span>
                )}
              </p>
            </div>
            {userLngLat && (
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="shrink-0 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold hover:border-brand"
                title="Refresh nearby places"
              >
                Refresh
              </button>
            )}
          </div>

          {userLngLat && maxDistance > 5.5 && (
            <div className="rounded-xl border border-brand/20 bg-brand/5 px-3 py-1.5 text-[11px] text-brand">
              Expanded search radius up to 10 km to locate closest emergency facilities.
            </div>
          )}

          {userLngLat && (
            <div className="flex gap-2 overflow-x-auto">
              {FILTERS.map((x) => (
                <Chip
                  key={x.k}
                  active={f === x.k}
                  onClick={() => setF(x.k)}
                  className="shrink-0"
                >
                  {x.l}
                </Chip>
              ))}
            </div>
          )}

          {!userLngLat && !geoLoading ? (
            <div className="rounded-2xl border border-line bg-surface p-5 text-center space-y-3">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600">
                <span className="text-xl font-bold">📍</span>
              </div>
              <p className="font-bold text-sm">
                {geoError?.code === "PERMISSION_DENIED"
                  ? "Location permission required"
                  : "GPS position unavailable"}
              </p>
              <p className="text-xs text-muted max-w-xs mx-auto">
                {geoError?.code === "PERMISSION_DENIED"
                  ? "Nearby Help requires browser location permission to show genuine police stations and hospitals near you. Please enable location in your browser."
                  : "We could not determine your current coordinates. Please ensure location services are enabled on your device."}
              </p>
              <button
                type="button"
                onClick={() => requestLocation()}
                className="rounded-xl bg-brand text-white px-4 py-2 text-xs font-semibold shadow-sm transition-transform active:scale-95"
              >
                Allow Location / Retry GPS
              </button>
            </div>
          ) : loading || geoLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-concern/30 bg-concern/5 p-4 text-xs text-concern space-y-2">
              <p className="font-semibold">Unable to load emergency help points</p>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-lg bg-concern text-white px-3 py-1 font-semibold text-xs"
              >
                Retry
              </button>
            </div>
          ) : filtered.length ? (
            <HelpList points={filtered} />
          ) : (
            <EmptyState
              title="Nothing nearby"
              hint={
                f === "all"
                  ? "No emergency facilities found within 10 km. In an emergency, call 112 directly."
                  : `No ${f} facilities found nearby. Try selecting 'All' or widening your search.`
              }
            />
          )}
        </div>
      }
    />
  );
}
