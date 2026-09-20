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
      // T-307 (บังคับทั้ง repo): ห้าม inject HTML ดิบ — ทุกอย่างจากโมเดล/ข้อมูลดิบ render เป็น text node,
      // SVG ผ่าน `sanitizeSvg(...).node()` เท่านั้น
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'ห้ามใช้ dangerouslySetInnerHTML (T-307) — render เป็น text node หรือใช้ sanitizeSvg().node()',
        },
        {
          selector:
            "AssignmentExpression[left.type='MemberExpression'][left.property.name=/^(innerHTML|outerHTML)$/]",
          message: 'ห้าม assign innerHTML/outerHTML (T-307)',
        },
        // T-602 NEW-M2: ช่องทาง inject HTML/โค้ดอื่นที่กฎเดิมไม่จับ (วันนี้ไม่มีการใช้ — กันการถดถอย)
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'ห้ามใช้ insertAdjacentHTML (T-602) — สร้าง DOM node/text node แทน',
        },
        {
          selector: "MemberExpression[object.name='document'][property.name=/^write(ln)?$/]",
          message: 'ห้ามใช้ document.write/writeln (T-602)',
        },
        {
          selector: "CallExpression[callee.property.name='createContextualFragment']",
          message: 'ห้ามใช้ createContextualFragment (T-602) — parse HTML จากสตริงได้',
        },
        {
          selector: 'JSXAttribute[name.name=/^srcdoc$/i]',
          message: 'ห้ามใช้ srcdoc (T-602)',
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: 'ห้ามส่ง dangerouslySetInnerHTML ผ่าน object/props spread (T-602)',
        },
        {
          selector: "NewExpression[callee.name='Function']",
          message: "ห้ามใช้ new Function (T-602) — CSP ของเราไม่มี 'unsafe-eval' โดยตั้งใจ",
        },
      ],
      'no-eval': 'error',
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
            {
              // T-307 L6 / T-602 NEW-L10: fake client + tool capture ห้ามเข้าโค้ด production
              group: ['@/ai/testing/*', '**/ai/testing/*'],
              message: 'ห้าม import @/ai/testing/* จากโค้ด production (ใช้ได้เฉพาะ test และ app/dataHarness)',
            },
          ],
        },
      ],
    },
  },
  // T-602 NEW-M2: parse HTML/SVG จากสตริงได้ที่เดียวคือ sanitizer (มี allowlist + test ชุดโจมตี)
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/svgSanitizer.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'DOMParser',
          message: 'ใช้ DOMParser ได้เฉพาะใน src/lib/svgSanitizer.ts (T-602) — ที่อื่นให้เรียก sanitizeSvg()',
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
