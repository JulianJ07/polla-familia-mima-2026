/** @type {import('tailwindcss').Config} */
export default {
  content: ["./client/index.html", "./client/src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        stadiumNight: "#070B18",
        triondaBlue: "#1B5CFF",
        triondaRed: "#F43F5E",
        triondaGreen: "#00B86B",
        trophyGold: "#FFD54A",
        ballWhite: "#F8FAFC",
        night: "#070B18",
        panel: "#101827",
        line: "rgba(255,255,255,0.12)",
        gold: "#FFD54A",
        mint: "#00B86B",
        ink: "#F8FAFC",
        muted: "#99A4B8"
      },
      backgroundImage: {
        "trionda-waves":
          "radial-gradient(circle at 16% 18%, rgba(27,92,255,0.34), transparent 28%), radial-gradient(circle at 82% 12%, rgba(244,63,94,0.23), transparent 28%), radial-gradient(circle at 62% 82%, rgba(0,184,107,0.23), transparent 30%)"
      },
      fontFamily: {
        display: ["Bebas Neue", "Impact", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 32px rgba(255, 213, 74, 0.24)",
        trionda: "0 22px 70px rgba(7, 11, 24, 0.45), 0 0 28px rgba(27, 92, 255, 0.18)"
      }
    }
  },
  plugins: []
};
