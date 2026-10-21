import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { AppShell } from "@/components/layout/app-shell";
export const metadata: Metadata = { title: "Suraksha Grid", description: "Navigate Smarter. Travel Safer." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0E7C86" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><AppShell>{children}</AppShell></body></html>;
}
