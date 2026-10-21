"use client";
import { TriangleAlert, X, RefreshCw } from "lucide-react";
import type { AnomalyResult } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  anomaly: AnomalyResult;
  segmentName?: string;
  onRecalculate?: () => void;
  onDismiss?: () => void;
}

const SEV_STYLE: Record<string, string> = {
  high:   "border-concern/40 bg-concern/5 text-concern",
  medium: "border-elevated/40 bg-elevated/5 text-elevated",
  low:    "border-moderate/40 bg-moderate/5 text-moderate",
};

export function AnomalyBanner({ anomaly, segmentName, onRecalculate, onDismiss }: Props) {
  if (!anomaly.is_anomaly) return null;
  const sev = anomaly.severity as "high" | "medium" | "low";

  return (
    <div className={cn(
      "animate-rise flex items-start gap-3 rounded-2xl border p-3.5 text-sm",
      SEV_STYLE[sev] ?? SEV_STYLE.medium,
    )}>
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">
          Safety conditions changed{segmentName ? ` — ${segmentName}` : ""}
        </p>
        <p className="mt-0.5 text-xs opacity-80">{anomaly.reason}</p>
        {onRecalculate && (
          <button
            onClick={onRecalculate}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/80"
          >
            <RefreshCw className="h-3.5 w-3.5" />Recalculate Route
          </button>
        )}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="mt-0.5 shrink-0 opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}