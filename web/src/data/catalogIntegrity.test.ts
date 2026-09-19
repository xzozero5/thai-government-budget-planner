// @vitest-environment node
//
// ใช้ 'node' environment เพราะ test ที่สองอ่าน parquet ด้วย hyparquet โดยตรง (เหตุผลเดียวกับ
// budgetLines.parquet.test.ts — jsdom แทนที่ global ArrayBuffer ทำให้ hyparquet ใช้งานไม่ได้)
/**
 * (ค) catalog v2 referential integrity:
 *   - ทุก items[].shards[] เป็น index ที่ valid เข้า shard_paths
 *   - ทุก shard_paths[] มีใน manifest.files
 *   - trend ของแต่ละ item ชี้ shard file ที่มีอยู่จริง และ item.key/keys มี entry ตรงในนั้น
 *   - sample_source_ids ของแต่ละ item อยู่ใน shard (parquet) ที่ item.shards ชี้จริง
 */
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { describe, expect, it } from 'vitest';
import { loadJson, loadJsonGz } from '@/data/manifest';
import { CatalogFileSchema, ManifestSchema, TrendShardSchema } from '@/data/types';
import { createFixtureFetch, fixtureFilePath } from '@/data/testFixtures';

const fetchImpl = createFixtureFetch();

describe('catalog v2 referential integrity (T-202 ค)', () => {
  it('shards[] เป็น index ที่ valid เข้า shard_paths, shard_paths[] มีใน manifest.files, trend ชี้ shard ที่มีจริง', async () => {
    const [manifest, catalog] = await Promise.all([
      loadJson('manifest.json', ManifestSchema, fetchImpl),
      loadJsonGz('catalog/items.json.gz', CatalogFileSchema, fetchImpl),
    ]);

    const manifestPaths = new Set(manifest.files.map((f) => f.path));

    // shard_paths ทุกตัวต้องมีอยู่จริงใน manifest.files
    for (const shardPath of catalog.shard_paths) {
      expect(manifestPaths.has(shardPath)).toBe(true);
    }

    for (const item of catalog.items) {
      // shards เป็น index ที่ valid เข้า shard_paths เสมอ (ไม่ติดลบ ไม่เกินความยาว)
      for (const shardIndex of item.shards) {
        expect(shardIndex).toBeGreaterThanOrEqual(0);
        expect(shardIndex).toBeLessThan(catalog.shard_paths.length);
      }

      if (item.trend !== undefined) {
        const trendShard = await loadJsonGz(
          `catalog/trends/${item.trend}.json.gz`,
          TrendShardSchema,
          fetchImpl,
        );
        // สัญญาของ pipeline: shard เป็น map ที่ key = `CatalogItem.key` (ตัวแทนของกลุ่ม) และ
        // `entry.key` ต้องเท่ากับ key ของ map เสมอ
        const entry = trendShard[item.key];
        expect(
          entry,
          `item "${item.key}" อ้าง trend="${item.trend}" แต่ไม่พบ key นี้ใน shard นั้น`,
        ).toBeDefined();
        expect(entry?.key).toBe(item.key);
      }
    }
  });

  it('sample_source_ids ของแต่ละ item อยู่ใน shard (parquet) ที่ item.shards ชี้จริง', async () => {
    const catalog = await loadJsonGz('catalog/items.json.gz', CatalogFileSchema, fetchImpl);

    // อ่าน source_id ของทุก shard parquet ที่ปรากฏใน catalog.shard_paths ครั้งเดียว (cache)
    const sourceIdsByShardIndex = new Map<number, Set<string>>();
    async function sourceIdsFor(shardIndex: number): Promise<Set<string>> {
      const cached = sourceIdsByShardIndex.get(shardIndex);
      if (cached) return cached;
      const shardPath = catalog.shard_paths[shardIndex];
      if (shardPath === undefined) {
        throw new Error(`shard index ${String(shardIndex)} เกินขอบเขต shard_paths`);
      }
      const file = await asyncBufferFromFile(fixtureFilePath(shardPath));
      const rows = await parquetReadObjects({ file, columns: ['source_id'], compressors });
      const ids = new Set(rows.map((row) => row['source_id'] as string));
      sourceIdsByShardIndex.set(shardIndex, ids);
      return ids;
    }

    for (const item of catalog.items) {
      expect(item.sample_source_ids.length).toBeLessThanOrEqual(3);
      expect(item.shards.length).toBeGreaterThan(0);

      for (const sourceId of item.sample_source_ids) {
        let foundInAnyShard = false;
        for (const shardIndex of item.shards) {
          const ids = await sourceIdsFor(shardIndex);
          if (ids.has(sourceId)) {
            foundInAnyShard = true;
            break;
          }
        }
        expect(
          foundInAnyShard,
          `item "${item.key}" sample_source_id="${sourceId}" ไม่พบใน shard ที่ item.shards ชี้เลย`,
        ).toBe(true);
      }
    }
  });
});
