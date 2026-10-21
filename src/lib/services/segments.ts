import type { Segment } from "@/types";
import { LEVELS } from "@/lib/constants";
import { levelOf } from "@/lib/utils";
import { lineStringCoords, isSyntheticBoundingGeometry } from "@/lib/map/geometry";
import { apiGet } from "@/lib/services/api";

function configured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const DEMO_ROAD_NAMES = new Set([
  "Ring Road",
  "MG Road",
  "Market Lane",
  "Station Link",
  "Canal Road",
  "Temple Street",
  "Civil Lines",
  "Garden Path",
]);

/**
 * Identify synthetic bounding-box or demo seed segments that do not
 * represent verified, road-following physical geometries.
 */
export function isSyntheticSegment(segment: {
  id?: string;
  name?: string;
  coords?: unknown;
}): boolean {
  if (!segment) return true;
  // Demo seed UUID prefix from 006_demo_seed.sql
  if (segment.id && segment.id.startsWith("00000000-0000-0000-0000-")) return true;
  // Synthetic rectangular bounding-box coordinates
  if (Array.isArray(segment.coords) && isSyntheticBoundingGeometry(segment.coords as any)) {
    return true;
  }
  // Hardcoded demo roads when lacking verified multi-point road curvature
  if (segment.name && DEMO_ROAD_NAMES.has(segment.name)) {
    if (!Array.isArray(segment.coords) || (segment.coords as any[]).length <= 3) {
      return true;
    }
  }
  return false;
}

function rowToSegment(row: Record<string, unknown>): Segment {
  const score = Number(row["safety_score"] ?? 50);
  const coords = lineStringCoords(row["geometry"]);

  return {
    id:            String(row["id"]),
    name:          String(row["name"] ?? "Unknown"),
    path:          "",
    coords,
    score,
    confidence:    row["confidence_score"] != null ? Number(row["confidence_score"]) : 0,
    lighting:      row["lighting_score"] != null ? Number(row["lighting_score"]) : 0,
    activity:      row["pedestrian_activity_score"] != null ? Number(row["pedestrian_activity_score"]) : 0,
    emergency:     (row["emergency_access_label"] as Segment["emergency"]) ?? "Fair",
    timeCondition: String(row["time_condition"] ?? ""),
    explanation:   String(row["explanation"] ?? (LEVELS[levelOf(score)]?.label ?? "Moderate")),
    observations:  [],
    riskFactors:   [],
    positiveFactors: [],
    recentReportCount: Number(row["recent_reports_count"] ?? 0),
  };
}

const SEGMENT_FIELDS =
  "id,name,safety_score,confidence_score,lighting_score," +
  "pedestrian_activity_score,emergency_access_score," +
  "emergency_access_label,time_condition,explanation," +
  "recent_reports_count,geometry::json";

export async function getSegments(): Promise<Segment[]> {
  if (!configured()) return [];

  try {
    const rows = await apiGet<Record<string, unknown>[]>("segments");
    const mapped = rows.map(rowToSegment);
    const genuine = mapped.filter((segment) => !isSyntheticSegment(segment) && segment.coords.length >= 2);
    return genuine;
  } catch (apiError) {
    console.warn("[segments] FastAPI read failed, trying direct Supabase:", apiError);

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("road_segments")
        .select(SEGMENT_FIELDS)
        .limit(3000);
      if (error) throw error;

      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      const mapped = rows.map(rowToSegment);
      const genuine = mapped.filter((segment) => !isSyntheticSegment(segment) && segment.coords.length >= 2);
      return genuine;
    } catch (err) {
      console.warn("[segments] Supabase unavailable:", err);
      return [];
    }
  }
}

export async function getSegmentById(id: string): Promise<Segment | undefined> {
  if (!configured()) return undefined;

  try {
    const segment = await apiGet<Record<string, unknown>>(`segments/${id}`);
    const seg = rowToSegment(segment);
    return isSyntheticSegment(seg) ? undefined : seg;
  } catch {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("road_segments")
        .select(SEGMENT_FIELDS)
        .eq("id", id)
        .single();
      if (error) throw error;
      if (!data) return undefined;
      const seg = rowToSegment(data as unknown as Record<string, unknown>);
      return isSyntheticSegment(seg) ? undefined : seg;
    } catch {
      return undefined;
    }
  }
}
