// Live market data from Binance. The visitor's own browser connects to Binance's public, key-less market
// data endpoints; Meridian relays and stores nothing. On by default; it can be turned off in Settings.
// Symbols ending in ".P" are USDⓈ-M perpetual futures; every other symbol is a spot pair.
export const liveTerms = 'https://www.binance.com/en/terms';
export const liveDocs = 'https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only';
const venues = {
  spot: { rest: 'https://data-api.binance.vision/api/v3/', stream: 'wss://data-stream.binance.vision/ws/', source: 'Binance spot' },
  futures: { rest: 'https://fapi.binance.com/fapi/v1/', stream: 'wss://fstream.binance.com/market/ws/', source: 'Binance futures' }
};
const names = { 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 720: '12h', 1440: '1d', 10080: '1w' };
const RETRY = 3000;

// The venue and the exchange's own symbol for a Meridian symbol.
export const venueOf = symbol => symbol.endsWith('.P') ? { ...venues.futures, kind: 'futures', pair: symbol.slice(0, -2) } : { ...venues.spot, kind: 'spot', pair: symbol };

const toBar = row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
const valid = bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) && bar.low > 0 && bar.high >= bar.low;
const quotes = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY'];

// Every pair Binance lists, as Meridian instruments. Used for symbol search; returns [] when Binance cannot be reached.
export async function listSymbols(request = (...args) => fetch(...args)) {
  const found = [];
  for (const [kind, venue] of Object.entries(venues)) {
    try {
      const response = await request(venue.rest + 'ticker/price');
      if (!response.ok) continue;
      for (const row of await response.json()) {
        if (typeof row?.symbol !== 'string' || !/^[A-Z0-9]{3,24}$/.test(row.symbol) || !(Number(row.price) > 0)) continue;
        const quote = quotes.find(name => row.symbol.endsWith(name) && row.symbol.length > name.length);
        const text = String(row.price).includes('.') ? String(row.price).replace(/0+$/, '') : String(row.price);
        const digits = Math.min(8, Math.max(2, (text.split('.')[1] ?? '').length));
        found.push({
          symbol: kind === 'futures' ? row.symbol + '.P' : row.symbol,
          name: quote ? row.symbol.slice(0, -quote.length) + ' / ' + quote + (kind === 'futures' ? ' perpetual' : '') : row.symbol,
          type: 'Crypto', live: true, source: venue.source, digits
        });
      }
    } catch {}
  }
  return found;
}

export function createLive({ request = (...args) => fetch(...args), Socket = globalThis.WebSocket, onData = () => {}, onTick = () => {},
  wait = (run, delay) => { const timer = setTimeout(run, delay); timer.unref?.(); return timer; } } = {}) {
  const store = new Map();
  const state = new Map();
  const sockets = new Map();
  let wanted = new Set();
  let stopped = false;
  const key = (symbol, minutes) => symbol + '|' + minutes;

  async function load(symbol, minutes) {
    const id = key(symbol, minutes);
    const venue = venueOf(symbol);
    if (!store.has(id)) state.set(id, 'loading');
    try {
      const response = await request(venue.rest + 'klines?symbol=' + encodeURIComponent(venue.pair) + '&interval=' + names[minutes] + '&limit=1000');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bars = (await response.json()).map(toBar).filter(valid);
      if (!bars.length) throw new Error('No data');
      store.set(id, bars);
      state.set(id, 'ready');
    } catch {
      if (!store.has(id)) state.set(id, 'error');
    }
    if (!stopped) onData(symbol, minutes);
  }

  function open(symbol, minutes) {
    const id = key(symbol, minutes);
    if (sockets.has(id) || !Socket) return;
    const venue = venueOf(symbol);
    const socket = new Socket(venue.stream + venue.pair.toLowerCase() + '@kline_' + names[minutes]);
    sockets.set(id, socket);
    socket.onmessage = event => {
      const bars = store.get(id);
      let bar;
      try {
        const candle = JSON.parse(event.data).k;
        bar = toBar([candle.t, candle.o, candle.h, candle.l, candle.c, candle.v]);
      } catch {
        return;
      }
      if (!bars || !valid(bar) || bar.time < bars.at(-1).time) return;
      const previous = bars.at(-1).close;
      if (bar.time === bars.at(-1).time) bars[bars.length - 1] = bar;
      else bars.push(bar);
      onTick(symbol, minutes, previous, bar);
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
    // Most recent price seen for a symbol on any loaded interval.
    last(symbol) {
      let best = null;
      for (const [id, bars] of store) {
        if (id.startsWith(symbol + '|') && (!best || bars.at(-1).time >= best.time)) best = bars.at(-1);
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
