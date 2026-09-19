/// <reference types="node" />
/**
 * (ช) loadJsonGz: gzip จริง vs. ไม่ gzip (server ถอดให้แล้ว/ไฟล์ JSON ธรรมดา)
 */
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { loadJsonGz } from '@/data/manifest';

const PayloadSchema = z.object({ hello: z.string() });

describe('loadJsonGz (T-202 ช)', () => {
  it('แตก gzip จริงได้ (magic bytes 1f 8b)', async () => {
    const payload = { hello: 'สวัสดี' };
    const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(gz, { status: 200 }));

    const result = await loadJsonGz('fake.json.gz', PayloadSchema, fetchImpl);
    expect(result).toEqual(payload);
  });

  it('รองรับกรณี host ถอด gzip ให้แล้ว (body เป็น JSON text ตรง ๆ ไม่มี magic bytes)', async () => {
    const payload = { hello: 'plain' };
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));

    const result = await loadJsonGz('fake.json.gz', PayloadSchema, fetchImpl);
    expect(result).toEqual(payload);
  });

  it('โยน DataLoadError kind "schema" เมื่อแตก gzip ได้แต่ validate ไม่ผ่าน', async () => {
    const gz = gzipSync(Buffer.from(JSON.stringify({ wrong: 'shape' })));
    const fetchImpl: typeof fetch = () => Promise.resolve(new Response(gz, { status: 200 }));

    await expect(loadJsonGz('fake.json.gz', PayloadSchema, fetchImpl)).rejects.toMatchObject({
      kind: 'schema',
    });
  });
});
