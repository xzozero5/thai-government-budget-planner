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
      // T-411 (docs/ui/motion.md) — keyframe ล้วน (ไม่ผ่าน `motion/react`) สำหรับ effect ที่เล่นตอน mount
      // ครั้งเดียว/วนลูประหว่างทำงานจริงเท่านั้น — เคารพ reduced-motion อัตโนมัติผ่าน global override ใน
      // `tokens.css` (`animation-duration: 0.01ms !important; animation-iteration-count: 1 !important`)
      keyframes: {
        'popover-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // motion.md #15: drawer เปิด slide-in จากขวา — CSS keyframe ล้วน (ไม่ผ่าน `motion/react`) เพราะ
        // `components/ui/Drawer.tsx` ถูกใช้จาก `/load` (route ที่ไม่ได้ lazy-load — เห็นผลจริงตอน build:
        // เคยลองห่อด้วย `DrawerSlide` ของ `components/motion` แล้ว entry chunk โต +16 kB gz เพราะ
        // `motion/react` หลุดเข้าไปด้วย ถอยกลับมาใช้ CSS ล้วนตรงนี้แทน)
        'drawer-in': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        // motion.md #17: dialog เปิด scale(0.98→1) + fade — เหตุผลเดียวกับ `drawer-in` ข้างบน
        'dialog-in': {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'skeleton-shimmer': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        // motion.md #8: แถบ progress ของ tool activity ที่กำลังรัน — pulse x -100%→100% วนลูป
        'tool-progress': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(100%)' },
        },
        // motion.md #9: ไอคอน tool activity เมื่อเสร็จ (⌛→✓) crossfade + scale 0.9→1
        'check-pop': {
          from: { opacity: '0', transform: 'scale(0.9)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'popover-in': 'popover-in 150ms var(--ease-out)',
        'toast-in': 'toast-in 200ms var(--ease-out)',
        'drawer-in': 'drawer-in 250ms var(--ease-out)',
        'dialog-in': 'dialog-in 200ms var(--ease-out)',
        'skeleton-shimmer': 'skeleton-shimmer 1.4s ease-in-out infinite',
        'tool-progress': 'tool-progress 1.2s linear infinite',
        'check-pop': 'check-pop 150ms var(--ease-out)',
      },
    },
  },
  plugins: [],
} satisfies Config;
