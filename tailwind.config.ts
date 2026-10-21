import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: { ink: "#0B1F33", brand: { DEFAULT: "#0E7C86", dark: "#0A5C64", soft: "#E6F4F5" }, surface: "#F5F7FA", line: "#E3E8EF", muted: "#5B6B7F",
      safer: "#16A34A", moderate: "#CA9A04", elevated: "#EA580C", concern: "#DC2626" },
    boxShadow: { card: "0 1px 2px rgba(11,31,51,.05), 0 4px 16px rgba(11,31,51,.06)", sheet: "0 -8px 30px rgba(11,31,51,.14)" },
    keyframes: { rise: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } } },
    animation: { rise: "rise .35s ease-out both" } } },
  plugins: [],
};
export default config;
