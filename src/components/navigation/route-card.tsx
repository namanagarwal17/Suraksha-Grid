import { Zap, Scale, ShieldCheck, Clock, Ruler, AlertTriangle, CheckCircle2, ShieldAlert, Database } from "lucide-react";
import type { RouteOption } from "@/types";
import { ScoreBadge } from "@/components/safety/score";
import { cn } from "@/lib/utils";

const ICON = { fastest: Zap, balanced: Scale, safest: ShieldCheck };

export function RouteCard({ route, selected, onSelect }: { route: RouteOption; selected: boolean; onSelect: () => void }) {
  const I = ICON[route.id] ?? ShieldCheck;
  const risks    = route.riskFactors?.slice(0, 2)    ?? [];
  const positives= route.positiveFactors?.slice(0, 2) ?? [];
  const formattedEta =
    route.etaMin >= 60
      ? `${Math.floor(route.etaMin / 60)} hr ${route.etaMin % 60 > 0 ? `${route.etaMin % 60} min` : ""}`
      : `${route.etaMin} min`;

  const hist = route.historicalEvidence;
  const uniqueDistricts = hist?.intersections
    ? Array.from(new Set(hist.intersections.map((ix) => ix.district))).slice(0, 3)
    : [];

  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative w-full rounded-2xl border bg-white p-4 text-left transition",
        selected ? "border-brand shadow-card ring-2 ring-brand/30" : "border-line hover:border-brand/40",
        route.recommended && !selected && "border-brand/40",
      )}
    >
      {route.recommended && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-brand px-2.5 py-0.5 text-[11px] font-bold text-white">
          Recommended
        </span>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-bold">
          <I className="h-4 w-4 text-brand" />{route.name}
        </span>
        <ScoreBadge score={route.score} />
      </div>

      {/* ETA / distance / confidence */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1 text-lg font-bold">
          <Clock className="h-4 w-4 text-muted" />{formattedEta}
        </span>
        <span className="flex items-center gap-1 text-muted">
          <Ruler className="h-4 w-4" />{route.distanceKm} km
        </span>
        <span className="ml-auto text-xs text-muted">{route.confidence}% confidence</span>
      </div>

      {/* Reason / explanation */}
      <p className="mt-2 text-sm text-muted">{route.reason}</p>

      {/* Historical crime evidence info block */}
      {hist && (
        <div className="mt-2.5 rounded-xl border border-line bg-surface/60 p-2 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <Database className="h-3.5 w-3.5 text-brand" />
            <span>NCRB Historical Evidence</span>
            <span
              className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
                hist.level === "HIGH"
                  ? "bg-red-100 text-red-700"
                  : hist.level === "MODERATE"
                  ? "bg-amber-100 text-amber-800"
                  : hist.level === "LOW"
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              {hist.available ? `${hist.level} EXPOSURE` : "UNAVAILABLE"}
            </span>
          </div>

          {hist.available && uniqueDistricts.length > 0 ? (
            <p className="mt-1 text-[11px] text-muted">
              Intersects {uniqueDistricts.join(", ")}
              {hist.adjustment !== undefined && hist.adjustment < 0
                ? ` (${hist.adjustment} pts score adjustment)`
                : ""}
            </p>
          ) : !hist.available ? (
            <p className="mt-1 text-[11px] text-muted/80">
              No historical crime data available for this area. Area is not verified safe.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted/80">
              No significant district crime intersections recorded.
            </p>
          )}
        </div>
      )}

      {/* Risk + positive factor chips */}
      {(risks.length > 0 || positives.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {risks.map((f) => (
            <span key={f} className="flex items-center gap-1 rounded-full bg-elevated/10 px-2.5 py-1 text-[11px] font-medium text-elevated">
              <AlertTriangle className="h-3 w-3" />{f}
            </span>
          ))}
          {positives.map((f) => (
            <span key={f} className="flex items-center gap-1 rounded-full bg-safer/10 px-2.5 py-1 text-[11px] font-medium text-safer">
              <CheckCircle2 className="h-3 w-3" />{f}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}