import { simulatedBars, engineError, loadEngine } from './market-engine.mjs';
import { publicInstrument } from './live.mjs';
export { engineError, loadEngine };

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

// Binance pairs, shown while live data is on. Prices come from the visitor's own connection to Binance.
// Symbols ending in ".P" are USDⓈ-M perpetual futures.
const spot = (symbol, name, digits) => ({ symbol, name, type: 'Crypto', live: true, source: 'Binance spot', ...(digits ? { digits } : {}) });
const perpetual = (symbol, name, digits) => ({ symbol: symbol + '.P', name: name + ' perpetual', type: 'Crypto', live: true, source: 'Binance futures', ...(digits ? { digits } : {}) });
export const liveInstruments = [
  spot('BTCUSDT', 'Bitcoin / TetherUS'), spot('ETHUSDT', 'Ethereum / TetherUS'), spot('SOLUSDT', 'Solana / TetherUS'),
  spot('BNBUSDT', 'BNB / TetherUS'), spot('XRPUSDT', 'XRP / TetherUS', 4),
  perpetual('BTCUSDT', 'Bitcoin / TetherUS', 1), perpetual('ETHUSDT', 'Ethereum / TetherUS'), perpetual('SOLUSDT', 'Solana / TetherUS'),
  perpetual('BNBUSDT', 'BNB / TetherUS'), perpetual('XRPUSDT', 'XRP / TetherUS', 4), perpetual('DOGEUSDT', 'Dogecoin / TetherUS', 5)
];
let liveSource = null;
export const useLive = source => { liveSource = source; };
// Additional public markets, discovered through each venue's directory.
const listed = new Map();
export function registerLive(items, refreshedSource) {
  if (refreshedSource) {
    for (const [symbol, item] of listed) if (item.source === refreshedSource) listed.delete(symbol);
  }
  for (const item of items) {
    const symbol = item?.symbol;
    const source = publicInstrument(symbol)?.source ?? (typeof symbol === 'string' && /^[A-Z0-9]{3,24}(\.P)?$/.test(symbol)
      ? (symbol.endsWith('.P') ? 'Binance futures' : 'Binance spot') : null);
    if (!source || liveInstruments.some(known => known.symbol === symbol)) continue;
    listed.set(symbol, { symbol, name: String(item.name ?? symbol).slice(0, 80), type: 'Crypto', live: true, source,
      digits: Number.isInteger(item.digits) ? Math.min(12, Math.max(0, item.digits)) : 2 });
  }
}
export const listedInstruments = () => [...listed.values()];
export const tickerLabel = item => item.symbol.startsWith('HL:@') && item.name.includes(' / ') ? item.name.replace(' / ', '/') : item.symbol;

export const intervals = [...[1, 5, 10, 15, 30, 45].map(seconds => seconds / 60), 1, 2, 3, 5, 10, 15, 30, 45,
  ...Array.from({ length: 12 }, (_, i) => 60 * (i + 1)),
  1440, 2880, 4320, 10080, 20160, 30240, 43200, 129600, 259200, 525600];
const units = { m: 1, h: 60, D: 1440, W: 10080, M: 43200, Y: 525600 };
const wholeSeconds = value => Math.abs(value * 60 - Math.round(value * 60)) < 1e-9;
export const validInterval = value => typeof value === 'number' && value >= 1 / 60 && value <= 10 * units.Y &&
  (Number.isSafeInteger(value) || value < 1 && wholeSeconds(value));
export function parseInterval(input) {
  const match = String(input).trim().match(/^(\d+)\s*([sSmhHDdWwMYy])?$/);
  if (!match) return null;
  const suffix = match[2] ?? 'm';
  if (suffix.toLowerCase() === 's') {
    const value = Number(match[1]) / 60;
    return validInterval(value) ? value : null;
  }
  const unit = suffix === 'H' ? 'h' : suffix === 'm' ? 'm' : suffix.toUpperCase();
  const value = Number(match[1]) * units[unit];
  return validInterval(value) ? value : null;
}
export function intervalLabel(minutes) {
  if (minutes < 1) return Math.round(minutes * 60) + 's';
  for (const [unit, size] of Object.entries(units).reverse()) {
    if (minutes % size === 0) return minutes / size + unit;
  }
  return String(minutes) + 'm';
}
export const intervalName = intervalLabel;
const liveFind = symbol => liveInstruments.find(item => item.symbol === symbol) ?? listed.get(symbol) ?? publicInstrument(symbol);
// While live data is on, a Binance pair wins over a simulated instrument with the same symbol.
export const find = symbol => (liveSource && liveFind(symbol)) || instruments.find(item => item.symbol === symbol) || liveFind(symbol);

const end = Date.UTC(2026, 10, 10);
const cache = new Map();

// Returns a shared, cached array. Callers must not mutate it.
export function series(instrument, minutes) {
  if (!validInterval(minutes)) throw new RangeError('Unsupported interval');
  if (instrument.live) return liveSource?.get(instrument.symbol, minutes) ?? [];
  const key = instrument.symbol + '|' + minutes;
  if (!cache.has(key)) {
    const bars = simulatedBars(instrument, minutes, end);
    // Nothing is cached while the engine is unavailable, so a later retry can fill the chart.
    if (!bars.length) return bars;
    if (cache.size >= 32) cache.delete(cache.keys().next().value);
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
