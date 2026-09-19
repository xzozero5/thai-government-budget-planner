/**
 * (จ) loadManifest cache/error kinds
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataLoadError, loadManifest, resetManifestCache } from '@/data/manifest';
import { createFixtureFetch } from '@/data/testFixtures';

beforeEach(() => {
  resetManifestCache();
});

describe('loadManifest cache (T-202 จ)', () => {
  it('cache เป็น promise เดียว — เรียกซ้ำไม่ fetch ใหม่', async () => {
    const fetchImpl = vi.fn(createFixtureFetch());
    const first = await loadManifest(fetchImpl);
    const second = await loadManifest(fetchImpl);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('resetManifestCache() ล้าง cache — เรียกซ้ำ fetch ใหม่', async () => {
    const fetchImpl = vi.fn(createFixtureFetch());
    await loadManifest(fetchImpl);
    resetManifestCache();
    await loadManifest(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('ไม่ cache promise ที่ fail — เรียกซ้ำหลัง error ให้ fetch ใหม่ได้ (เช่น เน็ตกลับมา)', async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new Error('network down'));
    await expect(loadManifest(failingFetch)).rejects.toThrow(DataLoadError);

    const workingFetch = createFixtureFetch();
    const manifest = await loadManifest(workingFetch);
    expect(manifest.sample).toBe(true);
  });
});

describe('loadManifest error kinds (T-202 จ)', () => {
  it('kind "network" เมื่อ fetch throw (เครือข่ายขัดข้อง)', async () => {
    const failingFetch: typeof fetch = () => Promise.reject(new Error('boom'));
    const error = await loadManifest(failingFetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).kind).toBe('network');
  });

  it('kind "http" เมื่อ response ไม่ ok', async () => {
    const notFoundFetch: typeof fetch = () =>
      Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' }));
    const error = await loadManifest(notFoundFetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).kind).toBe('http');
  });

  it('kind "schema" เมื่อ body ไม่ใช่ JSON ที่ถูกต้อง', async () => {
    const badJsonFetch: typeof fetch = () =>
      Promise.resolve(new Response('ไม่ใช่ json', { status: 200 }));
    const error = await loadManifest(badJsonFetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).kind).toBe('schema');
  });

  it('kind "schema" เมื่อโครงสร้าง JSON ไม่ตรงกับ ManifestSchema', async () => {
    const wrongShapeFetch: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    const error = await loadManifest(wrongShapeFetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).kind).toBe('schema');
  });
});
