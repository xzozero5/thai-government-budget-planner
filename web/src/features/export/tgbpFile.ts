/**
 * T-403 — schema + serialize/parse ของไฟล์ `.tgbp.json` (05 §1 F5 US-5.2, 09 §1/§8)
 *
 * T-307 §9 ข้อ 8 (บังคับ): "serializer แบบ whitelist (ประกอบ object ใหม่ทีละฟิลด์ ห้าม spread ทั้ง
 * store), ตัด raw request/headers/ToolLog ส่วนที่ไม่จำเป็น + test ที่ assert ว่าไฟล์ที่ save ไม่มี
 * sk-ant- / x-api-key / authorization" — `serializeSession` ด้านล่างจึงประกอบ object ใหม่ทีละ field
 * จาก input ที่ผู้เรียกส่งมาตรง ๆ (ไม่รับ/ไม่ spread ทั้ง Zustand store state) และรับเฉพาะข้อมูลที่ไม่มี
 * key/client อยู่ในรูปแบบเลย (`ChatMessage`/`ProposalVersion` ของ `stores/*` ไม่มี field ใดอ้างถึง
 * Anthropic client — ดู `stores/chatStore.ts`/`stores/proposalStore.ts`)
 *
 * ToolLog snapshot: `ai/toolLog.ts` (T-302/T-303/T-307) **ยังไม่มีเมธอด export/serialize ใด ๆ**
 * (ตรวจแล้ว — มีแต่ `record*`/`has*`/`get*`/`reset()`) ตามที่ T-403 brief สั่งไว้ ("ถ้า ToolLog มีวิธี
 * export; ถ้าไม่มีให้ข้าม + แจ้ง") จึง **ข้าม** `toolLogSnapshot` ในไฟล์นี้ทั้งหมด — citation ที่ฝังอยู่ใน
 * `proposal.boq[].citations[]`/`proposal.comparables[]` ของแต่ละเวอร์ชันยังอยู่ครบ (พอสำหรับ
 * "Load กลับมาแสดงได้โดยไม่ต้องใส่ key" ของ US-5.2) เพียงแต่การกดปุ่ม "ให้ AI ทบทวน" ต่อจากไฟล์ที่โหลด
 * กลับมาจะเริ่ม ToolLog ใหม่เปล่า (เหมือนเริ่ม session ใหม่ที่มี proposal เดิมเป็นบริบท) — เป็น
 * ข้อจำกัดที่ทราบและแจ้งไว้ตรงนี้ ไม่ใช่ช่องโหว่ความปลอดภัย
 */
import { z } from 'zod';
import { ProposalSchema, type Proposal } from '@/ai/tools/proposal';
import type { ChatMessage, ToolActivity } from '@/stores/chatStore';
import type { ProposalVersion } from '@/stores/proposalStore';

export const TGBP_FILE_FORMAT = 'tgbp';
export const TGBP_FILE_VERSION = 1;

/** 09 §1: "ขนาด ≤ 5 MB" */
export const TGBP_FILE_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Schema — `.strict()` ที่ระดับบนสุดเพื่อปฏิเสธ field แปลกปลอมทั้งไฟล์อย่างชัดเจน (เช่น ใครแก้ไฟล์ใส่
// `apiKey`/`headers` เข้ามาเอง) ระดับย่อยยังคง strip unknown key ตามพฤติกรรม default ของ zod object()
// (ปลอดภัยเท่ากันในทางปฏิบัติ — ไม่มี field แปลกปลอมหลงเหลือหลัง parse ไม่ว่าระดับไหน)
// ---------------------------------------------------------------------------

const ToolActivityStatusSchema = z.enum(['running', 'done', 'error']);

const ToolActivitySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ToolActivityStatusSchema,
  inputSummary: z.string().optional(),
});

const ChatRoleSchema = z.enum(['user', 'assistant']);
const ChatMessageStatusSchema = z.enum(['streaming', 'done', 'error', 'cancelled']);

const ChatMessageSchema = z.object({
  id: z.string(),
  role: ChatRoleSchema,
  text: z.string(),
  status: ChatMessageStatusSchema,
  toolActivities: z.array(ToolActivitySchema),
  warnings: z.array(z.string()),
});

const ProposalVersionSourceSchema = z.enum(['ai', 'user_edit']);

const ProposalVersionFileSchema = z.object({
  id: z.string(),
  proposal: ProposalSchema,
  warnings: z.array(z.string()),
  createdAt: z.number(),
  source: ProposalVersionSourceSchema,
  userEditedLineIds: z.array(z.string()),
});

