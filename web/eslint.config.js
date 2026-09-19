import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'spikes', // npm project แยกของ T-201 (มี lint/ts ของตัวเอง)
      'dist',
      'node_modules',
      'coverage',
      'playwright-report',
      'test-results',
      'public/data',
      'public/fonts',
    ],
  },
  // TypeScript แหล่งโค้ดจริง (app + vite config + plugins) — type-aware, strict
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // no `any` (CLAUDE.md §7) — ยกเว้น boundary ที่ comment ไว้ ใช้ eslint-disable-line เฉพาะจุด
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  // T-206 item 9: `ai/tools/*`/`features/*` ต้อง import ผ่าน facade `@/data` เท่านั้น — ห้าม import
  // ลึกเข้า `@/data/<file>` ตรง ๆ จากนอก `src/data/**` ยกเว้น harness (`src/app/dataHarness/**` ต้อง
  // เรียกฟังก์ชันภายในตรง ๆ เพื่อทดสอบ integration จริงกับ Playwright) และไฟล์ทดสอบ (`*.test.ts(x)`)
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/data/**', 'src/app/dataHarness/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/data/*'],
              message:
                'ห้าม import ลึกเข้า @/data/<file> ตรง ๆ — ให้ import จาก "@/data" (facade เดียว, T-206) เท่านั้น',
            },
          ],
        },
      ],
    },
  },
  // plain JS config files (postcss/eslint config เอง) — ไม่ type-aware
  {
    files: ['*.config.js', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  prettierConfig,
);
