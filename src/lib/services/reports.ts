/**
 * Safety-report data access.
 *
 * createReport() is called by the ReportForm component.
 * getReports() is used by the Home/Map UI and keeps a deliberate mock fallback
 * for offline development.
 */
import type { SafetyReport } from "@/types";
import { apiGet } from "@/lib/services/api";

function isSupabaseConfigured() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export interface CreateReportInput {
  category: string;
  description?: string;
  latitude: number;
  longitude: number;
  road_segment_id?: string;
  severity?: number;
}

export async function createReport(
  input: CreateReportInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Database not configured." };
  }

  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("safety_reports") as any).insert({
      user_id: userData.user?.id ?? null,
      category: input.category,
      description: input.description,
      latitude: input.latitude,
      longitude: input.longitude,
      road_segment_id: input.road_segment_id,
      severity: input.severity ?? 1,
    });

    if (error) throw error;
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[reports] createReport failed:", msg);
    return { ok: false, error: msg };
  }
}

export async function getReports(): Promise<SafetyReport[]> {
  if (!isSupabaseConfigured()) return [];

  const mapRows = (rows: Array<Record<string, unknown>>): SafetyReport[] =>
    rows.map((r) => {
      const latitude = Number(r["latitude"]);
      const longitude = Number(r["longitude"]);
      const createdAt = String(r["created_at"]);

      return {
        id: String(r["id"]),
        place: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        tag: String(r["category"] ?? "Other"),
        minutesAgo: Math.max(
          0,
          Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000),
        ),
        note: String(r["description"] ?? ""),
        latitude,
        longitude,
        segmentId: r["road_segment_id"] ? String(r["road_segment_id"]) : undefined,
      };
    });

  try {
    const rows = await apiGet<Record<string, unknown>[]>("reports?limit=50");
    return mapRows(rows);
  } catch (apiError) {
    console.warn("[reports] FastAPI read failed, trying direct Supabase:", apiError);

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("safety_reports")
        .select("id,category,description,latitude,longitude,road_segment_id,created_at")
        .neq("status", "dismissed")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return mapRows((data ?? []) as unknown as Record<string, unknown>[]);
    } catch (err) {
      console.warn("[reports] Supabase unavailable:", err);
      return [];
    }
  }
}