export const TgbpFileSchema = z
  .object({
    format: z.literal(TGBP_FILE_FORMAT),
    version: z.literal(TGBP_FILE_VERSION),
    /** ISO 8601 (UTC) — `new Date().toISOString()` */
    savedAt: z.string(),
    /** `data.dataVersion()` ของ `@/data` ตอนที่ save (เพื่อเตือนผู้ใช้ถ้าโหลดไฟล์เก่ากับข้อมูลรุ่นใหม่) */
    app_data_version: z.string(),
    proposalVersions: z.array(ProposalVersionFileSchema),
    currentProposalIndex: z.number().int(),
    /** ข้อความ UI เท่านั้น (ไม่มีประวัติ `Anthropic.MessageParam[]` ที่ใช้เรียก API จริง) */
    chat: z.array(ChatMessageSchema),
  })
  .strict();

export type TgbpFile = z.infer<typeof TgbpFileSchema>;

// ---------------------------------------------------------------------------
// serializeSession — whitelist ทีละ field (T-307 §9 ข้อ 8) — ห้าม spread state ของ store ทั้งก้อน
// ---------------------------------------------------------------------------

export interface SerializeSessionInput {
  proposalVersions: ProposalVersion[];
  currentProposalIndex: number;
  chatMessages: ChatMessage[];
  appDataVersion: string;
  /** override เวลาปัจจุบัน (ทดสอบ deterministic) — default `new Date()` */
  now?: Date;
}

function toolActivityToFile(activity: ToolActivity): z.infer<typeof ToolActivitySchema> {
  return {
    id: activity.id,
    name: activity.name,
    status: activity.status,
    ...(activity.inputSummary !== undefined ? { inputSummary: activity.inputSummary } : {}),
  };
}

function chatMessageToFile(message: ChatMessage): z.infer<typeof ChatMessageSchema> {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    toolActivities: message.toolActivities.map(toolActivityToFile),
    warnings: [...message.warnings],
  };
}

function proposalVersionToFile(version: ProposalVersion): z.infer<typeof ProposalVersionFileSchema> {
  return {
    id: version.id,
    proposal: version.proposal,
    warnings: [...version.warnings],
    createdAt: version.createdAt,
    source: version.source,
    userEditedLineIds: [...version.userEditedLineIds],
  };
}

/** ประกอบไฟล์ `.tgbp.json` เป็นสตริง JSON — object ที่ส่งให้ `JSON.stringify` ถูกสร้างใหม่ทีละ field
 * จาก input ที่รับมาตรง ๆ เท่านั้น (ไม่มีการ spread store state ทั้งก้อนที่ไหนเลยในไฟล์นี้) */
export function serializeSession(input: SerializeSessionInput): string {
  const file: TgbpFile = {
    format: TGBP_FILE_FORMAT,
    version: TGBP_FILE_VERSION,
    savedAt: (input.now ?? new Date()).toISOString(),
    app_data_version: input.appDataVersion,
    proposalVersions: input.proposalVersions.map(proposalVersionToFile),
    currentProposalIndex: input.currentProposalIndex,
    chat: input.chatMessages.map(chatMessageToFile),
  };
  return JSON.stringify(file);
}

// ---------------------------------------------------------------------------
// parseTgbpFile — ตรวจขนาดก่อนแตะ JSON.parse เสมอ (กัน parse ไฟล์ยักษ์ก่อนรู้ว่าเกินเพดาน)
// ---------------------------------------------------------------------------

export type ParseTgbpFileResult = { ok: true; file: TgbpFile } | { ok: false; error: string };

export function parseTgbpFile(text: string): ParseTgbpFileResult {
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > TGBP_FILE_MAX_BYTES) {
    return {
      ok: false,
      error: `ไฟล์มีขนาด ${String(byteLength)} ไบต์ เกินเพดานที่รองรับ (${String(TGBP_FILE_MAX_BYTES)} ไบต์)`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return { ok: false, error: 'ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง' };
  }

  const result = TgbpFileSchema.safeParse(parsedJson);
  if (!result.success) {
    return { ok: false, error: 'โครงสร้างไฟล์ไม่ตรงกับรูปแบบ .tgbp.json ที่รองรับ (format/version ไม่ตรง หรือฟิลด์ไม่ครบ)' };
  }
  return { ok: true, file: result.data };
}

/** เพื่อความสะดวกของผู้เรียก (T-502 UI) — คืน `Proposal` ที่ index ที่ระบุ (หรือ `undefined`) */
export function getProposalAt(file: TgbpFile, index: number): Proposal | undefined {
  return file.proposalVersions[index]?.proposal;
}
