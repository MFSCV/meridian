import assert from 'node:assert/strict';
import test from 'node:test';
import { csv, instruments, intervals, movingAverage, series } from './market.mjs';

const combine = chunk => ({
  time: chunk[0].time, open: chunk[0].open,
  high: Math.max(...chunk.map(bar => bar.high)), low: Math.min(...chunk.map(bar => bar.low)),
  close: chunk.at(-1).close, volume: chunk.reduce((sum, bar) => sum + bar.volume, 0)
});

test('synthetic history is deterministic, positive and continuous for every symbol', () => {
  assert.equal(instruments.length, 18);
  for (const instrument of instruments) {
    for (const [minutes, length] of [[60, 3456], [5, 41472]]) {
      const bars = series(instrument, minutes);
      assert.equal(bars.length, length);
      for (const [index, bar] of bars.entries()) {
        assert.ok(bar.low > 0 && bar.volume > 0);
        assert.ok(bar.low <= Math.min(bar.open, bar.close));
        assert.ok(bar.high >= Math.max(bar.open, bar.close));
        if (index > 0) {
          assert.equal(bar.time - bars[index - 1].time, minutes * 60000);
          assert.equal(bar.open, bars[index - 1].close);
        }
      }
    }
  }
});

test('every interval aggregates the same underlying history', () => {
  for (const instrument of instruments.slice(0, 7)) {
    for (const [minutes, base] of [[15, 5], [30, 5], [60, 5], [120, 60], [240, 60], [720, 60], [1440, 60], [10080, 60]]) {
      const source = series(instrument, base);
      const size = minutes / base;
      const bars = series(instrument, minutes);
      assert.equal(bars.length, Math.ceil(source.length / size));
      bars.forEach((bar, index) => assert.deepEqual(bar, combine(source.slice(index * size, (index + 1) * size))));
    }
  }
  assert.deepEqual(intervals, [5, 15, 30, 60, 120, 240, 720, 1440, 10080]);
  assert.throws(() => series(instruments[0], 7), RangeError);
});

test('moving average and CSV preserve warmup, time and values', () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4].map(close => ({ close })), 3), [null, null, 2, 3]);
  assert.equal(csv([{ time: 0, open: 1, high: 3, low: 1, close: 2, volume: 12 }]),
    'Time (UTC),Open,High,Low,Close,Volume\r\n1970-01-01T00:00:00.000Z,1,3,1,2,12');
});
