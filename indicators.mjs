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

const combine = (left, right, operate) => left.map((value, index) =>
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

// Formula language: numbers, + - * /, parentheses, price fields and the functions below.
const functions = {
  sma: [2, sma], ema: [2, ema], rsi: [2, rsi], highest: [2, highest], lowest: [2, lowest], stdev: [2, stdev],
  abs: [1, values => values.map(value => value === null ? null : Math.abs(value))],
  max: [2, (a, b) => combine(a, b, Math.max)], min: [2, (a, b) => combine(a, b, Math.min)],
  change: [2, (values, length) => values.map((value, index) =>
    index < length || value === null || values[index - length] === null ? null : value - values[index - length])]
};
const fields = {
  open: bar => bar.open, high: bar => bar.high, low: bar => bar.low, close: bar => bar.close,
  volume: bar => bar.volume, hl2: bar => (bar.high + bar.low) / 2, hlc3: bar => (bar.high + bar.low + bar.close) / 3
};
export const formulaHelp = { functions: Object.keys(functions), fields: Object.keys(fields) };

export function compileFormula(source) {
  const tokens = source.match(/\s*(\d+\.?\d*|\.\d+|[A-Za-z_]\w*|[-+*/(),]|\S)/g)?.map(token => token.trim()) ?? [];
  if (!tokens.length) throw new SyntaxError('Enter a formula');
  let position = 0;
  const take = expected => {
    if (expected && tokens[position] !== expected) throw new SyntaxError('Expected "' + expected + '"');
    return tokens[position++];
  };
  const binary = (next, operators) => () => {
    let node = next();
    while (operators.includes(tokens[position])) node = [take(), node, next()];
    return node;
  };
  const primary = () => {
    const token = take();
    if (token === undefined) throw new SyntaxError('Formula ends too early');
    if (token === '-') return ['*', -1, primary()];
    if (token === '(') {
      const node = sum();
      take(')');
      return node;
    }
    if (/^[\d.]/.test(token)) return Number(token);
    if (functions[token]) {
      take('(');
      const args = [sum()];
      while (tokens[position] === ',') {
        take();
        args.push(sum());
      }
      take(')');
      if (args.length !== functions[token][0]) throw new SyntaxError(token + ' takes ' + functions[token][0] + ' arguments');
      return ['call', token, args];
    }
    if (fields[token]) return ['field', token];
    throw new SyntaxError('Unknown name "' + token + '"');
  };
  const sum = binary(binary(primary, ['*', '/']), ['+', '-']);
  const tree = sum();
  if (position < tokens.length) throw new SyntaxError('Unexpected "' + tokens[position] + '"');
  const math = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => b === 0 ? null : a / b };
  return bars => {
    const spread = value => typeof value === 'number' ? bars.map(() => value) : value;
    const run = node => {
      if (typeof node === 'number') return node;
      if (node[0] === 'field') return bars.map(fields[node[1]]);
      if (node[0] === 'call') {
        const args = node[2].map(run);
        const [, apply] = functions[node[1]];
        if (['max', 'min'].includes(node[1])) return apply(spread(args[0]), spread(args[1]));
        if (args.length === 2 && (typeof args[1] !== 'number' || args[1] < 1 || args[1] > 500 || !Number.isInteger(args[1]))) {
          throw new RangeError(node[1] + ' needs a whole length from 1 to 500');
        }
        return apply(spread(args[0]), args[1]);
      }
      const [left, right] = [run(node[1]), run(node[2])];
      return typeof left === 'number' && typeof right === 'number' ? math[node[0]](left, right)
        : combine(spread(left), spread(right), math[node[0]]);
    };
    return spread(run(tree));
  };
}

// Each plot: { label, values, kind: 'line' | 'histogram' | 'volume', color } where color indexes the chart palette.
export const registry = [
  { id: 'volume', name: 'Volume', pane: 'overlay', params: {},
    plots: bars => [{ label: 'Vol', kind: 'volume', values: bars.map(bar => bar.volume) }] },
  { id: 'sma', name: 'Moving Average (SMA)', pane: 'overlay', params: { length: 20 },
    plots: (bars, p) => [{ label: 'SMA ' + p.length, values: sma(closes(bars), p.length), color: 0 }] },
  { id: 'ema', name: 'Exponential Moving Average (EMA)', pane: 'overlay', params: { length: 50 },
    plots: (bars, p) => [{ label: 'EMA ' + p.length, values: ema(closes(bars), p.length), color: 1 }] },
  { id: 'bb', name: 'Bollinger Bands', pane: 'overlay', params: { length: 20, width: 2 },
    plots: (bars, p) => {
      const bands = bollinger(closes(bars), p.length, p.width);
      return [{ label: 'BB upper', values: bands.upper, color: 3 }, { label: 'BB basis', values: bands.middle, color: 1 },
        { label: 'BB lower', values: bands.lower, color: 3 }];
    } },
  { id: 'vwap', name: 'VWAP (daily)', pane: 'overlay', params: {},
    plots: bars => [{ label: 'VWAP', values: vwap(bars), color: 2 }] },
  { id: 'rsi', name: 'Relative Strength Index (RSI)', pane: 'separate', params: { length: 14 }, guides: [30, 70], range: [0, 100],
    plots: (bars, p) => [{ label: 'RSI ' + p.length, values: rsi(closes(bars), p.length), color: 2 }] },
  { id: 'macd', name: 'MACD', pane: 'separate', params: { fast: 12, slow: 26, signal: 9 }, guides: [0],
    plots: (bars, p) => {
      const result = macd(closes(bars), p.fast, p.slow, p.signal);
      return [{ label: 'Histogram', kind: 'histogram', values: result.histogram },
        { label: 'MACD', values: result.line, color: 0 }, { label: 'Signal', values: result.signal, color: 1 }];
    } },
  { id: 'stoch', name: 'Stochastic', pane: 'separate', params: { length: 14, smooth: 3 }, guides: [20, 80], range: [0, 100],
    plots: (bars, p) => {
      const result = stochastic(bars, p.length, p.smooth);
      return [{ label: '%K', values: result.k, color: 0 }, { label: '%D', values: result.d, color: 1 }];
    } },
  { id: 'atr', name: 'Average True Range (ATR)', pane: 'separate', params: { length: 14 },
    plots: (bars, p) => [{ label: 'ATR ' + p.length, values: atr(bars, p.length), color: 4 }] },
  { id: 'formula', name: 'Custom formula', pane: 'separate', params: { expression: 'close - sma(close, 20)', name: 'Formula', overlay: 0 },
    plots: (bars, p) => [{ label: p.name, values: compileFormula(p.expression)(bars), color: 5 }] }
];
export const definition = id => registry.find(item => item.id === id);
