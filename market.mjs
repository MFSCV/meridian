// Deterministic simulated market data. Nothing here is an observed price.
export const instruments = [
  { symbol: 'SPY', name: 'S&P 500 ETF', base: 575, type: 'ETF' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', base: 490, type: 'ETF' },
  { symbol: 'AAPL', name: 'Apple', base: 230, type: 'Stock' },
  { symbol: 'NVDA', name: 'NVIDIA', base: 142, type: 'Stock' },
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', base: 68400, type: 'Crypto' },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', base: 1.085, type: 'Forex', digits: 4 },
  { symbol: 'ETHUSDT.P', name: 'Ethereum / TetherUS perpetual', base: 2050, type: 'Crypto' },
  { symbol: 'SOLUSD', name: 'Solana / US Dollar', base: 162, type: 'Crypto' },
  { symbol: 'MSFT', name: 'Microsoft', base: 428, type: 'Stock' },
  { symbol: 'TSLA', name: 'Tesla', base: 251, type: 'Stock' },
  { symbol: 'AMZN', name: 'Amazon', base: 197, type: 'Stock' },
  { symbol: 'GOOGL', name: 'Alphabet', base: 172, type: 'Stock' },
  { symbol: 'META', name: 'Meta Platforms', base: 585, type: 'Stock' },
  { symbol: 'IWM', name: 'Russell 2000 ETF', base: 221, type: 'ETF' },
  { symbol: 'GLD', name: 'Gold ETF', base: 245, type: 'ETF' },
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', base: 2650, type: 'Commodity' },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', base: 1.297, type: 'Forex', digits: 4 },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', base: 152.4, type: 'Forex', digits: 3 }
];

export const intervals = [5, 15, 30, 60, 120, 240, 720, 1440, 10080];
export const intervalLabel = minutes => minutes < 60 ? minutes + 'm' : minutes < 1440 ? minutes / 60 + 'h'
  : minutes === 1440 ? '1D' : '1W';
export const intervalName = minutes => minutes < 60 ? minutes + ' minutes' : minutes === 60 ? '1 hour'
  : minutes < 1440 ? minutes / 60 + ' hours' : minutes === 1440 ? '1 day' : '1 week';
export const find = symbol => instruments.find(item => item.symbol === symbol);

const hour = 3600000;
const end = Date.UTC(2026, 10, 10);
const count = 144 * 24;
const cache = new Map();
const lcg = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

function hourly(instrument) {
  let state = 101;
  for (const char of instrument.symbol) state = Math.imul(state, 31) + char.charCodeAt(0);
  const random = lcg(state);
  let close = instrument.base;
  const bars = [];
  for (let index = 0; index < count; index++) {
    const open = close;
    close *= 1 + (random() - 0.489) * 0.012 + Math.sin(index / 80) * 0.0008;
    const high = Math.max(open, close) * (1 + random() * 0.003);
    const low = Math.min(open, close) * (1 - random() * 0.003);
    const volume = Math.floor(1000 + random() * 100000);
    bars.push({ time: end - (count - index) * hour, open, high, low, close, volume });
  }
  return bars;
}

// Splits one hourly bar into twelve five-minute bars that aggregate back to it exactly.
function split(bar) {
  const random = lcg(((bar.time / 300000) ^ bar.volume ^ 0x9e3779b9) >>> 0);
  const parts = 12;
  const span = bar.high - bar.low;
  const top = Math.floor(random() * parts);
  const bottom = Math.floor(random() * parts);
  const weights = Array.from({ length: parts }, () => 0.5 + random());
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const out = [];
  let previous = bar.open;
  let used = 0;
  for (let index = 0; index < parts; index++) {
    const share = (index + 1) / parts;
    const drift = bar.open + (bar.close - bar.open) * share;
    const close = index === parts - 1 ? bar.close
      : Math.min(bar.high, Math.max(bar.low, drift + (random() - 0.5) * span * 0.6 * Math.sin(Math.PI * share)));
    const upper = Math.max(previous, close);
    const lower = Math.min(previous, close);
    const volume = index === parts - 1 ? bar.volume - used : Math.max(1, Math.floor(bar.volume * weights[index] / total));
    used += volume;
    out.push({
      time: bar.time + index * 300000, open: previous,
      high: index === top ? bar.high : upper + random() * 0.3 * (bar.high - upper),
      low: index === bottom ? bar.low : lower - random() * 0.3 * (lower - bar.low),
      close, volume
    });
    previous = close;
  }
  return out;
}

function aggregate(bars, size) {
  if (size === 1) return bars;
  const out = [];
  for (let index = 0; index < bars.length; index += size) {
    const chunk = bars.slice(index, index + size);
    out.push({
      time: chunk[0].time, open: chunk[0].open,
      high: Math.max(...chunk.map(bar => bar.high)), low: Math.min(...chunk.map(bar => bar.low)),
      close: chunk.at(-1).close, volume: chunk.reduce((sum, bar) => sum + bar.volume, 0)
    });
  }
  return out;
}

// Returns a shared, cached array. Callers must not mutate it.
export function series(instrument, minutes) {
  if (!intervals.includes(minutes)) throw new RangeError('Unsupported interval');
  const key = instrument.symbol + '|' + minutes;
  if (!cache.has(key)) {
    const bars = minutes === 60 ? hourly(instrument)
      : minutes === 5 ? series(instrument, 60).flatMap(split)
      : minutes < 60 ? aggregate(series(instrument, 5), minutes / 5)
      : aggregate(series(instrument, 60), minutes / 60);
    cache.set(key, bars);
  }
  return cache.get(key);
}

export function movingAverage(bars, period) {
  let sum = 0;
  return bars.map(({ close }, index) => {
    sum += close - (bars[index - period]?.close ?? 0);
    return index >= period - 1 ? sum / period : null;
  });
}

export function price(value, instrument) {
  const digits = instrument?.digits ?? 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function csv(bars) {
  return ['Time (UTC),Open,High,Low,Close,Volume', ...bars.map(bar =>
    [new Date(bar.time).toISOString(), bar.open, bar.high, bar.low, bar.close, bar.volume].join(',')
  )].join('\r\n');
}
