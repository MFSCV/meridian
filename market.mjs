import { simulatedBars, engineError, loadEngine } from './market-engine.mjs';
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
// Every other pair Binance lists, found through symbol search once the list has been downloaded.
const listed = new Map();
export function registerLive(items) {
  for (const item of items) {
    if (typeof item?.symbol === 'string' && /^[A-Z0-9]{3,24}(.P)?$/.test(item.symbol) && !liveInstruments.some(known => known.symbol === item.symbol)) {
      listed.set(item.symbol, { symbol: item.symbol, name: String(item.name ?? item.symbol).slice(0, 60), type: 'Crypto', live: true,
        source: item.symbol.endsWith('.P') ? 'Binance futures' : 'Binance spot', digits: Number.isInteger(item.digits) ? Math.min(8, Math.max(0, item.digits)) : 2 });
    }
  }
}
export const listedInstruments = () => [...listed.values()];

export const intervals = [5, 15, 30, 60, 120, 240, 720, 1440, 10080];
export const intervalLabel = minutes => minutes < 60 ? minutes + 'm' : minutes < 1440 ? minutes / 60 + 'h'
  : minutes === 1440 ? '1D' : '1W';
export const intervalName = minutes => minutes < 60 ? minutes + ' minutes' : minutes === 60 ? '1 hour'
  : minutes < 1440 ? minutes / 60 + ' hours' : minutes === 1440 ? '1 day' : '1 week';
const liveFind = symbol => liveInstruments.find(item => item.symbol === symbol) ?? listed.get(symbol);
// While live data is on, a Binance pair wins over a simulated instrument with the same symbol.
export const find = symbol => (liveSource && liveFind(symbol)) || instruments.find(item => item.symbol === symbol) || liveFind(symbol);

const end = Date.UTC(2026, 10, 10);
const cache = new Map();

// Returns a shared, cached array. Callers must not mutate it.
export function series(instrument, minutes) {
  if (!intervals.includes(minutes)) throw new RangeError('Unsupported interval');
  if (instrument.live) return liveSource?.get(instrument.symbol, minutes) ?? [];
  const key = instrument.symbol + '|' + minutes;
  if (!cache.has(key)) {
    const bars = simulatedBars(instrument, minutes, end);
    // Nothing is cached while the engine is unavailable, so a later retry can fill the chart.
    if (!bars.length) return bars;
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
