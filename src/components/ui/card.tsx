import { cn } from "@/lib/utils";
import type { HTMLAttributes, ButtonHTMLAttributes } from "react";
export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-2xl border border-line bg-white p-4 shadow-card", className)} {...p} />;
export const Chip = ({ active, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) => (
  <button type="button" className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-brand bg-brand text-white" : "border-line bg-white text-muted hover:bg-surface", className)} {...p} />);
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("animate-pulse rounded-xl bg-line/70", className)} />;
export const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
  <div className="rounded-2xl border border-dashed border-line bg-white p-8 text-center"><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted">{hint}</p></div>);
