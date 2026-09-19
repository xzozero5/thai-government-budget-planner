import { startServer, launch, ORIGIN, serverStats, sleep, PAGES_BASE } from './lib/harness.mjs';

const step = async (page, label, fn, arg) => {
  await serverStats({ reset: true });
  let res;
  try {
    res = await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 15s')), 15000)),
    ]);
  } catch (e) {
    res = { error: String(e).split('\n')[0].slice(0, 160) };
  }
  await sleep(200);
  const st = await serverStats({ reset: true, log: true });
  console.log(`\n### ${label}`);
  console.log('  client:', JSON.stringify(res));
  console.log('  server:', st.requests, 'req /', st.bytes, 'bytes');
  for (const l of st.log ?? []) console.log('   ', l.method, l.status, 'reqRange=' + l.reqRange, 'bytes=' + l.bytes);
};

await startServer();
const browser = await launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${ORIGIN}/pages/s1-remote/index.html`);

const LOCAL = `${ORIGIN}/data/budget_lines/pbo/2564/20000.parquet`;
const REMOTE = `${PAGES_BASE}/data/budget_lines/pbo/2564/20000.parquet`;

await step(page, 'fetch + Range (local)', async (url) => {
  const f = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  return { status: f.status, len: (await f.arrayBuffer()).byteLength, cr: f.headers.get('content-range') };
}, LOCAL);

await step(page, 'XHR sync GET + Range (main thread, local)', (url) => {
  const x = new XMLHttpRequest();
  x.open('GET', url, false);
  x.setRequestHeader('Range', 'bytes=0-99');
  x.send(null);
  return { status: x.status, cr: x.getResponseHeader('content-range'), len: x.responseText.length };
}, LOCAL);

await step(page, 'XHR sync HEAD + Range (main thread, local)', (url) => {
  const h = new XMLHttpRequest();
  h.open('HEAD', url, false);
  h.setRequestHeader('Range', 'bytes=0-');
  h.send(null);
  return { status: h.status, cl: h.getResponseHeader('content-length'), cr: h.getResponseHeader('content-range') };
}, LOCAL);

await step(page, 'blob worker: XHR sync GET + Range (local)', async (url) => {
  const code = `onmessage=(e)=>{const x=new XMLHttpRequest();x.open('GET',e.data,false);x.setRequestHeader('Range','bytes=0-99');x.responseType='arraybuffer';try{x.send(null);postMessage({status:x.status,cr:x.getResponseHeader('content-range'),len:x.response?x.response.byteLength:-1});}catch(err){postMessage({error:String(err)});}};`;
  const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  const r = await new Promise((res) => {
    const t = setTimeout(() => res({ error: 'worker timeout' }), 8000);
    w.onmessage = (e) => { clearTimeout(t); res(e.data); };
    w.onerror = (e) => { clearTimeout(t); res({ error: 'workererror ' + e.message }); };
    w.postMessage(url);
  });
  w.terminate();
  return r;
}, LOCAL);

await step(page, 'fetch + Range (GitHub Pages)', async (url) => {
  const f = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  return { status: f.status, len: (await f.arrayBuffer()).byteLength, cr: f.headers.get('content-range') };
}, REMOTE);

await browser.close();
process.exit(0);
