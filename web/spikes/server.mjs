// Static server สำหรับ spike: serve dist/ ที่ / และ web/public/data ที่ /data
// รองรับ HTTP Range (เลียนแบบ static host) + log bytes ที่ serve จริง
// ใช้แทน `vite preview` เพราะต้อง mount โฟลเดอร์ data ที่อยู่นอก root และคุม header เอง
import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(dir, 'dist');
const DATA = join(dir, '..', 'public', 'data');
const PORT = Number(process.env.PORT ?? 5199);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.parquet': 'application/octet-stream',
  '.gz': 'application/gzip',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const served = { requests: 0, bytes: 0 };
const reqLog = [];
let noteMethod = null;
let noteRange = null;
const note = (url, status, bytes, range) => {
  if (reqLog.length < 5000)
    reqLog.push({ url, method: noteMethod, reqRange: noteRange, status, bytes, range: range ?? null });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/__stats') {
    // ground truth ของ "จำนวน request + bytes ที่ serve จริง" (ฝั่ง server)
    const snapshot = { ...served, log: url.searchParams.get('log') === '1' ? [...reqLog] : undefined };
    if (url.searchParams.get('reset') === '1') {
      served.requests = 0;
      served.bytes = 0;
      reqLog.length = 0;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(snapshot));
    return;
  }
  noteMethod = req.method;
  noteRange = req.headers.range ?? null;
  let file;
  if (pathname.startsWith('/data/')) {
    file = join(DATA, normalize(pathname.slice('/data/'.length)).replace(/^(\.\.[/\\])+/, ''));
  } else if (pathname.startsWith('/duckdb-ext/')) {
    // สำเนา extension ของ duckdb (self-host เพื่อไม่ให้ browser ยิงไป extensions.duckdb.org — N5)
    file = join(dir, 'vendor', 'duckdb-ext', normalize(pathname.slice('/duckdb-ext/'.length)).replace(/^(\.\.[/\\])+/, ''));
  } else {
    if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';
    file = join(DIST, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const base = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store', // บังคับ cold ทุกครั้ง ยกเว้นเทสต์ warm ที่ใช้ in-process cache ของ duckdb
  };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
      let end = m[1] === '' ? size - 1 : m[2] === '' ? size - 1 : Number(m[2]);
      if (start < 0) start = 0;
      if (end >= size) end = size - 1;
      const len = end - start + 1;
      const isHead = req.method === 'HEAD';
      served.requests += 1;
      served.bytes += isHead ? 0 : len;
      note(pathname, 206, isHead ? 0 : len, isHead ? `HEAD ${start}-${end}` : `${start}-${end}`);
      res.writeHead(206, {
        ...base,
        'content-length': String(len),
        'content-range': `bytes ${start}-${end}/${size}`,
      });
      if (isHead) {
        res.end();
        return;
      }
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }
  served.requests += 1;
  served.bytes += req.method === 'HEAD' ? 0 : size;
  note(pathname, 200, req.method === 'HEAD' ? 0 : size, req.method === 'HEAD' ? 'HEAD' : null);
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...base, 'content-length': String(size) });
    res.end();
    return;
  }
  res.writeHead(200, { ...base, 'content-length': String(size) });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`spike server: http://localhost:${PORT}/  (dist=${DIST}, /data=${DATA})`);
});

process.on('SIGINT', () => {
  console.log('served', served);
  process.exit(0);
});

export { server, served };
