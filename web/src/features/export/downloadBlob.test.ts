import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from './downloadBlob';

describe('downloadBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('สร้าง object URL, คลิก <a download>, แล้ว revoke หลังหน่วงเวลา', () => {
    vi.useFakeTimers();
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const blob = new Blob(['{}'], { type: 'application/json' });
    downloadBlob(blob, 'ทดสอบ.tgbp.json');

    expect(createUrl).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake-url');
  });

  it('anchor ที่สร้างมี download attribute ตรงกับชื่อไฟล์ที่ส่งมา', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url-2');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedFileName: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      capturedFileName = this.download;
    });

    downloadBlob(new Blob(['x']), 'ไฟล์ของฉัน.tgbp.json');
    expect(capturedFileName).toBe('ไฟล์ของฉัน.tgbp.json');
  });
});
