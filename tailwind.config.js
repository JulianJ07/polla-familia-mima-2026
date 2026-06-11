/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        night: "#0A0E1A",
        panel: "#141829",
        line: "#1E2438",
        gold: "#FFD700",
        mint: "#00C9A7",
        ink: "#F0F4FF",
        muted: "#8892A4"
      },
      fontFamily: {
        display: ["Bebas Neue", "Impact", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 32px rgba(255, 215, 0, 0.22)"
      }
    }
  },
  plugins: []
};
