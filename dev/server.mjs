import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {context} from 'esbuild';
import fixtureFiles from './files.json' with {type: 'json'};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDiff =
  fixtureFiles
    .map((file) => {
      const isCode = /\.[jt]sx?$/.test(file.path);
      const removed = Array.from(
        {length: file.removed},
        (_, i) =>
          `-${isCode && i === 0 ? '// Previous implementation note' : 'const previous = true;'}`,
      );
      const added = Array.from(
        {length: file.added},
        (_, i) =>
          `+${isCode && i < 2 ? (i === 0 ? '// Review context' : '/* A comment-only change */') : 'const next = "https://example.com";'}`,
      );
      return [
        `diff --git a/${file.path} b/${file.path}`,
        'index 1234567..abcdef0 100644',
        `--- a/${file.path}`,
        `+++ b/${file.path}`,
        `@@ -1,${file.removed} +1,${file.added} @@`,
        ...removed,
        ...added,
      ].join('\n');
    })
    .join('\n') + '\n';
const html = (entry = 'preview') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="user-login" content="alex"><title>PR Impact · Local playground</title><link rel="stylesheet" href="/${entry}.css"><script type="application/json">{"headSha":"abc123456789"}</script><script defer src="/${entry}.js"></script></head><body></body></html>`;

export async function startPreview({port = 4173, watch = true} = {}) {
  const clients = new Set();
  let ready = false;
  const build = await context({
    absWorkingDir: root,
    entryPoints: {
      preview: 'dev/preview.ts',
      fixtures: 'dev/fixtures.ts',
      popup: 'entrypoints/popup/main.ts',
    },
    outdir: '.output/preview',
    bundle: true,
    sourcemap: true,
    format: 'iife',
    target: 'es2022',
    alias: {'wxt/browser': resolve(root, 'dev/browser-mock.ts')},
    plugins: [
      {
        name: 'reload',
        setup(build) {
          build.onEnd((result) => {
            if (ready && !result.errors.length)
              for (const client of clients) client.write('data: reload\n\n');
          });
        },
      },
    ],
  });
  await build.rebuild();
  if (watch) await build.watch();
  const handleRequest = async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (url.pathname === '/__events') {
        response.writeHead(200, {'Content-Type': 'text/event-stream', Connection: 'keep-alive'});
        response.write(': connected\n\n');
        clients.add(response);
        request.on('close', () => clients.delete(response));
      } else if (url.pathname === '/') {
        response.writeHead(302, {Location: '/acme/review-kit/pull/42/files'}).end();
      } else if (/^\/(?:preview|fixtures|popup)\.(?:js|css)(?:\.map)?$/.test(url.pathname)) {
        response.setHeader(
          'Content-Type',
          url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        );
        response.end(await readFile(resolve(root, '.output/preview', url.pathname.slice(1))));
      } else if (url.pathname === '/popup.html') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          (await readFile(resolve(root, 'entrypoints/popup/index.html'), 'utf8')).replace(
            '<script type="module" src="./main.ts"></script>',
            '<link rel="stylesheet" href="/popup.css"><script defer src="/popup.js"></script>',
          ),
        );
      } else if (url.pathname === '/fonts/inter.woff2') {
        response.setHeader('Content-Type', 'font/woff2');
        response.end(
          await readFile(
            resolve(root, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'),
          ),
        );
      } else if (url.pathname === '/visual/' || /^\/visual\/[a-z0-9-]+\.png$/.test(url.pathname)) {
        const name = url.pathname === '/visual/' ? 'index.html' : url.pathname.split('/').at(-1);
        response.setHeader(
          'Content-Type',
          name.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8',
        );
        response.end(await readFile(resolve(root, 'e2e/screenshots/visual', name)));
      } else if (url.pathname === '/screenshots/') {
        const names = (await readdir(resolve(root, 'e2e/screenshots/local')).catch(() => []))
          .filter((name) => name.endsWith('.png'))
          .sort();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          `<!doctype html><html lang="en"><title>PR Impact screenshots</title><style>body{font:14px system-ui;background:#10141c;color:#dde5f0;padding:32px}a{color:#8db9ff}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:24px}img{width:100%;border-radius:8px;border:1px solid #303947}</style><h1>PR Impact screenshots</h1><p><a href="/">← Playground</a> · <a href="/visual/">Visual comparisons</a> · Run <code>npm run screenshots</code> to refresh.</p><main>${names.map((name) => `<a href="/screenshots/${encodeURIComponent(name)}"><h3>${name}</h3><img src="/screenshots/${encodeURIComponent(name)}" alt="${name}"></a>`).join('')}</main></html>`,
        );
      } else if (/^\/screenshots\/[a-z0-9-]+\.png$/.test(url.pathname)) {
        response.setHeader('Content-Type', 'image/png');
        response.end(
          await readFile(resolve(root, 'e2e/screenshots/local', url.pathname.split('/').at(-1))),
        );
      } else if (url.pathname === '/acme/review-kit/pull/42.diff') {
        if (request.headers.referer?.includes('scenario=partial')) {
          response.writeHead(503).end('Diff not available');
        } else {
          response.setHeader('Content-Type', 'text/plain');
          response.end(fixtureDiff);
        }
      } else if (url.pathname.includes('/raw/HEAD/')) {
        response.writeHead(404).end('No custom configuration in this fixture');
      } else if (url.pathname === '/acme/review-kit/pulls') {
        response.setHeader('Content-Type', 'text/html');
        const query = (url.searchParams.get('q') ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('"', '&quot;');
        response.end(
          `<meta name="user-login" content="alex"><input name="q" value="${query}"><a href="/acme/review-kit/pulls?q=is%3Aopen">3 Open</a>`,
        );
      } else if (url.pathname === '/acme/review-kit/pull/42') {
        response.setHeader('Content-Type', 'text/html');
        response.end(html(url.searchParams.has('extension') ? 'fixtures' : 'preview'));
      } else if (/^\/acme\/review-kit\/pull\/42\/(?:files|changes)(?:\/.*)?$/.test(url.pathname)) {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html(url.searchParams.has('extension') ? 'fixtures' : 'preview'));
      } else response.writeHead(404).end('Not found');
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => response.destroy(error));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  ready = true;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      ready = false;
      for (const client of clients) client.end();
      await build.dispose();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const preview = await startPreview({port: Number(process.env.PRIX_PORT ?? 4173)});
  console.log(
    `PR Impact playground: ${preview.url}\nSource changes reload automatically. Screenshots: ${preview.url}/screenshots/`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void preview.close().then(
        () => process.exit(),
        (error) => {
          console.error(error);
          process.exit(1);
        },
      );
    });
}
