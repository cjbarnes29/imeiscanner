// Isolated local API audit. Uses only a new temp data folder; never starts OCR or reads the user's scanner data.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
const folder = await mkdtemp(join(tmpdir(), 'imei-api-audit-'));
const key = 'synthetic-audit-access-key-only';
const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(port), IMEI_HOST: '127.0.0.1', IMEI_DATA_DIR: folder, IMEI_ACCESS_KEY: key }, stdio: ['ignore','pipe','pipe'] });
let output = ''; proc.stdout.on('data', d => output += d); proc.stderr.on('data', d => output += d);
const base = `http://127.0.0.1:${port}`;
const call = (path, options = {}) => fetch(base + path, { ...options, headers: { authorization: `Bearer ${key}`, ...options.headers }, signal: AbortSignal.timeout(10000) });
try {
  for (let n = 0; n < 100; n++) { if (await fetch(base+'/api/health').then(r => r.ok, () => false)) break; if (proc.exitCode !== null) throw new Error(output); await new Promise(r => setTimeout(r, 100)); }
  assert.equal((await fetch(base+'/api/health')).status, 200);
  for (const path of ['/api/jobs', '/api/jobs/00000000-0000-0000-0000-000000000000/records']) assert.equal((await fetch(base+path)).status, 401);
  assert.equal((await call('/api/jobs', { method:'OPTIONS', headers:{ origin:'https://untrusted.invalid' } })).status, 403);
  const cors = await call('/api/jobs', { method:'OPTIONS', headers:{ origin:'https://cjbarnes29.github.io' } });
  assert.equal(cors.status, 204); assert.equal(cors.headers.get('access-control-allow-origin'), 'https://cjbarnes29.github.io');
  assert.equal((await call('/api/jobs', { method:'POST', body:'{"count":0}' })).status, 400);
  const malformed = await call('/api/jobs', { method:'POST', body:'not-json' });
  const nullInput = await call('/api/jobs', { method:'POST', body:'null' });
  // Capture all failures before asserting, so concurrent upload issues are checked in the same run.
  const created = await call('/api/jobs', { method:'POST', body:JSON.stringify({count:6,personId:'audit-person'}) });
  assert.equal(created.status, 201); const id = (await created.json()).job.id;
  assert.equal((await call(`/api/jobs/${id}/start`, {method:'POST'})).status, 400);
  assert.equal((await call(`/api/jobs/${id}/photos/0`, { method:'PUT', headers:{'content-type':'text/plain'}, body:'synthetic' })).status, 415);
  const uploads = await Promise.all(Array.from({length:6}, (_,i) => call(`/api/jobs/${id}/photos/${i}`, { method:'PUT', headers:{'content-type':'image/jpeg','x-file-name':`E2E-audit-${i}.jpg`}, body:Buffer.from('synthetic image fixture') })));
  if (!uploads.every(r => r.status === 200)) console.log('Upload failures:', uploads.map(r=>r.status), output);
  assert.ok(uploads.every(r => r.status === 200));
  const job = (await (await call(`/api/jobs/${id}`)).json()).job;
  console.log(JSON.stringify({malformed:malformed.status,nullInput:nullInput.status,concurrentUploads:job.uploaded}));
  assert.equal((await call(`/api/jobs/${id}/stop`, { method:'POST' })).status, 200);
  assert.equal((await call(`/api/jobs/${id}/start`, { method:'POST' })).status, 400);
  assert.equal((await call(`/api/jobs/${id}/photos/0`, { method:'PUT', headers:{'content-type':'image/jpeg'}, body:'synthetic' })).status, 400);
  assert.equal((await call(`/api/jobs/${id}/stop`, { method:'POST' })).status, 409);
  assert.equal((await call(`/api/jobs/${id}/images/00000000-0000-0000-0000-000000000000.jpg`)).status, 404);
  assert.equal((await call('/api/jobs/not-a-job')).status, 404);
  assert.equal((await call('/%2e%2e/package.json')).status, 404);
  assert.equal(malformed.status, 400, 'malformed JSON is a client error');
  assert.equal(nullInput.status, 400, 'null input is a client error');
  assert.equal(job.uploaded, 6, 'concurrent photo uploads must all remain in the manifest');
  console.log('PASS: API authorization, CORS, input errors, concurrent uploads, stop state, missing images and path boundaries');
} finally {
  proc.kill();
}
