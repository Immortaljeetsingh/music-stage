'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.flac', 'audio/flac'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp']
]);

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:* blob:",
  "img-src 'self' data: blob:",
  "media-src 'self' https: blob:",
  "worker-src 'self' blob:"
].join('; ');

function requestPath(rawUrl) {
  try {
    return decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname).replaceAll('\\', '/');
  } catch {
    return null;
  }
}

function allowedRelativePath(pathname) {
  if (pathname === '/') return 'index.html';
  if (['/index.html', '/stems.html', '/LICENSE', '/README.md'].includes(pathname)) {
    return pathname.slice(1);
  }
  if (/^\/assets\/[a-z0-9/_-]+\.(?:css|js|svg|png|webp|ico)$/i.test(pathname)) {
    return pathname.slice(1);
  }
  if (pathname === '/demos/manifest.json') return 'demos/manifest.json';
  if (/^\/demos\/\d+\/(?:mix|vocals|drums|bass|other)\.flac$/i.test(pathname)) {
    return pathname.slice(1);
  }
  return null;
}

function resolveRequest(rawUrl) {
  const pathname = requestPath(rawUrl);
  const relative = pathname && allowedRelativePath(pathname);
  if (!relative) return null;
  const filePath = path.resolve(ROOT, relative);
  return filePath.startsWith(`${ROOT}${path.sep}`) ? filePath : null;
}

function securityHeaders(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const immutable = ext === '.flac';
  return {
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Security-Policy': CSP,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'accelerometer=(self), camera=(), geolocation=(), gyroscope=(self), magnetometer=(self), microphone=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    return null;
  }
  return {start, end: Math.min(end, size - 1)};
}

function sendError(response, statusCode, message) {
  const body = `${message}\n`;
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function createServer() {
  return http.createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method || '')) {
      response.setHeader('Allow', 'GET, HEAD');
      sendError(response, 405, 'Method not allowed');
      return;
    }

    const filePath = resolveRequest(request.url || '/');
    if (!filePath) {
      sendError(response, 404, 'Not found');
      return;
    }

    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        sendError(response, 404, 'Not found');
        return;
      }

      const headers = {
        ...securityHeaders(filePath),
        'Accept-Ranges': 'bytes',
        'Content-Type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream'
      };
      const requestedRange = request.headers.range;
      const range = requestedRange ? parseRange(requestedRange, stat.size) : null;
      if (requestedRange && !range) {
        response.writeHead(416, {...headers, 'Content-Range': `bytes */${stat.size}`});
        response.end();
        return;
      }

      const statusCode = range ? 206 : 200;
      const start = range?.start ?? 0;
      const end = range?.end ?? stat.size - 1;
      headers['Content-Length'] = Math.max(0, end - start + 1);
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      response.writeHead(statusCode, headers);
      if (request.method === 'HEAD' || stat.size === 0) {
        response.end();
        return;
      }

      const stream = fs.createReadStream(filePath, {start, end});
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    });
  });
}

function startServer() {
  const host = process.env.HOST || '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host) && process.env.ALLOW_REMOTE !== '1') {
    throw new Error('Refusing to bind outside loopback. Set ALLOW_REMOTE=1 only if you intend to expose local files.');
  }
  const rawPort = process.env.PORT || process.argv[2] || '8000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${rawPort}`);
  const server = createServer();
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Music Stage: http://${host}:${actualPort}`);
    console.log('Serving only allowlisted application assets. Press Ctrl+C to stop.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
  return server;
}

if (require.main === module) startServer();

module.exports = {allowedRelativePath, createServer, parseRange, resolveRequest, startServer};
