import type { ReactNode } from "react";

/**
 * Full-bleed map layout used by Map, Routes, Navigation, Safety, Help pages.
 *
 * Mobile  : map fills the viewport below the header; panel slides up as a
 *           bottom sheet above the bottom nav (pb-16 keeps content clear).
 * Tablet  : map fills right 60%; panel is a 40% left column.
 * Desktop : fixed 400px left panel + map fills the remaining width, both
 *           flush with the sidebar edge (pl-64 on the shell handles the offset).
 */
export function MapLayout({ map, panel }: { map: ReactNode; panel: ReactNode }) {
  return (
    <div className="relative flex h-[calc(100dvh-3.5rem)] lg:h-dvh">
      {/* map layer — always behind the panel on mobile */}
      <div className="absolute inset-0 lg:relative lg:flex-1">{map}</div>

      {/* panel */}
      <aside
        className={[
          // mobile: bottom sheet anchored flush above the bottom nav bar
          "absolute inset-x-0 bottom-0 z-10",
          "max-h-[60%] sm:max-h-[55%] md:max-h-[50%] overflow-y-auto overscroll-contain",
          "rounded-t-3xl border-t border-line/80 bg-white p-4 pb-6 shadow-sheet",
          // ≥ lg: clean left sidebar beside the map
          "lg:relative lg:bottom-auto lg:order-first",
          "lg:max-h-none lg:h-full lg:w-[420px] lg:shrink-0 lg:overflow-y-auto",
          "lg:rounded-none lg:border-t-0 lg:border-r lg:border-line lg:p-6 lg:shadow-none",
        ].join(" ")}
      >
        {/* drag handle — mobile only */}
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line lg:hidden" />
        {panel}
      </aside>
    </div>
  );
}
