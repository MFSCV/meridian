// Binance USDⓈ-M futures account adapter for the local server. Credentials stay in this process:
// they are never written to disk, never returned by a route and never reach the browser code.
import { createHmac } from 'node:crypto';

const hosts = {
  live: { rest: 'https://fapi.binance.com', stream: 'wss://fstream.binance.com/private/ws/' },
  testnet: { rest: 'https://demo-fapi.binance.com', stream: 'wss://demo-fstream.binance.com/ws/' }
};
const conditional = { stop: 'STOP_MARKET', stopLimit: 'STOP', takeProfit: 'TAKE_PROFIT_MARKET', takeProfitLimit: 'TAKE_PROFIT', trailing: 'TRAILING_STOP_MARKET' };
const plain = { market: 'MARKET', limit: 'LIMIT' };
const kinds = Object.fromEntries(Object.entries({ ...plain, ...conditional }).map(([name, type]) => [type, name]));

export class BrokerError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (message, status = 400) => { throw new BrokerError(status, message); };
const number = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
const positive = (value, label) => number(value) > 0 && Number.isFinite(number(value)) ? number(value) : fail(label + ' must be a number above zero.');
const pair = value => typeof value === 'string' && /^[A-Z0-9]{3,24}$/.test(value) ? value : fail('Unknown symbol.');
const decimals = step => (String(step).replace(/0+$/, '').split('.')[1] ?? '').length;
// Rounds to a multiple of the exchange's step and prints it without floating-point noise.
function snap(value, step, down) {
  if (!(Number(step) > 0)) return String(value);
  const places = decimals(step);
  const units = value / Number(step);
  const whole = down ? Math.floor(units + 1e-9) : Math.round(units);
  return (whole * Number(step)).toFixed(places);
}

