// Serves Meridian with a made-up, in-memory Binance futures account, so the trading panel can be explored
// and tested without an API key. Nothing here talks to Binance and no order leaves this process.
//   node tools/demo-account.mjs --port=4175
import { createServer } from 'node:http';
import { createHandler } from '../server.mjs';

const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7)) || 4173;
let serial = 100;
let at = Date.now();
const account = { wallet: 2500, margin: 2536.4, available: 2140.75, unrealized: 36.4, maintenance: 14.2 };
let positions = [{ symbol: 'BTCUSDT', side: 'BOTH', amount: 0.05, entry: 0, breakEven: 0, mark: 0, liquidation: 0, unrealized: 0, notional: 0, margin: 180, leverage: 20, marginType: 'CROSSED' }];
let orders = [];
const touch = () => { at = Date.now(); };

// Anchors the sample position and orders around the current Binance futures price, when it can be read.
async function seed() {
  let last = 70000;
  try {
    last = Number((await (await fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT', { signal: AbortSignal.timeout(8000) })).json()).price) || last;
  } catch {}
  const round = value => Math.round(value * 10) / 10;
  Object.assign(positions[0], { entry: round(last * 0.992), breakEven: round(last * 0.9924), mark: round(last), liquidation: round(last * 0.948), unrealized: 0.05 * last * 0.008, notional: 0.05 * last });
  orders = [
    { id: '11', algo: false, symbol: 'BTCUSDT', side: 'BUY', positionSide: 'BOTH', kind: 'limit', quantity: 0.02, filled: 0, price: round(last * 0.98), trigger: null, reduceOnly: false, closePosition: false, time: at },
    { id: '21', algo: true, symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH', kind: 'takeProfit', quantity: null, filled: 0, price: null, trigger: round(last * 1.02), reduceOnly: false, closePosition: true, time: at },
    { id: '22', algo: true, symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH', kind: 'stop', quantity: null, filled: 0, price: null, trigger: round(last * 0.985), reduceOnly: false, closePosition: true, time: at }
  ];
}
const held = symbol => positions.find(item => item.symbol === symbol) ?? (() => { throw Object.assign(new Error('There is no open ' + symbol + ' position.'), { status: 409 }); })();

const binance = {
  status: async () => ({ provider: 'binance', mode: 'testnet', status: 'connected', hedge: false, streaming: false, revision: 0 }),
  connect: async () => binance.status(),
  disconnect: async () => binance.status(),
  snapshot: async () => ({ mode: 'testnet', hedge: false, revision: 0, at, account, positions, orders }),
  async order(body) {
    const level = Number(body.triggerPrice ?? body.price ?? body.activatePrice) || null;
    if (body.kind === 'market') {
      const existing = positions.find(item => item.symbol === body.symbol);
      const change = Number(body.quantity) * (body.side === 'BUY' ? 1 : -1);
      if (existing) existing.amount = Math.round((existing.amount + change) * 1000) / 1000;
      positions = positions.filter(item => item.amount !== 0);
    } else {
      orders.push({ id: String(++serial), algo: body.kind !== 'limit', symbol: body.symbol, side: body.side, positionSide: 'BOTH', kind: body.kind, quantity: body.closePosition ? null : Number(body.quantity), filled: 0,
        price: body.kind === 'limit' ? level : null, trigger: body.kind === 'limit' || body.kind === 'trailing' ? null : level, activation: body.kind === 'trailing' ? level : null,
        callback: body.kind === 'trailing' ? Number(body.callbackRate) : null, reduceOnly: Boolean(body.reduceOnly), closePosition: Boolean(body.closePosition), time: Date.now() });
    }
    touch();
    return { placed: 1 };
  },
  async cancel({ id }) { orders = orders.filter(item => item.id !== String(id)); touch(); return { cancelled: 1 }; },
  async cancelAll({ symbol }) { orders = orders.filter(item => item.symbol !== symbol); touch(); return { cancelled: true }; },
  async close({ symbol, fraction = 1 }) {
    const position = held(symbol);
    position.amount = Math.round(position.amount * (1 - (fraction > 0 && fraction < 1 ? fraction : 1)) * 1000) / 1000;
    positions = positions.filter(item => item.amount !== 0);
    touch();
    return { closed: true };
  },
  async reverse({ symbol }) { const position = held(symbol); position.amount = -position.amount; position.liquidation = Math.round(position.entry * 1.05 * 10) / 10; touch(); return { reversed: true }; },
  async breakEven({ symbol }) {
    const position = held(symbol);
    orders = orders.filter(item => !(item.symbol === symbol && item.kind === 'stop' && item.closePosition));
    orders.push({ id: String(++serial), algo: true, symbol, side: position.amount > 0 ? 'SELL' : 'BUY', positionSide: 'BOTH', kind: 'stop', quantity: null, filled: 0, price: null, trigger: position.breakEven, reduceOnly: false, closePosition: true, time: Date.now() });
    touch();
    return { stop: position.breakEven };
  },
  async leverage({ symbol, leverage }) { for (const item of positions) if (item.symbol === symbol) item.leverage = Number(leverage); touch(); return { leverage: Number(leverage) }; },
  async marginType({ symbol, marginType }) { for (const item of positions) if (item.symbol === symbol) item.marginType = marginType; touch(); return { marginType }; }
};

await seed();
createServer(createHandler({ binance })).listen(port, '127.0.0.1', () => process.stdout.write('Meridian with a demo account: http://127.0.0.1:' + port + '/\n'));
