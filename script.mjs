// Formula and strategy language, and the backtester. Scripts are parsed, never passed to eval or Function.
//
//   fast = ema(close, 12)          assignment
//   plot fast as Fast average      draws a line
//   buy when crossover(fast, slow) strategy entry
//   sell when crossunder(fast, slow)
//
// A script that is a single expression is treated as one plot.
import { combine, ema, highest, lowest, registry, rsi, sma, stdev, wma } from './indicators.mjs';

const series = (bars, value) => typeof value === 'number' ? bars.map(() => value) : value;
const cross = direction => (a, b) => a.map((value, index) => {
  const [before, other, otherBefore] = [a[index - 1], b[index], b[index - 1]];
  if ([value, before, other, otherBefore].some(item => item === null || item === undefined)) return index ? null : 0;
  return Number(direction * (value - other) > 0 && direction * (before - otherBefore) <= 0);
});
// [argument count, implementation, true when the second argument is a bar length]
const functions = {
  sma: [2, sma, true], ema: [2, ema, true], wma: [2, wma, true], rsi: [2, rsi, true], highest: [2, highest, true], lowest: [2, lowest, true],
  stdev: [2, stdev, true],
  change: [2, (values, length) => values.map((value, index) =>
    index < length || value === null || values[index - length] === null ? null : value - values[index - length]), true],
  abs: [1, values => values.map(value => value === null ? null : Math.abs(value))],
  max: [2, (a, b) => combine(a, b, Math.max)], min: [2, (a, b) => combine(a, b, Math.min)],
  crossover: [2, cross(1)], crossunder: [2, cross(-1)]
};
const fields = {
  open: bar => bar.open, high: bar => bar.high, low: bar => bar.low, close: bar => bar.close,
  volume: bar => bar.volume, hl2: bar => (bar.high + bar.low) / 2, hlc3: bar => (bar.high + bar.low + bar.close) / 3
};
const words = ['and', 'or', 'not', 'plot', 'buy', 'sell', 'when', 'as'];
export const formulaHelp = { functions: Object.keys(functions), fields: Object.keys(fields) };

const math = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => b === 0 ? null : a / b,
  '>': (a, b) => Number(a > b), '<': (a, b) => Number(a < b), '>=': (a, b) => Number(a >= b), '<=': (a, b) => Number(a <= b),
  '==': (a, b) => Number(a === b), '!=': (a, b) => Number(a !== b), and: (a, b) => Number(Boolean(a && b)), or: (a, b) => Number(Boolean(a || b))
};

function parse(source, scope) {
  const tokens = source.match(/\s*(\d+\.?\d*|\.\d+|[A-Za-z_]\w*|>=|<=|==|!=|[-+*/(),<>]|\S)/g)?.map(token => token.trim()) ?? [];
  if (!tokens.length) throw new SyntaxError('Enter a formula');
  let position = 0;
  const take = expected => {
    if (expected && tokens[position] !== expected) throw new SyntaxError('Expected "' + expected + '"');
    return tokens[position++];
  };
  const binary = (next, operators) => () => {
    let tree = next();
    while (operators.includes(tokens[position])) tree = [take(), tree, next()];
    return tree;
  };
  const primary = () => {
    const token = take();
    if (token === undefined) throw new SyntaxError('Formula ends too early');
    if (token === '-') return ['*', -1, primary()];
    if (token === '(') {
      const tree = top();
      take(')');
      return tree;
    }
    if (/^[\d.]/.test(token)) return Number(token);
    if (Object.hasOwn(functions, token)) {
      take('(');
      const args = [top()];
      while (tokens[position] === ',') {
        take();
        args.push(top());
      }
      take(')');
      if (args.length !== functions[token][0]) throw new SyntaxError(token + ' takes ' + functions[token][0] + ' arguments');
      return ['call', token, args];
    }
    if (Object.hasOwn(fields, token)) return ['field', token];
    if (scope.has(token)) return ['name', token];
    throw new SyntaxError('Unknown name "' + token + '"');
  };
  const compare = binary(binary(binary(primary, ['*', '/']), ['+', '-']), ['>', '<', '>=', '<=', '==', '!=']);
  const negate = () => tokens[position] === 'not' ? (take(), ['not', negate()]) : compare();
  const top = binary(binary(negate, ['and']), ['or']);
  const tree = top();
  if (position < tokens.length) throw new SyntaxError('Unexpected "' + tokens[position] + '"');
  return tree;
}

