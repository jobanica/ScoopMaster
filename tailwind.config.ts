import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: { 50: "#FFFDF8", 100: "#FFF8EC", 200: "#FBEFD9", 300: "#F3E1C0" },
        choco: { 50: "#F6EFEA", 100: "#E9DCD1", 300: "#B8977F", 500: "#7A4E36", 600: "#654030", 700: "#523325", 800: "#3E261B", 900: "#2B1A12" },
        berry: { 50: "#FDF0F3", 100: "#FADCE4", 400: "#E8849E", 500: "#D9607F", 700: "#A23A57" },
        mint: { 50: "#EEF9F4", 100: "#D5F0E3", 400: "#6CC5A0", 500: "#3FA67D", 700: "#257556" },
        vanilla: { 50: "#FFFBEB", 100: "#FEF3C7", 400: "#F5C451", 500: "#E0A82E", 700: "#9A6B10" },
        sky: { 50: "#EFF6FD", 100: "#D9EAFB", 400: "#73A9E0", 500: "#4A86C5", 700: "#2D5E92" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(62,38,27,0.06), 0 4px 16px rgba(62,38,27,0.05)" },
    },
  },
  plugins: [],
} satisfies Config;
