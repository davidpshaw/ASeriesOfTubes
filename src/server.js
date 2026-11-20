// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal static file server for A Series of Tubes. No dependencies: the whole
// app is in public/, loaded into memory at startup and served with strict
// security headers. The container filesystem can be read-only.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// url path -> { body, type, etag }
const files = new Map();

async function load(dir, prefix = '/') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await load(full, `${prefix}${entry.name}/`);
    } else if (entry.isFile() && TYPES[extname(entry.name)]) {
      const body = await readFile(full);
      const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
      files.set(prefix + entry.name, { body, type: TYPES[extname(entry.name)], etag });
    }
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request\n');
  }
  if (path === '/healthz') return send(res, 200, 'ok\n', { 'Cache-Control': 'no-store' });
  if (path.endsWith('/')) path += 'index.html';

  const file = files.get(path); // only files loaded at startup can be served, so no path traversal
  if (!file) return send(res, 404, 'Not found\n');

  const headers = { 'Content-Type': file.type, ETag: file.etag, 'Cache-Control': 'no-cache' };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ...headers });
    return res.end();
  }
  res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': file.body.length });
  res.end(req.method === 'HEAD' ? undefined : file.body);
}

await load(PUBLIC);
const server = http.createServer(handle);
server.listen(PORT, () => {
  console.log(`A Series of Tubes listening on port ${server.address().port} (${files.size} files)`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
