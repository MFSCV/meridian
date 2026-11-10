import assert from 'node:assert/strict';
import test from 'node:test';
import { atr, bollinger, compileFormula, ema, heikinAshi, macd, registry, rsi, sma, stochastic, vwap } from './indicators.mjs';
import { instruments, series } from './market.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' is not ' + expected);

test('averages, bands and oscillators match hand-computed values', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepEqual(ema([null, 2, 4, 8], 2), [null, null, 3, 8 * 2 / 3 + 3 / 3]);
  const bands = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  near(bands.middle[7], 5);
  near(bands.upper[7], 9);
  near(bands.lower[7], 1);
  assert.equal(rsi([1, 2, 3, 4, 5], 3).at(-1), 100);
  near(rsi([10, 11, 10, 11, 10], 2).at(-1), 100 - 100 / (1 + 0.375 / 0.625));
  assert.deepEqual(rsi([1, 2], 3), [null, null]);
  const flat = macd(Array(40).fill(7), 12, 26, 9);
  assert.equal(flat.line.at(-1), 0);
  assert.equal(flat.histogram.at(-1), 0);
  assert.equal(flat.line[24], null);
});

test('bar-based studies respect ranges and sessions', () => {
  const bars = [
    { time: 0, open: 10, high: 12, low: 9, close: 11, volume: 100 },
    { time: 3600000, open: 11, high: 13, low: 10, close: 12, volume: 300 },
    { time: 86400000, open: 12, high: 16, low: 12, close: 14, volume: 50 }
  ];
  assert.deepEqual(atr(bars, 2), [null, 3, 3.5]);
  near(vwap(bars)[1], ((12 + 9 + 11) / 3 * 100 + (13 + 10 + 12) / 3 * 300) / 400);
  near(vwap(bars)[2], 14);
  assert.deepEqual(stochastic(bars, 2, 1).k, [null, 75, 4 / 6 * 100]);
  const candles = heikinAshi(bars);
  assert.equal(candles[0].close, 10.5);
  assert.equal(candles[1].open, (candles[0].open + candles[0].close) / 2);
  for (const candle of candles) assert.ok(candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close));
});

test('formulas parse precedence, functions and reject invalid input', () => {
  const bars = [1, 2, 3, 4].map(close => ({ open: close, high: close + 1, low: close - 1, close, volume: 10 }));
  assert.deepEqual(compileFormula('close * 2 + 1')(bars), [3, 5, 7, 9]);
  assert.deepEqual(compileFormula('-(high - low) / 2')(bars), [-1, -1, -1, -1]);
  assert.deepEqual(compileFormula('close - sma(close, 2)')(bars), [null, 0.5, 0.5, 0.5]);
  assert.deepEqual(compileFormula('max(close, 2.5)')(bars), [2.5, 2.5, 3, 4]);
  assert.deepEqual(compileFormula('close / 0')(bars), [null, null, null, null]);
  assert.deepEqual(compileFormula('7')(bars), [7, 7, 7, 7]);
  for (const source of ['', 'close +', 'unknown', 'sma(close)', 'close )', 'alert(1)', 'close.constructor']) {
    assert.throws(() => compileFormula(source), SyntaxError, source);
  }
  assert.throws(() => compileFormula('sma(close, 0)')(bars), RangeError);
  assert.throws(() => compileFormula('sma(close, close)')(bars), RangeError);
});

test('every registered indicator returns plots aligned with the bars', () => {
  const bars = series(instruments[0], 1440);
  for (const spec of registry) {
    const plots = spec.plots(bars, spec.params);
    assert.ok(plots.length > 0, spec.id);
    for (const plot of plots) {
      assert.equal(plot.values.length, bars.length, spec.id);
      assert.ok(Number.isFinite(plot.values.at(-1)), spec.id);
    }
  }
});
