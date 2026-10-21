import { AlertTriangle, MapPinOff } from "lucide-react";
export function MapLoadingOverlay() {
  return (
    <div className="absolute inset-0 z-[6] grid place-items-center bg-surface">
      <div className="flex flex-col items-center gap-2 text-sm text-muted"><div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand" />Loading map…</div>
    </div>);
}
export function MapErrorOverlay({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="absolute inset-0 z-[6] grid place-items-center bg-surface p-6">
      <div className="max-w-[220px] text-center text-sm text-muted"><AlertTriangle className="mx-auto mb-2 h-7 w-7 text-elevated" /><p className="font-semibold text-ink">Map couldn’t load</p><p className="mt-1">Check your connection and try again.</p>
        {onRetry && <button onClick={onRetry} className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white">Retry</button>}</div>
    </div>);
}
export function MapEmptyOverlay({ label = "Nothing to show on the map yet" }: { label?: string }) {
  return <div className="absolute inset-x-3 bottom-3 z-[6] flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs text-muted shadow-card"><MapPinOff className="h-4 w-4" />{label}</div>;
}
