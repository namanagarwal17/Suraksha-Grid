import { NextResponse, type NextRequest } from "next/server";

export interface ReportPayload {
  category: string;
  description?: string;
  latitude: number;
  longitude: number;
  road_segment_id?: string;
  severity?: number;
  original_text?: string;
  language?: string;
  image_url?: string;
}

function validatePayload(body: unknown): body is ReportPayload {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b["category"] !== "string" || b["category"].trim().length === 0) return false;
  if (typeof b["latitude"] !== "number" || typeof b["longitude"] !== "number") return false;
  if (b["description"] !== undefined && typeof b["description"] !== "string") return false;
  if (b["description"] && (b["description"] as string).length > 2000) return false;
  if (b["image_url"] !== undefined && typeof b["image_url"] !== "string") return false;
  return true;
}

async function directSupabaseInsert(
  body: ReportPayload,
  userId: string | null
): Promise<NextResponse> {
  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error: dbError } = await (supabase.from("safety_reports") as any)
      .insert({
        user_id: userId,
        category: body.category,
        description: body.description ?? null,
        latitude: body.latitude,
        longitude: body.longitude,
        road_segment_id: body.road_segment_id ?? null,
        severity: body.severity ?? 1,
        status: "pending",
      })
      .select()
      .single();

    if (dbError) {
      return NextResponse.json({ error: "Failed to save report to database" }, { status: 500 });
    }
    return NextResponse.json(
      {
        report: inserted,
        gemini_used: false,
        gemini_error: "Backend AI analysis unavailable — report saved directly to database",
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Database error occurred while saving report" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!validatePayload(body)) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 422 });
  }

  let userId: string | null = null;
  let token: string | null = null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      // 1. Check Bearer token from incoming Authorization header
      const authHeader = request.headers.get("authorization");
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
      }

      const { createServerSupabaseClient } = await import("@/lib/supabase/server");
      const supabase = await createServerSupabaseClient();

      // 2. If token not in header, check cookie session
      if (!token) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.access_token) {
          token = sessionData.session.access_token;
        }
      }

      // 3. Verify user identity
      let user = null;
      if (token) {
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user) {
          user = data.user;
        }
      }
      if (!user) {
        const { data, error } = await supabase.auth.getUser();
        if (!error && data?.user) {
          user = data.user;
        }
      }

      if (!user) {
        return NextResponse.json(
          { error: "Authentication required to submit reports" },
          { status: 401 }
        );
      }
      userId = user.id;
    } catch {
      return NextResponse.json(
        { error: "Authentication verification failed" },
        { status: 401 }
      );
    }
  }

  const fastapiBase = process.env.FASTAPI_BASE_URL ?? "http://localhost:8000";
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (userId) {
      headers["x-user-id"] = userId;
    }

    const resp = await fetch(`${fastapiBase}/api/v1/reports/`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      const errorMsg =
        err.detail || err.error || `Report submission failed (${resp.status})`;

      // If FastAPI fails with 5xx server error, fall back to direct Supabase save
      if (resp.status >= 500 && supabaseUrl && supabaseKey) {
        return await directSupabaseInsert(body, userId);
      }
      return NextResponse.json(
        { error: errorMsg, detail: err.detail },
        { status: resp.status }
      );
    }

    const data: unknown = await resp.json();
    return NextResponse.json(data, { status: 201 });
  } catch {
    // If FastAPI backend is unavailable, fallback to saving directly to Supabase if configured
    if (supabaseUrl && supabaseKey) {
      return await directSupabaseInsert(body, userId);
    }

    return NextResponse.json(
      { error: "Report service is currently unavailable. Please try again later." },
      { status: 503 }
    );
  }
}