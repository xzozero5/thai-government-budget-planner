import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { zodToToolInputSchema } from './jsonSchema';

describe('zodToToolInputSchema', () => {
  it('สร้าง JSON Schema type object พร้อม additionalProperties:false อัตโนมัติ (T-302)', () => {
    const schema = z.object({
      query: z.string(),
      limit: z.number().int().optional(),
    });
    const json = zodToToolInputSchema(schema);
    expect(json['type']).toBe('object');
    expect(json['additionalProperties']).toBe(false);
    expect(json['required']).toEqual(['query']);
    const properties = json['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['query', 'limit']);
  });

  it('ไม่ throw กับ enum/nested object/array', () => {
    const schema = z.object({
      kind: z.enum(['a', 'b']),
      nested: z.object({ x: z.number() }),
      list: z.array(z.string()).max(5),
    });
    expect(() => zodToToolInputSchema(schema)).not.toThrow();
    const json = zodToToolInputSchema(schema);
    expect(json['type']).toBe('object');
  });
});
