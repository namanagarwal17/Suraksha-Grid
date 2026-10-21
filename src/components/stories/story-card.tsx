"use client";
import { useState } from "react";
import { ThumbsUp, MapPin } from "lucide-react";
import type { Story } from "@/types";
import { Card } from "@/components/ui/card";
import { cn, timeAgo } from "@/lib/utils";
import { incrementHelpful } from "@/lib/services/stories";

export function StoryCard({ story }: { story: Story }) {
  const [helpful, setHelpful] = useState(story.helpful);
  const [voted, setVoted]     = useState(false);

  async function handleHelpful() {
    if (voted) return;
    setVoted(true);
    setHelpful((h) => h + 1);
    await incrementHelpful(story.id);
  }

  return (
    <Card className="animate-rise">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1 font-semibold text-ink">
          <MapPin className="h-3.5 w-3.5 text-brand" />{story.place}
        </span>
        <span>{timeAgo(story.minutesAgo)}</span>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed">{story.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {story.tags.map((t) => (
          <span key={t} className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-muted">{t}</span>
        ))}
        <button
          onClick={handleHelpful}
          aria-pressed={voted}
          disabled={voted}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition",
            voted ? "bg-brand text-white" : "bg-brand-soft text-brand-dark hover:bg-brand/20",
          )}
        >
          <ThumbsUp className="h-4 w-4" />Helpful · {helpful}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">— {story.author}</p>
    </Card>
  );
}