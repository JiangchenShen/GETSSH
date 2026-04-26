/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          400: 'rgb(var(--primary-color) / 0.8)',
          500: 'rgb(var(--primary-color) / <alpha-value>)',
          600: 'rgb(var(--primary-color) / 1)',
        }
      }
    },
  },
  plugins: [],
}
