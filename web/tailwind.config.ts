import type { Config } from 'tailwindcss';

// ชื่อสีผูกกับ CSS variables ใน `src/styles/tokens.css` (docs/06-UI-SPEC.md §2) — ใช้ class เช่น
// `bg-surface text-fg border-line bg-accent text-accent-contrast text-basis-historical`
// ห้ามใช้ hex ตรง ๆ ใน component (dark mode จะพัง)
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        line: 'var(--border)',
        fg: { DEFAULT: 'var(--text)', muted: 'var(--text-muted)' },
        primary: { DEFAULT: 'var(--primary)', contrast: 'var(--primary-contrast)' },
        accent: { DEFAULT: 'var(--accent)', contrast: 'var(--accent-contrast)' },
        danger: 'var(--danger)',
        success: 'var(--success)',
        warn: 'var(--warn)',
        info: 'var(--info)',
        focus: 'var(--focus-ring)',
        brand: { navy: 'var(--brand-navy)', red: 'var(--brand-red)', white: 'var(--brand-white)' },
        basis: {
          historical: 'var(--basis-historical)',
          'historical-bg': 'var(--basis-historical-bg)',
          market: 'var(--basis-market)',
          'market-bg': 'var(--basis-market-bg)',
          estimate: 'var(--basis-estimate)',
          'estimate-bg': 'var(--basis-estimate-bg)',
        },
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)' },
      boxShadow: { 1: 'var(--shadow-1)', 2: 'var(--shadow-2)' },
      fontFamily: { sans: ['Sarabun', 'system-ui', 'sans-serif'] },
      transitionTimingFunction: { out: 'var(--ease-out)' },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '250ms' },
    },
  },
  plugins: [],
} satisfies Config;
