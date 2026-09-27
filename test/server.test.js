import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 39000 + Math.floor(Math.random() * 900);
const base = `http://127.0.0.1:${port}`;
let server;

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('exit', code => reject(new Error(`server exited with ${code}`)));
  });
});
test.after(() => server?.kill());

test('serves the game with its security headers', async () => {
  for (const path of ['/', '/game.css', '/src/main.js', '/assets/icon.svg']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
  assert.equal(await (await fetch(`${base}/healthz`)).text(), 'ok');
});

test('never serves the rest of the repo', async () => {
  for (const path of ['/server.js', '/package.json', '/deploy/update.sh', '/test/server.test.js', '/.git/config', '/src/../server.js', '/%2e%2e/server.js', '/src/.hidden']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});
