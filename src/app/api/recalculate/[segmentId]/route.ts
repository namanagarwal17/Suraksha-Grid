
import { NextResponse, type NextRequest } from "next/server";

type RouteContext = {
  params: Promise<{ segmentId: string }>;
};

/**
 * Server-side proxy: browser → this route → FastAPI → Safety Engine → Supabase.
 * The FastAPI base URL and any privileged credentials stay in server env vars.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
) {
  const { segmentId } = await params;
  const fastapiBase = (
    process.env.FASTAPI_BASE_URL ?? "http://localhost:8000"
  ).replace(/\/+$/, "");

  try {
    const resp = await fetch(
      `${fastapiBase}/api/v1/safety/recalculate/${encodeURIComponent(segmentId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      }
    );

    if (!resp.ok) {
      const err = await resp.text().catch(() => "unknown");
      return NextResponse.json({ error: err }, { status: resp.status });
    }

    const data: unknown = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend unavailable" },
      { status: 503 }
    );
  }
}
