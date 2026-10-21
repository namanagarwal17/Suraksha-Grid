"use client";
import { useCallback, useEffect, useState } from "react";
import { MapLayout } from "@/components/map/map-layout";
import { MapLibreMap } from "@/components/map/maplibre-map";
import { Legend } from "@/components/safety/score";
import { SafetyLens } from "@/components/safety/safety-lens";
import { Chip, EmptyState, Skeleton } from "@/components/ui/card";
import { getSegments } from "@/lib/services/segments";
import { fetchCrimeGeoJSON, type CrimeGeoJSON } from "@/lib/services/crime";
import type { Segment } from "@/types";

export default function SafetyPage() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [crimeGeoJSON, setCrimeGeoJSON] = useState<CrimeGeoJSON | null>(null);
  const [sel, setSel] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    Promise.all([getSegments(), fetchCrimeGeoJSON()])
      .then(([segmentData, crimeData]) => {
        if (!alive) return;
        setSegments(segmentData);
        if (crimeData && crimeData.features.length > 0) {
          setCrimeGeoJSON(crimeData);
        }
        const preferred = segmentData.find((segment) => segment.score < 50) ?? segmentData[0];
        setSel(preferred?.id ?? "");
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const [filterQuery, setFilterQuery] = useState("");

  const onSelect = useCallback((id: string) => setSel(id), []);
  const selected = segments.find((segment) => segment.id === sel);

  // Filter segments for chip list by name
  const filteredSegments = segments.filter((s) =>
    !filterQuery ? true : s.name.toLowerCase().includes(filterQuery.toLowerCase())
  );
  // Ensure selected segment is present in visible chips list
  const visibleChips = (() => {
    const list = filteredSegments.slice(0, 25);
    if (selected && !list.some((s) => s.id === selected.id)) {
      list.unshift(selected);
    }
    return list;
  })();

  return (
    <MapLayout
      map={
        <div className="relative h-full">
          <MapLibreMap
            className="h-full w-full"
            segments={segments}
            selectedSegmentId={sel}
            onSelectSegment={onSelect}
            crimeGeoJSON={crimeGeoJSON}
            showCrimeOverlay={true}
          />
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[5]">
            <Legend />
          </div>
          {loading && (
            <div className="absolute left-3 bottom-20 z-[5] rounded-xl bg-white/95 px-3 py-2 text-xs text-muted shadow-card">
              Loading safety intelligence…
            </div>
          )}
        </div>
      }
      panel={
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-bold">Safety Lens</h1>
            <p className="text-sm text-muted">
              {segments.length
                ? `Analyzing ${segments.length} verified Jaipur & Alwar road segments`
                : "Road-level safety intelligence"}
            </p>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-56" />
            </div>
          ) : segments.length ? (
            <>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Filter roads (e.g. Amer Road, Tonk, Station)…"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="w-full rounded-xl border border-divider bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {visibleChips.map((segment) => (
                    <Chip
                      key={segment.id}
                      active={segment.id === sel}
                      onClick={() => setSel(segment.id)}
                      className="shrink-0 text-xs"
                    >
                      {segment.name}
                    </Chip>
                  ))}
                  {filteredSegments.length > 25 && (
                    <span className="self-center px-1 text-[10px] text-muted whitespace-nowrap">
                      +{filteredSegments.length - 25} more
                    </span>
                  )}
                </div>
              </div>
              <SafetyLens segment={selected} />
            </>
          ) : (
            <EmptyState
              title="No verified road segments available"
              hint="Road-level safety intelligence requires verified road network geometries. Historical NCRB district crime data is active on the map."
            />
          )}
        </div>
      }
    />
  );
}
