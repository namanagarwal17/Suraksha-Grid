import { Home, Map as MapIcon, Route, Navigation, ShieldCheck, MessageSquareText, PenSquare, LifeBuoy, User, Radio } from "lucide-react";
import type { Level } from "@/types";
export const BRAND = { name: "Suraksha Grid", tagline: "Navigate Smarter. Travel Safer." };
export const LEVELS: Record<Level, { label: string; hex: string; bg: string; text: string }> = {
  safer: { label: "Safer", hex: "#16A34A", bg: "bg-safer/10", text: "text-safer" },
  moderate: { label: "Moderate", hex: "#CA9A04", bg: "bg-moderate/10", text: "text-moderate" },
  elevated: { label: "Elevated", hex: "#EA580C", bg: "bg-elevated/10", text: "text-elevated" },
  concern: { label: "Higher concern", hex: "#DC2626", bg: "bg-concern/10", text: "text-concern" },
};
// Wording for the map legend specifically: the Safety Score is an index, not a
// probability, so the legend never reads like "87% safe".
export const MAP_LEGEND_LABELS: Record<Level, string> = {
  safer: "Higher Safety Score",
  moderate: "Lower Safety Score",
  elevated: "Caution",
  concern: "Higher Caution",
};
export const NAV = [
  { href: "/", label: "Home", icon: Home }, { href: "/map", label: "Map", icon: MapIcon },
  { href: "/routes", label: "Routes", icon: Route }, { href: "/navigation", label: "Navigation", icon: Navigation },
  { href: "/safety", label: "Safety Lens", icon: ShieldCheck }, { href: "/safety/black-box", label: "Black Box", icon: Radio },
  { href: "/stories", label: "Street Stories", icon: MessageSquareText },
  { href: "/report", label: "Add Report", icon: PenSquare }, { href: "/help", label: "Nearby Help", icon: LifeBuoy },
  { href: "/profile", label: "Profile", icon: User },
];
export const BOTTOM_NAV = ["/", "/map", "/stories", "/profile"];
export const BOTTOM_ALIAS: Record<string, string> = { "/routes": "/map", "/navigation": "/map", "/safety": "/map", "/safety/black-box": "/map", "/help": "/map", "/report": "/stories" };
export const REPORT_TAGS = ["Poor lighting", "Isolated", "Crowded", "Construction", "Safety concern", "Police presence", "Other"];
