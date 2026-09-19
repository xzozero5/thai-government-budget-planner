/**
 * ข้อความ UI ภาษาไทย — แหล่งเดียวคือ `docs/ui/copy.th.json` (T-401); ไฟล์ `copy.th.json` ในโฟลเดอร์นี้เป็น
 * สำเนาที่ bundle ได้ และมี test (`i18n.test.ts`) บังคับว่าต้องตรงกับต้นฉบับทุกตัวอักษร
 *
 * ใช้: `t('keygate.title')`, `t('data.progress', { percent: 40 })` — key เป็น type-safe (พิมพ์ผิด = compile error)
 */
import copy from './copy.th.json';

type Copy = typeof copy;

type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends readonly unknown[]
      ? never
      : T[K] extends object
        ? LeafPaths<T[K], `${Prefix}${K}.`>
        : never;
}[keyof T & string];

export type CopyKey = Exclude<LeafPaths<Copy>, `_meta.${string}`>;

function lookup(key: string): string | undefined {
  let node: unknown = copy;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** คืนข้อความตาม key และแทน `{name}` ด้วยค่าจาก params; key ที่ไม่มี → คืน key เอง (มองเห็นได้ทันทีตอน dev) */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const template = lookup(key) ?? key;
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
