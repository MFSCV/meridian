import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createBinance } from './binance.mjs';
import { createBroker, futuresPair } from './broker.mjs';
import { createHandler } from './server.mjs';
import { createLive, listSymbols, venueOf } from './live.mjs';
import { loadEngine, engineError, series, instruments } from './market.mjs';

const KEY = 'k'.repeat(32);
const SECRET = 's'.repeat(32);

// A stand-in for Binance futures: records every call and answers from a small table.
function exchange({ hedge = false, positions = [], fail = {} } = {}) {
  const calls = [];
  const request = async (url, options) => {
    const { pathname, searchParams, origin } = new URL(url);
    const params = Object.fromEntries(searchParams);
    calls.push({ method: options.method, path: pathname, params, origin, key: options.headers['X-MBX-APIKEY'], query: searchParams.toString() });
    const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    const id = options.method + ' ' + pathname;
    if (fail[id]) return reply(fail[id].body, fail[id].status);
    switch (id) {
      case 'GET /fapi/v1/time': return reply({ serverTime: 1000000 });
      case 'GET /fapi/v3/account': return reply({ totalWalletBalance: '1000.5', totalMarginBalance: '1010', availableBalance: '900', totalUnrealizedProfit: '9.5', totalMaintMargin: '4' });
      case 'GET /fapi/v1/positionSide/dual': return reply({ dualSidePosition: hedge });
      case 'GET /fapi/v3/positionRisk': return reply(positions.filter(row => !params.symbol || row.symbol === params.symbol));
      case 'GET /fapi/v1/openOrders': return reply([{ orderId: 11, symbol: 'BTCUSDT', side: 'BUY', positionSide: 'BOTH', type: 'LIMIT', origQty: '0.010', executedQty: '0', price: '60000', stopPrice: '0', reduceOnly: false, closePosition: false, time: 5 }]);
      case 'GET /fapi/v1/openAlgoOrders': return reply([
        { algoId: 21, symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH', orderType: 'STOP_MARKET', quantity: '0', triggerPrice: '65000', closePosition: true, reduceOnly: false, createTime: 6 },
        { algoId: 22, symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH', orderType: 'TRAILING_STOP_MARKET', quantity: '0.010', activatePrice: '75000', callbackRate: '1.5', closePosition: false, reduceOnly: true, createTime: 7 }]);
      case 'GET /fapi/v1/symbolConfig': return reply([{ symbol: 'BTCUSDT', marginType: 'CROSSED', leverage: 20 }]);
      case 'GET /fapi/v1/exchangeInfo': return reply({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.10' }, { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001' }, { filterType: 'MARKET_LOT_SIZE', stepSize: '0.001' }] }] });
      case 'POST /fapi/v1/listenKey': return reply({ listenKey: 'listen' });
      case 'POST /fapi/v1/leverage': return reply({ leverage: Number(params.leverage) });
      default: return reply({});
    }
  };
  return { calls, request, sent: (method, path) => calls.filter(call => call.method === method && call.path === path) };
}
const long = { symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmt: '0.010', entryPrice: '70000', breakEvenPrice: '70035.5', markPrice: '71000', liquidationPrice: '66800.4', unRealizedProfit: '10', notional: '710', isolatedMargin: '0', initialMargin: '35.5' };

