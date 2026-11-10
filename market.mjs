import { simulatedBars } from './market-engine.mjs';

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

// Shown only when the visitor turns on live data. Prices come from the visitor's own connection to Binance.
export const liveInstruments = [
  { symbol: 'BTCUSDT', name: 'Bitcoin / TetherUS', type: 'Crypto', live: true, source: 'Binance spot' },
  { symbol: 'ETHUSDT', name: 'Ethereum / TetherUS', type: 'Crypto', live: true, source: 'Binance spot' },
  { symbol: 'SOLUSDT', name: 'Solana / TetherUS', type: 'Crypto', live: true, source: 'Binance spot' },
  { symbol: 'BNBUSDT', name: 'BNB / TetherUS', type: 'Crypto', live: true, source: 'Binance spot' },
  { symbol: 'XRPUSDT', name: 'XRP / TetherUS', type: 'Crypto', live: true, source: 'Binance spot', digits: 4 }
];
let liveSource = null;
export const useLive = source => { liveSource = source; };

export const intervals = [5, 15, 30, 60, 120, 240, 720, 1440, 10080];
export const intervalLabel = minutes => minutes < 60 ? minutes + 'm' : minutes < 1440 ? minutes / 60 + 'h'
  : minutes === 1440 ? '1D' : '1W';
export const intervalName = minutes => minutes < 60 ? minutes + ' minutes' : minutes === 60 ? '1 hour'
  : minutes < 1440 ? minutes / 60 + ' hours' : minutes === 1440 ? '1 day' : '1 week';
export const find = symbol => instruments.find(item => item.symbol === symbol) ?? liveInstruments.find(item => item.symbol === symbol);

const end = Date.UTC(2026, 10, 10);
const cache = new Map();

// Returns a shared, cached array. Callers must not mutate it.
export function series(instrument, minutes) {
  if (!intervals.includes(minutes)) throw new RangeError('Unsupported interval');
  if (instrument.live) return liveSource?.get(instrument.symbol, minutes) ?? [];
  const key = instrument.symbol + '|' + minutes;
  if (!cache.has(key)) cache.set(key, simulatedBars(instrument, minutes, end));
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
