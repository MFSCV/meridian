import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createFeeds } from './feeds.mjs';
import { paperChecks } from './paper.mjs';
import { createBinance, binanceActions } from './binance.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']],
  ['/market-engine.wasm', ['market-engine.wasm', 'application/wasm']],
  ...['app', 'broker', 'chart', 'i18n', 'indicators', 'live', 'market', 'market-engine', 'observed', 'script'].map(name => ['/' + name + '.mjs', [name + '.mjs', 'text/javascript']])
]);
// The port is 4173 unless a --port=N argument, MERIDIAN_PORT or PORT says otherwise. The server only ever listens on loopback.
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? process.env.MERIDIAN_PORT ?? process.env.PORT) || 4173;
const hosts = ['127.0.0.1:' + port, 'localhost:' + port];

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new RangeError('Request too large');
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Expected an object');
  return parsed;
}

// Builds the request handler. Tests pass their own feeds, paper checks and Binance adapter.
export function createHandler({ feeds = createFeeds({ userAgent: process.env.MERIDIAN_SEC_USER_AGENT }), checkPaper = paperChecks(), binance = createBinance() } = {}) {
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  // Account routes answer only to this page: same host, same origin, and never a cross-site request.
  const own = req => req.headers['sec-fetch-site'] !== 'cross-site' && req.headers['sec-fetch-site'] !== 'same-site' &&
    (!req.headers.origin || hosts.some(host => req.headers.origin === 'http://' + host));

  return async (req, res) => {
    const route = req.url;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!hosts.includes(req.headers.host)) return res.writeHead(403).end();
    if (route.startsWith('/api/binance')) {
      if (!own(req)) return res.writeHead(403).end();
      try {
        if (req.method === 'GET' && route === '/api/binance') return json(res, 200, await binance.status());
        if (req.method === 'GET' && route === '/api/binance/account') return json(res, 200, await binance.snapshot());
        const action = binanceActions[route.slice('/api/binance/'.length)];
        if (req.method !== 'POST' || !action) return res.writeHead(req.method === 'POST' ? 404 : 405, { Allow: 'GET, POST' }).end();
        if (!/^application\/json\b/.test(req.headers['content-type'] ?? '') || !req.headers.origin) return res.writeHead(415).end();
        let input;
        try {
          input = await body(req);
        } catch {
          return json(res, 400, { error: 'The request could not be read.' });
        }
        return json(res, 200, await binance[action](input));
      } catch (problem) {
        return json(res, Number.isInteger(problem?.status) ? problem.status : 500, { error: Number.isInteger(problem?.status) ? problem.message : 'Meridian could not complete the request.', code: problem?.code });
      }
    }
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' }).end();
    } else if (route === '/api/ecb' || route === '/api/edgar') {
      json(res, 200, await feeds(route.slice(5)));
    } else if (route === '/api/paper/alpaca' || route === '/api/paper/ibkr') {
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.writeHead(403).end();
      json(res, 200, await checkPaper(route.slice('/api/paper/'.length)));
    } else if (files.has(route) || /^\/locales\/[A-Za-z]+(-[A-Za-z]+)*\.mjs$/.test(route)) {
      const [file, type] = files.get(route) ?? [route.slice(1), 'text/javascript'];
      try {
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type === 'application/wasm' ? type : type + '; charset=utf-8', 'Cache-Control': 'no-cache' }).end(content);
      } catch {
        res.writeHead(files.has(route) ? 500 : 404).end();
      }
    } else {
      res.writeHead(404).end();
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  createServer(createHandler()).listen(port, '127.0.0.1', () => process.stdout.write('Meridian: http://127.0.0.1:' + port + '/\n'));
}
