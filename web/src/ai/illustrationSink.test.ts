import { describe, expect, it } from 'vitest';
import { createInMemoryIllustrationSink } from './illustrationSink';

describe('createInMemoryIllustrationSink', () => {
  it('add/get/count ทำงานถูกต้อง', () => {
    const sink = createInMemoryIllustrationSink();
    expect(sink.count()).toBe(0);
    sink.add({
      illustrationId: 'illus-1',
      title: 'แผนผังถนน',
      caption: 'ภาพเชิงแผนผัง ไม่ใช่แบบก่อสร้างจริง',
      kind: 'map',
      svg: '<svg viewBox="0 0 10 10"></svg>',
      warnings: [],
    });
    expect(sink.count()).toBe(1);
    expect(sink.get('illus-1')?.title).toBe('แผนผังถนน');
    expect(sink.get('missing')).toBeUndefined();
  });
});
