import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0f1f1a", muted: "#3d524a", faint: "#6b7f76" },
        paper: { DEFAULT: "#f4f7f5", card: "#ffffff" },
        pine: { DEFAULT: "#1b6b4a", dark: "#0f4a34", light: "#2d9a6a" },
        sand: "#e8efe9",
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"Source Sans 3"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
