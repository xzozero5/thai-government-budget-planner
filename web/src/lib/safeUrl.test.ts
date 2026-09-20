import { describe, expect, it } from 'vitest';
import { isSafeHttpsUrl, parseSafeHttpsUrl } from './safeUrl';

describe('parseSafeHttpsUrl', () => {
  it('https ปกติ → คืน URL', () => {
    const url = parseSafeHttpsUrl('https://shopee.co.th/product/1');
    expect(url).not.toBeNull();
    expect(url?.href).toBe('https://shopee.co.th/product/1');
  });

  it.each([
    ['http://example.com', 'http'],
    ['javascript:alert(1)', 'javascript:'],
    ['data:text/html,<script>alert(1)</script>', 'data:'],
    ['ftp://example.com/file', 'ftp:'],
    ['//evil.example.com', 'protocol-relative'],
    ['not a url', 'invalid'],
    ['', 'empty'],
    ['https://bank.example@evil.example/login', 'userinfo หลอกตา'],
    ['https://user:pass@example.com/', 'user:pass'],
    [' https://example.com', 'ช่องว่างนำหน้า'],
    ['\thttps://example.com', 'tab นำหน้า'],
    ['\u0000https://example.com', 'null byte นำหน้า'],
  ])('ปฏิเสธ: %s (%s)', (href) => {
    expect(parseSafeHttpsUrl(href)).toBeNull();
  });

  it('อักขระควบคุมแฝงกลางสตริง (ไม่ใช่แค่นำหน้า) ต้องถูกปฏิเสธ — กัน trick ของ WHATWG URL parser ที่ตัด tab/newline ทั่วทั้งสตริง', () => {
    // ถ้าไม่กัน อักขระควบคุมนี้จะถูก `new URL()` ตัดทิ้งแล้ว parse ผ่านเป็น "javascript:alert(1)" เงียบ ๆ
    expect(parseSafeHttpsUrl('java\nscript:alert(1)')).toBeNull();
    expect(parseSafeHttpsUrl('https://exa\tmple.com')).toBeNull();
  });
});

describe('isSafeHttpsUrl', () => {
  it('true เฉพาะ https ที่ปลอดภัย', () => {
    expect(isSafeHttpsUrl('https://shopee.co.th/a')).toBe(true);
    expect(isSafeHttpsUrl('http://shopee.co.th/a')).toBe(false);
    expect(isSafeHttpsUrl('https://user:pass@example.com/')).toBe(false);
  });
});

describe('parseSafeHttpsUrl — ชุดโจมตีของ main thread (หลัง T-602)', () => {
  it.each([
    'https:/' + String.fromCharCode(92) + 'evil.example',
    'https://evil.example' + String.fromCharCode(92) + '@good.example',
    'https:///a',
    'https://',
    'https://console.anthropic.com@evil.example/x',
    'javascript:alert(1)//https://a',
    'blob:https://a.example/1',
    '//a.example',
  ])('ปฏิเสธ %s (parser ของเบราว์เซอร์ "ซ่อม" รูปแปลกให้เอง — เรารับเฉพาะรูปมาตรฐาน)', (href) => {
    expect(isSafeHttpsUrl(href)).toBe(false);
  });

  it.each([
    'https://shopee.co.th/item?x=1#y',
    'https://www.lazada.co.th/สินค้า',
    'HTTPS://EXAMPLE.COM/A',
  ])('ยอมรับ %s', (href) => {
    expect(isSafeHttpsUrl(href)).toBe(true);
  });
});
