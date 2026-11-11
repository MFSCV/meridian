// Technical indicators. Every function returns an array aligned with its input, with null during warmup.
const closes = bars => bars.map(bar => bar.close);

function rolling(values, length, reduce) {
  return values.map((_, index) => {
    if (index < length - 1) return null;
    const window = values.slice(index - length + 1, index + 1);
    return window.includes(null) ? null : reduce(window);
  });
}
const mean = window => window.reduce((sum, value) => sum + value, 0) / window.length;

export const sma = (values, length) => rolling(values, length, mean);
export const highest = (values, length) => rolling(values, length, window => Math.max(...window));
export const lowest = (values, length) => rolling(values, length, window => Math.min(...window));
export const stdev = (values, length) => rolling(values, length, window => {
  const average = mean(window);
  return Math.sqrt(mean(window.map(value => (value - average) ** 2)));
});

export function ema(values, length) {
  const out = values.map(() => null);
  const first = values.findIndex(value => value !== null);
  if (first < 0 || first + length > values.length) return out;
  let value = mean(values.slice(first, first + length));
  out[first + length - 1] = value;
  const factor = 2 / (length + 1);
  for (let index = first + length; index < values.length; index++) {
    value += (values[index] - value) * factor;
    out[index] = value;
  }
  return out;
}

export function rsi(values, length) {
  const out = values.map(() => null);
  const first = values.findIndex(value => value !== null);
  if (first < 0) return out;
  let gain = 0;
  let loss = 0;
  for (let index = first + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (index <= first + length) {
      gain += up / length;
      loss += down / length;
    } else {
      gain = (gain * (length - 1) + up) / length;
      loss = (loss * (length - 1) + down) / length;
    }
    if (index >= first + length) out[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export const combine = (left, right, operate) => left.map((value, index) =>
  value === null || right[index] === null ? null : operate(value, right[index]));

export function macd(values, fast, slow, signal) {
  const line = combine(ema(values, fast), ema(values, slow), (a, b) => a - b);
  const smooth = ema(line, signal);
  return { line, signal: smooth, histogram: combine(line, smooth, (a, b) => a - b) };
}

export function bollinger(values, length, width) {
  const middle = sma(values, length);
  const deviation = stdev(values, length);
  return {
    middle, upper: combine(middle, deviation, (a, b) => a + width * b),
    lower: combine(middle, deviation, (a, b) => a - width * b)
  };
}

export function atr(bars, length) {
  const ranges = bars.map((bar, index) => index === 0 ? bar.high - bar.low
    : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1].close), Math.abs(bar.low - bars[index - 1].close)));
  const out = ranges.map(() => null);
  let value = 0;
  ranges.forEach((range, index) => {
    value = index < length ? value + range / length : (value * (length - 1) + range) / length;
    if (index >= length - 1) out[index] = value;
  });
  return out;
}

export function stochastic(bars, length, smooth) {
  const high = highest(bars.map(bar => bar.high), length);
  const low = lowest(bars.map(bar => bar.low), length);
  const k = bars.map((bar, index) => high[index] === null ? null
    : high[index] === low[index] ? 50 : (bar.close - low[index]) / (high[index] - low[index]) * 100);
  return { k, d: sma(k, smooth) };
}

// Volume-weighted average price, restarting each UTC day.
export function vwap(bars) {
  let day;
  let traded = 0;
  let volume = 0;
  return bars.map(bar => {
    const current = Math.floor(bar.time / 86400000);
    if (current !== day) [day, traded, volume] = [current, 0, 0];
    traded += (bar.high + bar.low + bar.close) / 3 * bar.volume;
    volume += bar.volume;
    return traded / volume;
  });
}

export function heikinAshi(bars) {
  const out = [];
  for (const bar of bars) {
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = out.length ? (out.at(-1).open + out.at(-1).close) / 2 : (bar.open + bar.close) / 2;
    out.push({ ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) });
  }
  return out;
}

export const wma = (values, length) => rolling(values, length, window =>
  window.reduce((sum, value, index) => sum + value * (index + 1), 0) / (length * (length + 1) / 2));

