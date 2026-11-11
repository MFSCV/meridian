// Public market data connects directly from the visitor's browser.
export const liveTerms = 'https://www.binance.com/en/terms';
export const liveDocs = 'https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only';
const venues = {
  spot: { rest: 'https://data-api.binance.vision/api/v3/', stream: 'wss://data-stream.binance.vision/ws/', source: 'Binance spot' },
  futures: { rest: 'https://fapi.binance.com/fapi/v1/', stream: 'wss://fstream.binance.com/market/ws/', source: 'Binance futures' },
  coin: { rest: 'https://dapi.binance.com/dapi/v1/', stream: 'wss://dstream.binance.com/ws/', source: 'Binance COIN-M' }
};
const names = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 30: '30m', 60: '1h',
  120: '2h', 240: '4h', 360: '6h', 480: '8h', 720: '12h', 1440: '1d', 4320: '3d', 10080: '1w' };
const hyperIntervals = { ...names, 360: undefined };
const dydxIntervals = { 1: '1MIN', 5: '5MINS', 15: '15MINS', 30: '30MINS', 60: '1HOUR', 240: '4HOURS', 1440: '1DAY' };
const sourceInterval = (minutes, intervals = names) => intervals[minutes] ? minutes
  : Object.keys(intervals).map(Number).filter(value => value <= 1440 && intervals[value]).reverse().find(value => minutes % value === 0);

function aggregate(bars, minutes) {
  const duration = minutes * 60_000;
  const result = [];
  for (const bar of bars) {
    const time = Math.floor(bar.time / duration) * duration;
    const bucket = result.at(-1);
    if (bucket?.time === time) {
      bucket.high = Math.max(bucket.high, bar.high);
      bucket.low = Math.min(bucket.low, bar.low);
      bucket.close = bar.close;
      bucket.volume += bar.volume;
    } else {
      result.push({ ...bar, time });
    }
  }
  return result;
}
const RETRY = 3000;

// The venue and the exchange's own symbol for a Meridian symbol.
export function venueOf(symbol) {
  if (symbol.startsWith('COINM:')) return { ...venues.coin, kind: 'coin', pair: symbol.slice(6) };
  if (symbol.startsWith('USDM:')) return { ...venues.futures, source: 'Binance delivery futures', kind: 'delivery', pair: symbol.slice(5) };
  return symbol.endsWith('.P') ? { ...venues.futures, kind: 'futures', pair: symbol.slice(0, -2) } : { ...venues.spot, kind: 'spot', pair: symbol };
}

export function publicInstrument(symbol) {
  if (typeof symbol !== 'string') return null;
  if (/^(?:COINM:[A-Z0-9]{3,24}_(?:PERP|\d{6})|USDM:[A-Z0-9]{3,24}_\d{6})$/.test(symbol)) {
    const { pair, source } = venueOf(symbol);
    return { symbol, name: pair, source, live: true, type: 'Crypto', digits: 2 };
  }
  if (/^HL:(?:@[0-9]{1,7}|[A-Z0-9._-]{1,24}\/[A-Z0-9._-]{1,24}|(?:[a-z0-9_-]{1,20}:)?[A-Z0-9._-]{1,32})$/.test(symbol)) {
    const pair = symbol.slice(3);
    const spot = pair.startsWith('@') || pair.includes('/');
    return { symbol, name: pair + (spot ? '' : ' perpetual'), source: spot ? 'Hyperliquid spot' : 'Hyperliquid perpetuals', live: true, type: 'Crypto', digits: 5 };
  }
  if (/^DYDX:[A-Z0-9._-]{1,32}-[A-Z0-9]{2,12}$/.test(symbol)) {
    return { symbol, name: symbol.slice(5) + ' perpetual', source: 'dYdX perpetuals', live: true, type: 'Crypto', digits: 5 };
  }
  return null;
}

const toBar = row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
const valid = bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) && bar.low > 0 && bar.high >= bar.low;
const hyperBar = row => toBar([row?.t, row?.o, row?.h, row?.l, row?.c, row?.v]);
const dydxBar = row => toBar([Date.parse(row?.startedAt), row?.open, row?.high, row?.low, row?.close, row?.baseTokenVolume]);
const hyperTrade = row => ({ id: row?.tid, T: row?.time, p: row?.px, q: row?.sz });
const dydxTrade = row => ({ id: row?.id, T: Date.parse(row?.createdAt), p: row?.price, q: row?.size });
const hyperUrl = 'https://api.hyperliquid.xyz/info';
const dydxUrl = 'https://indexer.dydx.trade/v4/';

