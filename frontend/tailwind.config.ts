import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0b0b0f",
        foreground: "#f5f5f7",
        accent: "#ff3b5c",
      },
    },
  },
  plugins: [],
};

export default config;
