/**
 * จับคู่ tool call ที่ agent loop รายงาน (ลำดับที่โมเดล "เรียก") กับ capture ของ `ai/testing/toolCapture`
 * (ลำดับที่ tool "เสร็จ") — tool ที่รันขนานในรอบเดียวกันเสร็จไม่ตรงลำดับเรียก จึงห้ามเดินด้วย cursor เดียว
 * (รันจริงรอบ 2 ของ T-306: `query_budget_lines` error เสร็จก่อน `search_catalog` → cursor เพี้ยนทั้ง case)
 * จับแบบ FIFO ต่อ (ชื่อ tool, isError); capture ที่ถูกใช้แล้วไม่ถูกใช้ซ้ำ
 */
export interface CaptureLike {
  name: string;
  isError: boolean;
}

export function matchCaptures<TCapture extends CaptureLike>(
  calls: readonly CaptureLike[],
  captures: readonly TCapture[],
): (TCapture | undefined)[] {
  const unused = [...captures];
  return calls.map((call) => {
    const index = unused.findIndex((c) => c.name === call.name && c.isError === call.isError);
    return index >= 0 ? unused.splice(index, 1)[0] : undefined;
  });
}