export function createBinance({ env = process.env, request = fetch, Socket = globalThis.WebSocket, now = Date.now } = {}) {
  let session = null;
  let snapshotCache = null;
  let rules = null;
  let revision = 0;

  if (env.MERIDIAN_BINANCE_KEY && env.MERIDIAN_BINANCE_SECRET) {
    session = start(env.MERIDIAN_BINANCE_KEY, env.MERIDIAN_BINANCE_SECRET, /^(1|true|yes)$/i.test(env.MERIDIAN_BINANCE_TESTNET ?? ''));
    session.fromEnv = true;
  }

  function start(key, secret, testnet) {
    return { key, secret, mode: testnet ? 'testnet' : 'live', host: hosts[testnet ? 'testnet' : 'live'], offset: 0, hedge: false, verified: false, socket: null, streaming: false, timer: null };
  }

  async function call(target, method, path, params = {}, signed = true) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    if (signed) {
      query.set('recvWindow', '10000');
      query.set('timestamp', String(now() + target.offset));
      query.set('signature', createHmac('sha256', target.secret).update(query.toString()).digest('hex'));
    }
    let response;
    try {
      response = await request(target.host.rest + path + (query.size ? '?' + query : ''), {
        method, headers: { 'X-MBX-APIKEY': target.key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new BrokerError(502, 'Binance could not be reached.');
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const denied = response.status === 401 || response.status === 403 || [-2014, -2015, -1022].includes(data?.code);
      throw new BrokerError(denied ? 401 : response.status === 429 || response.status === 418 ? 429 : 400,
        typeof data?.msg === 'string' ? data.msg : 'Binance refused the request (HTTP ' + response.status + ').', data?.code);
    }
    return data;
  }

  // Exchange trading rules, shared across sessions of the same mode and refreshed hourly.
  async function filters(target, symbol) {
    if (!rules || rules.mode !== target.mode || now() - rules.at > 3600000) {
      const info = await call(target, 'GET', '/fapi/v1/exchangeInfo', {}, false);
      rules = { mode: target.mode, at: now(), symbols: new Map((info?.symbols ?? []).map(item => {
        const find = type => item.filters?.find(entry => entry.filterType === type) ?? {};
        return [item.symbol, { tick: find('PRICE_FILTER').tickSize, step: find('LOT_SIZE').stepSize, minQty: Number(find('LOT_SIZE').minQty) || 0,
          marketStep: find('MARKET_LOT_SIZE').stepSize, status: item.status }];
      })) };
    }
    return rules.symbols.get(symbol) ?? fail('Binance futures does not list ' + symbol + '.');
  }

  function listen(target) {
    if (!Socket) return;
    const close = () => {
      target.streaming = false;
      clearInterval(target.timer);
      try { target.socket?.close(); } catch {}
      target.socket = null;
    };
    target.stop = close;
    const open = async () => {
      try {
        const { listenKey } = await call(target, 'POST', '/fapi/v1/listenKey', {}, false);
        if (session !== target || typeof listenKey !== 'string') return;
        const socket = new Socket(target.host.stream + listenKey);
        target.socket = socket;
        socket.onopen = () => { target.streaming = true; };
        socket.onmessage = () => { revision += 1; snapshotCache = null; };
        socket.onclose = () => {
          if (target.socket !== socket) return;
          target.streaming = false;
          target.socket = null;
          if (session === target) setTimeout(open, 5000).unref?.();
        };
        socket.onerror = () => {};
      } catch {}
    };
    open();
    target.timer = setInterval(() => call(target, 'PUT', '/fapi/v1/listenKey', {}, false).catch(() => {}), 30 * 60000);
    target.timer.unref?.();
  }

  async function verify(target) {
    try {
      const time = await call(target, 'GET', '/fapi/v1/time', {}, false);
      if (Number.isFinite(time?.serverTime)) target.offset = time.serverTime - now();
    } catch {}
    await call(target, 'GET', '/fapi/v3/account');
    target.hedge = Boolean((await call(target, 'GET', '/fapi/v1/positionSide/dual')).dualSidePosition);
    target.verified = true;
  }

  const active = () => session ?? fail('Binance is not connected.', 409);
  const touched = () => { revision += 1; snapshotCache = null; };

  async function positionOf(target, symbol, side) {
    const rows = await call(target, 'GET', '/fapi/v3/positionRisk', { symbol });
    const open = rows.filter(row => Number(row.positionAmt) !== 0 && (!side || row.positionSide === side));
    if (!open.length) fail('There is no open ' + symbol + ' position.', 409);
    if (open.length > 1) fail('Choose the long or the short position.', 409);
    return open[0];
  }

  // A market order that only reduces or closes the given position.
  function closing(target, position, quantity) {
    const amount = Number(position.positionAmt);
    return {
      symbol: position.symbol, side: amount > 0 ? 'SELL' : 'BUY', type: 'MARKET', quantity,
      ...(target.hedge ? { positionSide: position.positionSide } : { reduceOnly: 'true' })
    };
  }

  const api = {
    // What the browser may know about the connection. Never includes the key or the secret.
    async status() {
      if (!session) return { provider: 'binance', status: 'not_configured' };
      if (!session.verified) {
        try {
          await verify(session);
          listen(session);
        } catch (problem) {
          return { provider: 'binance', mode: session.mode, status: problem.status === 401 ? 'authorization_required' : 'unavailable', message: problem.message };
        }
      }
      return { provider: 'binance', mode: session.mode, status: 'connected', hedge: session.hedge, streaming: session.streaming, revision };
    },

    async connect({ key, secret, testnet } = {}) {
      if (typeof key !== 'string' || typeof secret !== 'string' || !/^[A-Za-z0-9]{16,128}$/.test(key.trim()) || !/^[A-Za-z0-9]{16,128}$/.test(secret.trim())) {
        fail('Enter the API key and the secret exactly as Binance shows them.');
      }
      const next = start(key.trim(), secret.trim(), Boolean(testnet));
      await verify(next);
      session?.stop?.();
      session = next;
      touched();
      listen(next);
      return api.status();
    },

    async disconnect() {
      const target = session;
      session = null;
      snapshotCache = null;
      revision += 1;
      target?.stop?.();
      if (target?.verified) await call(target, 'DELETE', '/fapi/v1/listenKey', {}, false).catch(() => {});
      return { provider: 'binance', status: 'not_configured' };
    },

    // Balances, positions and working orders in one normalised object, cached briefly.
    async snapshot() {
      const target = active();
      const age = target.streaming ? 20000 : 8000;
      if (snapshotCache && now() - snapshotCache.at < age) return snapshotCache.data;
      const [account, positions, orders, algos, settings] = await Promise.all([
        call(target, 'GET', '/fapi/v3/account'), call(target, 'GET', '/fapi/v3/positionRisk'), call(target, 'GET', '/fapi/v1/openOrders'),
        call(target, 'GET', '/fapi/v1/openAlgoOrders').catch(() => []), call(target, 'GET', '/fapi/v1/symbolConfig').catch(() => [])
      ]);
      const config = new Map((Array.isArray(settings) ? settings : []).map(row => [row.symbol, row]));
      const data = {
        mode: target.mode, hedge: target.hedge, revision, at: now(),
        account: {
          wallet: Number(account.totalWalletBalance), margin: Number(account.totalMarginBalance), available: Number(account.availableBalance),
          unrealized: Number(account.totalUnrealizedProfit), maintenance: Number(account.totalMaintMargin)
        },
        positions: (Array.isArray(positions) ? positions : []).filter(row => Number(row.positionAmt) !== 0).map(row => ({
          symbol: row.symbol, side: row.positionSide, amount: Number(row.positionAmt), entry: Number(row.entryPrice), breakEven: Number(row.breakEvenPrice),
          mark: Number(row.markPrice), liquidation: Number(row.liquidationPrice), unrealized: Number(row.unRealizedProfit), notional: Number(row.notional),
          margin: Number(row.isolatedMargin) || Number(row.initialMargin) || 0, leverage: Number(config.get(row.symbol)?.leverage) || null,
          marginType: config.get(row.symbol)?.marginType ?? null
        })),
        orders: [
          ...(Array.isArray(orders) ? orders : []).map(row => ({
            id: String(row.orderId), algo: false, symbol: row.symbol, side: row.side, positionSide: row.positionSide, kind: kinds[row.type] ?? 'limit',
            quantity: Number(row.origQty), filled: Number(row.executedQty), price: Number(row.price) || null, trigger: Number(row.stopPrice) || null,
            reduceOnly: Boolean(row.reduceOnly), closePosition: Boolean(row.closePosition), time: row.time
          })),
          ...(Array.isArray(algos) ? algos : []).map(row => ({
            id: String(row.algoId), algo: true, symbol: row.symbol, side: row.side, positionSide: row.positionSide, kind: kinds[row.orderType] ?? 'stop',
            quantity: Number(row.quantity) || null, filled: 0, price: Number(row.price) || null, trigger: Number(row.triggerPrice) || null,
            activation: Number(row.activatePrice) || null, callback: Number(row.callbackRate) || null,
            reduceOnly: Boolean(row.reduceOnly), closePosition: Boolean(row.closePosition), time: row.createTime
          }))
        ]
      };
      snapshotCache = { at: now(), data };
      return data;
    },

    // Places one order. Entry orders may carry a take profit and a stop loss, which are placed as close-position orders.
    async order(body = {}) {
      const target = active();
      const symbol = pair(body.symbol);
      const side = body.side === 'BUY' || body.side === 'SELL' ? body.side : fail('Side must be BUY or SELL.');
      const kind = Object.hasOwn(plain, body.kind) || Object.hasOwn(conditional, body.kind) ? body.kind : fail('Unknown order type.');
      const rule = await filters(target, symbol);
      const closeAll = body.closePosition === true && (kind === 'stop' || kind === 'takeProfit');
      const quantity = closeAll ? undefined : snap(positive(body.quantity, 'Quantity'), kind === 'market' ? rule.marketStep ?? rule.step : rule.step, true);
      if (quantity !== undefined && !(Number(quantity) > 0 && Number(quantity) >= rule.minQty)) fail('The quantity is below the minimum for ' + symbol + ' (' + rule.minQty + ').');
      const hedgeSide = target.hedge ? (['LONG', 'SHORT'].includes(body.positionSide) ? body.positionSide : body.reduceOnly || closeAll ? (side === 'SELL' ? 'LONG' : 'SHORT') : (side === 'BUY' ? 'LONG' : 'SHORT')) : undefined;
      const common = { symbol, side, positionSide: hedgeSide, quantity, reduceOnly: !target.hedge && body.reduceOnly === true && !closeAll ? 'true' : undefined };
      const price = value => snap(positive(value, 'Price'), rule.tick);
      const placed = [];
      if (kind === 'market') placed.push(await call(target, 'POST', '/fapi/v1/order', { ...common, type: 'MARKET' }));
      else if (kind === 'limit') {
        placed.push(await call(target, 'POST', '/fapi/v1/order', { ...common, type: 'LIMIT', price: price(body.price), timeInForce: body.postOnly === true ? 'GTX' : 'GTC' }));
      } else {
        const working = body.workingType === 'CONTRACT_PRICE' ? 'CONTRACT_PRICE' : 'MARK_PRICE';
        const params = { ...common, algoType: 'CONDITIONAL', type: conditional[kind], workingType: working };
        if (kind === 'trailing') {
          const rate = positive(body.callbackRate, 'Callback rate');
          if (rate < 0.1 || rate > 20) fail('The callback rate must be between 0.1% and 20%.');
          params.callbackRate = String(Math.round(rate * 100) / 100);
          if (number(body.activatePrice) > 0) params.activatePrice = price(body.activatePrice);
        } else {
          params.triggerPrice = price(body.triggerPrice);
          if (kind === 'stopLimit' || kind === 'takeProfitLimit') Object.assign(params, { price: price(body.price), timeInForce: 'GTC' });
          else params.priceProtect = 'true';
          if (closeAll) Object.assign(params, { closePosition: 'true', quantity: undefined, reduceOnly: undefined });
        }
        placed.push(await call(target, 'POST', '/fapi/v1/algoOrder', params));
      }
      // Exits attached to an entry order close the whole position when their price trades.
      const exits = [];
      if (kind === 'market' || kind === 'limit') {
        for (const [field, type] of [['takeProfit', 'TAKE_PROFIT_MARKET'], ['stopLoss', 'STOP_MARKET']]) {
          if (!(number(body[field]) > 0)) continue;
          try {
            exits.push(await call(target, 'POST', '/fapi/v1/algoOrder', {
              algoType: 'CONDITIONAL', symbol, side: side === 'BUY' ? 'SELL' : 'BUY', positionSide: hedgeSide, type, triggerPrice: price(body[field]),
              workingType: 'MARK_PRICE', closePosition: 'true', priceProtect: 'true'
            }));
          } catch (problem) {
            touched();
            throw new BrokerError(problem.status ?? 400, 'The order was placed, but its ' + (field === 'takeProfit' ? 'take profit' : 'stop loss') + ' was refused: ' + problem.message, problem.code);
          }
        }
      }
      touched();
      return { placed: placed.length + exits.length };
    },

    async cancel({ symbol, id, algo } = {}) {
      const target = active();
      if (!/^\d{1,24}$/.test(String(id))) fail('Unknown order.');
      if (algo === true) await call(target, 'DELETE', '/fapi/v1/algoOrder', { algoId: String(id) });
      else await call(target, 'DELETE', '/fapi/v1/order', { symbol: pair(symbol), orderId: String(id) });
      touched();
      return { cancelled: 1 };
    },

    async cancelAll({ symbol } = {}) {
      const target = active();
      const results = await Promise.allSettled([
        call(target, 'DELETE', '/fapi/v1/allOpenOrders', { symbol: pair(symbol) }), call(target, 'DELETE', '/fapi/v1/algoOpenOrders', { symbol: pair(symbol) })
      ]);
      touched();
      if (results.every(result => result.status === 'rejected')) throw results[0].reason;
      return { cancelled: true };
    },

    // Closes a position at market: all of it, or the given fraction (0 to 1).
    async close({ symbol, positionSide, fraction = 1 } = {}) {
      const target = active();
      const position = await positionOf(target, pair(symbol), positionSide);
      const rule = await filters(target, position.symbol);
      const share = number(fraction) > 0 && number(fraction) < 1 ? number(fraction) : 1;
      const quantity = share === 1 ? String(Math.abs(Number(position.positionAmt))) : snap(Math.abs(Number(position.positionAmt)) * share, rule.marketStep ?? rule.step, true);
      if (!(Number(quantity) > 0)) fail('That share of the position is below the minimum order size.');
      await call(target, 'POST', '/fapi/v1/order', closing(target, position, quantity));
      touched();
      return { closed: quantity };
    },

    // Turns a long into a short of the same size, or the reverse, at market.
    async reverse({ symbol, positionSide } = {}) {
      const target = active();
      const position = await positionOf(target, pair(symbol), positionSide);
      const size = Math.abs(Number(position.positionAmt));
      const side = Number(position.positionAmt) > 0 ? 'SELL' : 'BUY';
      if (target.hedge) {
        await call(target, 'POST', '/fapi/v1/order', closing(target, position, String(size)));
        touched();
        await call(target, 'POST', '/fapi/v1/order', { symbol: position.symbol, side, type: 'MARKET', quantity: String(size), positionSide: side === 'BUY' ? 'LONG' : 'SHORT' });
      } else {
        const rule = await filters(target, position.symbol);
        await call(target, 'POST', '/fapi/v1/order', { symbol: position.symbol, side, type: 'MARKET', quantity: snap(size * 2, rule.marketStep ?? rule.step, true) });
      }
      touched();
      return { reversed: size };
    },

    // Moves the stop loss of a position to its break-even price, replacing other close-position stops on that side.
    async breakEven({ symbol, positionSide } = {}) {
      const target = active();
      const position = await positionOf(target, pair(symbol), positionSide);
      const long = Number(position.positionAmt) > 0;
      const level = Number(position.breakEvenPrice) || Number(position.entryPrice);
      const mark = Number(position.markPrice);
      if (long ? mark <= level : mark >= level) fail('The price has not moved past break-even yet, so a stop there would trigger at once.', 409);
      const rule = await filters(target, position.symbol);
      const side = long ? 'SELL' : 'BUY';
      const existing = (await call(target, 'GET', '/fapi/v1/openAlgoOrders', { symbol: position.symbol }).catch(() => []))
        .filter(row => row.orderType === 'STOP_MARKET' && row.side === side && String(row.closePosition) === 'true' && (!target.hedge || row.positionSide === position.positionSide));
      await call(target, 'POST', '/fapi/v1/algoOrder', {
        algoType: 'CONDITIONAL', symbol: position.symbol, side, positionSide: target.hedge ? position.positionSide : undefined, type: 'STOP_MARKET',
        triggerPrice: snap(level, rule.tick), workingType: 'MARK_PRICE', closePosition: 'true', priceProtect: 'true'
      });
      for (const row of existing) await call(target, 'DELETE', '/fapi/v1/algoOrder', { algoId: String(row.algoId) }).catch(() => {});
      touched();
      return { stop: snap(level, rule.tick) };
    },

    async leverage({ symbol, leverage } = {}) {
      const value = Math.round(positive(leverage, 'Leverage'));
      if (value < 1 || value > 150) fail('Leverage must be between 1 and 150.');
      const result = await call(active(), 'POST', '/fapi/v1/leverage', { symbol: pair(symbol), leverage: value });
      touched();
      return { leverage: Number(result.leverage) || value };
    },

    async marginType({ symbol, marginType } = {}) {
      if (marginType !== 'ISOLATED' && marginType !== 'CROSSED') fail('Margin type must be ISOLATED or CROSSED.');
      try {
        await call(active(), 'POST', '/fapi/v1/marginType', { symbol: pair(symbol), marginType });
      } catch (problem) {
        if (problem.code !== -4046) throw problem;
      }
      touched();
      return { marginType };
    }
  };
  return api;
}

export const binanceActions = { connect: 'connect', disconnect: 'disconnect', order: 'order', cancel: 'cancel', 'cancel-all': 'cancelAll', close: 'close', reverse: 'reverse',
  'break-even': 'breakEven', leverage: 'leverage', 'margin-type': 'marginType' };
