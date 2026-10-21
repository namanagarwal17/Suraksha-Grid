import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Level } from "@/types";
export const cn = (...i: ClassValue[]) => twMerge(clsx(i));
export const levelOf = (s: number): Level => (s >= 80 ? "safer" : s >= 65 ? "moderate" : s >= 50 ? "elevated" : "concern");
export const timeAgo = (m: number) => (m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`);