async function json(request, url, body) {
  const options = { signal: AbortSignal.timeout(8000) };
  if (body) Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await request(url, options);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

const hyper = (request, type, rest = {}) => json(request, hyperUrl, { type, ...rest });
const dydx = (request, path) => json(request, dydxUrl + path);

function chainMarket(symbol, minutes) {
  const seconds = minutes < 1;
  if (symbol.startsWith('HL:')) {
    const coin = symbol.slice(3);
    const source = sourceInterval(minutes, hyperIntervals);
    const interval = hyperIntervals[source];
    return {
      source, url: 'wss://api.hyperliquid.xyz/ws', heartbeat: { method: 'ping' },
      subscribe: { method: 'subscribe', subscription: seconds ? { type: 'trades', coin } : { type: 'candle', coin, interval } },
      matches(message) {
        return seconds ? message.channel === 'trades' && message.data?.[0]?.coin === coin
          : message.channel === 'candle' && message.data?.s === coin && message.data?.i === interval;
      },
      async history(request) {
        if (seconds) return (await hyper(request, 'recentTrades', { coin })).map(hyperTrade);
        const endTime = Date.now();
        return (await hyper(request, 'candleSnapshot', { req: { coin, interval, startTime: endTime - source * 60_000 * 1000, endTime } })).map(hyperBar);
      },
      read(message) {
        if (seconds && message.channel === 'trades' && Array.isArray(message.data)) return message.data.map(hyperTrade);
        if (!seconds && message.channel === 'candle') return [hyperBar(message.data)];
        return [];
      }
    };
  }
  if (symbol.startsWith('DYDX:')) {
    const pair = symbol.slice(5);
    const source = sourceInterval(minutes, dydxIntervals);
    const resolution = dydxIntervals[source];
    const channel = seconds ? 'v4_trades' : 'v4_candles';
    const id = seconds ? pair : pair + '/' + resolution;
    return {
      source, url: 'wss://indexer.dydx.trade/v4/ws',
      subscribe: { type: 'subscribe', channel, id },
      matches: message => message.channel === channel && message.id === id,
      async history(request) {
        if (seconds) return (await dydx(request, 'trades/perpetualMarket/' + encodeURIComponent(pair) + '?limit=100')).trades.map(dydxTrade);
        return (await dydx(request, 'candles/perpetualMarkets/' + encodeURIComponent(pair) + '?resolution=' + resolution + '&limit=100')).candles.map(dydxBar);
      },
      read(message) {
        if (message.channel !== channel) return [];
        if (seconds) return (message.contents?.trades ?? []).map(dydxTrade);
        return Array.isArray(message.contents?.candles) ? message.contents.candles.map(dydxBar) : [dydxBar(message.contents)];
      }
    };
  }
  return null;
}
const MAX_TRADE_BARS = 2000;

function applyTrade(bars, trade, duration) {
  const price = Number(trade.p);
  const volume = Number(trade.q);
  if (!Number.isSafeInteger(trade.T) || trade.T < 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(volume) || volume <= 0) return false;
  const time = Math.floor(trade.T / duration) * duration;
  const last = bars.at(-1);
  if (last && time < last.time) return false;
  if (last?.time === time) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += volume;
  } else {
    if (last) {
      const start = Math.max(last.time + duration, time - (MAX_TRADE_BARS - 1) * duration);
      for (let missing = start; missing < time; missing += duration) {
        const close = last.close;
        bars.push({ time: missing, open: close, high: close, low: close, close, volume: 0 });
      }
    }
    bars.push({ time, open: price, high: price, low: price, close: price, volume });
    if (bars.length > MAX_TRADE_BARS) bars.splice(0, bars.length - MAX_TRADE_BARS);
  }
  return true;
}
const decimals = tick => Math.min(12, (String(tick ?? '').split('.')[1] ?? '').replace(/0+$/, '').length);

