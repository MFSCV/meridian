import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createFeeds } from './feeds.mjs';
import { paperChecks } from './paper.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']],
  ...['app', 'chart', 'i18n', 'indicators', 'live', 'market', 'observed', 'script'].map(name => ['/' + name + '.mjs', [name + '.mjs', 'text/javascript']])
]);
const feeds = createFeeds({ userAgent: process.env.MERIDIAN_SEC_USER_AGENT });
const checkPaper = paperChecks();
createServer(async (req, res) => {
  const route = req.url;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['127.0.0.1:4173', 'localhost:4173'].includes(req.headers.host)) {
    res.writeHead(403).end();
  } else if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' }).end();
  } else if (route === '/api/ecb' || route === '/api/edgar') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(await feeds(route.slice(5))));
  } else if (route === '/api/paper/alpaca' || route === '/api/paper/ibkr') {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.writeHead(403).end();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(await checkPaper(route.slice('/api/paper/'.length))));
  } else if (files.has(route) || /^\/locales\/[A-Za-z]+(-[A-Za-z]+)*\.mjs$/.test(route)) {
    const [file, type] = files.get(route) ?? [route.slice(1), 'text/javascript'];
    try {
      const body = await readFile(new URL(file, import.meta.url));
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(files.has(route) ? 500 : 404).end();
    }
  } else {
    res.writeHead(404).end();
  }
}).listen(4173, '127.0.0.1', () => process.stdout.write('Meridian: http://127.0.0.1:4173/\n'));
