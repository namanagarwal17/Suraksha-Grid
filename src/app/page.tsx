"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Search, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Chip, Skeleton } from "@/components/ui/card";
import { ScoreBadge } from "@/components/safety/score";
import { MapLibreMap } from "@/components/map/maplibre-map";
import { DESTINATIONS } from "@/lib/mock-data";
import { useGeolocation } from "@/lib/location";
import { getReports } from "@/lib/services/reports";
import { getSegments } from "@/lib/services/segments";
import {
  subscribeToReports,
  subscribeToSegmentUpdates,
} from "@/lib/services/realtime";
import { BRAND } from "@/lib/constants";
import { timeAgo } from "@/lib/utils";
import type { MapMarker, SafetyReport, Segment } from "@/types";

export default function HomePage() {
  const r = useRouter();
  const [q, setQ] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const { coords: geoCoords, lngLat: userLngLat, isLoading: isGeoLoading } = useGeolocation({ autoRequest: true });

  useEffect(() => {
    let alive = true;

    Promise.all([getSegments(), getReports()])
      .then(([segmentData, reportData]) => {
        if (!alive) return;
        setSegments(segmentData);
        setReports(reportData);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    let unsubReports: (() => void) | undefined;
    let unsubSegments: (() => void) | undefined;

    subscribeToReports((row) => {
      if (!alive) return;
      const newReport: SafetyReport = {
        id: row.id,
        place: `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`,
        tag: row.category,
        minutesAgo: 0,
        note: row.description ?? "",
        latitude: row.latitude,
        longitude: row.longitude,
        segmentId: row.road_segment_id ?? undefined,
      };
      setReports((prev) => [newReport, ...prev].slice(0, 50));
    }).then((sub) => {
      if (alive) unsubReports = sub.unsubscribe;
      else sub.unsubscribe();
    });

    subscribeToSegmentUpdates((row) => {
      if (!alive) return;
      setSegments((prev) =>
        prev.map((s) => (s.id === row.id ? { ...s, score: row.safety_score } : s))
      );
    }).then((sub) => {
      if (alive) unsubSegments = sub.unsubscribe;
      else sub.unsubscribe();
    });

    return () => {
      alive = false;
      unsubReports?.();
      unsubSegments?.();
    };
  }, []);

  const areaScore = useMemo(() => {
    if (!segments.length) return null;
    return Math.round(
      segments.reduce((sum, segment) => sum + segment.score, 0) / segments.length,
    );
  }, [segments]);

  const mapMarkers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = userLngLat
      ? [
          {
            id: "you",
            x: 0,
            y: 0,
            lng: userLngLat[0],
            lat: userLngLat[1],
            kind: "you",
            label: "You (GPS)",
          },
        ]
      : [];
    for (const rep of reports) {
      if (rep.latitude !== undefined && rep.longitude !== undefined) {
        list.push({
          id: `rep-${rep.id}`,
          x: 0,
          y: 0,
          lng: rep.longitude,
          lat: rep.latitude,
          kind: "report",
          label: rep.tag,
        });
      }
    }
    return list;
  }, [userLngLat, reports]);

  const go = (d = q) =>
    r.push(`/routes?to=${encodeURIComponent(d || DESTINATIONS[0])}`);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[1fr_440px] lg:p-8">
      <div className="space-y-5">
        <div className="animate-rise">
          <p className="text-sm font-medium text-brand">{BRAND.tagline}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight lg:text-4xl">
            Where do you want to go?
          </h1>
        </div>

        <Card className="space-y-3 p-3 lg:p-4">
          <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-3 text-sm">
            <MapPin className="h-4 w-4 text-brand" />
            <span className="text-muted">From</span>
            <span className="truncate font-medium">
              {geoCoords
                ? `Current Location (${geoCoords.latitude.toFixed(3)}, ${geoCoords.longitude.toFixed(3)})`
                : isGeoLoading
                ? "Acquiring GPS location…"
                : "Location unavailable (enable GPS)"}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
            className="flex items-center gap-2 rounded-xl border border-line px-3 focus-within:border-brand"
          >
            <Search className="h-4 w-4 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search destination"
              aria-label="Destination"
              className="h-12 flex-1 bg-transparent text-base outline-none"
            />
          </form>
          <div className="flex flex-wrap gap-2">
            {DESTINATIONS.map((d) => (
              <Chip key={d} onClick={() => go(d)}>
                {d}
              </Chip>
            ))}
          </div>
          <Button size="lg" className="w-full" onClick={() => go()}>
            Find safe routes <ArrowRight className="h-4 w-4" />
          </Button>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="flex items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-safer/10 text-2xl font-bold text-safer">
              {areaScore ?? "—"}
            </div>
            <div>
              <p className="font-semibold">Your area right now</p>
              <p className="text-sm text-muted">
                {segments.length
                  ? `Live view across ${segments.length} mapped road segments.`
                  : "No road segment data available for this area yet."}
              </p>
            </div>
          </Card>
          <Card className="flex items-start gap-3 bg-brand-soft">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <div>
              <p className="font-semibold">Safety Lens</p>
              <p className="text-sm text-muted">
                Tap any road on the map to see why it scores the way it does.
              </p>
              <Link
                href="/safety"
                className="mt-1 inline-block text-sm font-semibold text-brand"
              >
                Open Safety Lens →
              </Link>
            </div>
          </Card>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Recent safety updates</h2>
            <Link href="/stories" className="text-sm font-semibold text-brand">
              See stories
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : reports.length ? (
            <div className="space-y-2">
              {reports.slice(0, 5).map((p) => (
                <Card key={p.id} className="flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {p.place} · {p.tag}
                    </p>
                    <p className="text-sm text-muted">{p.note}</p>
                  </div>
                  <span className="text-xs text-muted">
                    {timeAgo(p.minutesAgo)}
                  </span>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="text-sm text-muted">
              No recent safety reports are available yet.
            </Card>
          )}
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-3xl border border-line shadow-card lg:block lg:sticky lg:top-8 lg:h-[580px]">
        <div className="relative h-full">
          <MapLibreMap
            className="h-full w-full"
            segments={segments}
            markers={mapMarkers}
          />
          {areaScore !== null && (
            <div className="absolute left-3 top-3 z-[5]">
              <ScoreBadge score={areaScore} className="bg-white shadow-card" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
