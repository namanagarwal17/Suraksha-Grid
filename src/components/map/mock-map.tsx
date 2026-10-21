import type { ReactNode } from "react";
import type { MapMarker, Segment } from "@/types";
import { LEVELS } from "@/lib/constants";
import { cn, levelOf } from "@/lib/utils";
interface Props { segments: Segment[]; activeIds?: string[]; selectedId?: string; onSelect?: (id: string) => void; markers?: MapMarker[]; className?: string }
const MK = { you: "#0E7C86", dest: "#0B1F33", report: "#EA580C", help: "#2563EB" };
/** Stand-in for MapLibre GL. Same data contract (segments + markers) so a real map can replace it later. */
export function MockMap({ segments, activeIds, selectedId, onSelect, markers = [], className }: Props) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={cn("h-full w-full bg-[#EAF0F1]", className)} role="img" aria-label="Map">
      <path d="M0 62 Q30 55 55 65 T100 55 V70 Q70 80 45 72 T0 76Z" fill="#CFE3EC" />
      {[[14, 30, 18, 10], [46, 24, 16, 14], [60, 54, 12, 14], [88, 58, 10, 16], [14, 48, 20, 14], [50, 88, 30, 8]].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="#DDE5E7" />)}
      <rect x="62" y="24" width="14" height="12" rx="2" fill="#CDE7D3" />
      {segments.map((s) => { const dim = !!activeIds && !activeIds.includes(s.id); const sel = selectedId === s.id;
        return <g key={s.id} onClick={() => onSelect?.(s.id)} className={onSelect ? "cursor-pointer" : ""} opacity={dim ? 0.3 : 1}>
          <path d={s.path} stroke="white" strokeWidth={sel ? 3.6 : 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={s.path} stroke={LEVELS[levelOf(s.score)].hex} strokeWidth={sel ? 2.4 : activeIds && !dim ? 2 : 1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={s.path} stroke="transparent" strokeWidth="6" fill="none" /></g>; })}
      {markers.map((m) => <g key={m.id}>{m.kind === "you" && <circle cx={m.x} cy={m.y} r="4" fill={MK.you} opacity=".2" />}<circle cx={m.x} cy={m.y} r={m.kind === "you" ? 2.4 : 1.8} fill={MK[m.kind]} stroke="white" strokeWidth="0.7"><title>{m.label}</title></circle></g>)}
    </svg>);
}
export function MapOverlay({ children }: { children: ReactNode }) { return <div className="pointer-events-none absolute inset-x-3 top-3 z-[5] space-y-2 [&>*]:pointer-events-auto">{children}</div>; }
