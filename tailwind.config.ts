import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // NOVA palette: dark navy/red/blue premium personal-assistant theme.
        nova: {
          bg: "#080D17", // primary background
          surface: "#0D1626", // secondary background
          surface2: "#132038", // slightly lifted surface, derived from secondary bg
          border: "#243149", // borders
          primary: "#E3262E", // red accent — sparingly, urgent/CTA/selected
          primary2: "#B81E25", // deeper red for gradients
          accent: "#1E5AA8", // blue accent — nav/secondary actions/info
          accent2: "#2E71C9", // lighter blue for gradients
          urgent: "#E3262E",
          warn: "#1E5AA8",
          good: "#3E8E63", // muted/desaturated green for quiet "completed" state
          muted: "#9BA8BC", // secondary text
          text: "#F5F7FA", // primary text
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
