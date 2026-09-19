import { describe, expect, it } from 'vitest';
import { matchCaptures } from './matchCaptures';

const call = (name: string, isError = false) => ({ name, isError });
const cap = (name: string, tag: string, isError = false) => ({ name, isError, tag });

describe('matchCaptures', () => {
  it('ลำดับตรงกัน → จับคู่ตามลำดับ', () => {
    const out = matchCaptures([call('a'), call('b')], [cap('a', '1'), cap('b', '2')]);
    expect(out.map((c) => c?.tag)).toEqual(['1', '2']);
  });

  it('tool ขนานเสร็จสลับลำดับ (เคสจริง) → ยังจับถูกทุกตัว รวม emit_proposal ท้ายสุด', () => {
    const calls = [call('search_catalog'), call('query_budget_lines', true), call('emit_proposal')];
    const captures = [
      cap('query_budget_lines', 'q', true),
      cap('search_catalog', 's'),
      cap('emit_proposal', 'p'),
    ];
    expect(matchCaptures(calls, captures).map((c) => c?.tag)).toEqual(['s', 'q', 'p']);
  });

  it('ชื่อซ้ำ → FIFO ต่อชื่อ และ capture ไม่ถูกใช้ซ้ำ', () => {
    const out = matchCaptures([call('x'), call('x'), call('x')], [cap('x', '1'), cap('x', '2')]);
    expect(out.map((c) => c?.tag)).toEqual(['1', '2', undefined]);
  });

  it('isError ไม่ตรง → ไม่จับคู่ข้ามกัน', () => {
    const out = matchCaptures(
      [call('x', true), call('x')],
      [cap('x', 'ok'), cap('x', 'err', true)],
    );
    expect(out.map((c) => c?.tag)).toEqual(['err', 'ok']);
  });
});
