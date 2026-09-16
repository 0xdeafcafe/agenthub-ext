import {execFileSync} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:https';
import {join} from 'node:path';

// Playwright routes intercept only the first URL in a redirect chain. A local
// HTTPS server exercises the worker's real cross-host redirect and permissions.
export async function startGithubFixture(previewUrl, directory) {
  const keyPath = join(directory, 'fixture-key.pem');
  const certPath = join(directory, 'fixture-cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=github.com',
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ],
    {stdio: 'ignore'},
  );
  const key = await readFile(keyPath);
  const cert = await readFile(certPath);
  const spki = createHash('sha256')
    .update(new X509Certificate(cert).publicKey.export({type: 'spki', format: 'der'}))
    .digest('base64');
  const metrics = {patchDownloads: 0};
  const server = createServer({key, cert}, (request, response) => {
    void (async () => {
      const url = new URL(request.url, `https://${request.headers.host}`);
      if (!['github.com', 'patch-diff.githubusercontent.com'].includes(url.hostname)) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      if (url.hostname === 'github.com' && url.pathname.endsWith('.diff')) {
        response
          .writeHead(302, {
            location: 'https://patch-diff.githubusercontent.com/raw/acme/review-kit/pull/42.diff',
          })
          .end();
        return;
      }
      if (url.hostname === 'patch-diff.githubusercontent.com') {
        if (url.pathname !== '/raw/acme/review-kit/pull/42.diff') {
          response.writeHead(404).end();
          return;
        }
        metrics.patchDownloads++;
        url.pathname = '/acme/review-kit/pull/42.diff';
      }
      if (url.pathname === '/__events') {
        response.writeHead(200, {'Content-Type': 'text/event-stream'}).end(': fixture\n\n');
        return;
      }
      const fixture = await fetch(`${previewUrl}${url.pathname}${url.search}`);
      response.writeHead(fixture.status, {
        'Content-Type': fixture.headers.get('content-type') ?? 'text/plain',
      });
      response.end(Buffer.from(await fixture.arrayBuffer()));
    })().catch((error) => response.destroy(error));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const destination = `127.0.0.1:${server.address().port}`;
  return {
    metrics,
    args: [
      '--no-proxy-server',
      `--host-resolver-rules=MAP github.com ${destination}, MAP patch-diff.githubusercontent.com ${destination}, MAP * ~NOTFOUND`,
      `--ignore-certificate-errors-spki-list=${spki}`,
    ],
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
