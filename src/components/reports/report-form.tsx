"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ImagePlus,
  MapPin,
  Loader2,
  AlertCircle,
  Bot,
  LocateFixed,
  LogIn,
  Eye,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/card";
import { REPORT_TAGS } from "@/lib/constants";
import { useGeolocation } from "@/lib/location";
import { getUser, getSession } from "@/lib/services/auth";
import type { User } from "@supabase/supabase-js";

type FormState = "idle" | "uploading" | "submitting" | "analysing" | "done" | "error";

interface VisionResult {
  vision_used: boolean;
  lighting?: string;
  obstruction?: string;
  crowd_activity?: string;
  summary?: string;
  confidence?: string;
  vision_error?: string;
}

function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function ReportForm() {
  const [tags, setTags] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [geminiUsed, setGeminiUsed] = useState(false);
  const [geminiError, setGeminiError] = useState<string | null>(null);
  const [visionResult, setVisionResult] = useState<VisionResult | null>(null);
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined); // undefined = loading
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real geolocation from the existing location hook
  const geo = useGeolocation({ autoRequest: true });

  // Load auth state
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setAuthUser(null); // no auth required without Supabase
      return;
    }
    getUser()
      .then((u) => setAuthUser(u))
      .catch(() => setAuthUser(null));
  }, []);

  const toggle = (t: string) =>
    setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const reset = useCallback(() => {
    setTags([]);
    setText("");
    setImageFile(null);
    setImagePreview(null);
    setState("idle");
    setError(null);
    setGeminiUsed(false);
    setGeminiError(null);
    setVisionResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const requestLocation = useCallback(() => {
    void geo.requestLocation({ cacheTime: 0 });
  }, [geo]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      setImageFile(file);
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(file ? URL.createObjectURL(file) : null);
    },
    [imagePreview]
  );

  const removeImage = useCallback(() => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [imagePreview]);

  async function submit() {
    if (!tags.length && !text.trim()) return;

    // Validate we have real coordinates
    if (!geo.coords) {
      setError(
        "Location is required to submit a report. Please allow location access and try again."
      );
      setState("error");
      return;
    }

    setError(null);

    // ── Extract session auth header ──────────────────────────────────────────
    let authHeader: Record<string, string> = {};
    if (isSupabaseConfigured()) {
      try {
        const session = await getSession();
        if (session?.access_token) {
          authHeader = { Authorization: `Bearer ${session.access_token}` };
        }
      } catch (err) {
        console.warn("Could not retrieve session token:", err);
      }
    }

    // ── Step 1: Upload image if provided ──────────────────────────────────────
    let imageUrl: string | undefined;
    if (imageFile && isSupabaseConfigured()) {
      setState("uploading");
      try {
        const fd = new FormData();
        fd.append("image", imageFile);
        const uploadRes = await fetch("/api/reports/upload", {
          method: "POST",
          headers: { ...authHeader },
          body: fd,
        });
        if (uploadRes.ok) {
          const uploadData = (await uploadRes.json()) as { image_url?: string };
          imageUrl = uploadData.image_url;
        } else {
          // Non-fatal: log and continue without image
          const uploadErr = (await uploadRes.json().catch(() => ({}))) as {
            error?: string;
          };
          console.warn("Image upload failed:", uploadErr.error);
        }
      } catch (uploadErr) {
        console.warn("Image upload error:", uploadErr);
      }
    }

    // ── Step 2: Submit the report ─────────────────────────────────────────────
    setState(text.trim() ? "analysing" : "submitting");

    try {
      const payload = {
        category: tags[0] ?? "Other",
        description: text.trim() || undefined,
        original_text: text.trim() || undefined,
        latitude: geo.coords.latitude,
        longitude: geo.coords.longitude,
        severity: 1,
        ...(imageUrl ? { image_url: imageUrl } : {}),
      };

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const errMsg =
          (body["detail"] as string) ||
          (body["error"] as string) ||
          `Submission failed (HTTP ${res.status})`;
        throw new Error(errMsg);
      }

      const data = (await res.json()) as {
        report?: { id?: string };
        gemini_used?: boolean;
        gemini_error?: string;
      };
      setGeminiUsed(data.gemini_used ?? false);
      setGeminiError(data.gemini_error ?? null);

      // ── Step 3: Trigger Vision analysis (non-blocking) ────────────────────
      const reportId = data.report?.id;
      if (reportId && imageUrl) {
        fetch(`/api/reports/${reportId}/analyse-image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
          body: JSON.stringify({ image_url: imageUrl }),
        })
          .then((r) => r.json())
          .then((v) => setVisionResult(v as VisionResult))
          .catch((e) =>
            setVisionResult({
              vision_used: false,
              vision_error: e instanceof Error ? e.message : "Vision unavailable",
            })
          );
      }

      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  // ── Auth gate (only when Supabase is configured) ─────────────────────────
  if (isSupabaseConfigured()) {
    if (authUser === undefined) {
      return (
        <Card className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </Card>
      );
    }

    if (authUser === null) {
      return (
        <Card className="space-y-4 py-8 text-center">
          <LogIn className="mx-auto h-10 w-10 text-muted" />
          <div>
            <p className="font-semibold text-ink">Sign in to submit a report</p>
            <p className="mt-1 text-sm text-muted">
              Reports are linked to your account to help the community trust
              them.
            </p>
          </div>
          <Link href="/auth/login?redirect=/report">
            <Button size="lg" className="w-full max-w-xs">
              Sign in
            </Button>
          </Link>
          <p className="text-sm text-muted">
            No account?{" "}
            <Link
              href="/auth/signup?redirect=/report"
              className="font-semibold text-brand"
            >
              Create one
            </Link>
          </p>
        </Card>
      );
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (state === "done")
    return (
      <Card className="animate-rise space-y-2 py-10 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-safer" />
        <h2 className="text-xl font-bold">Thanks for helping others</h2>
        <p className="text-sm text-muted">
          Your report will improve safety scores nearby.
        </p>
        {geminiUsed && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-brand">
            <Bot className="h-3.5 w-3.5" />
            AI extracted structured signals from your text
          </p>
        )}
        {geminiError && !geminiUsed && (
          <p className="text-xs text-muted">
            AI analysis unavailable — report saved without it.
          </p>
        )}
        {/* Vision analysis result (loaded async) */}
        {visionResult?.vision_used && (
          <div className="mx-auto mt-3 max-w-xs rounded-xl bg-surface p-3 text-left text-xs">
            <p className="mb-1.5 flex items-center gap-1 font-semibold text-brand">
              <Eye className="h-3.5 w-3.5" />
              Image analysis
            </p>
            {visionResult.lighting && (
              <p className="text-muted">
                Lighting:{" "}
                <span className="font-medium text-ink capitalize">
                  {visionResult.lighting}
                </span>
              </p>
            )}
            {visionResult.obstruction && (
              <p className="text-muted">
                Obstruction:{" "}
                <span className="font-medium text-ink capitalize">
                  {visionResult.obstruction}
                </span>
              </p>
            )}
            {visionResult.crowd_activity && (
              <p className="text-muted">
                Activity:{" "}
                <span className="font-medium text-ink capitalize">
                  {visionResult.crowd_activity}
                </span>
              </p>
            )}
            {visionResult.summary && (
              <p className="mt-1 text-muted italic">{visionResult.summary}</p>
            )}
          </div>
        )}
        {imageFile && !visionResult && isSupabaseConfigured() && (
          <p className="text-xs text-muted">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Analysing image…
          </p>
        )}
        <Button className="mt-4" variant="outline" onClick={reset}>
          Add another
        </Button>
      </Card>
    );

  // ── Location indicator ────────────────────────────────────────────────────
  function locationLabel(): string {
    if (geo.status === "loading") return "Getting your location…";
    if (geo.status === "success" && geo.coords) {
      return `${geo.coords.latitude.toFixed(5)}, ${geo.coords.longitude.toFixed(5)}`;
    }
    if (geo.status === "error") return "Location unavailable";
    return "Location not yet obtained";
  }

  const locationOk = geo.status === "success" && !!geo.coords;

  const isSubmitting =
    state === "uploading" || state === "submitting" || state === "analysing";

  return (
    <Card className="space-y-5">
      {/* Location row */}
      <div className="flex items-center gap-2 rounded-xl bg-surface p-3 text-sm">
        <MapPin
          className={`h-4 w-4 shrink-0 ${locationOk ? "text-brand" : "text-muted"}`}
        />
        <span className="min-w-0 flex-1 truncate font-medium">
          {locationLabel()}
        </span>
        {geo.status === "loading" && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
        )}
        {(geo.status === "error" || geo.status === "idle") && (
          <button
            type="button"
            onClick={requestLocation}
            className="flex shrink-0 items-center gap-1 text-xs font-semibold text-brand hover:underline"
          >
            <LocateFixed className="h-3 w-3" />
            Retry
          </button>
        )}
        {locationOk && (
          <span className="shrink-0 text-xs text-safer">✓ Located</span>
        )}
      </div>

      {/* Location error banner */}
      {geo.status === "error" && geo.error && (
        <p className="flex items-center gap-2 rounded-xl bg-moderate/10 p-3 text-sm text-moderate">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {geo.error.message} — you can still try to submit after retrying.
        </p>
      )}

      {/* Tag chips */}
      <div>
        <p className="mb-2 text-sm font-semibold">What did you notice?</p>
        <div className="flex flex-wrap gap-2">
          {REPORT_TAGS.map((t) => (
            <Chip
              key={t}
              active={tags.includes(t)}
              onClick={() => toggle(t)}
            >
              {t}
            </Chip>
          ))}
        </div>
      </div>

      {/* Free text */}
      <div>
        <label htmlFor="exp" className="mb-2 block text-sm font-semibold">
          Your experience{" "}
          <span className="font-normal text-muted">
            (optional — any language)
          </span>
        </label>
        <textarea
          id="exp"
          value={text}
          rows={4}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          placeholder="Share a short note for other travellers… (any language)"
          className="w-full rounded-xl border border-line p-3 text-sm outline-none focus:border-brand"
        />
        {text.trim().length > 0 && (
          <p className="mt-1 flex items-center gap-1 text-xs text-brand">
            <Bot className="h-3 w-3" />
            AI will extract structured signals from your text
          </p>
        )}
      </div>

      {/* Photo upload — real file picker with preview */}
      {imagePreview ? (
        <div className="relative overflow-hidden rounded-xl border border-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagePreview}
            alt="Selected photo preview"
            className="h-32 w-full object-cover"
          />
          <button
            type="button"
            onClick={removeImage}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
            aria-label="Remove photo"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {isSupabaseConfigured() && (
            <p className="flex items-center gap-1 bg-surface px-3 py-1.5 text-xs text-brand">
              <Eye className="h-3 w-3" />
              Photo will be analysed for environmental safety signals
            </p>
          )}
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line p-3 text-sm text-muted hover:bg-surface">
          <ImagePlus className="h-4 w-4" />
          Add a photo (optional)
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="sr-only"
            onChange={handleFileChange}
          />
        </label>
      )}

      {/* Submission error */}
      {state === "error" && error && (
        <p className="flex items-center gap-2 rounded-xl bg-concern/10 p-3 text-sm text-concern">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <Button
        size="lg"
        className="w-full"
        disabled={(!tags.length && !text.trim()) || isSubmitting}
        onClick={submit}
      >
        {state === "uploading" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Uploading photo…
          </>
        )}
        {state === "submitting" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        )}
        {state === "analysing" && (
          <>
            <Bot className="h-4 w-4 animate-pulse" />
            Analysing…
          </>
        )}
        {(state === "idle" || state === "error") && "Submit report"}
      </Button>
    </Card>
  );
}