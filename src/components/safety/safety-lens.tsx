"use client";
import { Gauge, Users, Siren, Info, Clock3, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import type { Segment } from "@/types";
import { ScoreBadge, Meter } from "./score";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function SafetyLens({ segment }: { segment?: Segment }) {
  if (!segment) return (
    <Card className="text-center text-sm text-muted">
      Select a verified road on the map to see its Safety Lens.
    </Card>
  );

  const facts = [
    {
      Icon: Gauge,
      l: "Confidence",
      v: segment.confidence > 0 ? `${segment.confidence}%` : "Unrated",
    },
    {
      Icon: Users,
      l: "Pedestrian activity",
      v: segment.activity > 70 ? "Busy" : segment.activity > 30 ? "Moderate" : segment.activity > 0 ? "Quiet" : "Unmeasured",
    },
    {
      Icon: Siren,
      l: "Emergency access",
      v: segment.emergency || "Unmeasured",
    },
    {
      Icon: FileText,
      l: "Recent reports",
      v: `${segment.recentReportCount ?? segment.observations.length}`,
    },
  ];

  const risks     = segment.riskFactors     ?? [];
  const positives = segment.positiveFactors ?? [];

  return (
    <div className="animate-rise space-y-4">
      {/* Title + score */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Safety Lens</p>
          <h2 className="text-xl font-bold">{segment.name}</h2>
        </div>
        <ScoreBadge score={segment.score} />
      </div>

      {/* Explanation */}
      <p className="flex gap-2 rounded-xl bg-brand-soft p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        {segment.explanation}
      </p>

      {/* Meters / Indicators */}
      <div className="grid grid-cols-2 gap-4">
        {segment.lighting > 0 ? (
          <Meter label="Lighting" value={segment.lighting} />
        ) : (
          <div className="rounded-xl border border-line bg-surface p-2 text-xs text-muted">
            <span className="font-semibold text-ink">Lighting:</span> Unmeasured baseline
          </div>
        )}
        {segment.activity > 0 ? (
          <Meter label="Pedestrian activity" value={segment.activity} />
        ) : (
          <div className="rounded-xl border border-line bg-surface p-2 text-xs text-muted">
            <span className="font-semibold text-ink">Activity:</span> Unmeasured baseline
          </div>
        )}
      </div>

      {/* Fact grid */}
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        {facts.map(({ Icon, l, v }) => (
          <div key={l} className="rounded-xl bg-surface p-2.5">
            <Icon className="mx-auto h-4 w-4 text-brand" />
            <p className="mt-1 font-semibold">{v}</p>
            <p className="text-muted leading-tight">{l}</p>
          </div>
        ))}
      </div>

      {/* Evidence Sources Breakdown */}
      <div className="rounded-xl border border-line bg-surface p-3 text-xs text-muted space-y-1">
        <p className="font-semibold text-ink text-xs mb-1">Evidence Sources</p>
        <p>• Infrastructure indicators: {segment.lighting > 0 ? `Lighting score ${segment.lighting}/100` : "Baseline estimate"}</p>
        <p>• Pedestrian activity: {segment.activity > 0 ? `Activity score ${segment.activity}/100` : "Baseline estimate"}</p>
        <p>• Community verification: {segment.recentReportCount ? `${segment.recentReportCount} verified reports` : "No community reports on record"}</p>
        <p>• Emergency accessibility: {segment.emergency || "Fair proximity"}</p>
      </div>

      {/* Risk factors */}
      {risks.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Risk factors</p>
          <div className="flex flex-wrap gap-1.5">
            {risks.map((r) => (
              <span key={r} className="flex items-center gap-1 rounded-full bg-elevated/10 px-2.5 py-1 text-xs font-medium text-elevated">
                <AlertTriangle className="h-3 w-3" />{r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Positive factors */}
      {positives.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Positive factors</p>
          <div className="flex flex-wrap gap-1.5">
            {positives.map((p) => (
              <span key={p} className="flex items-center gap-1 rounded-full bg-safer/10 px-2.5 py-1 text-xs font-medium text-safer">
                <CheckCircle2 className="h-3 w-3" />{p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Time of day condition */}
      {segment.timeCondition && (
        <p className="flex items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-muted">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span><span className="font-semibold text-ink">Right now: </span>{segment.timeCondition}</span>
        </p>
      )}

      {/* Historical crime evidence — shown only when data is available */}
      {segment.historicalEvidence && (
        <div>
          <p className="mb-2 text-sm font-semibold">Historical Crime Evidence</p>
          <div className={cn(
            "rounded-xl border p-3 text-sm",
            segment.historicalEvidence.level === "UNAVAILABLE" || segment.historicalEvidence.level === "NONE"
              ? "border-line bg-surface text-muted"
              : segment.historicalEvidence.level === "HIGH"
              ? "border-concern/30 bg-concern/5"
              : segment.historicalEvidence.level === "MODERATE"
              ? "border-elevated/30 bg-elevated/5"
              : "border-line bg-surface",
          )}>
            <p className="font-semibold">
              {segment.historicalEvidence.level === "UNAVAILABLE"
                ? "Unavailable"
                : segment.historicalEvidence.level}
            </p>
            <p className="mt-1 text-xs text-muted">{segment.historicalEvidence.explanation}</p>
            {segment.historicalEvidence.source && (
              <p className="mt-1.5 text-[11px] text-muted/70">
                Source: {segment.historicalEvidence.source}
                {segment.historicalEvidence.yearRange && ` · Period: ${segment.historicalEvidence.yearRange}`}
              </p>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted/70">
            Area-level historical evidence does not indicate that a specific crime occurred on this road.
          </p>
        </div>
      )}

      {/* Score disclaimer */}
      <div className="space-y-1 text-[11px] text-muted/70">
        <p>
          Safety Score is an index (0–100), not a crime probability. Confidence reflects data availability, distinct from safety score.
        </p>
        <p>
          Absence of reported community incidents does not constitute evidence or guarantee of safety.
        </p>
      </div>

      {/* Recent reports */}
      {segment.observations.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Recent reports</p>
          <ul className="space-y-1.5 text-sm text-muted">
            {segment.observations.map((o) => (
              <li key={o} className="rounded-lg border border-line px-3 py-2">{o}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}