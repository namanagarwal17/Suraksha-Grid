/**
 * Profile service — data access for Supabase `profiles` table.
 *
 * Handles fetching and updating user profile data,
 * as well as retrieving user contribution counts and history.
 */
import type { Database } from "@/lib/supabase/types";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export interface UserContribution {
  id: string;
  type: "report" | "story";
  title: string;
  createdAt: string;
}

export interface UserStats {
  reportsCount: number;
  storiesCount: number;
  contributions: UserContribution[];
}

function isConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

async function getClient() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}

export async function getProfile(
  userId: string,
): Promise<{ data: ProfileRow | null; error: string | null }> {
  if (!isConfigured()) return { data: null, error: null };

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }
    return { data: data as ProfileRow | null, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load profile";
    return { data: null, error: msg };
  }
}

export async function updateProfile(
  userId: string,
  updates: { full_name?: string | null; avatar_url?: string | null },
): Promise<{ data: ProfileRow | null; error: string | null }> {
  if (!isConfigured()) {
    return { data: null, error: "Supabase is not configured" };
  }

  try {
    const supabase = await getClient();
    const payload = {
      full_name: updates.full_name,
      avatar_url: updates.avatar_url,
      updated_at: new Date().toISOString(),
    };

    // First attempt an update on the existing row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (supabase.from("profiles") as any)
      .update(payload)
      .eq("id", userId)
      .select()
      .maybeSingle();

    if (updateError) {
      return { data: null, error: updateError.message };
    }

    if (updated) {
      // Also update auth user metadata if possible
      try {
        await supabase.auth.updateUser({
          data: {
            ...(updates.full_name !== undefined && { full_name: updates.full_name }),
            ...(updates.avatar_url !== undefined && { avatar_url: updates.avatar_url }),
          },
        });
      } catch {
        // Auth metadata sync is secondary
      }
      return { data: updated as ProfileRow, error: null };
    }

    // If no row was updated, attempt insert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (supabase.from("profiles") as any)
      .insert({
        id: userId,
        full_name: updates.full_name,
        avatar_url: updates.avatar_url,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      return { data: null, error: insertError.message };
    }

    return { data: inserted as ProfileRow, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save profile";
    return { data: null, error: msg };
  }
}

export async function getUserContributions(
  userId: string,
): Promise<UserStats> {
  if (!isConfigured()) {
    return { reportsCount: 0, storiesCount: 0, contributions: [] };
  }

  try {
    const supabase = await getClient();
    const [reportsRes, storiesRes] = await Promise.all([
      supabase
        .from("safety_reports")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("street_stories")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    const reports = (reportsRes.data ?? []) as unknown as Array<{
      id: string;
      category: string;
      description: string | null;
      created_at: string;
    }>;
    const stories = (storiesRes.data ?? []) as unknown as Array<{
      id: string;
      place_name: string | null;
      created_at: string;
    }>;

    const contributions: UserContribution[] = [
      ...reports.map((r) => ({
        id: r.id,
        type: "report" as const,
        title: `Report: ${r.category}`,
        createdAt: r.created_at,
      })),
      ...stories.map((s) => ({
        id: s.id,
        type: "story" as const,
        title: `Story: ${s.place_name || "Community note"}`,
        createdAt: s.created_at,
      })),
    ].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      reportsCount: reports.length,
      storiesCount: stories.length,
      contributions,
    };
  } catch {
    return { reportsCount: 0, storiesCount: 0, contributions: [] };
  }
}

export interface SavedRouteItem {
  id: string;
  routeId: string;
  label: string | null;
  name: string;
  routeType: string;
  safetyScore: number;
}

export async function getSavedRoutes(userId: string): Promise<SavedRouteItem[]> {
  if (!isConfigured()) {
    return [];
  }

  try {
    const supabase = await getClient();
    const { data, error } = await supabase
      .from("saved_routes")
      .select("id, route_id, label, created_at, routes(id, name, route_type, safety_score)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];

    return (data as unknown as Array<{
      id: string;
      route_id: string;
      label: string | null;
      routes: { id: string; name: string; route_type: string; safety_score: number } | null;
    }>).map((item) => ({
      id: item.id,
      routeId: item.route_id,
      label: item.label,
      name: item.routes?.name ?? "Saved route",
      routeType: item.routes?.route_type ?? "balanced",
      safetyScore: item.routes?.safety_score ?? 70,
    }));
  } catch {
    return [];
  }
}

export interface SaveRouteParams {
  routeId?: string;
  routeType?: "fastest" | "balanced" | "safest";
  name?: string;
  label?: string;
}

export interface SaveRouteResult {
  ok: boolean;
  id?: string;
  alreadySaved?: boolean;
  error?: string;
}

/**
 * Save a route for the currently authenticated user.
 * Strictly verifies the user via Supabase Auth session (never accepts client user_id).
 * Resolves the route in the `routes` table and prevents duplicate saves.
 */
export async function saveRoute(
  routeIdentifier: SaveRouteParams,
): Promise<SaveRouteResult> {
  if (!isConfigured()) {
    return { ok: false, error: "Database not configured." };
  }

  try {
    const supabase = await getClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { ok: false, error: "You must be signed in to save a route." };
    }

    let resolvedRouteId = routeIdentifier.routeId;

    if (resolvedRouteId) {
      const { data } = await supabase
        .from("routes")
        .select("id")
        .eq("id", resolvedRouteId)
        .maybeSingle();
      const routeRow = data as { id: string } | null;
      if (!routeRow) {
        resolvedRouteId = undefined;
      }
    }

    if (!resolvedRouteId && routeIdentifier.routeType) {
      const { data } = await supabase
        .from("routes")
        .select("id")
        .eq("route_type", routeIdentifier.routeType)
        .limit(1)
        .maybeSingle();
      const routeRow = data as { id: string } | null;
      if (routeRow?.id) {
        resolvedRouteId = routeRow.id;
      }
    }

    if (!resolvedRouteId && routeIdentifier.name) {
      const { data } = await supabase
        .from("routes")
        .select("id")
        .ilike("name", routeIdentifier.name)
        .limit(1)
        .maybeSingle();
      const routeRow = data as { id: string } | null;
      if (routeRow?.id) {
        resolvedRouteId = routeRow.id;
      }
    }

    if (!resolvedRouteId) {
      return {
        ok: false,
        error: "Route cannot be saved because it does not exist in the routes database.",
      };
    }

    // Check for existing save to avoid duplicates
    const { data: existingData } = await supabase
      .from("saved_routes")
      .select("id")
      .eq("user_id", user.id)
      .eq("route_id", resolvedRouteId)
      .maybeSingle();
    const existing = existingData as { id: string } | null;

    if (existing) {
      return { ok: true, id: existing.id, alreadySaved: true };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: insertError } = await (supabase.from("saved_routes") as any)
      .insert({
        user_id: user.id,
        route_id: resolvedRouteId,
        label: routeIdentifier.label?.trim() || null,
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return { ok: true, alreadySaved: true };
      }
      return { ok: false, error: insertError.message };
    }

    return { ok: true, id: inserted?.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save route.",
    };
  }
}

/**
 * Remove a saved route owned by the currently authenticated user.
 */
export async function deleteSavedRoute(
  savedRouteId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isConfigured()) {
    return { ok: false, error: "Database not configured." };
  }

  try {
    const supabase = await getClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { ok: false, error: "You must be signed in to manage saved routes." };
    }

    const { error: deleteError } = await supabase
      .from("saved_routes")
      .delete()
      .eq("id", savedRouteId)
      .eq("user_id", user.id);

    if (deleteError) throw deleteError;
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to remove route.",
    };
  }
}

/**
 * Check if a route is already saved by the current user.
 */
export async function checkIsRouteSaved(routeIdentifier: {
  routeId?: string;
  routeType?: "fastest" | "balanced" | "safest";
}): Promise<boolean> {
  if (!isConfigured()) return false;

  try {
    const supabase = await getClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return false;

    let resolvedRouteId = routeIdentifier.routeId;

    if (!resolvedRouteId && routeIdentifier.routeType) {
      const { data: routeData } = await supabase
        .from("routes")
        .select("id")
        .eq("route_type", routeIdentifier.routeType)
        .limit(1)
        .maybeSingle();
      const routeRow = routeData as { id: string } | null;
      resolvedRouteId = routeRow?.id;
    }

    if (!resolvedRouteId) return false;

    const { data: existing } = await supabase
      .from("saved_routes")
      .select("id")
      .eq("user_id", user.id)
      .eq("route_id", resolvedRouteId)
      .maybeSingle();

    return !!existing;
  } catch {
    return false;
  }
}

