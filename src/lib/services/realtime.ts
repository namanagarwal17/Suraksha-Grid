/**
 * Supabase Realtime subscriptions.
 *
 * subscribeToReports       — fires on every new safety_reports INSERT
 * subscribeToSegmentUpdates — fires when a road_segments row is UPDATEd
 *                             (score recalculation complete)
 *
 * Both return an object with unsubscribe() so callers clean up on unmount.
 * Falls back to a no-op when Supabase is not configured.
 */
import type { Database } from "@/lib/supabase/types";

type ReportRow = Database["public"]["Tables"]["safety_reports"]["Row"];
type SegmentRow = Database["public"]["Tables"]["road_segments"]["Row"];

export type ReportInsertHandler  = (report: ReportRow) => void;
export type SegmentUpdateHandler = (segment: Pick<SegmentRow, "id" | "safety_score" | "updated_at">) => void;

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

function configured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function subscribeToReports(
  onInsert: ReportInsertHandler,
): Promise<RealtimeSubscription> {
  if (!configured()) return { unsubscribe: () => {} };
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const chanId = `safety_reports_inserts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ch = sb
    .channel(chanId)
    .on<ReportRow>(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "safety_reports" },
      (payload) => {
        if (payload?.new) {
          onInsert(payload.new as ReportRow);
        }
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      try {
        void sb.removeChannel(ch);
      } catch (e) {
        console.warn("[realtime] unsubscribe error:", e);
      }
    },
  };
}

export async function subscribeToSegmentUpdates(
  onUpdate: SegmentUpdateHandler,
): Promise<RealtimeSubscription> {
  if (!configured()) return { unsubscribe: () => {} };
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const chanId = `road_segments_updates_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ch = sb
    .channel(chanId)
    .on<SegmentRow>(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "road_segments" },
      (payload) => {
        if (payload?.new) {
          const { id, safety_score, updated_at } = payload.new;
          if (id && safety_score !== undefined) {
            onUpdate({ id, safety_score, updated_at });
          }
        }
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      try {
        void sb.removeChannel(ch);
      } catch (e) {
        console.warn("[realtime] unsubscribe error:", e);
      }
    },
  };
}

/**
 * Trigger a server-side segment recalculation via the Next.js API proxy.
 * Never exposes backend credentials to the browser.
 * Returns null on success, error string on failure.
 */
export async function triggerRecalculation(segmentId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/recalculate/${segmentId}`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return body.error ?? `HTTP ${res.status}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Network error";
  }
}