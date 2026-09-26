/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 浅色主题下的中性色阶：950 最浅（页面底色），600 最深（边框）
        ink: {
          950: "#fbfcfe",
          900: "#ffffff",
          850: "#f6f8fc",
          800: "#eef2f7",
          700: "#e2e8f0",
          600: "#d2dae7",
          500: "#b3bfd0",
        },
        accent: {
          DEFAULT: "#0891b2",
          soft: "#0e7490",
          deep: "#155e75",
        },
        // 语义反转：浅色主题下 text-slate-200 = 深正文，text-slate-500 = 次要文字
        slate: {
          50: "#0f172a",
          100: "#1e293b",
          200: "#334155",
          300: "#475569",
          400: "#55637a",
          500: "#64748b",
          600: "#8a97ab",
          700: "#cbd5e1",
          800: "#e2e8f0",
          900: "#f1f5f9",
          950: "#f8fafc",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "-apple-system", '"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
        mono: ['ui-monospace', '"SF Mono"', '"JetBrains Mono"', "Menlo", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(8,145,178,.28), 0 12px 40px -14px rgba(8,145,178,.35)",
        panel: "0 1px 2px rgba(15,23,42,.04), 0 10px 30px -22px rgba(15,23,42,.30)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "fade-up": "fade-up .28s ease-out both",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
