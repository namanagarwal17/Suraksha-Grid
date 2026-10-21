/**
 * POST /api/reports/upload
 *
 * Accepts a multipart/form-data upload with a single field named "image".
 * Validates the file, uploads it to the Supabase "report-images" storage
 * bucket under <user_id>/<timestamp>.<ext>, and returns the signed URL
 * (valid for 24 hours) so the report form can include it in the report payload.
 *
 * Requirements:
 *  - User must be authenticated (Supabase session cookie)
 *  - Supabase env vars must be configured
 *  - File must be JPEG, PNG, WebP or GIF and ≤ 5 MB
 */
import { NextResponse, type NextRequest } from "next/server";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function extForMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[mime] ?? "bin";
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  // ── Auth check ──────────────────────────────────────────────────────────────
  let userId: string;
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    let user = null;
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user) user = data.user;
    }
    if (!user) {
      const { data, error: authError } = await supabase.auth.getUser();
      if (!authError && data?.user) user = data.user;
    }

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "Authentication verification failed" }, { status: 401 });
  }

  // ── Parse multipart body ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'image' field" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}` },
      { status: 415 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File exceeds 5 MB limit" },
      { status: 413 }
    );
  }

  // ── Validate magic bytes (do not trust client MIME type) ─────────────────────
  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes.slice(0, 12));

  function isAllowedImage(h: Uint8Array): boolean {
    // JPEG: FF D8 FF
    if (h.length >= 3 && h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) return true;
    // GIF: GIF87a or GIF89a (47 49 46 38)
    if (h.length >= 6 && h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) return true;
    // WebP: RIFF (52 49 46 46) ... WEBP (57 45 42 50)
    if (
      h.length >= 12 &&
      h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
      h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50
    ) return true;
    return false;
  }

  if (!isAllowedImage(header)) {
    return NextResponse.json(
      { error: "Invalid image content: file signature does not match supported image format" },
      { status: 415 }
    );
  }

  // ── Upload to Supabase Storage ───────────────────────────────────────────────
  const ext = extForMime(file.type);
  const filename = `${userId}/${Date.now()}.${ext}`;

  try {
    const { createServerSupabaseClient } = await import("@/lib/supabase/server");
    const supabase = await createServerSupabaseClient();

    const { error: uploadError } = await supabase.storage
      .from("report-images")
      .upload(filename, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Create a signed URL valid for 24 hours
    const { data: signed, error: signError } = await supabase.storage
      .from("report-images")
      .createSignedUrl(filename, 86400);

    if (signError || !signed?.signedUrl) {
      return NextResponse.json(
        { error: "Uploaded but could not generate signed URL" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { image_url: signed.signedUrl, path: filename },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