// Wilder smoothing: the first value is a plain mean, later values decay by 1/length.
function wilder(values, length) {
  const out = values.map(() => null);
  const first = values.findIndex(value => value !== null);
  if (first < 0 || first + length > values.length) return out;
  let value = mean(values.slice(first, first + length));
  out[first + length - 1] = value;
  for (let index = first + length; index < values.length; index++) {
    value = (value * (length - 1) + values[index]) / length;
    out[index] = value;
  }
  return out;
}

export function donchian(bars, length) {
  const upper = highest(bars.map(bar => bar.high), length);
  const lower = lowest(bars.map(bar => bar.low), length);
  return { upper, lower, middle: combine(upper, lower, (a, b) => (a + b) / 2) };
}

export function keltner(bars, length, width) {
  const middle = ema(closes(bars), length);
  const range = atr(bars, length);
  return { middle, upper: combine(middle, range, (a, b) => a + width * b), lower: combine(middle, range, (a, b) => a - width * b) };
}

export function supertrend(bars, length, width) {
  const range = atr(bars, length);
  let upper;
  let lower;
  let rising = true;
  return bars.map((bar, index) => {
    if (range[index] === null) return null;
    const middle = (bar.high + bar.low) / 2;
    let nextUpper = middle + width * range[index];
    let nextLower = middle - width * range[index];
    if (upper !== undefined) {
      const before = bars[index - 1].close;
      if (!(nextUpper < upper || before > upper)) nextUpper = upper;
      if (!(nextLower > lower || before < lower)) nextLower = lower;
      if (rising && bar.close < nextLower) rising = false;
      else if (!rising && bar.close > nextUpper) rising = true;
    }
    [upper, lower] = [nextUpper, nextLower];
    return rising ? lower : upper;
  });
}

export function parabolicSar(bars, step = 0.02, limit = 0.2) {
  const out = [null];
  if (bars.length < 2) return bars.map(() => null);
  let rising = bars[1].close >= bars[0].close;
  let factor = step;
  let extreme = rising ? bars[0].high : bars[0].low;
  let sar = rising ? bars[0].low : bars[0].high;
  for (let index = 1; index < bars.length; index++) {
    const bar = bars[index];
    const one = bars[index - 1];
    const two = bars[index - 2] ?? one;
    sar += factor * (extreme - sar);
    if (rising) {
      sar = Math.min(sar, one.low, two.low);
      if (bar.low < sar) [rising, sar, extreme, factor] = [false, extreme, bar.low, step];
      else if (bar.high > extreme) [extreme, factor] = [bar.high, Math.min(limit, factor + step)];
    } else {
      sar = Math.max(sar, one.high, two.high);
      if (bar.high > sar) [rising, sar, extreme, factor] = [true, extreme, bar.high, step];
      else if (bar.low < extreme) [extreme, factor] = [bar.low, Math.min(limit, factor + step)];
    }
    out.push(sar);
  }
  return out;
}

export function ichimoku(bars, fast = 9, slow = 26, span = 52) {
  const middle = length => combine(highest(bars.map(bar => bar.high), length), lowest(bars.map(bar => bar.low), length), (a, b) => (a + b) / 2);
  const shift = values => values.map((_, index) => values[index - slow] ?? null);
  const conversion = middle(fast);
  const base = middle(slow);
  return { conversion, base, leadA: shift(combine(conversion, base, (a, b) => (a + b) / 2)), leadB: shift(middle(span)) };
}

export function obv(bars) {
  let total = 0;
  return bars.map((bar, index) => {
    if (index) total += Math.sign(bar.close - bars[index - 1].close) * bar.volume;
    return total;
  });
}

export function cci(bars, length) {
  const typical = bars.map(bar => (bar.high + bar.low + bar.close) / 3);
  return rolling(typical, length, window => {
    const average = mean(window);
    const deviation = mean(window.map(value => Math.abs(value - average)));
    return deviation === 0 ? 0 : (window.at(-1) - average) / (0.015 * deviation);
  });
}

export function williamsR(bars, length) {
  const high = highest(bars.map(bar => bar.high), length);
  const low = lowest(bars.map(bar => bar.low), length);
  return bars.map((bar, index) => high[index] === null ? null : high[index] === low[index] ? -50 : (high[index] - bar.close) / (high[index] - low[index]) * -100);
}

