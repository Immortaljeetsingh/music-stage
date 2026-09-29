'use strict';

const assert = require('node:assert/strict');
const {createServer} = require('./server.cjs');

(async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const {port} = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const index = await fetch(`${base}/index.html`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') || '', /^text\/html/);
    const csp=index.headers.get('content-security-policy') || '';
    assert.match(csp, /object-src 'none'/);
    assert(!/script-src[^;]*unsafe-inline/.test(csp), 'application scripts must not require unsafe-inline');
    const playerAsset=await fetch(`${base}/assets/player.js`);
    assert.equal(playerAsset.status,200);
    assert(!/immutable/.test(playerAsset.headers.get('cache-control')||''),'mutable JS assets must revalidate');

    const manifest = await fetch(`${base}/demos/manifest.json`);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).length, 7);

    const range = await fetch(`${base}/demos/71178/mix.flac`, {headers: {Range: 'bytes=0-31'}});
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 32);
    assert.match(range.headers.get('content-range') || '', /^bytes 0-31\//);

    for (const denied of ['/.git/config', '/test.cjs', '/package.json', '/Aaj%20Ki%20Raat.mp3', '/../.git/config']) {
      assert.equal((await fetch(base + denied)).status, 404, `${denied} must not be served`);
    }
    console.log('PASS: local server serves app/audio ranges and blocks repository/private files.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
