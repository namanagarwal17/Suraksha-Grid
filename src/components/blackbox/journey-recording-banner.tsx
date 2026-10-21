"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Radio,
  Pause,
  Play,
  CheckCircle2,
  X,
  MapPin,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBlackBox } from "@/lib/services/use-blackbox";
import { formatDuration } from "@/lib/services/geocoding";
import { cn } from "@/lib/utils";

interface Props {
  onOpenReport?: (journeyId: string) => void;
  className?: string;
}

export function JourneyRecordingBanner({ onOpenReport, className }: Props) {
  const router = useRouter();
  const {
    isActive,
    journeyId,
    status,
    elapsedSeconds,
    pointsCount,
    isStationary,
    lastPoint,
    pauseJourney,
    resumeJourney,
    completeJourney,
    cancelJourney,
  } = useBlackBox();

  const [liveSeconds, setLiveSeconds] = useState(elapsedSeconds);
  const [isFinishing, setIsFinishing] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);

  // Live seconds ticker when recording
  useEffect(() => {
    if (!isActive || status !== "recording") return;

    setLiveSeconds(elapsedSeconds);
    const interval = setInterval(() => {
      setLiveSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive, status, elapsedSeconds]);

  if (!isActive) return null;

  async function handleFinish() {
    setIsFinishing(true);
    try {
      const completed = await completeJourney();
      if (onOpenReport) {
        onOpenReport(completed.id);
      } else {
        router.push(`/safety/black-box?id=${completed.id}`);
      }
    } catch (err) {
      console.error("Failed to complete journey:", err);
    } finally {
      setIsFinishing(false);
    }
  }

  async function handleCancelConfirm() {
    await cancelJourney();
    setShowConfirmCancel(false);
  }

  return (
    <>
      <div
        className={cn(
          "fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-lg animate-rise",
          className
        )}
      >
        <div className="rounded-2xl border border-line/80 bg-white/95 p-3.5 shadow-sheet backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            {/* Left: Indicator & Telemetry Stats */}
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  status === "recording"
                    ? isStationary
                      ? "bg-amber-100 text-amber-700"
                      : "bg-brand-soft text-brand-dark"
                    : "bg-surface text-muted"
                )}
              >
                {status === "recording" && (
                  <span
                    className={cn(
                      "absolute inline-flex h-full w-full rounded-xl opacity-75 animate-ping",
                      isStationary ? "bg-amber-300" : "bg-brand/40"
                    )}
                  />
                )}
                <Radio className="relative h-5 w-5" />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
                    Safety Black Box
                  </span>
                  {isStationary && status === "recording" && (
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                      Stop Detected
                    </span>
                  )}
                  {status === "paused" && (
                    <span className="rounded-md bg-surface px-1.5 py-0.2 text-[10px] font-semibold text-muted">
                      Paused
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-ink font-semibold">
                  <span className="tabular-nums font-mono">
                    {formatDuration(liveSeconds)}
                  </span>
                  <span className="text-muted/40">•</span>
                  <span className="text-muted text-[11px] font-medium">
                    {pointsCount} GPS {pointsCount === 1 ? "point" : "points"}
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {status === "recording" ? (
                <button
                  type="button"
                  onClick={() => void pauseJourney()}
                  title="Pause recording"
                  className="rounded-xl p-2 text-muted hover:bg-surface hover:text-ink active:scale-95 transition-all"
                >
                  <Pause className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void resumeJourney()}
                  title="Resume recording"
                  className="rounded-xl p-2 text-brand hover:bg-brand-soft active:scale-95 transition-all"
                >
                  <Play className="h-4 w-4" />
                </button>
              )}

              <Button
                type="button"
                size="sm"
                disabled={isFinishing}
                onClick={handleFinish}
                className="h-8 rounded-xl bg-ink px-3 text-xs font-semibold text-white shadow-sm hover:bg-ink/90 active:scale-95"
              >
                {isFinishing ? (
                  "Finalizing…"
                ) : (
                  <>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Complete
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setShowConfirmCancel(true)}
                title="Discard recording"
                className="rounded-xl p-2 text-muted/60 hover:bg-surface hover:text-concern active:scale-95 transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      {showConfirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-sheet space-y-3 animate-rise">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-100 p-2.5 text-concern shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-ink">Discard Journey Recording?</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  This will stop tracking and permanently delete all {pointsCount} GPS points
                  recorded for this trip. This cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl text-xs font-semibold"
                onClick={() => setShowConfirmCancel(false)}
              >
                Keep Recording
              </Button>
              <Button
                type="button"
                className="flex-1 rounded-xl bg-concern text-white text-xs font-semibold hover:bg-concern/90"
                onClick={handleCancelConfirm}
              >
                Discard Trip
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
