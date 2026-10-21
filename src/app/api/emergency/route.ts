import { NextResponse, type NextRequest } from "next/server";

export interface EmergencyPayload {
  user_name: string;
  latitude?: number;
  longitude?: number;
  destination?: string;
  route_name?: string;
  emergency_contact_email?: string;
  emergency_contact_phone?: string;
  voice_message_base64?: string;
  voice_message_mime_type?: string;
  voice_message_filename?: string;
  idempotency_key?: string;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fastapiBase = process.env.FASTAPI_BASE_URL ?? "http://localhost:8000";
  try {
    const resp = await fetch(`${fastapiBase}/api/v1/emergency/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data: unknown = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backend unavailable" },
      { status: 503 }
    );
  }
}