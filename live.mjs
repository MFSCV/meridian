// Optional live market data. The visitor's own browser connects to Binance's public, key-less market
// data endpoints; Meridian relays and stores nothing. Off unless the visitor turns it on in Settings.
export const liveTerms = 'https://www.binance.com/en/terms';
export const liveDocs = 'https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only';
const REST = 'https://data-api.binance.vision/api/v3/klines';
const STREAM = 'wss://data-stream.binance.vision/ws/';
const names = { 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h', 720: '12h', 1440: '1d', 10080: '1w' };

const toBar = row => ({ time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]) });
const valid = bar => [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) && bar.low > 0 && bar.high >= bar.low;

export function createLive({ request = (...args) => fetch(...args), Socket = globalThis.WebSocket, onData = () => {}, onTick = () => {} } = {}) {
  const store = new Map();
  const state = new Map();
  const sockets = new Map();
  const key = (symbol, minutes) => symbol + '|' + minutes;

  async function load(symbol, minutes) {
    const id = key(symbol, minutes);
    state.set(id, 'loading');
    try {
      const response = await request(REST + '?symbol=' + encodeURIComponent(symbol) + '&interval=' + names[minutes] + '&limit=1000');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bars = (await response.json()).map(toBar).filter(valid);
      if (!bars.length) throw new Error('No data');
      store.set(id, bars);
      state.set(id, 'ready');
    } catch {
      state.set(id, 'error');
    }
    onData(symbol, minutes);
  }

  function open(symbol, minutes) {
    const id = key(symbol, minutes);
    if (sockets.has(id) || !Socket) return;
    const socket = new Socket(STREAM + symbol.toLowerCase() + '@kline_' + names[minutes]);
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
    socket.onclose = () => { if (sockets.get(id) === socket) sockets.delete(id); };
  }

  return {
    // Bars for a symbol and interval, or an empty array while they load.
    get(symbol, minutes) {
      const id = key(symbol, minutes);
      if (!state.has(id)) load(symbol, minutes);
      return store.get(id) ?? [];
    },
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
    watch(wanted) {
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
      for (const socket of sockets.values()) socket.close();
      sockets.clear();
    }
  };
}
