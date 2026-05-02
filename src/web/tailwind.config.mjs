/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"IBM Plex Sans Thai"',
          '"Noto Sans Thai"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        display: [
          '"IBM Plex Sans Thai"',
          '"Noto Sans Thai"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Indigo blue — fintech-grade trust (Stripe-adjacent), differentiates from
        // existing Thai aggregators that use teal-blue.
        brand: {
          50: "#eef4ff",
          100: "#dbe6ff",
          200: "#b8cfff",
          300: "#88aeff",
          400: "#5685ff",
          500: "#0b5fff",
          600: "#0a52d9",
          700: "#0840a8",
          800: "#0a3486",
          900: "#0c2d6b",
          950: "#091d4a",
        },
        // Rose for deal/discount badges — warm, urgent, SE-Asia commerce convention
        deal: {
          50: "#fff1f3",
          100: "#ffe4e7",
          400: "#fb7185",
          500: "#f43f5e",
          600: "#e11d48",
          700: "#be123c",
        },
        // Success — verified store, all-time-low badge
        success: {
          50: "#f0fdf4",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
        },
        // Warning — low stock / expiring
        warn: {
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
        },
        // Surface — slightly cooler neutrals (slate family) for "fintech serious" tone
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      maxWidth: {
        "8xl": "88rem",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        // Subtle restraint — modern 2026 standard
        soft: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -4px rgba(15,23,42,0.04)",
        card: "0 1px 3px rgba(15,23,42,0.05), 0 8px 24px -8px rgba(15,23,42,0.08)",
        lift: "0 4px 8px -2px rgba(15,23,42,0.08), 0 16px 32px -8px rgba(15,23,42,0.12)",
        ring: "0 0 0 4px rgba(11,95,255,0.12)",
      },
      fontSize: {
        // Tighter line-heights for headlines per 2026 spec
        "display-lg": ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-md": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "700" }],
        "display-sm": ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "700" }],
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.4s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