function evaluate(tree, bars, names) {
  if (typeof tree === 'number') return tree;
  if (tree[0] === 'field') return bars.map(fields[tree[1]]);
  if (tree[0] === 'name') return names[tree[1]];
  if (tree[0] === 'not') {
    const value = evaluate(tree[1], bars, names);
    return typeof value === 'number' ? Number(!value) : value.map(item => item === null ? null : Number(!item));
  }
  if (tree[0] === 'call') {
    const args = tree[2].map(item => evaluate(item, bars, names));
    const [, apply, needsLength] = functions[tree[1]];
    if (!needsLength) return apply(...args.map(item => series(bars, item)));
    if (typeof args[1] !== 'number' || !Number.isInteger(args[1]) || args[1] < 1 || args[1] > 500) {
      throw new RangeError(tree[1] + ' needs a whole length from 1 to 500');
    }
    return apply(series(bars, args[0]), args[1]);
  }
  const [left, right] = [evaluate(tree[1], bars, names), evaluate(tree[2], bars, names)];
  return typeof left === 'number' && typeof right === 'number' ? math[tree[0]](left, right)
    : combine(series(bars, left), series(bars, right), math[tree[0]]);
}

// One expression, returning one value per bar.
export function compileFormula(source) {
  const tree = parse(source, new Set());
  return bars => series(bars, evaluate(tree, bars, {}));
}

// A whole script, returning { plots, buy, sell, strategy } for a set of bars.
export function compileScript(source) {
  const lines = source.split('\n').map(line => line.replace(/(#|\/\/).*$/, '').trim());
  const count = lines.filter(Boolean).length;
  if (!count) throw new SyntaxError('Enter a formula');
  const scope = new Set();
  const steps = [];
  lines.forEach((line, number) => {
    if (!line) return;
    try {
      let match;
      if ((match = /^plot\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line))) steps.push({ kind: 'plot', tree: parse(match[1], scope), label: match[2] ?? match[1] });
      else if ((match = /^(buy|sell)\s+when\s+(.+)$/i.exec(line))) steps.push({ kind: match[1].toLowerCase(), tree: parse(match[2], scope) });
      else if ((match = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/.exec(line))) {
        if (Object.hasOwn(functions, match[1]) || Object.hasOwn(fields, match[1]) || words.includes(match[1])) {
          throw new SyntaxError('"' + match[1] + '" is a reserved name');
        }
        steps.push({ kind: 'set', name: match[1], tree: parse(match[2], scope) });
        scope.add(match[1]);
      } else if (count === 1) steps.push({ kind: 'plot', tree: parse(line, scope), label: null });
      else throw new SyntaxError('Expected an assignment, plot, buy when or sell when');
    } catch (problem) {
      if (count > 1) problem.message = 'Line ' + (number + 1) + ': ' + problem.message;
      throw problem;
    }
  });
  const strategy = steps.some(step => step.kind === 'buy') && steps.some(step => step.kind === 'sell');
  return Object.assign(bars => {
    const names = {};
    const result = { plots: [], buy: bars.map(() => 0), sell: bars.map(() => 0), strategy };
    for (const step of steps) {
      const values = series(bars, evaluate(step.tree, bars, names));
      if (step.kind === 'set') names[step.name] = values;
      else if (step.kind === 'plot') result.plots.push({ label: step.label, values });
      else values.forEach((value, index) => { if (value) result[step.kind][index] = 1; });
    }
    return result;
  }, { strategy });
}

// Long-only, all-in backtest. A signal on one bar is filled at the next bar's open.
export function backtest(bars, buy, sell, { capital = 10000, fee = 0.001 } = {}) {
  let cash = capital;
  let units = 0;
  let open = null;
  let peak = capital;
  let drawdown = 0;
  const trades = [];
  const equity = [];
  bars.forEach((bar, index) => {
    if (index && !units && buy[index - 1]) {
      open = { entryTime: bar.time, entryPrice: bar.open, entryIndex: index, stake: cash };
      units = cash * (1 - fee) / bar.open;
      cash = 0;
    } else if (index && units && sell[index - 1]) {
      cash = units * bar.open * (1 - fee);
      trades.push({ ...open, exitTime: bar.time, exitPrice: bar.open, exitIndex: index, profit: cash - open.stake, change: cash / open.stake - 1 });
      [units, open] = [0, null];
    }
    const value = cash + units * bar.close;
    equity.push(value);
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, 1 - value / peak);
  });
  const gains = trades.filter(trade => trade.profit > 0).reduce((sum, trade) => sum + trade.profit, 0);
  const losses = trades.filter(trade => trade.profit < 0).reduce((sum, trade) => sum - trade.profit, 0);
  return {
    trades, open, equity, capital, drawdown,
    net: equity.length ? equity.at(-1) / capital - 1 : 0,
    winRate: trades.length ? trades.filter(trade => trade.profit > 0).length / trades.length : null,
    profitFactor: losses ? gains / losses : null,
    buyHold: bars.length ? bars.at(-1).close / bars[0].open - 1 : 0
  };
}

registry.push({
  id: 'formula', name: 'Custom formula or script', pane: 'separate', params: { expression: 'close - sma(close, 20)', name: 'Formula', overlay: 0 },
  plots: (bars, params) => compileScript(params.expression)(bars).plots.map((plot, index, all) => ({
    label: plot.label && all.length > 1 ? plot.label : params.name, values: plot.values, color: (5 + index) % 6
  }))
});
