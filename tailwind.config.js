/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  safelist: [
    {
      pattern: /^(bg|text|border|ring)-(violet|sky|amber|emerald|rose|cyan|indigo|pink|orange|teal|red|slate)-(400|500|600)$/,
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        // @fontsource-variable pakkerne (v5) erklærer familierne 'Inter Variable' / 'Outfit Variable'
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Outfit Variable"', '"Inter Variable"', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08)',
        panel: '0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)',
        glow: '0 0 0 1px color-mix(in srgb, var(--acc-500) 35%, transparent), 0 4px 24px color-mix(in srgb, var(--acc-500) 25%, transparent)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(32px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200px 0' },
          '100%': { backgroundPosition: '200px 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.18s ease-out',
        'slide-up': 'slide-up 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