test('the Binance adapter signs requests, validates input and never exposes credentials', async () => {
  const market = exchange({ positions: [long] });
  const binance = createBinance({ env: {}, request: market.request, Socket: null, now: () => 999000 });
  assert.deepEqual(await binance.status(), { provider: 'binance', status: 'not_configured' });
  await assert.rejects(binance.snapshot(), { status: 409 });
  await assert.rejects(binance.connect({ key: 'short', secret: SECRET }), { status: 400 });
  assert.equal(market.calls.length, 0);

  const status = await binance.connect({ key: ' ' + KEY + ' ', secret: SECRET });
  assert.deepEqual(status, { provider: 'binance', mode: 'live', status: 'connected', hedge: false, streaming: false, revision: 1 });
  assert.ok(!JSON.stringify(status).includes(KEY) && !JSON.stringify(status).includes(SECRET));
  const signed = market.sent('GET', '/fapi/v3/account')[0];
  assert.equal(signed.origin, 'https://fapi.binance.com');
  assert.equal(signed.key, KEY);
  // The clock offset from Binance's server time is applied, and the signature covers the whole query.
  assert.equal(signed.params.timestamp, '1000000');
  const unsigned = signed.query.slice(0, signed.query.indexOf('&signature='));
  assert.equal(signed.params.signature, createHmac('sha256', SECRET).update(unsigned).digest('hex'));
  assert.equal(market.sent('GET', '/fapi/v1/time')[0].params.signature, undefined);

  const view = await binance.snapshot();
  assert.deepEqual(view.account, { wallet: 1000.5, margin: 1010, available: 900, unrealized: 9.5, maintenance: 4 });
  assert.deepEqual(view.positions, [{ symbol: 'BTCUSDT', side: 'BOTH', amount: 0.01, entry: 70000, breakEven: 70035.5, mark: 71000, liquidation: 66800.4,
    unrealized: 10, notional: 710, margin: 35.5, leverage: 20, marginType: 'CROSSED' }]);
  assert.deepEqual(view.orders.map(order => [order.id, order.algo, order.kind, order.price, order.trigger, order.callback ?? null, order.closePosition]),
    [['11', false, 'limit', 60000, null, null, false], ['21', true, 'stop', null, 65000, null, true], ['22', true, 'trailing', null, null, 1.5, false]]);
  assert.ok(!JSON.stringify(view).includes(SECRET));
  const before = market.calls.length;
  await binance.snapshot();
  assert.equal(market.calls.length, before, 'a fresh snapshot is served from the cache');

  // Entry orders: quantity rounded down to the lot step, prices to the tick, exits attached as close-position orders.
  await binance.order({ symbol: 'BTCUSDT', side: 'BUY', kind: 'limit', quantity: '0.0159', price: '60000.07', takeProfit: 75000, stopLoss: '58000.04' });
  const [limit] = market.sent('POST', '/fapi/v1/order');
  assert.deepEqual([limit.params.type, limit.params.quantity, limit.params.price, limit.params.timeInForce, limit.params.reduceOnly], ['LIMIT', '0.015', '60000.1', 'GTC', undefined]);
  const exits = market.sent('POST', '/fapi/v1/algoOrder');
  assert.deepEqual(exits.map(call => [call.params.type, call.params.side, call.params.triggerPrice, call.params.closePosition, call.params.quantity, call.params.algoType]),
    [['TAKE_PROFIT_MARKET', 'SELL', '75000.0', 'true', undefined, 'CONDITIONAL'], ['STOP_MARKET', 'SELL', '58000.0', 'true', undefined, 'CONDITIONAL']]);
  const cached = market.calls.length;
  await binance.snapshot();
  assert.ok(market.calls.length > cached, 'placing an order drops the cached snapshot');

  // Conditional orders go through the algo endpoint, never the plain order endpoint.
  await binance.order({ symbol: 'BTCUSDT', side: 'SELL', kind: 'trailing', quantity: 0.01, callbackRate: '1.5', activatePrice: 75000, reduceOnly: true });
  const trailing = market.sent('POST', '/fapi/v1/algoOrder').at(-1).params;
  assert.deepEqual([trailing.type, trailing.callbackRate, trailing.activatePrice, trailing.quantity, trailing.reduceOnly, trailing.triggerPrice],
    ['TRAILING_STOP_MARKET', '1.5', '75000.0', '0.010', 'true', undefined]);
  await binance.order({ symbol: 'BTCUSDT', side: 'SELL', kind: 'stop', triggerPrice: 69000, closePosition: true });
  const stop = market.sent('POST', '/fapi/v1/algoOrder').at(-1).params;
  assert.deepEqual([stop.type, stop.triggerPrice, stop.closePosition, stop.quantity, stop.workingType], ['STOP_MARKET', '69000.0', 'true', undefined, 'MARK_PRICE']);
  assert.equal(market.sent('POST', '/fapi/v1/order').length, 1);

  for (const bad of [{ symbol: 'btc/usdt', side: 'BUY', kind: 'market', quantity: 1 }, { symbol: 'BTCUSDT', side: 'HOLD', kind: 'market', quantity: 1 },
    { symbol: 'BTCUSDT', side: 'BUY', kind: 'iceberg', quantity: 1 }, { symbol: 'BTCUSDT', side: 'BUY', kind: 'market', quantity: 0.0001 },
    { symbol: 'BTCUSDT', side: 'BUY', kind: 'market', quantity: 'lots' }, { symbol: 'BTCUSDT', side: 'BUY', kind: 'limit', quantity: 1 },
    { symbol: 'BTCUSDT', side: 'SELL', kind: 'trailing', quantity: 1, callbackRate: 30 }, { symbol: 'DOGEUSDT', side: 'BUY', kind: 'market', quantity: 1 }]) {
    await assert.rejects(binance.order(bad), { status: 400 }, JSON.stringify(bad));
  }
  assert.equal(market.sent('POST', '/fapi/v1/order').length, 1);

  // Position management.
  await binance.close({ symbol: 'BTCUSDT' });
  assert.deepEqual(market.sent('POST', '/fapi/v1/order').at(-1).params, { ...market.sent('POST', '/fapi/v1/order').at(-1).params, side: 'SELL', type: 'MARKET', quantity: '0.01', reduceOnly: 'true' });
  await binance.close({ symbol: 'BTCUSDT', fraction: 0.5 });
  assert.equal(market.sent('POST', '/fapi/v1/order').at(-1).params.quantity, '0.005');
  await binance.reverse({ symbol: 'BTCUSDT' });
  const flip = market.sent('POST', '/fapi/v1/order').at(-1).params;
  assert.deepEqual([flip.side, flip.quantity, flip.reduceOnly], ['SELL', '0.020', undefined]);
  await binance.breakEven({ symbol: 'BTCUSDT' });
  const even = market.sent('POST', '/fapi/v1/algoOrder').at(-1).params;
  assert.deepEqual([even.type, even.side, even.triggerPrice, even.closePosition], ['STOP_MARKET', 'SELL', '70035.5', 'true']);
  // The stop it replaces is cancelled only after the new one is accepted.
  assert.deepEqual(market.sent('DELETE', '/fapi/v1/algoOrder').map(call => call.params.algoId), ['21']);
  await assert.rejects(binance.close({ symbol: 'ETHUSDT' }), { status: 409 });

  await binance.cancel({ symbol: 'BTCUSDT', id: '11' });
  assert.equal(market.sent('DELETE', '/fapi/v1/order')[0].params.orderId, '11');
  await binance.cancel({ id: '22', algo: true });
  assert.equal(market.sent('DELETE', '/fapi/v1/algoOrder').at(-1).params.algoId, '22');
  await assert.rejects(binance.cancel({ symbol: 'BTCUSDT', id: '1 OR 1' }), { status: 400 });
  await binance.cancelAll({ symbol: 'BTCUSDT' });
  assert.equal(market.sent('DELETE', '/fapi/v1/allOpenOrders').length + market.sent('DELETE', '/fapi/v1/algoOpenOrders').length, 2);
  assert.deepEqual(await binance.leverage({ symbol: 'BTCUSDT', leverage: '25' }), { leverage: 25 });
  await assert.rejects(binance.leverage({ symbol: 'BTCUSDT', leverage: 500 }), { status: 400 });
  await binance.marginType({ symbol: 'BTCUSDT', marginType: 'ISOLATED' });
  await assert.rejects(binance.marginType({ symbol: 'BTCUSDT', marginType: 'x' }), { status: 400 });

  assert.deepEqual(await binance.disconnect(), { provider: 'binance', status: 'not_configured' });
  await assert.rejects(binance.order({ symbol: 'BTCUSDT', side: 'BUY', kind: 'market', quantity: 1 }), { status: 409 });
});

