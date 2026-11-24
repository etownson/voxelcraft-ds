#!/usr/bin/env node
/*
 * Static dev server for the game.
 *
 * It serves the repo root as plain static files, every one with
 * `Cache-Control: no-store`. `python3 -m http.server` lets the browser cache,
 * so a reload after an edit or a rebaseline can quietly run stale modules.
 * It also answers /health with a 200, for anything that wants to check the
 * server is up.
 *
 * Usage: node tools/dev-server.mjs [port]   (default 8000)
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] || 8000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    send(res, 200, 'ok');
    return;
  }

  // Resolve inside ROOT only; normalise away ../ and collapse // (the
  // trailing-slash mistake that hit the old server).
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!rel) rel = 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT + sep) && file !== ROOT) {
    send(res, 403, 'forbidden');
    return;
  }

  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      const nested = join(file, 'index.html');
      info = await stat(nested);
      return stream(nested, info);
    }
    stream(file, info);
  } catch {
    send(res, 404, 'not found');
  }

  function stream(path, info) {
    res.writeHead(200, {
      'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size
    });
    createReadStream(path).pipe(res);
  }
});

server.listen(PORT, () => {
  console.log(`VoxelVerse dev server on http://localhost:${PORT} (root ${ROOT})`);
});
