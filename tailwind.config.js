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
        primary: 'rgb(var(--primary-color) / <alpha-value>)',
      },
      borderRadius: {
        'none': '9999px',
        'sm': '9999px',
        DEFAULT: '9999px',
        'md': '9999px',
        'lg': '9999px',
        'xl': '9999px',
        '2xl': '9999px',
        '3xl': '9999px',
        'full': '9999px',
      }
    },
  },
  plugins: [],
}
