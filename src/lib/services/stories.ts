import type { Story } from "@/types";
import { apiGet, apiPost } from "@/lib/services/api";

function configured() {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function getStories(): Promise<Story[]> {
  if (!configured()) return [];

  const mapRows = (rows: Array<Record<string, unknown>>): Story[] =>
    rows.map((s) => ({
      id: String(s["id"]),
      author: "Community member",
      place: String(s["place_name"] ?? "Unknown location"),
      body: String(s["content"] ?? ""),
      tags: Array.isArray(s["tags"]) ? s["tags"].map(String) : [],
      minutesAgo: Math.max(
        0,
        Math.round(
          (Date.now() - new Date(String(s["created_at"])).getTime()) / 60_000,
        ),
      ),
      helpful: Number(s["helpful_count"] ?? 0),
    }));

  try {
    const rows = await apiGet<Record<string, unknown>[]>("stories?limit=40");
    return mapRows(rows);
  } catch (apiError) {
    console.warn("[stories] FastAPI read failed, trying direct Supabase:", apiError);

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("street_stories")
        .select("id,place_name,content,tags,helpful_count,created_at,user_id")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return mapRows((data ?? []) as unknown as Record<string, unknown>[]);
    } catch {
      return [];
    }
  }
}

export interface CreateStoryInput {
  content: string;
  place_name?: string;
  tags?: string[];
  road_segment_id?: string;
}

export async function createStory(input: CreateStoryInput): Promise<{ ok: boolean; error?: string }> {
  if (!configured()) {
    return { ok: false, error: "Database not configured." };
  }
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const { data: ud } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("street_stories") as any).insert({
      user_id:         ud.user?.id ?? null,
      content:         input.content,
      place_name:      input.place_name ?? null,
      tags:            input.tags ?? [],
      road_segment_id: input.road_segment_id ?? null,
    });
    if (error) throw error;
    return { ok: true };
  } catch (err) {
    try {
      await apiPost("stories", {
        content: input.content,
        place_name: input.place_name ?? null,
        tags: input.tags ?? [],
        road_segment_id: input.road_segment_id ?? null,
      });
      return { ok: true };
    } catch {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  }
}

export async function incrementHelpful(id: string): Promise<void> {
  if (!configured()) return;
  try {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)("increment_helpful", { story_id: id });
  } catch { /* silent */ }
}