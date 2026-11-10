import assert from 'node:assert/strict';
import test from 'node:test';
import { createLive } from './live.mjs';
import { find, series, useLive } from './market.mjs';

const row = (time, close) => [time, String(close - 1), String(close + 2), String(close - 2), String(close), '10', 0, '0', 0, '0', '0', '0'];

test('live bars load once, stream updates and feed the shared series', async () => {
  const requests = [];
  const sockets = [];
  const events = [];
  class Socket {
    constructor(url) {
      this.url = url;
      sockets.push(this);
    }
    close() { this.closed = true; this.onclose?.(); }
  }
  const live = createLive({
    request: async url => {
      requests.push(url);
      if (url.includes('SOLUSDT')) return { ok: false, status: 451 };
      return { ok: true, json: async () => [row(0, 100), row(300000, 101), ['bad'], row(600000, 102)] };
    },
    Socket, onData: (...args) => events.push(['data', ...args]), onTick: (...args) => events.push(['tick', ...args])
  });
  useLive(live);
  try {
    const instrument = find('BTCUSDT');
    assert.ok(instrument.live);
    assert.deepEqual(series(instrument, 5), []);
    assert.equal(live.status('BTCUSDT', 5), 'loading');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^https:\/\/data-api\.binance\.vision\/api\/v3\/klines\?symbol=BTCUSDT&interval=5m&limit=1000$/);
    const bars = series(instrument, 5);
    assert.deepEqual(bars.map(bar => bar.close), [100, 101, 102]);
    assert.deepEqual(bars[0], { time: 0, open: 99, high: 102, low: 98, close: 100, volume: 10 });
    assert.deepEqual(events, [['data', 'BTCUSDT', 5]]);
    series(instrument, 5);
    assert.equal(requests.length, 1);

    live.watch(new Set(['BTCUSDT|5']));
    live.watch(new Set(['BTCUSDT|5']));
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].url, 'wss://data-stream.binance.vision/ws/btcusdt@kline_5m');
    const send = (time, close) => sockets[0].onmessage({ data: JSON.stringify({ k: { t: time, o: '101', h: '105', l: '100', c: String(close), v: '7' } }) });
    send(600000, 104);
    assert.equal(bars.length, 3);
    assert.equal(bars.at(-1).close, 104);
    send(900000, 103);
    assert.equal(bars.length, 4);
    send(300000, 1);
    sockets[0].onmessage({ data: 'not json' });
    assert.equal(bars.length, 4);
    assert.deepEqual(events.slice(1).map(event => event.slice(0, 4)), [['tick', 'BTCUSDT', 5, 102], ['tick', 'BTCUSDT', 5, 104]]);
    assert.equal(live.last('BTCUSDT').close, 103);

    series(find('SOLUSDT'), 60);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(live.status('SOLUSDT', 60), 'error');
    assert.deepEqual(series(find('SOLUSDT'), 60), []);
    live.watch(new Set(['SOLUSDT|60']));
    assert.ok(sockets[0].closed);
    assert.equal(sockets.length, 1);
  } finally {
    useLive(null);
  }
  assert.deepEqual(series(find('BTCUSDT'), 5), []);
});
