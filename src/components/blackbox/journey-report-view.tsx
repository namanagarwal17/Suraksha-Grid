"use client";

import { useState, useMemo } from "react";
import {
  ShieldCheck,
  MapPin,
  Clock,
  Ruler,
  Share2,
  Download,
  Trash2,
  Calendar,
  AlertTriangle,
  Info,
  ChevronRight,
  ExternalLink,
  Eye,
  CheckCircle2,
  X,
  FileText,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { JourneyMapPreview } from "./journey-map-preview";
import { generateJourneyPdfBlob } from "@/lib/services/blackbox-pdf";
import { shareJourneyPdf, downloadPdfBlob } from "@/lib/services/blackbox-share";
import { deleteJourney } from "@/lib/services/blackbox-storage";
import {
  formatCoordinates,
  formatAccuracy,
  formatDuration,
  formatDistance,
} from "@/lib/services/geocoding";
import { cn } from "@/lib/utils";
import type { JourneyRecord, JourneyEvent } from "@/types/blackbox";

interface Props {
  journey: JourneyRecord;
  onClose?: () => void;
  onDeleted?: (journeyId: string) => void;
  className?: string;
}

export function JourneyReportView({
  journey,
  onClose,
  onDeleted,
  className,
}: Props) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showShareConfirm, setShowShareConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const startDate = useMemo(() => new Date(journey.startTime), [journey.startTime]);
  const endDate = useMemo(
    () => (journey.endTime ? new Date(journey.endTime) : null),
    [journey.endTime]
  );

  const sortedEvents = useMemo(
    () => [...journey.events].sort((a, b) => a.timestamp - b.timestamp),
    [journey.events]
  );

  // PDF Generation Memo (lazily generated when needed)
  function getPdfBlob(): Blob {
    return generateJourneyPdfBlob(journey);
  }

  async function handleDownloadPdf() {
    setIsDownloading(true);
    try {
      const blob = getPdfBlob();
      const filename = `suraksha_journey_${journey.id}.pdf`;
      downloadPdfBlob(blob, filename);
    } catch (err) {
      console.error("PDF Download failed:", err);
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleConfirmShare() {
    setShowShareConfirm(false);
    setIsSharing(true);
    setShareFeedback(null);

    try {
      const blob = getPdfBlob();
      const result = await shareJourneyPdf(journey, blob);

      if (result.success) {
        setShareFeedback(result.message || "Report ready.");
      } else if (result.method === "cancelled") {
        setShareFeedback("Sharing cancelled.");
      }
    } catch (err) {
      setShareFeedback("Sharing could not be completed.");
      console.error("Share failed:", err);
    } finally {
      setIsSharing(false);
    }
  }

  async function handleDeleteConfirm() {
    setIsDeleting(true);
    try {
      await deleteJourney(journey.id);
      if (onDeleted) {
        onDeleted(journey.id);
      }
    } catch (err) {
      console.error("Failed to delete journey:", err);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <div className={cn("space-y-6 max-w-4xl mx-auto pb-10", className)}>
      {/* Top Header Card */}
      <div className="rounded-2xl border border-line bg-white p-5 sm:p-6 shadow-card space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand-dark">
                <Radio className="h-3 w-3" />
                Safety Black Box
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider",
                  journey.status === "completed"
                    ? "bg-safer/15 text-safer"
                    : "bg-amber-100 text-amber-800"
                )}
              >
                {journey.status === "completed" ? "Completed Journey" : "Incomplete Journey"}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-ink tracking-tight">
              {journey.title}
            </h1>
            <p className="text-xs text-muted flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {startDate.toLocaleDateString(undefined, {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
              <span className="text-muted/40">•</span>
              Reference: <code className="font-mono text-[11px]">{journey.id}</code>
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isDownloading}
              onClick={handleDownloadPdf}
              className="rounded-xl border-line text-xs font-semibold text-ink hover:bg-surface hover:border-brand"
            >
              <Download className="mr-1.5 h-3.5 w-3.5 text-muted" />
              {isDownloading ? "Generating…" : "Download PDF"}
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={isSharing}
              onClick={() => setShowShareConfirm(true)}
              className="rounded-xl bg-brand text-white text-xs font-bold shadow-sm hover:bg-brand-dark"
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              {isSharing ? "Sharing…" : "Share Report"}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              title="Delete journey permanently"
              className="rounded-xl border-line text-xs font-semibold text-concern hover:bg-red-50 hover:border-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Share Status Message Banner */}
        {shareFeedback && (
          <div className="flex items-center justify-between rounded-xl bg-surface border border-line p-2.5 text-xs text-ink animate-rise">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-brand shrink-0" />
              <span>{shareFeedback}</span>
            </div>
            <button
              type="button"
              onClick={() => setShareFeedback(null)}
              className="text-muted hover:text-ink p-1"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 4-Stat Metric Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <div className="rounded-xl bg-surface/80 border border-line/60 p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-brand" />
              Total Duration
            </span>
            <p className="text-base sm:text-lg font-extrabold text-ink mt-1">
              {formatDuration(journey.durationSeconds)}
            </p>
            <p className="text-[11px] text-muted">
              {startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {endDate ? ` → ${endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>

          <div className="rounded-xl bg-surface/80 border border-line/60 p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
              <Ruler className="h-3.5 w-3.5 text-brand" />
              Distance
            </span>
            <p className="text-base sm:text-lg font-extrabold text-ink mt-1">
              {formatDistance(journey.totalDistanceMeters)}
            </p>
            <p className="text-[11px] text-muted">Recorded GPS ground path</p>
          </div>

          <div className="rounded-xl bg-surface/80 border border-line/60 p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-brand" />
              Telemetry
            </span>
            <p className="text-base sm:text-lg font-extrabold text-ink mt-1">
              {journey.points.length} points
            </p>
            <p className="text-[11px] text-muted">
              {journey.hasInaccuratePoints ? "Variable accuracy" : "Verified GPS fixes"}
            </p>
          </div>

          <div className="rounded-xl bg-surface/80 border border-line/60 p-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-brand" />
              Storage
            </span>
            <p className="text-base sm:text-lg font-extrabold text-ink mt-1">
              Local Only
            </p>
            <p className="text-[11px] text-muted">100% On-Device privacy</p>
          </div>
        </div>
      </div>

      {/* Map Preview Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink flex items-center gap-2">
            <MapPin className="h-4 w-4 text-brand" />
            Recorded Journey Route Map
          </h2>
          <span className="text-xs text-muted">
            Click marker or timeline event to view
          </span>
        </div>

        <JourneyMapPreview
          journey={journey}
          selectedEventId={selectedEventId}
          onSelectEvent={(ev) => setSelectedEventId(ev.id)}
        />
      </div>

      {/* Chronological Event Timeline */}
      <div className="rounded-2xl border border-line bg-white p-5 sm:p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between border-b border-line/70 pb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-ink flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand" />
            Chronological Journey Timeline
          </h2>
          <span className="text-xs text-muted font-medium">
            {sortedEvents.length} {sortedEvents.length === 1 ? "Event" : "Events"} Logged
          </span>
        </div>

        <div className="relative pl-6 sm:pl-8 space-y-6 pt-2">
          {/* Timeline Vertical Continuous Line */}
          <div className="absolute left-2.5 sm:left-3.5 top-3 bottom-3 w-0.5 bg-line" />

          {sortedEvents.map((ev, idx) => {
            const isSelected = selectedEventId === ev.id;
            const evDate = new Date(ev.timestamp);
            const timeStr = evDate.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            let dotColor = "bg-brand ring-brand-soft";
            if (ev.type === "journey_started") dotColor = "bg-safer ring-safer/20";
            else if (ev.type === "journey_completed") dotColor = "bg-concern ring-red-100";
            else if (ev.type === "stop_detected") dotColor = "bg-elevated ring-amber-100";
            else if (ev.type === "journey_resumed") dotColor = "bg-blue-600 ring-blue-100";
            else if (ev.type === "manual_pause" || ev.type === "manual_resume")
              dotColor = "bg-purple-600 ring-purple-100";

            return (
              <div
                key={ev.id}
                className={cn(
                  "relative rounded-xl border p-3.5 transition-all duration-150",
                  isSelected
                    ? "border-brand bg-brand-soft/40 shadow-sm"
                    : "border-line bg-surface/50 hover:bg-surface hover:border-line/80"
                )}
              >
                {/* Timeline Dot Marker */}
                <div
                  className={cn(
                    "absolute -left-[30px] sm:-left-[38px] top-4 h-4 w-4 rounded-full ring-4 transition-transform",
                    dotColor,
                    isSelected && "scale-125"
                  )}
                />

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-brand-dark tabular-nums">
                      {timeStr}
                    </span>
                    <span className="text-muted/40">•</span>
                    <h3 className="text-sm font-bold text-ink">{ev.name}</h3>
                  </div>

                  {ev.latitude != null && ev.longitude != null && (
                    <button
                      type="button"
                      onClick={() => setSelectedEventId(ev.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-brand-dark hover:underline self-start sm:self-auto"
                    >
                      <span>View on map</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Location and Telemetry Details */}
                <div className="mt-2 space-y-1 text-xs">
                  <p className="text-muted flex items-start gap-1.5">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                    <span className="text-ink font-medium">
                      {ev.locationName || formatCoordinates(ev.latitude, ev.longitude)}
                    </span>
                  </p>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted pl-5">
                    <span>Coordinates: {formatCoordinates(ev.latitude, ev.longitude)}</span>
                    {ev.accuracy != null && (
                      <>
                        <span className="text-muted/40">•</span>
                        <span
                          className={cn(
                            ev.accuracy > 60 ? "text-amber-700 font-semibold" : ""
                          )}
                        >
                          Accuracy: {formatAccuracy(ev.accuracy)}
                        </span>
                      </>
                    )}
                  </div>

                  {ev.details && (
                    <p className="text-[11px] text-muted/80 pl-5 italic">
                      Note: {ev.details}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Disclaimers & Integrity Notice */}
      <div className="rounded-xl border border-line bg-surface/70 p-4 text-xs text-muted space-y-2">
        <div className="flex items-center gap-2 text-ink font-bold">
          <Info className="h-4 w-4 text-brand" />
          <span>Safety Black Box Disclosure & Privacy Statement</span>
        </div>
        <p className="leading-relaxed">
          This report contains actual recorded timestamps and device telemetry collected locally
          during your journey. It is stored exclusively on your device in local storage and was
          never transmitted to any external server or analytics service.
        </p>
        <p className="text-[11px] text-muted/70 italic">
          Disclaimer: This report records personal device telemetry for safety and personal
          accountability. It is not legally certified or tamper-proof evidence.
        </p>
      </div>

      {/* Share Confirmation Modal */}
      {showShareConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-sheet space-y-4 animate-rise">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand-soft p-2.5 text-brand-dark shrink-0">
                <Share2 className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-ink">Share Safety Journey Report</h3>
                <p className="text-xs text-muted leading-relaxed">
                  The generated PDF document contains your <b>sensitive journey timestamps</b> and
                  <b> exact recorded GPS location history</b>.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-surface border border-line p-3 text-xs text-muted space-y-1.5">
              <p className="font-semibold text-ink">What is being shared:</p>
              <ul className="list-disc list-inside space-y-1 pl-1 text-[11px]">
                <li>Complete journey start and completion times</li>
                <li>Chronological timeline of all stops and resumed events</li>
                <li>Recorded GPS coordinates and route map preview</li>
              </ul>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 rounded-xl text-xs font-semibold"
                onClick={() => setShowShareConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1 rounded-xl bg-brand text-white text-xs font-bold hover:bg-brand-dark"
                onClick={handleConfirmShare}
              >
                Confirm & Open Share Sheet
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-sheet space-y-3 animate-rise">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-red-100 p-2.5 text-concern shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-ink">Permanently Delete Journey?</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  This will permanently erase this journey record, including all {journey.points.length} GPS
                  telemetry points and timeline events from this device. This action cannot be reversed.
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isDeleting}
                className="flex-1 rounded-xl text-xs font-semibold"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Keep Journey
              </Button>
              <Button
                type="button"
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-concern text-white text-xs font-semibold hover:bg-concern/90"
                onClick={handleDeleteConfirm}
              >
                {isDeleting ? "Deleting…" : "Delete Permanently"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
