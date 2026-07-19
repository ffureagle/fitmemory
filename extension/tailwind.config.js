/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./popup.html", "./popup.js", "./content.js"],
  theme: {
    extend: {
      colors: {
        ink: "#f4f7f6",
        panel: "#ffffff",
        line: "#d5ddda",
        acid: "#0f766e",
        cobalt: "#2457d6",
        mango: "#102a43",
        cream: "#102a43",
        berry: "#b42336",
        fog: "#52626f",
        apricot: "#fff0e6",
        coral: "#e85d3f",
        mint: "#e2f4ef"
      },
      fontFamily: {
        sans: ["Segoe UI Variable Text", "Segoe UI", "Helvetica Neue", "Arial", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Segoe UI Variable Display", "Segoe UI", "Helvetica Neue", "Arial", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glow: "0 14px 38px rgba(16, 42, 67, 0.09)"
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px) scale(0.99)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" }
        }
      },
      animation: {
        rise: "rise 220ms ease-out",
        "pulse-soft": "pulseSoft 1.5s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
