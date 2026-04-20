/** @type {import('tailwindcss').Config} */
export default {
  corePlugins: {
    preflight: false,
  },
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--color-accent)',
        'accent-dark': 'var(--accent-dark)',
        'accent-light': 'var(--accent-light)',
        canvas: 'var(--color-bg-canvas)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        danger: 'var(--color-state-danger)',
        success: 'var(--color-state-success)',
        warning: 'var(--warning)',
        border: 'var(--border)',
        'border-light': 'var(--border-light)',
      }
    },
  },
  plugins: [],
}
