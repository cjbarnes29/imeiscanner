import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { createScanner } from './scan.mjs';

const root = resolve(import.meta.dirname, '..');
const dataRoot = resolve(process.env.IMEI_DATA_DIR || join(root, 'server-data'));
const jobsRoot = join(dataRoot, 'jobs');
const port = Number(process.env.PORT || 8787);
const host = process.env.IMEI_HOST || '127.0.0.1';
const allowedOrigins = new Set(['https://cjbarnes29.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);
let accessKey = '';
let processing = false;

const jobPath = id => join(jobsRoot, id);
const manifestPath = id => join(jobPath(id), 'manifest.json');
const recordsPath = id => join(jobPath(id), 'records.json');
const safeId = value => /^[a-f0-9-]{36}$/.test(value || '');

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function authorized(request) {
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const expected = Buffer.from(accessKey);
  const actual = Buffer.from(provided);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function bodyBuffer(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('File is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function loadJob(id) {
  if (!safeId(id)) return null;
  return readJson(manifestPath(id), null);
}

function publicJob(job) {
  return { id: job.id, status: job.status, count: job.count, uploaded: Object.keys(job.files).length,
    completed: job.completed, resultCount: job.resultCount, failed: job.failed, createdAt: job.createdAt,
    mode: job.mode, error: job.error || '' };
}

async function processQueue() {
  if (processing) return;
  processing = true;
  let scanner;
  try {
    const ids = await readdir(jobsRoot);
    for (const id of ids) {
      const job = await loadJob(id);
      if (!job || !['queued', 'processing'].includes(job.status)) continue;
      try {
        scanner ||= await createScanner();
        job.status = 'processing';
        await atomicJson(manifestPath(id), job);
        let rows = await readJson(recordsPath(id), []);
        job.nextNumber = Math.max(2, ...rows.map(row => row.number || 2)) + 1;
        const seen = new Set(rows.map(row => row.imei).filter(Boolean));
        for (let index = job.completed; index < job.count; index++) {
          if (rows.some(row => row.photoIndex === index)) {
            job.completed = index + 1;
            await atomicJson(manifestPath(id), job);
            continue;
          }
          try {
            const source = join(jobPath(id), 'input', `${index}.bin`);
            const results = await scanner.scan(source, job.files[index].name, job.mode);
            for (const result of results) {
              if (result.imei && seen.has(result.imei)) continue;
              if (result.imei) seen.add(result.imei);
              const imageName = `${result.id}.jpg`;
              await writeFile(join(jobPath(id), 'output', imageName), result.photo);
              delete result.photo;
              rows.push({ ...result, imageName, photoIndex: index, number: job.nextNumber++, personId: job.personId, duplicate: false });
            }
            await atomicJson(recordsPath(id), rows);
          } catch (error) {
            console.error(`Photo ${index + 1} in job ${id} failed:`, error);
            job.failed++;
          }
          job.completed = index + 1;
          job.resultCount = rows.length;
          await atomicJson(manifestPath(id), job);
        }
        job.status = 'completed';
        await atomicJson(manifestPath(id), job);
      } catch (error) {
        console.error(`Job ${id} paused:`, error);
        job.status = 'queued';
        job.error = 'Processing stopped. Restart the laptop scanner to retry.';
        await atomicJson(manifestPath(id), job);
        break;
      }
    }
  } catch (error) {
    console.error('Background scanner error:', error);
  } finally {
    if (scanner) await scanner.close();
    processing = false;
  }
}

const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

async function serveStatic(pathname, response) {
  const path = resolve(root, 'dist', `.${pathname === '/' ? '/index.html' : pathname}`);
  const dist = resolve(root, 'dist');
  if (!path.startsWith(`${dist}${sep}`)) return json(response, 404, { error: 'Not found' });
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return json(response, 404, { error: 'Not found' });
    response.writeHead(200, { 'Content-Type': staticTypes[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(path).pipe(response);
  } catch { json(response, 404, { error: 'Build the app first with npm run build.' }); }
}

async function handle(request, response) {
  const origin = request.headers.origin;
  if (origin && (allowedOrigins.has(origin) || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  if (request.method === 'OPTIONS') { response.writeHead(origin && !response.hasHeader('Access-Control-Allow-Origin') ? 403 : 204); response.end(); return; }
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(pathname, response);
  if (pathname === '/api/health') return json(response, 200, { running: true, background: true });
  if (!authorized(request)) return json(response, 401, { error: 'Enter the laptop scanner access code.' });

  if (pathname === '/api/jobs' && request.method === 'GET') {
    const ids = await readdir(jobsRoot);
    const jobs = (await Promise.all(ids.map(loadJob))).filter(Boolean).map(publicJob)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(response, 200, { jobs });
  }
  if (pathname === '/api/jobs' && request.method === 'POST') {
    const input = JSON.parse((await bodyBuffer(request, 4096)).toString());
    const count = Number(input.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) return json(response, 400, { error: 'Choose between 1 and 500 photos.' });
    const id = randomUUID();
    const job = { id, count, mode: ['fast', 'standard', 'detailed'].includes(input.mode) ? input.mode : 'standard',
      personId: String(input.personId || 'person-1').slice(0, 80), status: 'uploading', files: {},
      completed: 0, resultCount: 0, failed: 0, nextNumber: 3, createdAt: new Date().toISOString() };
    await mkdir(join(jobPath(id), 'input'), { recursive: true });
    await mkdir(join(jobPath(id), 'output'), { recursive: true });
    await atomicJson(manifestPath(id), job);
    await atomicJson(recordsPath(id), []);
    return json(response, 201, { job: publicJob(job) });
  }

  const match = pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(photos|start|records|images)(?:\/([^/]+))?)?$/);
  if (!match) return json(response, 404, { error: 'Not found' });
  const [, id, action, item] = match;
  const job = await loadJob(id);
  if (!job) return json(response, 404, { error: 'Scan job not found.' });
  if (!action && request.method === 'GET') return json(response, 200, { job: publicJob(job) });
  if (action === 'photos' && request.method === 'PUT') {
    const index = Number(item);
    if (job.status !== 'uploading' || !Number.isInteger(index) || index < 0 || index >= job.count) return json(response, 400, { error: 'Invalid photo upload.' });
    if (!/^image\//.test(request.headers['content-type'] || '')) return json(response, 415, { error: 'Choose an image file.' });
    const bytes = await bodyBuffer(request, 25 * 1024 * 1024);
    const name = decodeURIComponent(String(request.headers['x-file-name'] || `photo-${index + 1}.jpg`)).replace(/[\\/\x00-\x1f]/g, '_').slice(0, 180);
    await writeFile(join(jobPath(id), 'input', `${index}.bin`), bytes);
    job.files[index] = { name, size: bytes.length };
    await atomicJson(manifestPath(id), job);
    return json(response, 200, { uploaded: Object.keys(job.files).length });
  }
  if (action === 'start' && request.method === 'POST') {
    if (job.status !== 'uploading' || Object.keys(job.files).length !== job.count) return json(response, 400, { error: 'Finish uploading every photo first.' });
    job.status = 'queued';
    await atomicJson(manifestPath(id), job);
    setImmediate(() => void processQueue());
    return json(response, 202, { job: publicJob(job) });
  }
  if (action === 'records' && request.method === 'GET') return json(response, 200, { records: await readJson(recordsPath(id), []) });
  if (action === 'images' && request.method === 'GET' && /^[a-f0-9-]{36}\.jpg$/.test(item || '')) {
    const rows = await readJson(recordsPath(id), []);
    if (!rows.some(row => row.imageName === item)) return json(response, 404, { error: 'Photo not found.' });
    const path = join(jobPath(id), 'output', item);
    response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    createReadStream(path).pipe(response);
    return;
  }
  json(response, 404, { error: 'Not found' });
}

await mkdir(jobsRoot, { recursive: true });
const keyPath = join(dataRoot, 'access-code.txt');
try { accessKey = (await readFile(keyPath, 'utf8')).trim(); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  accessKey = randomBytes(24).toString('hex');
  await writeFile(keyPath, accessKey, { mode: 0o600 });
}
const server = http.createServer((request, response) => {
  void handle(request, response).catch(error => {
    console.error('Request failed:', error);
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'The laptop scanner could not complete this request.' });
    else response.destroy();
  });
});
server.listen(port, host, () => {
  console.log(`IMEI Lens laptop scanner: http://${host}:${port}`);
  console.log(`Access code file: ${keyPath}`);
  void processQueue();
});
