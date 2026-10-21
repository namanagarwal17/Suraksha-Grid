"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PenSquare, Loader2, CheckCircle2, AlertCircle, X, MapPin } from "lucide-react";
import { StoryCard } from "@/components/stories/story-card";
import { Card, Chip, EmptyState, Skeleton } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { REPORT_TAGS } from "@/lib/constants";
import { getStories, createStory } from "@/lib/services/stories";
import { getUser } from "@/lib/services/auth";
import type { Story } from "@/types";
import type { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";

export default function StoriesPage() {
  const [tag, setTag]           = useState("All");
  const [stories, setStories]   = useState<Story[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Create Story Form State
  const [showForm, setShowForm]         = useState(false);
  const [placeName, setPlaceName]       = useState("");
  const [content, setContent]           = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [submitting, setSubmitting]     = useState(false);
  const [formError, setFormError]       = useState<string | null>(null);
  const [formSuccess, setFormSuccess]   = useState<string | null>(null);
  const [authUser, setAuthUser]         = useState<User | null>(null);

  const fetchStories = useCallback(async () => {
    try {
      const data = await getStories();
      setStories(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchStories();
    getUser().then((u) => {
      if (alive) setAuthUser(u);
    });
    return () => { alive = false; };
  }, [fetchStories]);

  const toggleTag = (t: string) => {
    setSelectedTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const trimmedContent = content.trim();
    const trimmedPlace = placeName.trim();

    if (!trimmedPlace) {
      setFormError("Please enter a location or street name.");
      return;
    }
    if (trimmedContent.length < 10) {
      setFormError("Story description must be at least 10 characters.");
      return;
    }
    if (trimmedContent.length > 2000) {
      setFormError("Story description is too long (maximum 2,000 characters).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createStory({
        content: trimmedContent,
        place_name: trimmedPlace,
        tags: selectedTags,
      });

      if (res.ok) {
        setFormSuccess("Your story has been shared with the community!");
        setContent("");
        setPlaceName("");
        setSelectedTags([]);
        await fetchStories();
        setTimeout(() => {
          setShowForm(false);
          setFormSuccess(null);
        }, 2000);
      } else {
        setFormError(res.error || "Unable to save your story. Please try again.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  const list = stories.filter((s) => tag === "All" || s.tags.includes(tag));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Street Stories</h1>
          <p className="text-sm text-muted">Real experiences from people nearby</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
            setFormSuccess(null);
          }}
          className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex cursor-pointer")}
        >
          {showForm ? <X className="h-4 w-4" /> : <PenSquare className="h-4 w-4" />}
          {showForm ? "Cancel" : "Share a story"}
        </button>
      </div>

      {/* Expandable Create Story Form */}
      {showForm && (
        <Card className="animate-rise border border-brand/20 bg-brand-soft/20 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PenSquare className="h-4 w-4 text-brand" />
              <h2 className="font-semibold text-ink">Share a Street Story</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-muted hover:text-ink p-1"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {authUser ? (
            <p className="text-xs text-muted">
              Posting as signed-in user: <span className="font-medium text-ink">{authUser.email}</span>
            </p>
          ) : (
            <p className="text-xs text-muted">
              Posting as community contributor.{" "}
              <Link href="/auth/login" className="font-semibold text-brand underline">
                Sign in
              </Link>{" "}
              to associate stories with your account.
            </p>
          )}

          {formSuccess && (
            <div className="flex items-center gap-2 rounded-xl bg-safer/10 border border-safer/30 p-3 text-xs font-medium text-safer">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{formSuccess}</span>
            </div>
          )}

          {formError && (
            <div className="flex items-center gap-2 rounded-xl bg-concern/10 border border-concern/30 p-3 text-xs font-medium text-concern">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="story-place" className="block text-xs font-semibold text-muted mb-1">
                Location or Street Name *
              </label>
              <div className="relative flex items-center">
                <MapPin className="absolute left-3 h-4 w-4 text-muted pointer-events-none" />
                <input
                  id="story-place"
                  type="text"
                  required
                  placeholder="e.g. 100ft Road, Indiranagar"
                  value={placeName}
                  onChange={(e) => setPlaceName(e.target.value)}
                  className="w-full rounded-xl border border-line bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-brand"
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label htmlFor="story-content" className="block text-xs font-semibold text-muted mb-1">
                What did you experience or notice? * (min. 10 chars)
              </label>
              <textarea
                id="story-content"
                required
                rows={3}
                placeholder="Share helpful context about lighting, pedestrian path, crowd, or general observation..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full rounded-xl border border-line bg-white p-3 text-sm outline-none focus:border-brand resize-y min-h-[80px]"
                disabled={submitting}
              />
              <span className="text-[11px] text-muted block text-right">
                {content.length}/2000
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">
                Tags (select relevant)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_TAGS.map((t) => {
                  const active = selectedTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium transition",
                        active
                          ? "bg-brand text-white"
                          : "bg-surface border border-line text-muted hover:border-brand/40 hover:text-ink"
                      )}
                      disabled={submitting}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowForm(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting || content.trim().length < 10 || !placeName.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Publishing…
                  </>
                ) : (
                  "Publish Story"
                )}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {["All", ...REPORT_TAGS.slice(0, 6)].map((t) => (
          <Chip key={t} active={tag === t} onClick={() => setTag(t)} className="shrink-0">{t}</Chip>
        ))}
      </div>

      {loading && (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}</div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-concern/30 bg-concern/5 p-4 text-sm text-concern">
          Could not load street stories. Please check your network connection.
        </div>
      )}

      {!loading && !error && (
        list.length
          ? <div className="grid gap-3 md:grid-cols-2">{list.map((s) => <StoryCard key={s.id} story={s} />)}</div>
          : <EmptyState title="No stories yet" hint="Be the first to share what you noticed on this topic." />
      )}

      <p className="text-[11px] text-muted/60 text-center">
        Stories are community observations — not verified safety assessments.
      </p>

      {/* Floating Action Button on mobile */}
      <button
        type="button"
        onClick={() => {
          setShowForm((v) => !v);
          setFormError(null);
          setFormSuccess(null);
        }}
        className={cn(buttonVariants(), "fixed bottom-20 right-4 z-20 shadow-sheet sm:hidden cursor-pointer")}
      >
        {showForm ? <X className="h-4 w-4" /> : <PenSquare className="h-4 w-4" />}
        {showForm ? "Close" : "Share story"}
      </button>
    </div>
  );
}