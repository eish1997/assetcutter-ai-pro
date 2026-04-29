/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './App.tsx',
    './components/**/*.{ts,tsx,js,jsx}',
    './hooks/**/*.{ts,tsx,js,jsx}',
    './services/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
