import { describe, expect, it } from 'vitest';
import { CSP_CONTENT, injectCspMetaHtml } from './cspMeta';

const SAMPLE_HTML = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <title>test</title>
  </head>
  <body></body>
</html>
`;

describe('injectCspMetaHtml', () => {
  it('inserts the CSP meta tag right after the charset meta tag', () => {
    const result = injectCspMetaHtml(SAMPLE_HTML);
    expect(result).toContain('Content-Security-Policy');
    expect(result.indexOf('charset="UTF-8"')).toBeLessThan(
      result.indexOf('Content-Security-Policy'),
    );
  });

  it('does not include frame-ancestors (unsupported in <meta http-equiv>)', () => {
    expect(CSP_CONTENT).not.toContain('frame-ancestors');
  });

  it('restricts connect-src to self and api.anthropic.com only (N5)', () => {
    expect(CSP_CONTENT).toContain("connect-src 'self' https://api.anthropic.com");
  });

  it('is idempotent (does not double-insert if called twice)', () => {
    const once = injectCspMetaHtml(SAMPLE_HTML);
    const twice = injectCspMetaHtml(once);
    expect(twice.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it('throws a clear error when the charset tag is missing', () => {
    expect(() => injectCspMetaHtml('<html></html>')).toThrow();
  });

  it('still injects when the word "Content-Security-Policy" only appears in a comment (regression)', () => {
    const htmlWithExplanatoryComment = `<!doctype html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <!-- หมายเหตุ: ไม่ใส่ Content-Security-Policy ตรงนี้ตอน dev -->
  </head>
  <body></body>
</html>
`;
    const result = injectCspMetaHtml(htmlWithExplanatoryComment);
    expect(result).toContain('http-equiv="Content-Security-Policy"');
  });
});