const catalogs = {
  async 'Binance spot'(request) { return binanceCatalog(request, venues.spot, 'spot'); },
  async 'Binance futures'(request) { return binanceCatalog(request, venues.futures, 'perpetual'); },
  async 'Binance delivery futures'(request) { return binanceCatalog(request, venues.futures, 'delivery'); },
  async 'Binance COIN-M'(request) { return binanceCatalog(request, venues.coin, 'coin'); },
  async 'Hyperliquid spot'(request) {
    const { tokens, universe } = await hyper(request, 'spotMeta');
    const names = new Map(tokens.map(token => [token.index, token.name]));
    return universe.flatMap(row => {
      const item = publicInstrument('HL:' + row.name);
      return item && row.tokens.every(token => names.has(token))
        ? [{ ...item, name: row.tokens.map(token => names.get(token)).join(' / ') }] : [];
    });
  },
  async 'Hyperliquid perpetuals'(request) {
    const metas = await hyper(request, 'allPerpMetas');
    return metas.flatMap(meta => meta.universe.flatMap(row => {
      const item = publicInstrument('HL:' + row.name);
      return item && !row.isDelisted ? [item] : [];
    }));
  },
  async 'dYdX perpetuals'(request) {
    const { markets } = await dydx(request, 'perpetualMarkets');
    return Object.values(markets).flatMap(row => {
      const item = publicInstrument('DYDX:' + row.ticker);
      return item && row.status === 'ACTIVE' ? [{ ...item, digits: decimals(row.tickSize) }] : [];
    });
  }
};

async function binanceCatalog(request, venue, kind) {
  const { symbols } = await json(request, venue.rest + 'exchangeInfo');
  return symbols.flatMap(row => {
    if ((row.status ?? row.contractStatus) !== 'TRADING') return [];
    const pair = row.symbol;
    const perpetual = row.contractType === 'PERPETUAL';
    let symbol;
    if (kind === 'spot' && row.isSpotTradingAllowed !== false) symbol = pair;
    if (kind === 'perpetual' && perpetual) symbol = pair + '.P';
    if (kind === 'delivery' && !perpetual) symbol = 'USDM:' + pair;
    if (kind === 'coin') symbol = 'COINM:' + pair;
    const contract = publicInstrument(symbol);
    if (!contract && !(typeof symbol === 'string' && /^[A-Z0-9]{3,24}(\.P)?$/.test(symbol))) return [];
    const expiry = !perpetual && contract ? ' ' + new Date(row.deliveryDate).toISOString().slice(0, 10) : '';
    return [{
      symbol, source: contract?.source ?? venue.source, live: true, type: 'Crypto',
      name: row.baseAsset + ' / ' + row.quoteAsset + (perpetual ? ' perpetual' : expiry),
      digits: decimals(row.filters?.find(filter => filter.filterType === 'PRICE_FILTER')?.tickSize)
    }];
  });
}

export const marketSources = Object.keys(catalogs);

