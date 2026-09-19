/**
 * T-207 / N9 — svgSanitizer.test.ts
 *
 * เคสโจมตี 6 ไฟล์แรก (`web/spikes/s5/in/01..06`) คัดลอกมาไว้ `__fixtures__/svg/` ตามที่ task
 * brief กำหนด (ห้ามแก้ ห้าม import จาก spikes) — ไฟล์ที่ 7 (`07-clean-diagram.svg`) เป็นเคส
 * "SVG สะอาด" สำหรับตรวจว่า sanitizer ไม่ตัดของที่ไม่อันตราย (gradient/filter อ้าง `url(#id)`)
 *
 * SVG ที่ Claude สร้างจริงจาก spike S5 (`web/spikes/s5/out/*.raw.svg`) มีแค่ **2 ไฟล์** ที่สำเร็จ
 * (ฝายน้ำล้น cross_section โดย Haiku 4.5, แผนที่ กทม.–นครนายก โดย Sonnet 5) — โจทย์ที่ 3 (ถนน 4 เลน
 * isometric, Sonnet 5) ชน `stop_reason: 'max_tokens'` และ**ไม่ได้ SVG ที่สมบูรณ์เลย**
 * (docs/decisions/SPIKES.md §S5 ผล 3) จึงไม่มีไฟล์ที่ 3 ให้ทดสอบจริง — ระบุไว้ตรงนี้ตามที่พบจริง
 */
import { describe, expect, it } from 'vitest';
import attackScript from './__fixtures__/svg/01-script.svg?raw';
import attackEvents from './__fixtures__/svg/02-events.svg?raw';
import attackForeignObject from './__fixtures__/svg/03-foreignObject.svg?raw';
import attackExternalHref from './__fixtures__/svg/04-external-href.svg?raw';
import attackStyleUrl from './__fixtures__/svg/05-style-url.svg?raw';
import attackDatauriSmil from './__fixtures__/svg/06-datauri-and-smil.svg?raw';
import cleanDiagram from './__fixtures__/svg/07-clean-diagram.svg?raw';
import weirCrossSectionRaw from './__fixtures__/svg/02-weir-cross-section.raw.svg?raw';
import routeMapRaw from './__fixtures__/svg/03-route-map.raw.svg?raw';
import { sanitizeSvg, type SanitizeSvgOk } from '@/lib/svgSanitizer';

