/// <reference types="node" />
/**
 * (ก) ทุกไฟล์ fixture ต้อง parse ผ่าน Zod schema ของตัวเอง
 * (manifest, sources, catalog v2, trends ทุก shard, facets, orgs, docs ทุกไฟล์, econ)
 */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadJson, loadJsonGz } from '@/data/manifest';
import {
  CatalogFileSchema,
  DocChunksFileSchema,
  EconIndicatorsFileSchema,
  FacetsSchema,
  ManifestSchema,
  OrgsFileSchema,
  SourcesFileSchema,
  TrendShardSchema,
} from '@/data/types';
import { createFixtureFetch, fixtureFilePath } from '@/data/testFixtures';

const fetchImpl = createFixtureFetch();

describe('fixture ↔ Zod schema (T-202 ก)', () => {
  it('manifest.json ผ่าน ManifestSchema', async () => {
    const manifest = await loadJson('manifest.json', ManifestSchema, fetchImpl);
    expect(manifest.sample).toBe(true);
    expect(manifest.files.length).toBeGreaterThan(0);
  });

  it('sources.json ผ่าน SourcesFileSchema', async () => {
    const sources = await loadJson('sources.json', SourcesFileSchema, fetchImpl);
    expect(sources.length).toBeGreaterThan(0);
  });

  it('catalog/facets.json ผ่าน FacetsSchema', async () => {
    const facets = await loadJson('catalog/facets.json', FacetsSchema, fetchImpl);
    expect(facets.datasets.length).toBe(6);
  });

  it('catalog/orgs.json ผ่าน OrgsFileSchema', async () => {
    const orgs = await loadJson('catalog/orgs.json', OrgsFileSchema, fetchImpl);
    expect(orgs.length).toBeGreaterThan(0);
  });

  it('econ/indicators.json ผ่าน EconIndicatorsFileSchema', async () => {
    const econ = await loadJson('econ/indicators.json', EconIndicatorsFileSchema, fetchImpl);
    expect(econ.records.length).toBeGreaterThan(0);
    expect(econ.series.length).toBeGreaterThan(0);
  });

  it('catalog/items.json.gz (schema v2) ผ่าน CatalogFileSchema', async () => {
    const catalog = await loadJsonGz('catalog/items.json.gz', CatalogFileSchema, fetchImpl);
    expect(catalog.schema_version).toBe(2);
    expect(catalog.items.length).toBeGreaterThan(0);
  });

  const trendFiles = readdirSync(fixtureFilePath('catalog/trends')).filter((f) =>
    f.endsWith('.json.gz'),
  );

  it('มีไฟล์ catalog/trends/*.json.gz ให้ทดสอบจริง (ไม่ใช่ลิสต์ว่าง)', () => {
    expect(trendFiles.length).toBeGreaterThan(0);
  });

  it.each(trendFiles)('catalog/trends/%s ผ่าน TrendShardSchema', async (file) => {
    const shard = await loadJsonGz(`catalog/trends/${file}`, TrendShardSchema, fetchImpl);
    expect(Object.keys(shard).length).toBeGreaterThan(0);
  });

  const docFiles = readdirSync(fixtureFilePath('docs')).filter((f) => f.endsWith('.json.gz'));

  it('มีไฟล์ docs/*.json.gz ให้ทดสอบจริง (ไม่ใช่ลิสต์ว่าง)', () => {
    expect(docFiles.length).toBeGreaterThan(0);
  });

  it.each(docFiles)('docs/%s ผ่าน DocChunksFileSchema', async (file) => {
    const chunks = await loadJsonGz(`docs/${file}`, DocChunksFileSchema, fetchImpl);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
