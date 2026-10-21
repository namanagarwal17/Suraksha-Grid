import { LEVELS, MAP_LEGEND_LABELS } from "@/lib/constants";
import { cn, levelOf } from "@/lib/utils";
import type { Level } from "@/types";
export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const l = LEVELS[levelOf(score)];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold", l.bg, l.text, className)}><span className="h-2 w-2 rounded-full" style={{ background: l.hex }} />{score}<span className="text-xs font-medium">{l.label}</span></span>;
}
export function Meter({ label, value }: { label: string; value: number }) {
  return <div><div className="flex justify-between text-xs text-muted"><span>{label}</span><span>{value}</span></div><div className="mt-1 h-1.5 rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${value}%`, background: LEVELS[levelOf(value)].hex }} /></div></div>;
}
export function Legend() {
  const order: Level[] = ["safer", "moderate", "elevated", "concern"];
  return <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-xl bg-white/95 px-3 py-2 text-xs shadow-card">{order.map((k) => <span key={k} className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: LEVELS[k].hex }} />{MAP_LEGEND_LABELS[k]}</span>)}</div>;
}
