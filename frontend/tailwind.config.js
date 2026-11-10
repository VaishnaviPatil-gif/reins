/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        paypal: {
          navy: '#003087',
          dark: '#001c64',
          blue: '#0070ba',
          'blue-hover': '#005ea6',
          cyan: '#009cde',
          gold: '#ffc439',
          'gold-hover': '#f2b82b',
          surface: '#f5f7fa',
          border: '#e5e9f0',
          ink: '#0c1c3e',
          muted: '#5c6a82',
        },
        brand: {
          50:  '#f0f7fc',
          100: '#dceefa',
          500: '#009cde',
          600: '#0070ba',
          700: '#003087',
          900: '#001c64',
        },
      },
      boxShadow: {
        'pp-card': '0 2px 12px -2px rgba(0, 48, 135, 0.06), 0 1px 3px rgba(0, 28, 100, 0.04)',
        'pp-hover': '0 8px 24px -4px rgba(0, 48, 135, 0.12), 0 2px 6px rgba(0, 28, 100, 0.06)',
      },
    },
  },
  plugins: [],
}