test('hedge mode, the testnet, refused keys and environment configuration', async () => {
  const short = { ...long, positionSide: 'SHORT', positionAmt: '-0.020', markPrice: '69000', breakEvenPrice: '69960' };
  const market = exchange({ hedge: true, positions: [short] });
  const binance = createBinance({ env: { MERIDIAN_BINANCE_KEY: KEY, MERIDIAN_BINANCE_SECRET: SECRET, MERIDIAN_BINANCE_TESTNET: '1' }, request: market.request, Socket: null });
  const status = await binance.status();
  assert.deepEqual([status.status, status.mode, status.hedge], ['connected', 'testnet', true]);
  assert.ok(market.calls.every(call => call.origin === 'https://demo-fapi.binance.com'));

  await binance.order({ symbol: 'BTCUSDT', side: 'BUY', kind: 'market', quantity: 0.01 });
  assert.deepEqual([market.sent('POST', '/fapi/v1/order')[0].params.positionSide, market.sent('POST', '/fapi/v1/order')[0].params.reduceOnly], ['LONG', undefined]);
  await binance.reverse({ symbol: 'BTCUSDT' });
  assert.deepEqual(market.sent('POST', '/fapi/v1/order').slice(1).map(call => [call.params.side, call.params.positionSide, call.params.quantity]),
    [['BUY', 'SHORT', '0.02'], ['BUY', 'LONG', '0.02']]);
  await binance.breakEven({ symbol: 'BTCUSDT' });
  assert.deepEqual([market.sent('POST', '/fapi/v1/algoOrder')[0].params.side, market.sent('POST', '/fapi/v1/algoOrder')[0].params.positionSide], ['BUY', 'SHORT']);

  // A stop at break-even while the position is still losing would trigger at once, so it is refused before any order.
  const losing = exchange({ positions: [{ ...long, markPrice: '69000' }] });
  const second = createBinance({ env: {}, request: losing.request, Socket: null });
  await second.connect({ key: KEY, secret: SECRET, testnet: true });
  await assert.rejects(second.breakEven({ symbol: 'BTCUSDT' }), { status: 409 });
  assert.equal(losing.sent('POST', '/fapi/v1/algoOrder').length, 0);

  const refused = exchange({ fail: { 'GET /fapi/v3/account': { status: 401, body: { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' } } } });
  const third = createBinance({ env: {}, request: refused.request, Socket: null });
  await assert.rejects(third.connect({ key: KEY, secret: SECRET }), { status: 401, message: /Invalid API-key/ });
  assert.deepEqual(await third.status(), { provider: 'binance', status: 'not_configured' });
  const fourth = createBinance({ env: { MERIDIAN_BINANCE_KEY: KEY, MERIDIAN_BINANCE_SECRET: SECRET }, request: refused.request, Socket: null });
  assert.deepEqual([(await fourth.status()).status, (await fourth.status()).mode], ['authorization_required', 'live']);
  const down = createBinance({ env: { MERIDIAN_BINANCE_KEY: KEY, MERIDIAN_BINANCE_SECRET: SECRET }, request: async () => { throw new Error('offline'); }, Socket: null });
  assert.equal((await down.status()).status, 'unavailable');

  // An exit that Binance refuses is reported with the entry order already placed.
  const partial = exchange({ fail: { 'POST /fapi/v1/algoOrder': { status: 400, body: { code: -2021, msg: 'Order would immediately trigger.' } } } });
  const fifth = createBinance({ env: {}, request: partial.request, Socket: null });
  await fifth.connect({ key: KEY, secret: SECRET });
  await assert.rejects(fifth.order({ symbol: 'BTCUSDT', side: 'BUY', kind: 'market', quantity: 0.01, stopLoss: 99999 }), { message: /order was placed, but its stop loss was refused: Order would immediately trigger/ });
});

test('account routes answer only to the local page', async () => {
  const seen = [];
  const binance = {
    status: async () => ({ provider: 'binance', status: 'connected', mode: 'testnet' }), snapshot: async () => ({ positions: [] }),
    order: async input => { seen.push(input); return { placed: 1 }; },
    close: async () => { throw Object.assign(new Error('There is no open BTCUSDT position.'), { status: 409 }); },
    cancel: async () => { throw new Error('secret internal detail'); }
  };
  const handler = createHandler({ feeds: async () => ({}), checkPaper: async () => ({}), binance });
  const call = async (method, url, { headers = {}, body } = {}) => {
    const req = (async function* () { if (body !== undefined) yield Buffer.from(body); })();
    Object.assign(req, { method, url, headers: { host: '127.0.0.1:4173', ...headers } });
    const result = { status: 200, body: '' };
    await handler(req, {
      setHeader() {},
      writeHead(status) { result.status = status; return this; },
      end(text) { result.body = String(text ?? ''); }
    });
    return result;
  };
  const page = { origin: 'http://127.0.0.1:4173', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
  assert.deepEqual(JSON.parse((await call('GET', '/api/binance')).body), { provider: 'binance', status: 'connected', mode: 'testnet' });
  assert.equal((await call('GET', '/api/binance/account')).status, 200);
  assert.equal((await call('GET', '/api/binance', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await call('GET', '/api/binance/account', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);

  const order = JSON.stringify({ symbol: 'BTCUSDT', side: 'BUY', kind: 'market', quantity: 1 });
  assert.equal((await call('POST', '/api/binance/order', { headers: page, body: order })).status, 200);
  assert.deepEqual(seen, [JSON.parse(order)]);
  // Another site cannot place an order: wrong origin, missing origin, a form post, or a cross-site fetch.
  for (const headers of [{ ...page, origin: 'https://evil.example' }, { ...page, origin: undefined }, { ...page, 'content-type': 'text/plain' },
    { ...page, 'content-type': 'application/x-www-form-urlencoded' }, { ...page, 'sec-fetch-site': 'cross-site' }, { ...page, 'sec-fetch-site': 'same-site' }]) {
    assert.ok([403, 415].includes((await call('POST', '/api/binance/order', { headers, body: order })).status), JSON.stringify(headers));
  }
  assert.equal(seen.length, 1);
  assert.equal((await call('POST', '/api/binance/order', { headers: page, body: '[1]' })).status, 400);
  assert.equal((await call('POST', '/api/binance/order', { headers: page, body: 'x'.repeat(5000) })).status, 400);
  assert.equal((await call('POST', '/api/binance/withdraw', { headers: page, body: '{}' })).status, 404);
  assert.equal((await call('DELETE', '/api/binance/order', { headers: page })).status, 405);
  const refused = await call('POST', '/api/binance/close', { headers: page, body: '{}' });
  assert.deepEqual([refused.status, JSON.parse(refused.body).error], [409, 'There is no open BTCUSDT position.']);
  const broken = await call('POST', '/api/binance/cancel', { headers: page, body: '{}' });
  assert.equal(broken.status, 500);
  assert.ok(!broken.body.includes('secret internal detail'));
  assert.equal((await call('POST', '/api/ecb', { headers: page, body: '{}' })).status, 405);
});

test('the browser client follows the connection and keeps no credentials', async () => {
  const requests = [];
  let connected = false;
  let at = 1;
  const request = async (url, options = {}) => {
    requests.push([options.method ?? 'GET', url, options.body]);
    const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
    if (url === './api/binance') return reply(connected ? { provider: 'binance', status: 'connected', mode: 'live' } : { provider: 'binance', status: 'not_configured' });
    if (url === './api/binance/connect') { connected = true; return reply({ provider: 'binance', status: 'connected', mode: 'live', hedge: false }); }
    if (url === './api/binance/account') return connected ? reply({ at, mode: 'live', hedge: false, revision: 1, account: { wallet: 5 }, positions: [{ symbol: 'BTCUSDT', amount: 1 }], orders: [] }) : reply({ error: 'Binance is not connected.' }, 409);
    if (url === './api/binance/close') return reply({ error: 'There is no open BTCUSDT position.' }, 409);
    if (url === './api/binance/disconnect') { connected = false; return reply({ provider: 'binance', status: 'not_configured' }); }
    return reply({ placed: 1 });
  };
  let changes = 0;
  const timers = [];
  const broker = createBroker({ request, onChange: () => { changes += 1; }, repeat: run => { timers.push(run); return timers.length; }, stop: () => { timers.length = 0; } });
  assert.equal(await broker.check(), 'not_configured');
  assert.equal(timers.length, 0);
  await broker.connect('key', 'secret', false);
  assert.deepEqual([broker.state.status, broker.state.mode, broker.state.positions.length, timers.length], ['connected', 'live', 1, 1]);
  assert.ok(!JSON.stringify(broker.state).includes('secret'));
  const seen = changes;
  await timers[0]();
  assert.equal(changes, seen, 'an unchanged account does not redraw');
  at = 2;
  await timers[0]();
  assert.equal(changes, seen + 1);
  await broker.act('order', { symbol: 'BTCUSDT' });
  assert.deepEqual(requests.at(-2).slice(0, 2), ['POST', './api/binance/order']);
  await assert.rejects(broker.act('close', {}), /no open BTCUSDT position/);
  await broker.disconnect();
  assert.deepEqual([broker.state.status, broker.state.positions, timers.length], ['not_configured', [], 0]);

  // A static copy of Meridian has no server behind it.
  const hosted = createBroker({ request: async () => ({ ok: false, status: 404, json: async () => { throw new Error('html'); } }) });
  assert.equal(await hosted.check(), 'no_server');
  const offline = createBroker({ request: async () => { throw new Error('refused'); } });
  assert.equal(await offline.check(), 'no_server');
  assert.deepEqual([futuresPair('BTCUSDT.P'), futuresPair('BTCUSDT'), futuresPair(null)], ['BTCUSDT', null, null]);
});

test('futures symbols use the futures venue, streams reconnect and every pair can be listed', async () => {
  assert.deepEqual([venueOf('BTCUSDT.P').kind, venueOf('BTCUSDT.P').pair, venueOf('BTCUSDT').kind], ['futures', 'BTCUSDT', 'spot']);
  const requests = [];
  const sockets = [];
  const waits = [];
  class Socket {
    constructor(url) { this.url = url; sockets.push(this); }
    close() { this.onclose?.(); }
  }
  const row = (time, close) => [time, String(close), String(close + 1), String(close - 1), String(close), '5'];
  const live = createLive({ request: async url => { requests.push(url); return { ok: true, json: async () => [row(0, 100), row(3600000, 101)] }; }, Socket, wait: run => waits.push(run) });
  live.get('BTCUSDT.P', 60);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0], 'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=1000');
  assert.deepEqual(live.peek('ETHUSDT.P', 60), []);
  assert.equal(requests.length, 1, 'peeking never starts a download');
  live.watch(new Set(['BTCUSDT.P|60']));
  assert.equal(sockets[0].url, 'wss://fstream.binance.com/market/ws/btcusdt@kline_1h');
  // The exchange drops the stream: the bars are reloaded and the stream reopened while the chart still wants it.
  sockets[0].onclose();
  assert.equal(waits.length, 1);
  await waits[0]();
  assert.deepEqual([requests.length, sockets.length], [2, 2]);
  live.stop();
  assert.equal(waits.length, 1, 'stopping does not schedule a reconnect');

  const listed = await listSymbols(async url => url.includes('fapi') ? { ok: true, json: async () => [{ symbol: 'PEPEUSDT', price: '0.0000123' }, { symbol: 'bad symbol', price: '1' }] }
    : { ok: true, json: async () => [{ symbol: 'ADAEUR', price: '0.41230000' }, { symbol: 'DEADUSDT', price: '0.00000000' }] });
  assert.deepEqual(listed, [
    { symbol: 'ADAEUR', name: 'ADA / EUR', type: 'Crypto', live: true, source: 'Binance spot', digits: 4 },
    { symbol: 'PEPEUSDT.P', name: 'PEPE / USDT perpetual', type: 'Crypto', live: true, source: 'Binance futures', digits: 7 }]);
  assert.deepEqual(await listSymbols(async () => { throw new Error('offline'); }), []);
});

test('a failed engine load leaves the workspace running and can be retried', async () => {
  const spy = instruments.find(item => item.symbol === 'GLD');
  assert.equal(await loadEngine(async () => { throw new Error('HTTP 503'); }), false);
  assert.match(engineError, /HTTP 503/);
  assert.deepEqual(series(spy, 1440), []);
  assert.equal(await loadEngine(async () => ({ instance: { exports: {} } })), false);
  assert.match(engineError, /Incompatible/);
  assert.equal(await loadEngine(), true);
  assert.equal(engineError, null);
  assert.ok(series(spy, 1440).length > 100);
});