export async function listSymbols(request = (...args) => fetch(...args), sources = marketSources, onSource = () => {}) {
  let futuresRequest;
  const get = (url, options) => {
    if (url !== venues.futures.rest + 'exchangeInfo') return request(url, options);
    futuresRequest ??= Promise.resolve(request(url, options)).then(async response => {
      const data = response.ok ? await response.json() : null;
      return { ok: response.ok, status: response.status, json: () => data };
    });
    return futuresRequest;
  };
  const results = await Promise.allSettled(sources.map(async source => {
    const items = await catalogs[source](get);
    onSource(source, items);
    return items;
  }));
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

export function createLive({ request = (...args) => fetch(...args), Socket = globalThis.WebSocket, onData = () => {}, onTick = () => {},
  wait = (run, delay) => { const timer = setTimeout(run, delay); timer.unref?.(); return timer; } } = {}) {
  const store = new Map();
  const constituents = new Map();
  const tradeIds = new Map();
  const seenTrades = new Map();
  const state = new Map();
  const sockets = new Map();
  const chainSockets = new Map();
  const interestStore = new Map();
  let wanted = new Set();
  let stopped = false;
  const key = (symbol, minutes) => symbol + '|' + minutes;

  function subscribeChain(chain) {
    let group = chainSockets.get(chain.url);
    if (!group) {
      const socket = new Socket(chain.url);
      group = { socket, subscriptions: new Map(), opened: false };
      chainSockets.set(chain.url, group);
      socket.onopen = () => {
        group.opened = true;
        for (const sub of group.subscriptions.values()) socket.send(sub.wire);
        if (chain.heartbeat) {
          group.timer = setInterval(() => socket.send(JSON.stringify(chain.heartbeat)), 25_000);
          group.timer.unref?.();
        }
      };
      socket.onmessage = event => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        for (const sub of group.subscriptions.values()) {
          if (sub.chain.matches(message)) for (const client of sub.clients) client.onmessage?.(event);
        }
      };
      socket.onclose = () => {
        clearInterval(group.timer);
        if (chainSockets.get(chain.url) === group) chainSockets.delete(chain.url);
        for (const sub of group.subscriptions.values()) for (const client of sub.clients) client.onclose?.();
      };
    }
    const wire = JSON.stringify(chain.subscribe);
    let sub = group.subscriptions.get(wire);
    if (!sub) {
      sub = { wire, chain, clients: new Set() };
      group.subscriptions.set(wire, sub);
      if (group.opened) group.socket.send(wire);
    }
    const client = {
      close() {
        sub.clients.delete(client);
        if (sub.clients.size) return;
        group.subscriptions.delete(wire);
        if (!group.subscriptions.size) {
          chainSockets.delete(chain.url);
          clearInterval(group.timer);
          group.socket.close();
        } else if (group.opened) {
          const verb = 'method' in chain.subscribe ? 'method' : 'type';
          group.socket.send(JSON.stringify({ ...chain.subscribe, [verb]: 'unsubscribe' }));
        }
      }
    };
    sub.clients.add(client);
    return client;
  }

  function acceptTrade(id, minutes, trade) {
    if (trade?.id !== undefined) {
      if (typeof trade.id !== 'string' && !Number.isSafeInteger(trade.id)) return false;
      const seen = seenTrades.get(id) ?? new Set();
      if (seen.has(trade.id) || !applyTrade(store.get(id), trade, Math.round(minutes * 60_000))) return false;
      seen.add(trade.id);
      if (seen.size > 4096) seen.delete(seen.values().next().value);
      seenTrades.set(id, seen);
      return true;
    }
    if (!Number.isSafeInteger(trade?.a) || trade.a <= (tradeIds.get(id) ?? -1)) return false;
    if (!applyTrade(store.get(id), trade, Math.round(minutes * 60_000))) return false;
    tradeIds.set(id, trade.a);
    return true;
  }

  async function loadTrades(symbol, minutes, id, venue, chain) {
    try {
      const rows = chain ? await chain.history(request)
        : await json(request, venue.rest + 'aggTrades?symbol=' + encodeURIComponent(venue.pair) + '&limit=1000');
      if (Array.isArray(rows)) {
        if (chain) rows.sort((a, b) => a.T - b.T);
        for (const trade of rows) acceptTrade(id, minutes, trade);
      }
    } catch {}
    state.set(id, 'ready');
    if (!stopped) onData(symbol, minutes);
  }

  async function load(symbol, minutes) {
    const id = key(symbol, minutes);
    const chain = chainMarket(symbol, minutes);
    const venue = venueOf(symbol);
    if (minutes < 1) {
      if (!store.has(id)) store.set(id, []);
      state.set(id, 'loading');
      return loadTrades(symbol, minutes, id, venue, chain);
    }
    const source = chain?.source ?? sourceInterval(minutes);
    if (!store.has(id)) state.set(id, 'loading');
    try {
      const bars = (chain ? await chain.history(request)
        : (await json(request, venue.rest + 'klines?symbol=' + encodeURIComponent(venue.pair) + '&interval=' + names[source] + '&limit=1000')).map(toBar))
        .filter(valid).sort((a, b) => a.time - b.time);
      if (!bars.length) throw new Error('No data');
      if (source !== Number(minutes)) constituents.set(id, bars);
      store.set(id, source === Number(minutes) ? bars : aggregate(bars, minutes));
      state.set(id, 'ready');
    } catch {
      if (!store.has(id)) state.set(id, 'error');
    }
    if (!stopped) onData(symbol, minutes);
  }

  function open(symbol, minutes) {
    const id = key(symbol, minutes);
    if (sockets.has(id) || !Socket) return;
    const chain = chainMarket(symbol, minutes);
    const venue = venueOf(symbol);
    const stream = minutes < 1 ? '@aggTrade' : '@kline_' + names[sourceInterval(minutes)];
    const socket = chain ? subscribeChain(chain) : new Socket(venue.stream + venue.pair.toLowerCase() + stream);
    sockets.set(id, socket);
    socket.onmessage = event => {
      if (sockets.get(id) !== socket) return;
      const input = constituents.get(id);
      const bars = input ?? store.get(id);
      let updates;
      try {
        const message = JSON.parse(event.data);
        if (chain) updates = chain.read(message);
        else if (minutes < 1) updates = [message];
        else updates = [hyperBar(message.k)];
      } catch {
        return;
      }
      const previous = store.get(id).at(-1)?.close;
      if (minutes < 1) {
        if (chain) updates.sort((a, b) => a.T - b.T);
        let changed = false;
        for (const trade of updates) if (acceptTrade(id, minutes, trade)) changed = true;
        if (changed && previous === undefined) onData(symbol, minutes);
        else if (changed) onTick(symbol, minutes, previous, bars.at(-1));
        return;
      }
      let changed = false;
      for (const bar of updates.sort((a, b) => a.time - b.time)) {
        const lastTime = bars.at(-1)?.time;
        if (!valid(bar) || bar.time < lastTime) continue;
        if (bar.time === lastTime) bars[bars.length - 1] = bar;
        else bars.push(bar);
        changed = true;
      }
      if (!changed) return;
      if (input) store.set(id, aggregate(input, minutes));
      if (previous === undefined) onData(symbol, minutes);
      else onTick(symbol, minutes, previous, store.get(id).at(-1));
    };
    socket.onclose = () => {
      if (sockets.get(id) !== socket) return;
      sockets.delete(id);
      // The stream dropped while it was still wanted: reload the bars it missed, then reconnect.
      if (!stopped && wanted.has(id)) wait(() => !stopped && wanted.has(id) && load(symbol, minutes).then(() => api.watch(wanted)), RETRY);
    };
  }

  const api = {
    // Bars for a symbol and interval, or an empty array while they load.
    get(symbol, minutes) {
      const id = key(symbol, minutes);
      if (!state.has(id)) load(symbol, minutes);
      return store.get(id) ?? [];
    },
    // Bars already loaded, without starting a download.
    peek: (symbol, minutes) => store.get(key(symbol, minutes)) ?? [],
    status: (symbol, minutes) => state.get(key(symbol, minutes)) ?? 'loading',
    retry(symbol, minutes) {
      if (state.get(key(symbol, minutes)) === 'error') load(symbol, minutes);
    },
    // Open interest history for a perpetual future as a Map of bar time to contracts, or null while it loads or when
    // Binance has none (spot pairs, weekly bars, and anything older than its 30-day window).
    interest(symbol, minutes) {
      const venue = venueOf(symbol);
      const id = key(symbol, minutes);
      if (venue.kind !== 'futures' || !names[minutes] || minutes === 10080) return null;
      if (!interestStore.has(id)) {
        interestStore.set(id, null);
        request('https://fapi.binance.com/futures/data/openInterestHist?symbol=' + encodeURIComponent(venue.pair) + '&period=' + names[minutes] + '&limit=500')
          .then(response => response.ok ? response.json() : [])
          .then(rows => {
            const found = new Map((Array.isArray(rows) ? rows : []).map(row => [Number(row.timestamp), Number(row.sumOpenInterest)]).filter(([time, value]) => Number.isFinite(time) && value > 0));
            if (!found.size) return;
            interestStore.set(id, found);
            if (!stopped) onData(symbol, minutes);
          })
          .catch(() => {});
      }
      return interestStore.get(id);
    },
    // Most recent price seen for a symbol on any loaded interval.
    last(symbol) {
      let best = null;
      for (const [id, bars] of store) {
        const last = bars.at(-1);
        if (last && id.startsWith(symbol + '|') && (!best || last.time >= best.time)) best = last;
      }
      return best;
    },
    // Keeps streams open for exactly the given "SYMBOL|minutes" keys.
    watch(keys) {
      wanted = new Set(keys);
      for (const [id, socket] of sockets) {
        if (!wanted.has(id)) {
          sockets.delete(id);
          socket.close();
        }
      }
      for (const id of wanted) {
        const [symbol, minutes] = id.split('|');
        if (state.get(id) === 'ready') open(symbol, Number(minutes));
      }
    },
    stop() {
      stopped = true;
      wanted = new Set();
      for (const socket of [...sockets.values()]) socket.close();
      sockets.clear();
    }
  };
  return api;
}
