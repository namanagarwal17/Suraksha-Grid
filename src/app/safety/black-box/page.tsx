"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Radio,
  Plus,
  Clock,
  Ruler,
  Calendar,
  MapPin,
  ChevronRight,
  ShieldCheck,
  FileText,
  AlertTriangle,
  Loader2,
  Trash2,
  Download,
  Share2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { JourneyReportView } from "@/components/blackbox/journey-report-view";
import { JourneyRecordingBanner } from "@/components/blackbox/journey-recording-banner";
import { useBlackBox } from "@/lib/services/use-blackbox";
import { getAllJourneys, getJourney, deleteJourney } from "@/lib/services/blackbox-storage";
import { formatDuration, formatDistance } from "@/lib/services/geocoding";
import { cn } from "@/lib/utils";
import type { JourneyRecord } from "@/types/blackbox";

function BlackBoxContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedId = searchParams.get("id");

  const { isActive, journeyId: activeJourneyId, startJourney } = useBlackBox();

  const [journeys, setJourneys] = useState<JourneyRecord[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<JourneyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [destInput, setDestInput] = useState("");
  const [startInput, setStartInput] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const loadJourneys = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAllJourneys();
      setJourneys(all);

      if (selectedId) {
        const found = all.find((j) => j.id === selectedId) || (await getJourney(selectedId));
        setSelectedJourney(found || null);
      } else {
        setSelectedJourney(null);
      }
    } catch (err) {
      console.error("Failed to load journeys:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadJourneys();
  }, [loadJourneys]);

  async function handleStartNew() {
    setIsStarting(true);
    setStartError(null);

    try {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        throw new Error("Location services are not available on this device.");
      }

      const newJourney = await startJourney({
        destinationName: destInput.trim() || undefined,
        startLocationName: startInput.trim() || undefined,
      });

      setShowStartDialog(false);
      setDestInput("");
      setStartInput("");
      void loadJourneys();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Could not start recording.");
    } finally {
      setIsStarting(false);
    }
  }

  function handleSelectJourney(id: string) {
    router.push(`/safety/black-box?id=${id}`);
  }

  function handleBackToList() {
    setSelectedJourney(null);
    router.push("/safety/black-box");
    void loadJourneys();
  }

  function handleDeletedJourney(id: string) {
    setJourneys((prev) => prev.filter((j) => j.id !== id));
    handleBackToList();
  }

  // If a specific journey is selected, render its full Journey Report
  if (selectedJourney) {
    return (
      <div className="min-h-screen bg-surface px-4 py-6 sm:px-8">
        <div className="max-w-4xl mx-auto mb-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBackToList}
            className="rounded-xl border-line text-xs font-semibold text-ink hover:bg-white"
          >
            ← Back to Saved Journeys
          </Button>
        </div>

        <JourneyReportView
          journey={selectedJourney}
          onDeleted={handleDeletedJourney}
          onClose={handleBackToList}
        />
        <JourneyRecordingBanner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface px-4 py-6 sm:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Title & Mission Banner */}
        <div className="rounded-2xl border border-line bg-white p-5 sm:p-6 shadow-card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand-dark">
                  <Radio className="h-3 w-3" />
                  Telemetry Flight Recorder
                </span>
                <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-muted">
                  100% Local Device Storage
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight">
                Safety Black Box
              </h1>
              <p className="text-xs sm:text-sm text-muted leading-relaxed max-w-xl">
                Records your actual travel timeline, stops, and GPS path locally on your device.
                Generate verified journey reports, export clean PDFs, and share your route with family or authorities.
              </p>
            </div>

            <Button
              type="button"
              disabled={isActive}
              onClick={() => setShowStartDialog(true)}
              className="rounded-xl bg-brand text-white font-bold text-xs sm:text-sm px-4 py-2.5 shadow-sm hover:bg-brand-dark self-start sm:self-auto shrink-0"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {isActive ? "Recording In Progress" : "Start Journey Recording"}
            </Button>
          </div>

          {/* Privacy Guarantee Notice */}
          <div className="rounded-xl border border-line/60 bg-surface/70 p-3 flex items-start gap-2.5 text-xs text-muted">
            <ShieldCheck className="h-4 w-4 text-brand shrink-0 mt-0.5" />
            <p className="leading-relaxed text-[11px]">
              <b>Zero Cloud Telemetry:</b> Your GPS points and stops are saved exclusively in your browser’s
              secure local database (IndexedDB). They are never transmitted to any server or third party.
            </p>
          </div>
        </div>

        {/* List of Saved Journeys */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-ink flex items-center gap-2">
              <FileText className="h-4 w-4 text-brand" />
              Saved Journey Reports ({journeys.length})
            </h2>
            <span className="text-xs text-muted">Stored on this device</span>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white p-12 text-center space-y-2 shadow-card">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <p className="text-xs text-muted">Loading local journeys…</p>
            </div>
          ) : journeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white p-10 text-center space-y-3 shadow-card">
              <div className="rounded-2xl bg-brand-soft p-3 text-brand">
                <Radio className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-ink">No Recorded Journeys Yet</h3>
                <p className="text-xs text-muted max-w-sm">
                  Start a journey recording before you travel. Your device will log your timeline, stops,
                  and GPS path locally to generate a downloadable safety report.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => setShowStartDialog(true)}
                className="rounded-xl bg-brand text-white font-semibold text-xs px-4"
              >
                Start Your First Journey
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {journeys.map((j) => {
                const jDate = new Date(j.startTime);
                const isOngoing = j.status !== "completed";

                return (
                  <Card
                    key={j.id}
                    onClick={() => handleSelectJourney(j.id)}
                    className="cursor-pointer rounded-2xl border border-line p-4 transition-all hover:border-brand/60 hover:shadow-card bg-white space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              j.status === "completed"
                                ? "bg-safer/15 text-safer"
                                : "bg-amber-100 text-amber-800"
                            )}
                          >
                            {j.status === "completed" ? "Completed" : "In Progress"}
                          </span>
                          <span className="text-xs text-muted">
                            {jDate.toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-ink truncate">
                          {j.title}
                        </h3>
                        <p className="text-xs text-muted truncate flex items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span>
                            {j.startLocationName || "Start"} → {j.destinationName || "Destination"}
                          </span>
                        </p>
                      </div>

                      <ChevronRight className="h-5 w-5 text-muted/60 shrink-0 mt-1" />
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted border-t border-line/60 pt-2.5">
                      <span className="flex items-center gap-1 font-semibold text-ink">
                        <Clock className="h-3.5 w-3.5 text-brand" />
                        {formatDuration(j.durationSeconds)}
                      </span>
                      <span className="flex items-center gap-1 font-semibold text-ink">
                        <Ruler className="h-3.5 w-3.5 text-brand" />
                        {formatDistance(j.totalDistanceMeters)}
                      </span>
                      <span className="text-[11px]">
                        {j.points.length} GPS points
                      </span>
                      <span className="text-[11px] ml-auto font-mono text-muted/70">
                        {j.id.slice(0, 14)}…
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Start New Journey Modal */}
      {showStartDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md rounded-2xl border border-line bg-white p-5 sm:p-6 shadow-sheet space-y-4 animate-rise">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="rounded-xl bg-brand-soft p-2.5 text-brand-dark">
                  <Radio className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-ink">
                    Start Safety Black Box Recording
                  </h3>
                  <p className="text-xs text-muted">
                    Telemetry will be recorded locally on this device.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowStartDialog(false)}
                className="text-muted hover:text-ink p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-ink">
                  Destination (Optional)
                </label>
                <input
                  type="text"
                  value={destInput}
                  onChange={(e) => setDestInput(e.target.value)}
                  placeholder="e.g. Cyber Hub, Gurgaon or Home"
                  className="h-10 w-full rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-ink">
                  Starting Point Note (Optional)
                </label>
                <input
                  type="text"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  placeholder="e.g. Office / Sector 21"
                  className="h-10 w-full rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                />
              </div>

              {/* Permission & Consent Box */}
              <div className="rounded-xl border border-line bg-surface p-3 text-xs text-muted space-y-1">
                <p className="font-semibold text-ink flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-brand" />
                  Explicit Location Consent
                </p>
                <p className="text-[11px] leading-relaxed">
                  By starting recording, you allow Suraksha Grid to access your browser’s GPS
                  coordinates during your trip. All points and timestamps are stored exclusively on
                  this device.
                </p>
              </div>

              {startError && (
                <p className="text-xs text-concern flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{startError}</span>
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl text-xs font-semibold"
                onClick={() => setShowStartDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isStarting}
                className="flex-1 rounded-xl bg-brand text-white text-xs font-bold hover:bg-brand-dark"
                onClick={handleStartNew}
              >
                {isStarting ? "Starting GPS…" : "Start Recording"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Persistent floating banner if active */}
      <JourneyRecordingBanner onOpenReport={(id) => handleSelectJourney(id)} />
    </div>
  );
}

export default function BlackBoxPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
        </div>
      }
    >
      <BlackBoxContent />
    </Suspense>
  );
}
