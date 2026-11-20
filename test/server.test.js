// SPDX-License-Identifier: GPL-3.0-or-later
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));
let proc;
let base;

before(async () => {
  proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: '0' } });
  base = await new Promise((resolve, reject) => {
    proc.stdout.on('data', (chunk) => {
      const m = String(chunk).match(/port (\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    proc.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => proc.kill('SIGTERM'));

test('health check', async () => {
  const r = await fetch(`${base}/healthz`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok\n');
});

test('serves the app with security headers', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await r.text(), /A Series of Tubes/);
});

test('serves scripts and styles with the right types', async () => {
  for (const [path, type] of [['/app.js', /javascript/], ['/topics.js', /javascript/], ['/app.css', /text\/css/], ['/favicon.svg', /image\/svg/]]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), type, path);
  }
});

test('ETag revalidation returns 304', async () => {
  const first = await fetch(`${base}/app.js`);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const second = await fetch(`${base}/app.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});

test('unknown paths and traversal attempts are 404', async () => {
  for (const path of ['/nope.html', '/../src/server.js', '/%2e%2e/package.json']) {
    const r = await fetch(base + path);
    assert.equal(r.status, 404, path);
  }
});

test('only GET and HEAD are allowed', async () => {
  const r = await fetch(`${base}/`, { method: 'POST' });
  assert.equal(r.status, 405);
  const h = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(h.status, 200);
});