/** นับจำนวน element ต่อ tag name (lowercase) จากสตริง SVG — ใช้เทียบก่อน/หลัง sanitize */
function countTags(svgText: string): Map<string, number> {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const counts = new Map<string, number>();
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

function expectOk(result: ReturnType<typeof sanitizeSvg>): SanitizeSvgOk {
  if (!result.ok) {
    throw new Error(`คาดว่า sanitize จะสำเร็จ แต่ล้มเหลว: ${result.reason}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// เคสโจมตี 6 ไฟล์จาก spike S5 (web/spikes/s5/in/01..06)
// ---------------------------------------------------------------------------

const ATTACK_CASES: { name: string; svg: string; mustNotContain: RegExp[] }[] = [
  {
    name: '01-script.svg — <script> ต้องถูกตัด',
    svg: attackScript,
    mustNotContain: [/<script/i, /fetch\(/i],
  },
  {
    name: '02-events.svg — onload/onclick/onmouseover/onbegin ต้องถูกตัด',
    svg: attackEvents,
    mustNotContain: [/onload/i, /onclick/i, /onmouseover/i, /onbegin/i, /alert\(/i],
  },
  {
    name: '04-external-href.svg — href/xlink:href/javascript: ต้องถูกตัด',
    svg: attackExternalHref,
    mustNotContain: [/href=/i, /javascript:/i, /evil\.example/i, /<use/i, /<image/i, /<a[\s>]/i],
  },
  {
    name: '05-style-url.svg — <style>@import url(...) ต้องถูกตัดทั้ง element (ช่องโหว่จาก S5)',
    svg: attackStyleUrl,
    mustNotContain: [/<style/i, /@import/i, /url\(http/i, /evil\.example/i],
  },
  {
    name: '06-datauri-and-smil.svg — data: URI ใน <image>, animate/set (SMIL) ต้องถูกตัด',
    svg: attackDatauriSmil,
    mustNotContain: [/<image/i, /data:image/i, /<animate/i, /<set/i, /javascript:/i],
  },
];

describe('sanitizeSvg — เคสโจมตีจาก spike S5 (web/spikes/s5/in)', () => {
  it.each(ATTACK_CASES)('$name', ({ svg, mustNotContain }) => {
    const result = sanitizeSvg(svg);
    const ok = expectOk(result);
    for (const pattern of mustNotContain) {
      expect(ok.svg).not.toMatch(pattern);
    }
    // defense-in-depth ทั่วไปตาม task brief: ไม่มี on*, href, <style, @import, url(http เหลืออยู่เลย
    expect(ok.svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(ok.svg).not.toMatch(/href\s*=/i);
    expect(ok.svg).not.toMatch(/<style/i);
    expect(ok.svg).not.toMatch(/@import/i);
    expect(ok.svg).not.toMatch(/url\(\s*['"]?https?:/i);
    // root ยังเป็น <svg> ที่ render ได้ (ไม่ถูกลบทั้งก้อน)
    expect(ok.svg).toMatch(/^<svg[\s>]/);
  });

  it('01-script.svg: <rect> ที่ไม่อันตรายยังอยู่หลัง sanitize', () => {
    const ok = expectOk(sanitizeSvg(attackScript));
    expect(ok.svg).toContain('<rect');
    expect(ok.svg).toContain('#123');
  });

  it('04-external-href.svg: unwrap <a> แต่เก็บ text content ("click") ไว้ (ไม่ลบทั้ง subtree)', () => {
    const ok = expectOk(sanitizeSvg(attackExternalHref));
    expect(ok.svg).toContain('click');
  });

  it('06-datauri-and-smil.svg: unwrap <a> แต่เก็บ text content ("go") ไว้', () => {
    const ok = expectOk(sanitizeSvg(attackDatauriSmil));
    expect(ok.svg).toContain('go');
  });

  it(
    '03-foreignObject.svg: ไฟล์นี้มี XML ไม่ถูกต้องอยู่แล้ว (attribute "src=x" ไม่มี quote ใน ' +
      '<img>) → sanitizeSvg parse เป็น image/svg+xml แบบ strict แล้ว reject ทั้งไฟล์ (ok:false) ' +
      '— เข้มกว่า spike เดิมที่ sanitize เป็นสตริง HTML-lenient แล้วได้ "ถูกตัดทั้งหมด" (ยังปลอดภัย ' +
      'เท่ากันหรือมากกว่า เพราะไม่มี foreignObject/iframe/onerror หลุดออกมาเลยไม่ว่ากรณีใด)',
    () => {
      const result = sanitizeSvg(attackForeignObject);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('XML');
      }
    },
  );
});

// ---------------------------------------------------------------------------
// SVG สะอาด — ต้องไม่ตัดของที่ไม่อันตราย (url(#local) ภายใน gradient/filter ต้องรอด)
// ---------------------------------------------------------------------------

describe('sanitizeSvg — SVG สะอาด (07-clean-diagram.svg)', () => {
  it('ผ่านโดยไม่มี warning เมื่อไม่ได้ส่ง palette และ url(#local) ยังทำงาน', () => {
    const ok = expectOk(sanitizeSvg(cleanDiagram));
    expect(ok.warnings).toEqual([]);
    expect(ok.svg).toContain('fill="url(#g1)"');
    expect(ok.svg).toContain('filter="url(#f1)"');
    expect(ok.svg).toContain('linearGradient');
    expect(ok.svg).toContain('ฝายน้ำล้น');
  });

  it('สีนอก palette → warning เท่านั้น ไม่ reject', () => {
    const result = sanitizeSvg(cleanDiagram, { palette: ['#ffffff'] });
    const ok = expectOk(result);
    expect(ok.warnings.length).toBeGreaterThan(0);
    expect(ok.warnings.some((w) => w.includes('#a4161a'))).toBe(true);
  });

  it('สีที่อยู่ใน palette ไม่ได้ warning', () => {
    const result = sanitizeSvg(cleanDiagram, {
      palette: ['#ffffff', '#a4161a', '#2b4c7e', '#111', '#555', '#9ec5fe', '#e7f1ff'],
    });
    const ok = expectOk(result);
    expect(ok.warnings).toEqual([]);
  });

  it('ตั้ง width/height เป็น responsive (100%) แต่คง viewBox เดิม', () => {
    const ok = expectOk(sanitizeSvg(cleanDiagram));
    expect(ok.svg).toContain('viewBox="0 0 400 240"');
    expect(ok.svg).toMatch(/width="100%"/);
    expect(ok.svg).toMatch(/height="100%"/);
  });
});

// ---------------------------------------------------------------------------
// node() — ต้องสร้าง DOM node ใหม่ทุกครั้ง (ห้าม dangerouslySetInnerHTML กับสตริงดิบ)
// ---------------------------------------------------------------------------

describe('sanitizeSvg().node()', () => {
  it('คืน SVGSVGElement ใหม่ทุกครั้งที่เรียก (ไม่ใช่ reference เดิม)', () => {
    const ok = expectOk(sanitizeSvg(cleanDiagram));
    const nodeA = ok.node();
    const nodeB = ok.node();
    expect(nodeA).not.toBe(nodeB);
    expect(nodeA.tagName.toLowerCase()).toBe('svg');
    expect(nodeA.getAttribute('viewBox')).toBe('0 0 400 240');
    expect(nodeA.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('node ที่คืนมาไม่มี <script>/onload หลงเหลือ แม้จะมาจากไฟล์โจมตี', () => {
    const ok = expectOk(sanitizeSvg(attackEvents));
    const node = ok.node();
    expect(node.querySelector('script')).toBeNull();
    expect(node.hasAttribute('onload')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ปฏิเสธ (reject) — ขนาดเกิน / ไม่มี viewBox / root ผิด / XML พัง / entity expansion
// ---------------------------------------------------------------------------

describe('sanitizeSvg — เคสที่ต้อง reject (ok:false)', () => {
  it('เกิน maxBytes (default 60 KB) → reject', () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<!-- x -->'.repeat(10_000)}<rect width="1" height="1"/></svg>`;
    const result = sanitizeSvg(big);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('ขนาด');
    }
  });

  it('เกิน maxBytes ที่กำหนดเอง (options.maxBytes) → reject แม้ไฟล์เล็ก', () => {
    const result = sanitizeSvg(cleanDiagram, { maxBytes: 10 });
    expect(result.ok).toBe(false);
  });

  it('ไม่มี viewBox → reject', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('viewBox');
    }
  });

  it('viewBox เป็นสตริงว่าง → reject', () => {
    const result = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="   "><rect width="1" height="1"/></svg>',
    );
    expect(result.ok).toBe(false);
  });

  it('root ไม่ใช่ <svg> → reject', () => {
    const result = sanitizeSvg(
      '<div xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></div>',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('<svg>');
    }
  });

  it('XML พัง (unclosed tag) → reject', () => {
    const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('XML');
    }
  });

  it('entity expansion (<!DOCTYPE ... <!ENTITY ...>) → reject', () => {
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe "boom">]>' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&xxe;</text></svg>';
    const result = sanitizeSvg(bomb);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/DOCTYPE|ENTITY/);
    }
  });
});

