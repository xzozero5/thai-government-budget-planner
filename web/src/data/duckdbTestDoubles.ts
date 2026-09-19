/**
 * Test-only fake ของ `MinimalAsyncDuckDb`/`MinimalDuckDbConnection` (T-203) — จำลอง boundary ของ
 * `@duckdb/duckdb-wasm` โดยไม่ต้องมี browser/worker/wasm จริง (ใช้กับ `duckdb.test.ts`/`repo.test.ts`
 * ผ่าน `__setDuckDbDepsForTests`)
 *
 * ไม่ถูก import จากโค้ดแอปจริง (เฉพาะไฟล์ `*.test.ts` เท่านั้น) — อยู่ใน `src/data/` ตามแบบ
 * `testFixtures.ts` (T-202) เพื่ออยู่ใน tsconfig project เดียวกับโค้ดที่มันทดสอบ
 */
import type {
  DuckDbFactory,
  InstantiationProgressLike,
  MinimalAsyncDuckDb,
  MinimalDuckDbConnection,
  MinimalPreparedStatement,
  QueryResultLike,
  SqlParam,
} from './duckdb';
import type { DuckDBConfig } from '@duckdb/duckdb-wasm';

export interface FakeQueryResponse {
  rows: Record<string, unknown>[];
}

export interface RecordedCall {
  /** SQL ของ `.query(sql)` ตรง ๆ (ใช้ตอน setup: SET/INSTALL/LOAD) หรือของ `.prepare(sql)` */
  sql: string;
  /** parameter ที่ผูกกับ `.prepare(sql).query(...params)` — ว่างสำหรับ `.query(sql)` ตรง ๆ */
  params: SqlParam[];
  /** 'query' = เรียกผ่าน `conn.query(sql)` ตรง ๆ, 'prepared' = ผ่าน `conn.prepare(sql).query(...)` */
  kind: 'query' | 'prepared';
}

function toQueryResult(rows: Record<string, unknown>[]): QueryResultLike {
  return {
    toArray: () => rows.map((row) => ({ toJSON: () => row })),
  };
}

class FakePreparedStatement implements MinimalPreparedStatement {
  constructor(
    private readonly sql: string,
    private readonly conn: FakeDuckDbConnection,
  ) {}

  query(...params: SqlParam[]): Promise<QueryResultLike> {
    this.conn.calls.push({ sql: this.sql, params, kind: 'prepared' });
    return Promise.resolve(toQueryResult(this.conn.nextPreparedResponse().rows));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class FakeDuckDbConnection implements MinimalDuckDbConnection {
  readonly calls: RecordedCall[] = [];
  private responseIndex = 0;

  constructor(private readonly responses: FakeQueryResponse[]) {}

  /** ไว้ตรวจใน test: เฉพาะการเรียกแบบ prepared (คือ query ที่มีค่าจาก filter จริง ๆ) */
  get preparedCalls(): RecordedCall[] {
    return this.calls.filter((c) => c.kind === 'prepared');
  }

  nextPreparedResponse(): FakeQueryResponse {
    const response = this.responses[this.responseIndex] ?? { rows: [] };
    this.responseIndex += 1;
    return response;
  }

  query(sql: string): Promise<QueryResultLike> {
    // ใช้สำหรับ SET/INSTALL/LOAD (setup) เท่านั้นตาม convention ของ duckdb.ts — ไม่ดึงจาก response
    // queue (แยกจาก prepared เพื่อไม่ให้ setup call รบกวนลำดับ response ของ query จริงใน repo.ts)
    this.calls.push({ sql, params: [], kind: 'query' });
    return Promise.resolve(toQueryResult([]));
  }

  prepare(sql: string): Promise<MinimalPreparedStatement> {
    return Promise.resolve(new FakePreparedStatement(sql, this));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class FakeAsyncDuckDb implements MinimalAsyncDuckDb {
  readonly connection: FakeDuckDbConnection;
  readonly registeredBuffers = new Map<string, Uint8Array>();
  readonly droppedFiles: string[] = [];
  openConfig: DuckDBConfig | null = null;
  instantiateCalled = false;

  constructor(responses: FakeQueryResponse[] = []) {
    this.connection = new FakeDuckDbConnection(responses);
  }

  instantiate(
    _mainModuleUrl: string,
    _pthreadWorkerUrl?: string | null,
    onProgress?: (progress: InstantiationProgressLike) => void,
  ): Promise<null> {
    this.instantiateCalled = true;
    onProgress?.({ bytesLoaded: 100, bytesTotal: 100 });
    return Promise.resolve(null);
  }

  open(config: DuckDBConfig): Promise<void> {
    this.openConfig = config;
    return Promise.resolve();
  }

  connect(): Promise<MinimalDuckDbConnection> {
    return Promise.resolve(this.connection);
  }

  terminate(): Promise<void> {
    return Promise.resolve();
  }

  registerFileBuffer(name: string, buffer: Uint8Array): Promise<void> {
    this.registeredBuffers.set(name, buffer);
    return Promise.resolve();
  }

  dropFile(name: string): Promise<null> {
    this.registeredBuffers.delete(name);
    this.droppedFiles.push(name);
    return Promise.resolve(null);
  }
}

/** สร้างชุด fake deps ครบ (ใช้กับ `__setDuckDbDepsForTests`) ผูกกับ `FakeAsyncDuckDb` ตัวเดียวกันเสมอ */
export function createFakeDuckDbDeps(fakeDb: FakeAsyncDuckDb): {
  loadFactory: () => Promise<DuckDbFactory>;
  loadEhWasmUrl: () => Promise<string>;
  loadEhWorkerUrl: () => Promise<string>;
  createWorker: (workerScriptUrl: string) => Worker;
} {
  return {
    loadFactory: () => Promise.resolve({ create: () => fakeDb }),
    loadEhWasmUrl: () => Promise.resolve('fake://duckdb-eh.wasm'),
    loadEhWorkerUrl: () => Promise.resolve('fake://duckdb-browser-eh.worker.js'),
    createWorker: () => ({}) as Worker,
  };
}
