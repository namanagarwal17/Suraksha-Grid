"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BOTTOM_ALIAS, BOTTOM_NAV, BRAND, NAV } from "@/lib/constants";
import { cn } from "@/lib/utils";
const Logo = () => (
  <div className="flex items-center gap-2.5">
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-white shadow-sm transition-transform active:scale-95">
      <ShieldCheck className="h-5 w-5" />
    </span>
    <div className="leading-tight">
      <p className="font-bold tracking-tight text-ink">SURAKSHA GRID</p>
      <p className="hidden text-[11px] text-muted lg:block">{BRAND.tagline}</p>
    </div>
  </div>
);

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = BOTTOM_ALIAS[path] ?? path;

  return (
    <div className="min-h-dvh">
      {/* Desktop Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-line bg-white p-5 lg:flex">
        <Link href="/" className="inline-block">
          <Logo />
        </Link>
        <nav className="mt-8 space-y-1.5" aria-label="Desktop Navigation">
          {NAV.map(({ href, label, icon: I }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                path === href
                  ? "bg-brand-soft font-semibold text-brand-dark shadow-sm"
                  : "text-muted hover:bg-surface hover:text-ink active:scale-[0.98]"
              )}
            >
              <I className="h-[18px] w-[18px] shrink-0" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-line/60 bg-surface p-3.5 text-xs text-muted">
          <p className="font-medium text-ink mb-1">Safety Intelligence</p>
          Scores reflect lighting, activity, verified community reports, and historical evidence.
        </div>
      </aside>

      {/* Mobile Sticky Header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur-md lg:hidden">
        <Link href="/">
          <Logo />
        </Link>
      </header>

      {/* Main Content Area */}
      <main className="pb-16 lg:pb-0 lg:pl-64">{children}</main>

      {/* Mobile Bottom Navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-around border-t border-line bg-white/95 px-2 backdrop-blur-md pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Mobile Navigation"
      >
        {BOTTOM_NAV.map((href) => {
          const item = NAV.find((n) => n.href === href)!;
          const I = item.icon;
          const isSelected = active === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-medium transition-transform active:scale-90",
                isSelected
                  ? "font-semibold text-brand"
                  : "text-muted hover:text-ink"
              )}
            >
              <div
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                  isSelected && "bg-brand-soft"
                )}
              >
                <I className="h-4.5 w-4.5" />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
