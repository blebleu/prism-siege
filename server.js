import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = process.cwd();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const port = Number(process.env.PORT || 3010);
// Local development listens everywhere (so a phone on the same Wi-Fi can connect); the VPS sets HOST=127.0.0.1
// so only the reverse proxy in front of it can reach the game.
const host = process.env.HOST || '0.0.0.0';

// Browser safety rules sent with every response. Only this site's own scripts, styles and images load (the game
// sets element styles from script, which the policy allows), and the page can't be embedded in another site.
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

// Only the game itself is served; the repo's other files (.git, tools, tests, deploy) never are.
const PUBLIC_FILES = new Set(['/index.html', '/game.css']);
const PUBLIC_FOLDERS = ['/src/', '/assets/'];
const isPublic = pathname => !pathname.split('/').some(part => part.startsWith('.'))
  && (PUBLIC_FILES.has(pathname) || PUBLIC_FOLDERS.some(folder => pathname.startsWith(folder)));

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/healthz') {
      response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('ok');
      return;
    }
    const wanted = pathname === '/' ? '/index.html' : pathname;
    const path = resolve(root, `.${wanted}`);
    if (!isPublic(wanted) || (path !== root && !path.startsWith(root + sep))) {
      response.writeHead(404, SECURITY_HEADERS).end('Not found');
      return;
    }
    const file = await stat(path);
    if (!file.isFile()) throw new Error('Not a file');
    const type = types[extname(path)] || 'application/octet-stream';
    // no-cache: the browser revalidates every file on load, so edits never mix stale and fresh files.
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type.startsWith('image/') || type.startsWith('font/') ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    response.end(await readFile(path));
  } catch {
    response.writeHead(404, SECURITY_HEADERS).end('Not found');
  }
});

server.listen(port, host, () => console.log(`Prism Siege: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
