import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // PitStrike design system — dark theme with gold accents
        pit: {
          bg: '#0a0a0b',
          surface: '#111113',
          border: '#1e1e22',
          gold: '#f5c842',
          'gold-dim': '#c49a2a',
          buy: '#22c55e',
          'buy-dim': '#15803d',
          sell: '#ef4444',
          'sell-dim': '#b91c1c',
          muted: '#6b7280',
          text: '#e5e7eb',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'slide-in': 'slideIn 150ms ease-out',
        'flash-gold': 'flashGold 300ms ease-out',
        'fade-out': 'fadeOut 2000ms ease-in forwards',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        flashGold: {
          '0%': { backgroundColor: '#f5c842' },
          '100%': { backgroundColor: 'transparent' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0.2' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