export const roc = (values, length) => values.map((value, index) =>
  index < length || value === null || !values[index - length] ? null : (value / values[index - length] - 1) * 100);

export function mfi(bars, length) {
  const typical = bars.map(bar => (bar.high + bar.low + bar.close) / 3);
  return bars.map((_, index) => {
    if (index < length) return null;
    let up = 0;
    let down = 0;
    for (let at = index - length + 1; at <= index; at++) {
      const flow = typical[at] * bars[at].volume;
      if (typical[at] > typical[at - 1]) up += flow;
      else if (typical[at] < typical[at - 1]) down += flow;
    }
    return down === 0 ? 100 : 100 - 100 / (1 + up / down);
  });
}

export function adx(bars, length) {
  const plus = [null];
  const minus = [null];
  const range = [null];
  for (let index = 1; index < bars.length; index++) {
    const up = bars[index].high - bars[index - 1].high;
    const down = bars[index - 1].low - bars[index].low;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
    range.push(Math.max(bars[index].high - bars[index].low, Math.abs(bars[index].high - bars[index - 1].close), Math.abs(bars[index].low - bars[index - 1].close)));
  }
  const smooth = wilder(range, length);
  const ratio = values => combine(wilder(values, length), smooth, (a, b) => b === 0 ? 0 : a / b * 100);
  const plusDi = ratio(plus);
  const minusDi = ratio(minus);
  return { plusDi, minusDi, adx: wilder(combine(plusDi, minusDi, (a, b) => a + b === 0 ? 0 : Math.abs(a - b) / (a + b) * 100), length) };
}

export function cmf(bars, length) {
  return bars.map((_, index) => {
    if (index < length - 1) return null;
    let flow = 0;
    let volume = 0;
    for (const bar of bars.slice(index - length + 1, index + 1)) {
      flow += bar.high === bar.low ? 0 : ((bar.close - bar.low) - (bar.high - bar.close)) / (bar.high - bar.low) * bar.volume;
      volume += bar.volume;
    }
    return volume ? flow / volume : 0;
  });
}

