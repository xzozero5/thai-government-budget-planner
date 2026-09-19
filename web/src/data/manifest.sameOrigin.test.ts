/**
 * T-307 M3 (และ T-206 F11): `dataUrl` ต้องให้ URL ภายใน origin เดียวกันเสมอ (N5) แม้ `BASE_URL`
 * ถูกตั้งผิด และต้องปฏิเสธ path ที่มี backslash/อักขระควบคุม
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataUrl } from '@/data/manifest';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dataUrl — same-origin guard', () => {
  it.each(['https://cdn.example.com/app/', '//cdn.example.com/app/', 'app/', ''])(
    'BASE_URL ที่ไม่ใช่ path ภายใน origin (%j) → throw',
    (base) => {
      vi.stubEnv('BASE_URL', base);
      expect(() => dataUrl('manifest.json')).toThrow(/BASE_URL/);
    },
  );

  it('BASE_URL ปกติของ GitHub Pages และ "/" ผ่าน', () => {
    vi.stubEnv('BASE_URL', '/thai-government-budget-planner/');
    expect(dataUrl('manifest.json')).toBe('/thai-government-budget-planner/data/manifest.json');
    vi.stubEnv('BASE_URL', '/');
    expect(dataUrl('manifest.json')).toBe('/data/manifest.json');
  });

  it('path ที่มี backslash หรืออักขระควบคุม → throw', () => {
    vi.stubEnv('BASE_URL', '/');
    const backslash = String.fromCharCode(92);
    expect(() => dataUrl(`catalog${backslash}..${backslash}secret.json`)).toThrow();
    expect(() => dataUrl(`catalog/items${String.fromCharCode(10)}.json`)).toThrow();
    expect(() => dataUrl(`catalog/items${String.fromCharCode(0)}.json`)).toThrow();
  });
});
