/**
 * Route data access.
 *
 * Canonical read path:
 * browser → Next.js backend proxy → FastAPI → Supabase/Postgres.
 * Direct Supabase and mock routing remain fallbacks for local resilience.
 */
import type { LngLat, RouteOption } from "@/types";
import { lineStringCoords } from "@/lib/map/geometry";
import { apiGet, apiPost } from "@/lib/services/api";

function isSupabaseConfigured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export interface RouteResult extends RouteOption {
  coords: LngLat[];
  duration_s?: number;
  distance_m?: number;
}

function rowToRouteResult(row: Record<string, unknown>): RouteResult {
  return {
    id: String(row["route_type"] ?? "balanced") as RouteOption["id"],
    dbId: row["id"] ? String(row["id"]) : undefined,
    name: String(row["name"] ?? "Route"),
    etaMin: Math.round(Number(row["duration_s"] ?? 900) / 60),
    distanceKm: +(Number(row["distance_m"] ?? 3600) / 1000).toFixed(1),
    score: Number(row["safety_score"] ?? 70),
    confidence: Number(row["confidence"] ?? 70),
    reason: String(row["reason"] ?? ""),
    segmentIds: Array.isArray(row["segment_ids"])
      ? row["segment_ids"].map(String)
      : [],
    recommended: Boolean(row["recommended"]),
    coords: lineStringCoords(row["geometry"]),
  };
}

export async function fetchRoutes(): Promise<RouteResult[]> {
  if (!isSupabaseConfigured()) return [];

  try {
    const rows = await apiGet<Record<string, unknown>[]>("routes");
    const mapped = rows.map(rowToRouteResult);

    if (mapped.length === 0) {
      throw new Error(`No route options received from FastAPI`);
    }
    if (!mapped.some((route) => route.coords.length >= 2)) {
      throw new Error("Route geometry could not be read from FastAPI");
    }
    return mapped;
  } catch (apiError) {
    console.warn("[routes] FastAPI read failed, trying direct Supabase:", apiError);

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("routes")
        .select(
          "id,name,route_type,distance_m,duration_s,safety_score,confidence," +
          "reason,segment_ids,recommended,geometry::json",
        )
        .order("safety_score", { ascending: false });

      if (error) throw error;
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const mapped = rows.map(rowToRouteResult);
      if (mapped.length === 0 || !mapped.some((route) => route.coords.length >= 2)) {
        throw new Error("Incomplete route data");
      }
      return mapped;
    } catch (err) {
      console.warn("[routes] Could not load routes:", err);
      return [];
    }
  }
}

export interface PlanRouteRequest {
  origin: LngLat;
  destination: LngLat;
  profile?: "foot-walking" | "driving-car" | "cycling-regular";
}

export interface PlanRouteResponse {
  source: "openrouteservice" | "error";
  profile?: string;
  routes: RouteResult[];
  error?: string;
}

/**
 * Request real road-network routes from FastAPI.
 * The backend calls ORS for geometry/timing AND runs the existing Safety Engine
 * (RouteScorer.score_route) over nearby pre-scored road_segments to derive a
 * real safety_score + confidence per route.  No safety data is invented here;
 * the backend returns low confidence (30) when insufficient segment data exists.
 */
export async function planRealRoute(req: PlanRouteRequest): Promise<PlanRouteResponse> {
  try {
    const raw = await apiPost<{
      source: string;
      profile?: string;
      routes: Array<{
        type: string;
        geometry: { type: string; coordinates: [number, number][] };
        properties: {
          summary?:          { distance: number; duration: number };
          segments?:         Array<{ distance: number; duration: number }>;
          // Safety Engine fields injected by the backend /plan endpoint
          route_id?:         string;
          route_name?:       string;
          recommended?:      boolean;
          safety_score?:     number;
          confidence?:       number;
          risk_factors?:     string[];
          positive_factors?: string[];
          explanation?:      string;
          segment_count?:    number;
          segment_ids?:      string[];
          historical_evidence?: RouteOption["historicalEvidence"];
        };
      }>;
      error?: string;
    }>("routes/plan", {
      origin:      [req.origin[0],      req.origin[1]],
      destination: [req.destination[0], req.destination[1]],
      profile:     req.profile ?? "foot-walking",
    });

    if (raw.source === "error" || raw.error) {
      return {
        source: "error",
        routes: [],
        error: raw.error || "Failed to calculate route with OpenRouteService.",
      };
    }

    const mappedRoutes: RouteResult[] = (raw.routes ?? [])
      .map((feature): RouteResult | null => {
        const props = feature.properties ?? {};

        // Parse and validate real GeoJSON LineString coordinates
        const coords = lineStringCoords(feature.geometry);
        if (coords.length < 2) return null;

        // ORS timing summary
        const summary = props.summary ?? {
          distance: props.segments?.[0]?.distance ?? 0,
          duration: props.segments?.[0]?.duration ?? 0,
        };

        // Route identity — backend assigns Fastest / Balanced / Safest labels
        const routeId   = (props.route_id   ?? "balanced") as RouteOption["id"];
        const routeName =  props.route_name ?? (
          routeId === "fastest" ? "Fastest" :
          routeId === "safest"  ? "Safest"  : "Balanced"
        );

        // Safety Engine output — from backend RouteScorer.score_route()
        const safetyScore  = props.safety_score      ?? 50;
        const confidence   = props.confidence         ?? 30;
        const riskFactors  = props.risk_factors       ?? [];
        const posFact      = props.positive_factors   ?? [];
        const explanation  = props.explanation        ?? "";
        const segmentCount = props.segment_count      ?? 0;

        // Human-readable reason
        const reason = explanation
          || (segmentCount > 0
            ? `Safety Engine scored ${segmentCount} road segment(s) along this route.`
            : "No nearby road segments found — safety score is a baseline estimate.");

        return {
          id:              routeId,
          name:            routeName,
          etaMin:          Math.max(1, Math.round(summary.duration / 60)),
          distanceKm:      +(summary.distance / 1000).toFixed(1),
          duration_s:      summary.duration,
          distance_m:      summary.distance,
          score:           safetyScore,
          confidence,
          reason,
          riskFactors,
          positiveFactors: posFact,
          explanation,
          segmentIds:      (props.segment_ids ?? []) as string[],
          recommended:     props.recommended ?? (routeId === "balanced"),
          coords,
          historicalEvidence: props.historical_evidence,
        };
      })
      .filter((r): r is RouteResult => r !== null);

    return {
      source:  "openrouteservice",
      profile: raw.profile,
      routes:  mappedRoutes,
    };
  } catch (err) {
    return {
      source: "error",
      routes: [],
      error:  err instanceof Error ? err.message : "Route service unavailable.",
    };
  }
}