// Each plot: { label, values, kind: 'line' | 'histogram' | 'volume' | 'dots', color } where color indexes the chart palette.
const line = (label, values, color) => ({ label, values, color });
export const registry = [
  { id: 'volume', name: 'Volume', pane: 'separate', params: { overlay: 0, height: 18 },
    plots: bars => [{ label: 'Vol', kind: 'volume', values: bars.map(bar => bar.volume) }] },
  { id: 'sma', name: 'Moving Average (SMA)', pane: 'overlay', params: { length: 20 },
    plots: (bars, p) => [line('SMA ' + p.length, sma(closes(bars), p.length), 0)] },
  { id: 'ema', name: 'Exponential Moving Average (EMA)', pane: 'overlay', params: { length: 50 },
    plots: (bars, p) => [line('EMA ' + p.length, ema(closes(bars), p.length), 1)] },
  { id: 'wma', name: 'Weighted Moving Average (WMA)', pane: 'overlay', params: { length: 30 },
    plots: (bars, p) => [line('WMA ' + p.length, wma(closes(bars), p.length), 4)] },
  { id: 'bb', name: 'Bollinger Bands', pane: 'overlay', params: { length: 20, width: 2 },
    plots: (bars, p) => {
      const bands = bollinger(closes(bars), p.length, p.width);
      return [line('BB upper', bands.upper, 3), line('BB basis', bands.middle, 1), line('BB lower', bands.lower, 3)];
    } },
  { id: 'donchian', name: 'Donchian Channels', pane: 'overlay', params: { length: 20 },
    plots: (bars, p) => {
      const bands = donchian(bars, p.length);
      return [line('DC upper', bands.upper, 0), line('DC middle', bands.middle, 1), line('DC lower', bands.lower, 0)];
    } },
  { id: 'keltner', name: 'Keltner Channels', pane: 'overlay', params: { length: 20, width: 2 },
    plots: (bars, p) => {
      const bands = keltner(bars, p.length, p.width);
      return [line('KC upper', bands.upper, 2), line('KC middle', bands.middle, 1), line('KC lower', bands.lower, 2)];
    } },
  { id: 'ichimoku', name: 'Ichimoku Cloud', pane: 'overlay', params: { fast: 9, slow: 26, span: 52 },
    plots: (bars, p) => {
      const cloud = ichimoku(bars, p.fast, p.slow, p.span);
      return [line('Conversion', cloud.conversion, 0), line('Base', cloud.base, 4), line('Lead A', cloud.leadA, 3), line('Lead B', cloud.leadB, 1)];
    } },
  { id: 'supertrend', name: 'Supertrend', pane: 'overlay', params: { length: 10, width: 3 },
    plots: (bars, p) => [line('Supertrend', supertrend(bars, p.length, p.width), 3)] },
  { id: 'psar', name: 'Parabolic SAR', pane: 'overlay', params: {},
    plots: bars => [{ label: 'SAR', kind: 'dots', values: parabolicSar(bars), color: 2 }] },
  { id: 'vwap', name: 'VWAP (daily)', pane: 'overlay', params: {},
    plots: bars => [line('VWAP', vwap(bars), 2)] },
  { id: 'rsi', name: 'Relative Strength Index (RSI)', pane: 'separate', params: { length: 14 }, guides: [30, 70], range: [0, 100],
    plots: (bars, p) => [line('RSI ' + p.length, rsi(closes(bars), p.length), 2)] },
  { id: 'macd', name: 'MACD', pane: 'separate', params: { fast: 12, slow: 26, signal: 9 }, guides: [0],
    plots: (bars, p) => {
      const result = macd(closes(bars), p.fast, p.slow, p.signal);
      return [{ label: 'Histogram', kind: 'histogram', values: result.histogram }, line('MACD', result.line, 0), line('Signal', result.signal, 1)];
    } },
  { id: 'stoch', name: 'Stochastic', pane: 'separate', params: { length: 14, smooth: 3 }, guides: [20, 80], range: [0, 100],
    plots: (bars, p) => {
      const result = stochastic(bars, p.length, p.smooth);
      return [line('%K', result.k, 0), line('%D', result.d, 1)];
    } },
  { id: 'atr', name: 'Average True Range (ATR)', pane: 'separate', params: { length: 14 },
    plots: (bars, p) => [line('ATR ' + p.length, atr(bars, p.length), 4)] },
  { id: 'adx', name: 'Average Directional Index (ADX)', pane: 'separate', params: { length: 14 }, guides: [25],
    plots: (bars, p) => {
      const result = adx(bars, p.length);
      return [line('ADX', result.adx, 2), line('+DI', result.plusDi, 3), line('−DI', result.minusDi, 4)];
    } },
  { id: 'cci', name: 'Commodity Channel Index (CCI)', pane: 'separate', params: { length: 20 }, guides: [-100, 100],
    plots: (bars, p) => [line('CCI ' + p.length, cci(bars, p.length), 0)] },
  { id: 'williams', name: 'Williams %R', pane: 'separate', params: { length: 14 }, guides: [-80, -20], range: [-100, 0],
    plots: (bars, p) => [line('%R ' + p.length, williamsR(bars, p.length), 1)] },
  { id: 'mfi', name: 'Money Flow Index (MFI)', pane: 'separate', params: { length: 14 }, guides: [20, 80], range: [0, 100],
    plots: (bars, p) => [line('MFI ' + p.length, mfi(bars, p.length), 3)] },
  { id: 'roc', name: 'Rate of Change (ROC)', pane: 'separate', params: { length: 12 }, guides: [0],
    plots: (bars, p) => [line('ROC ' + p.length, roc(closes(bars), p.length), 5)] },
  { id: 'obv', name: 'On-Balance Volume (OBV)', pane: 'separate', params: {},
    plots: bars => [line('OBV', obv(bars), 0)] },
  { id: 'cmf', name: 'Chaikin Money Flow (CMF)', pane: 'separate', params: { length: 20 }, guides: [0],
    plots: (bars, p) => [line('CMF ' + p.length, cmf(bars, p.length), 3)] },
  { id: 'stdev', name: 'Standard Deviation', pane: 'separate', params: { length: 20 },
    plots: (bars, p) => [line('StdDev ' + p.length, stdev(closes(bars), p.length), 1)] }
];
export const definition = id => registry.find(item => item.id === id);
