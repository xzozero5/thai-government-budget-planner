/**
 * T-205 — econ.ts: loadEcon (lazy+cache), getEconSeries, getEconValue
 *
 * ยืนยันด้วยตัวเลขจริงจาก `web/tests/fixtures/data/econ/indicators.json` (T-111/T-110) — N3: ค่า
 * null ต้องคืน null พร้อม note เสมอ ห้ามเดา/interpolate
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataLoadError } from '@/data/manifest';
import { createFixtureFetch } from '@/data/testFixtures';
import { getEconSeries, getEconValue, loadEcon, resetEconCache } from '@/data/econ';

beforeEach(() => {
  resetEconCache();
});

describe('loadEcon (T-205) — lazy + cache', () => {
  it('cache เป็น promise เดียว — เรียกซ้ำไม่ fetch ใหม่', async () => {
    const fetchImpl = vi.fn(createFixtureFetch());
    const first = await loadEcon(fetchImpl);
    const second = await loadEcon(fetchImpl);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resetEconCache() ล้าง cache — เรียกซ้ำ fetch ใหม่', async () => {
    const fetchImpl = vi.fn(createFixtureFetch());
    await loadEcon(fetchImpl);
    resetEconCache();
    await loadEcon(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ไม่ cache promise ที่ fail — เรียกซ้ำหลัง error ให้ fetch ใหม่ได้', async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new Error('network down'));
    await expect(loadEcon(failingFetch)).rejects.toThrow(DataLoadError);

    const data = await loadEcon(createFixtureFetch());
    expect(data.schema_version).toBe(1);
  });
});

describe('getEconSeries (T-205)', () => {
  const fetchImpl = createFixtureFetch();

  it('คืน series ที่มีจริง (cpi_headline_index)', async () => {
    const series = await getEconSeries('cpi_headline_index', fetchImpl);
    expect(series).not.toBeNull();
    expect(series?.unit).toBe('index 2566=100 (TPSO CPI ทั่วไปของประเทศ, Type=TG)');
    expect(series?.verified).toBe(false);
    expect(series?.points.map((p) => p.year_be)).toEqual([
      2558, 2559, 2560, 2561, 2562, 2563, 2564, 2565, 2566, 2567, 2568,
    ]);
  });

  it('คืน null เมื่อ indicator ไม่มี series ในไฟล์ (ทุกปีเป็น null ตอน publish)', async () => {
    const series = await getEconSeries('cmi_asphalt_petroleum', fetchImpl);
    expect(series).toBeNull();
  });

  it('คืน null เมื่อ indicator ไม่รู้จักเลย', async () => {
    const series = await getEconSeries('not_a_real_indicator', fetchImpl);
    expect(series).toBeNull();
  });
});

describe('getEconValue (T-205) — N3: ห้ามเดา/interpolate ค่า null', () => {
  const fetchImpl = createFixtureFetch();

  it('คืนค่าปกติพร้อม metadata ครบ (cpi_headline_index ปี 2558)', async () => {
    const result = await getEconValue('cpi_headline_index', 2558, fetchImpl);
    expect(result).not.toBeNull();
    expect(result?.value).toBe(90.39);
    expect(result?.unit).toBe('index 2566=100 (TPSO CPI ทั่วไปของประเทศ, Type=TG)');
    expect(result?.source_name).toContain('สนค.');
    expect(result?.source_url).toBe('https://index.tpso.go.th/api/cpig/year');
    expect(result?.verified).toBe(false);
  });

  it('ค่า null ต้องคืน value:null พร้อม note อธิบาย ไม่ประมาณ/interpolate เอง', async () => {
    const result = await getEconValue('cmi_asphalt_petroleum', 2559, fetchImpl);
    expect(result).not.toBeNull();
    expect(result?.value).toBeNull();
    expect(result?.verified).toBe(false);
    expect(result?.note).toContain('not_published_by_source');
  });

  it('ปี 2569 ของ cpi_headline_index ยังไม่ประกาศ → value:null พร้อม note', async () => {
    const result = await getEconValue('cpi_headline_index', 2569, fetchImpl);
    expect(result).not.toBeNull();
    expect(result?.value).toBeNull();
    expect(result?.note.length).toBeGreaterThan(0);
  });

  it('คืน null (ทั้งก้อน) เมื่อไม่มี record ของ indicator/ปีนี้เลย (ต่างจาก value:null)', async () => {
    // cmi_steel เริ่มเก็บข้อมูลปี 2559 เป็นต้นไป — ปี 2558 ไม่มี record เลยในไฟล์ (ไม่ใช่ value:null)
    const result = await getEconValue('cmi_steel', 2558, fetchImpl);
    expect(result).toBeNull();
  });
});
