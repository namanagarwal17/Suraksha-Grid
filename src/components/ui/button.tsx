import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";
export const buttonVariants = cva("inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:opacity-50", {
  variants: { variant: { primary: "bg-brand text-white hover:bg-brand-dark", outline: "border border-line bg-white hover:bg-surface", ghost: "hover:bg-surface" }, size: { md: "h-11 px-4 text-sm", lg: "h-14 px-6 text-base", sm: "h-9 px-3 text-sm" } },
  defaultVariants: { variant: "primary", size: "md" } });
export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...p} />;
}
