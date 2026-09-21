import type { Config } from "tailwindcss";

const config: Config = {
  // Class-based dark mode: the app ships a light theme only, so `dark:`
  // utilities must NOT auto-activate from the visitor's OS preference. They
  // stay inert until a `dark` class is placed on <html> (e.g. a future theme
  // toggle) — which keeps the copilot drawer's dark: hover styles opt-in.
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jbmono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        brand: {
          emerald: "#059669",
          emeraldDark: "#047857",
          emeraldLight: "#d1fae5",
        },
      },
      boxShadow: {
        panel: "0 1px 2px 0 rgba(15, 23, 42, 0.04), 0 1px 3px 0 rgba(15, 23, 42, 0.06)",
      },
      keyframes: {
        "slide-in": {
          "0%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "slide-in": "slide-in 0.25s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