// ---------------------------------------------------------------------------
// เคสเพิ่มตาม task brief — สิ่งที่ DOMPurify ปล่อยผ่านแต่ชั้นตรวจซ้ำของเราต้องจับได้
// ---------------------------------------------------------------------------

describe('sanitizeSvg — defense-in-depth (สิ่งที่ DOMPurify คนเดียวไม่พอ)', () => {
  it('<style><![CDATA[...]]></style> (mutation XSS) — ทั้ง element ต้องหายไป', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<style><![CDATA[ rect{fill:url(https://evil.example/x)} ]]></style>' +
      '<rect width="5" height="5"/></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).not.toMatch(/<style/i);
    expect(ok.svg).not.toMatch(/evil\.example/i);
    expect(ok.svg).toContain('<rect');
  });

  it('attribute "style" ตัวพิมพ์เล็กปกติที่มี url(http...) — DOMPurify ปล่อยผ่าน แต่ชั้นของเราต้องตัด', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect width="5" height="5" style="fill:url(https://evil.example/x)"/></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).not.toMatch(/style\s*=/i);
    expect(ok.svg).not.toMatch(/evil\.example/i);
    expect(ok.warnings.some((w) => w.includes('style'))).toBe(true);
  });

  it('attribute style ถูกตัดทิ้งเสมอ แม้ค่าจะดูปลอดภัย (นโยบาย: ไม่อนุญาต inline CSS)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect width="5" height="5" style="opacity:0.5"/></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).not.toMatch(/style\s*=/i);
    expect(ok.svg).toContain('<rect');
    expect(ok.warnings.join(' ')).toContain('inline CSS');
  });

  // main thread (T-207 review): blocklist แบบ `url(` ไม่พอ — CSS โหลดทรัพยากรได้หลายฟังก์ชัน
  const externalReferenceAttacks: [string, string][] = [
    [
      'style + image-set() (ไม่มี url()',
      '<rect style="mask-image:image-set(&quot;https://evil.example/m.png&quot; 1x)" width="1" height="1"/>',
    ],
    [
      'style + url()',
      '<rect style="fill:url(https://evil.example/x.svg#a)" width="1" height="1"/>',
    ],
    ['fill=url(ภายนอก)', '<rect fill="url(https://evil.example/g.svg#g)" width="1" height="1"/>'],
    [
      'filter=url("ภายนอก")',
      '<g filter="url(&quot;https://evil.example/f#x&quot;)"><rect width="1" height="1"/></g>',
    ],
    ['cursor=url()', '<rect cursor="url(https://evil.example/c.cur), auto" width="1" height="1"/>'],
    ['protocol-relative', '<rect fill="url(//evil.example/g#g)" width="1" height="1"/>'],
    ['feImage href', '<filter id="f"><feImage href="https://evil.example/i.png"/></filter>'],
    ['nested svg + script', '<svg><script>alert(1)</script></svg>'],
    [
      'a xlink:href javascript:',
      '<a xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(1)"><text>x</text></a>',
    ],
  ];
  it.each(externalReferenceAttacks)('ไม่เหลือการอ้างทรัพยากรภายนอก: %s', (_name, inner) => {
    const result = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`,
    );
    if (!result.ok) return; // ปฏิเสธทั้งไฟล์ = ปลอดภัย
    expect(result.svg).not.toMatch(
      /evil\.example|javascript:|<script|image-set|\/\/(?!www\.w3\.org)/i,
    );
  });

  it('url(#local) และ xmlns ยังผ่าน (ไม่ถูกกฎ external reference ตัด)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs>' +
      '<linearGradient id="g"><stop offset="0" stop-color="#0033A0"/></linearGradient></defs>' +
      '<rect width="5" height="5" fill="url(#g)"/></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).toContain('fill="url(#g)"');
    expect(ok.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  // T-206 (architect): CSS escape bypass — Chromium ถอด `\000075rl(` เป็น `url(` แล้วยิง request ออกจริง
  const cssEscapeAttacks: [string, string][] = [
    [
      'fill',
      String.raw`<rect fill="\000075rl(\00002f\00002fevil.example/g.svg#g)" width="1" height="1"/>`,
    ],
    ['stroke', String.raw`<rect stroke="\75 rl(//evil.example/s.svg#s)" width="1" height="1"/>`],
    [
      'filter',
      String.raw`<g filter="\000075rl(\00002f\00002fevil.example/f.svg#f)"><rect width="1" height="1"/></g>`,
    ],
    ['mask', String.raw`<rect mask="\000075rl(//evil.example/m.svg#m)" width="1" height="1"/>`],
    [
      'clip-path',
      String.raw`<rect clip-path="\000075rl(//evil.example/c.svg#c)" width="1" height="1"/>`,
    ],
    [
      'marker-start',
      String.raw`<path d="M0 0L1 1" marker-start="\000075rl(//evil.example/mk.svg#k)"/>`,
    ],
    [
      'stop-color',
      String.raw`<linearGradient id="g"><stop stop-color="\000075rl(//evil.example/x)"/></linearGradient>`,
    ],
  ];
  it.each(cssEscapeAttacks)('CSS escape ใน %s ถูกตัดทิ้ง', (attr, inner) => {
    const result = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`,
    );
    if (!result.ok) return; // ปฏิเสธทั้งไฟล์ = ปลอดภัย
    expect(result.svg.includes('\\')).toBe(false);
    expect(result.svg).not.toMatch(/evil\.example/i);
    expect(result.svg).not.toMatch(new RegExp(`${attr}\\s*=`, 'i'));
  });

  it.each([
    'none',
    'currentColor',
    'red',
    '#0033A0',
    '#fff',
    'rgb(0, 51, 160)',
    'rgba(0,51,160,0.5)',
    'hsl(210 50% 40%)',
    'url(#grad)',
    'url(#grad) #ffffff',
  ])('ค่า paint ที่ถูกต้อง "%s" ยังอยู่', (paint) => {
    const ok = expectOk(
      sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs>' +
          '<linearGradient id="grad"><stop offset="0" stop-color="#0033A0"/></linearGradient></defs>' +
          `<rect width="5" height="5" fill="${paint}"/></svg>`,
      ),
    );
    expect(ok.svg).toContain(`fill="${paint}"`);
  });

  it.each([
    'expression(alert(1))',
    'url(#a) url(//evil.example/x)',
    'var(--x, url(//evil.example))',
    'attr(data-x url)',
    'URL(//evil.example/x)',
  ])('ค่า paint นอก grammar "%s" ถูกตัด', (paint) => {
    const ok = expectOk(
      sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5" fill="${paint}"/></svg>`,
      ),
    );
    expect(ok.svg).not.toMatch(/fill\s*=/i);
  });

  it('attribute แบบตัวพิมพ์ผสม STYLE/OnLoad — ต้องถูกตัดเหมือนตัวพิมพ์เล็ก', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" OnLoad="alert(1)">' +
      '<rect width="5" height="5" STYLE="fill:url(https://evil.example/x)"/></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).not.toMatch(/onload/i);
    expect(ok.svg).not.toMatch(/style\s*=/i);
    expect(ok.svg).not.toMatch(/evil\.example/i);
  });

  it('namespace แปลก: xlink:href บน <a> ที่เหลือจาก DOMPurify — ถูกตัดทั้ง element (a อยู่ใน FORBID_TAGS)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 10 10"><a xlink:href="https://evil.example/">x</a></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).not.toMatch(/xlink:href/i);
    expect(ok.svg).not.toMatch(/evil\.example/i);
  });

  it('url() ที่ไม่ใช่ style แต่ชี้ไป http ใน attribute อื่น (เช่น clip-path) ต้องถูกตัด', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<rect width="5" height="5" clip-path="url(https://evil.example/clip.svg#c)"/></svg>';
    const ok = expectOk(sanitizeSvg(svg));
    expect(ok.svg).not.toMatch(/evil\.example/i);
    expect(ok.svg).not.toMatch(/clip-path/i);
  });
});

// ---------------------------------------------------------------------------
// SVG ที่ Claude สร้างจริง (spike S5) — ต้องผ่านและ element หลักครบ
// ---------------------------------------------------------------------------

describe('sanitizeSvg — SVG ที่ Claude สร้างจริงจาก spike S5', () => {
  it.each([
    ['02-weir-cross-section (Haiku 4.5, cross_section)', weirCrossSectionRaw],
    ['03-route-map (Sonnet 5, map)', routeMapRaw],
  ])(
    '%s: ผ่าน sanitizer โดยไม่ลด element หลัก (path/rect/text/circle/polygon/line)',
    (_label, raw) => {
      const before = countTags(raw);
      const ok = expectOk(sanitizeSvg(raw));
      const after = countTags(ok.svg);

      for (const tag of ['path', 'rect', 'text', 'circle', 'polygon', 'line', 'pattern', 'defs']) {
        expect(after.get(tag) ?? 0).toBe(before.get(tag) ?? 0);
      }
      // ไม่มี warning เพราะไฟล์เหล่านี้สะอาดอยู่แล้ว (spike ยืนยันว่าโมเดลทำตามข้อจำกัดครบ)
      expect(ok.warnings).toEqual([]);
    },
  );
});
