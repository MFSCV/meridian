import assert from 'node:assert/strict';
import test from 'node:test';
import { definition, registry } from './indicators.mjs';
import { dailyLevels, liquidationLevels, psyLevels, pvsraFlags, sessionRanges, sessions, vectorZones, volumeProfile, vwapBands, weekly, zoneOffset } from './pvsra.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const bar = (time, open, high, low, close, volume = 100) => ({ time, open, high, low, close, volume });
// Ten quiet bars around 100, so every later bar is measured against an average volume of 100 and a spread of 2.
const quiet = (count = 10, start = 0, step = HOUR) => Array.from({ length: count }, (_, index) => bar(start + index * step, 100, 101, 99, 100.5, 100));
const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

test('vector candles follow the PVSRA volume rules', () => {
  const bars = [...quiet(),
    bar(10 * HOUR, 100, 100.5, 99.5, 100.2, 120), // ordinary volume
    bar(11 * HOUR, 100, 100.5, 99.5, 99.8, 160),  // at least 1.5 times the average, falling
    bar(12 * HOUR, 100, 100.5, 99.5, 100.2, 250), // at least twice the average
    bar(13 * HOUR, 100, 110, 99, 99, 140)];      // modest volume but the widest spread x volume
  assert.deepEqual(pvsraFlags(bars).slice(10), [1, -2, 3, -3]);
  assert.deepEqual(pvsraFlags(bars).slice(0, 10), new Array(10).fill(1), 'bars without ten bars of history are regular');
  assert.equal(pvsraFlags([bar(0, 5, 6, 4, 5)])[0], -1, 'an unchanged bar counts as down, as in the original');
});

test('vector zones open after a vector candle, are trimmed by wicks and cleared when price returns', () => {
  const start = [...quiet(), bar(10 * HOUR, 100, 106, 99.5, 105, 400)];   // climax up: body 100 to 105
  // Price stays above: one zone under price covering the whole body.
  let bars = [...start, bar(11 * HOUR, 105.5, 107, 105.2, 106, 100)];
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars)), [{ from: 10, top: 105, bottom: 100, flag: 3, order: 1 }]);
  // A low dips into the zone: the part it touched is trimmed away.
  bars = [...bars, bar(12 * HOUR, 106, 106.5, 103, 104, 100)];
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars)).map(zone => [zone.top, zone.bottom]), [[103, 100]]);
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars), { trim: false }).map(zone => [zone.top, zone.bottom]), [[105, 100]]);
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars), { wicks: true }).map(zone => [zone.top, zone.bottom]), [[103, 99.5]]);
  // A low reaches the bottom of the zone: it is gone.
  bars = [...bars, bar(13 * HOUR, 104, 104.5, 99.8, 100.2, 100)];
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars)), []);
  // A falling vector candle leaves its zone above price, and old zones expire after `max` newer vector candles.
  bars = [...quiet(), bar(10 * HOUR, 100, 100.5, 94, 95, 400), bar(11 * HOUR, 94.5, 94.8, 93, 93.5, 100)];
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars)).map(zone => [zone.top, zone.bottom, zone.flag]), [[100, 95, -3]]);
  bars = [...bars, bar(12 * HOUR, 93.5, 93.6, 88, 89, 900), bar(13 * HOUR, 88.5, 88.8, 87, 87.5, 100)];
  assert.equal(vectorZones(bars, pvsraFlags(bars)).length, 2);
  assert.deepEqual(vectorZones(bars, pvsraFlags(bars), { max: 1 }).map(zone => zone.from), [12]);
});

test('daily levels: pivots, M levels, ranges and last week', () => {
  const monday = Date.UTC(2026, 0, 5);
  const days = Array.from({ length: 16 }, (_, index) => bar(monday + index * DAY, 100, 110, 90, 105, 1000));
  days[14] = bar(monday + 14 * DAY, 100, 120, 80, 110, 1000);            // yesterday
  days[15] = bar(monday + 15 * DAY, 110, 112, 108, 111, 1000);           // today: a 4-point range so far, rising
  const levels = dailyLevels(days, { adr: 14 });
  assert.deepEqual([levels.dayHigh, levels.dayLow, levels.open, levels.start], [120, 80, 110, monday + 15 * DAY]);
  const pivot = (120 + 80 + 110) / 3;
  assert.ok(near(levels.pivot, pivot));
  assert.ok(near(levels.r1, 2 * pivot - 80) && near(levels.s1, 2 * pivot - 120));
  assert.ok(near(levels.r2, pivot + 40) && near(levels.s2, pivot - 40));
  assert.ok(near(levels.r3, 2 * pivot + 120 - 160) && near(levels.s3, 2 * pivot - 160));
  assert.ok(near(levels.m3, (pivot + levels.r1) / 2) && near(levels.m0, (levels.s2 + levels.s3) / 2) && near(levels.m5, (levels.r2 + levels.r3) / 2));
  // The fourteen days before today: twelve quiet days of range 20, the day before yesterday (also 20) and yesterday's 40.
  const adr = (13 * 20 + 40) / 14;
  assert.ok(near(levels.adr, adr));
  // Today has moved less than the average and is rising: the range is projected up from today's low and down from its high.
  assert.ok(near(levels.adrHigh, 108 + adr) && near(levels.adrLow, 112 - adr));
  // Weeks start on Monday: last week is days 7 to 13, and the current week holds yesterday and today.
  assert.deepEqual(weekly(days).map(week => [week.time, week.high, week.low]), [[monday, 110, 90], [monday + 7 * DAY, 110, 90], [monday + 14 * DAY, 120, 80]]);
  assert.deepEqual([levels.weekHigh, levels.weekLow], [110, 90]);
  assert.equal(dailyLevels(days.slice(0, 1)), null);
  assert.equal(dailyLevels(days.slice(0, 5)).adr, null, 'too little history leaves the average range unknown');
});

test('sessions follow each exchange clock through daylight saving', () => {
  assert.equal(zoneOffset('Europe/London', Date.UTC(2026, 0, 15)), 0);
  assert.equal(zoneOffset('Europe/London', Date.UTC(2026, 6, 15)), HOUR);
  assert.equal(zoneOffset('America/New_York', Date.UTC(2026, 0, 15)), -5 * HOUR);
  assert.equal(zoneOffset('Asia/Tokyo', Date.UTC(2026, 6, 15)), 9 * HOUR);
  const london = sessions.find(session => session.name === 'London');
  const hours = (start, count) => Array.from({ length: count }, (_, index) => bar(start + index * HOUR, 100, 101 + index, 99 - index, 100));
  // Thursday 15 January: London runs 08:00 to 16:30 UTC. Hourly bars from 06:00 to 19:00.
  const winter = sessionRanges(hours(Date.UTC(2026, 0, 15, 6), 14), london, 60);
  assert.deepEqual(winter.map(range => [range.from, range.to, range.openHigh, range.openLow, range.high, range.low]), [[2, 11, 103, 97, 111, 89]]);
  // Wednesday 15 July: British summer time, so the session starts at 07:00 UTC.
  assert.deepEqual(sessionRanges(hours(Date.UTC(2026, 6, 15, 6), 14), london, 60).map(range => range.from), [1]);
  // Saturday 17 January: no session unless weekends are switched on.
  assert.deepEqual(sessionRanges(hours(Date.UTC(2026, 0, 17, 6), 14), london, 60), []);
  assert.equal(sessionRanges(hours(Date.UTC(2026, 0, 17, 6), 14), london, 60, true).length, 1);
});

test('weekly psy levels come from the Sydney open that starts the week', () => {
  // Saturday 17 January 2026, Sydney on summer time: the window is 21:00 UTC Saturday to 05:00 UTC Sunday.
  const summer = Date.UTC(2026, 0, 17, 18);
  const run = start => Array.from({ length: 20 }, (_, index) => bar(start + index * HOUR, 100, 100 + index, 100 - index, 100));
  assert.deepEqual(psyLevels(run(summer)), { from: 3, high: 110, low: 90 });
  // Saturday 18 July 2026, Sydney on standard time: 22:00 UTC Saturday to 06:00 UTC Sunday.
  assert.deepEqual(psyLevels(run(Date.UTC(2026, 6, 18, 18))), { from: 4, high: 111, low: 89 });
  assert.equal(psyLevels(quiet(10, Date.UTC(2026, 0, 14))), null);
});

test('liquidation estimates use leverage tiers and open interest, and go once price reaches them', () => {
  const bars = [...quiet(), bar(10 * HOUR, 100, 103, 99, 102, 250), bar(11 * HOUR, 102, 102.8, 101.5, 102.5, 100)];
  const flags = pvsraFlags(bars);
  const entry = (103 + 99 + 102) / 3;
  // 2.5 times the average volume is tier 2: 50x, with the liquidation price 1 / 50 - 0.4% below the entry.
  const levels = liquidationLevels(bars, flags);
  assert.deepEqual(levels.map(level => [level.side, level.tier, level.leverage, level.confirmed, level.from]), [['long', 2, 50, false, 10]]);
  assert.ok(near(levels[0].price, entry * (1 - (1 / 50 - 0.004))) && near(levels[0].entry, entry));
  assert.deepEqual(liquidationLevels(bars, flags, { both: true }).map(level => level.side), ['long', 'short']);
  // Open interest fell on the vector candle: positions were closing, so nothing is drawn.
  const falling = new Map(bars.map((item, index) => [item.time, 1000 - index]));
  assert.deepEqual(liquidationLevels(bars, flags, { interest: falling }), []);
  // Open interest rose: the level is confirmed.
  const rising = new Map(bars.map((item, index) => [item.time, 1000 + index]));
  assert.deepEqual(liquidationLevels(bars, flags, { interest: rising }).map(level => [level.confirmed, level.tier]), [[true, 2]]);
  // A later low reaches the liquidation price: the level is removed.
  const swept = [...bars, bar(12 * HOUR, 102, 102.5, 97, 98, 100)];
  assert.deepEqual(liquidationLevels(swept, pvsraFlags(swept)).filter(level => level.from === 10), []);
});

test('VWAP restarts each day and the volume profile splits buy and sell volume', () => {
  const day = Date.UTC(2026, 0, 15);
  const bars = [bar(day, 10, 12, 8, 11, 100), bar(day + HOUR, 11, 15, 13, 14, 300), bar(day + DAY, 20, 22, 18, 20, 50)];
  const bands = vwapBands(bars, 2);
  const typical = [(12 + 8 + 11) / 3, (15 + 13 + 14) / 3, 20];
  const second = (typical[0] * 100 + typical[1] * 300) / 400;
  assert.ok(near(bands.vwap[0], typical[0]) && near(bands.vwap[1], second) && near(bands.vwap[2], 20));
  const deviation = Math.sqrt((typical[0] ** 2 * 100 + typical[1] ** 2 * 300) / 400 - second ** 2);
  assert.ok(near(bands.upper[1], second + 2 * deviation) && near(bands.lower[1], second - 2 * deviation));
  assert.ok(near(bands.upper[2], 20));

  // Two bars over a 0 to 10 range in 10 rows: one closes at its high (all buying), one at its low (all selling).
  const profile = volumeProfile([bar(0, 0, 4, 0, 4, 400), bar(HOUR, 10, 10, 2, 2, 800)], { rows: 10, area: 70 });
  assert.deepEqual([profile.low, profile.high, profile.rows.length], [0, 10, 10]);
  assert.ok(near(profile.rows.reduce((sum, row) => sum + row.buy + row.sell, 0), 1200));
  assert.ok(near(profile.buyShare, 400 / 1200));
  assert.ok(near(profile.rows[0].buy, 80) && profile.rows[0].sell === 0, 'the lowest row holds only the first bar');
  assert.ok(near(profile.rows[3].buy, 80) && near(profile.rows[3].sell, 100), 'the second bar spreads its 800 over rows 2 to 9');
  assert.ok(profile.poc > 2 && profile.poc < 5 && profile.valueLow <= profile.poc && profile.valueHigh >= profile.poc);
  assert.equal(volumeProfile([bar(0, 1, 1, 1, 1, 5)]), null);
});

test('the PVSRA studies are registered and return shapes the chart understands', () => {
  const ids = ['pvsra', 'pvsra-ema', 'pvsra-levels', 'sessions', 'liquidations', 'vwap-bands', 'vprofile'];
  assert.deepEqual(ids.filter(id => !definition(id)), []);
  assert.equal(new Set(registry.map(item => item.id)).size, registry.length);
  const start = Date.UTC(2026, 0, 12);
  const bars = Array.from({ length: 400 }, (_, index) => {
    const base = 100 + Math.sin(index / 9) * 6;
    return bar(start + index * HOUR, base, base + 1.5, base - 1.5, base + (index % 3 ? 0.7 : -0.9), index % 17 === 0 ? 900 : 100 + (index % 5) * 10);
  });
  const daily = Array.from({ length: 30 }, (_, index) => bar(start - 13 * DAY + index * DAY, 100, 108, 93, 102, 5000));
  const context = { interval: 60, daily, interest: null };
  for (const id of ids) {
    const spec = definition(id);
    const plots = spec.plots(bars, spec.params, context);
    assert.ok(plots.length > 0, id);
    for (const plot of plots) assert.ok(Array.isArray(plot.values) && typeof plot.label === 'string', id + ' ' + plot.label);
  }
  const candles = definition('pvsra').plots(bars, { zones: 1, wicks: 0, limit: 500 });
  assert.equal(candles[0].colors.length, bars.length);
  assert.ok(candles[0].colors.includes('#00e676') && Array.isArray(candles[1].boxes));
  assert.equal(definition('pvsra').plots(bars, { zones: 0, wicks: 0, limit: 500 }).length, 1);
  const params = definition('pvsra-levels').params;
  const labels = definition('pvsra-levels').plots(bars, params, context)[0].rays.map(ray => ray.label);
  for (const label of ['YDay Hi', 'YDay Lo', 'Daily Open', 'LWeek Hi', 'PP', 'M0', 'M5', 'Hi-ADR', 'Lo-ADR', 'Psy-Hi']) assert.ok(labels.includes(label), label);
  assert.ok(!labels.includes('R1'));
  assert.ok(definition('pvsra-levels').plots(bars, { ...params, supports: 1 }, context)[0].rays.some(ray => ray.label === 'S3'));
  // Without daily bars, and on daily charts, the intraday levels are left out rather than guessed.
  assert.deepEqual(definition('pvsra-levels').plots(bars, { ...params, psy: 0 }, { interval: 60, daily: [] })[0].rays, []);
  assert.deepEqual(definition('sessions').plots(bars, { weekends: 0 }, { interval: 1440 })[0].boxes, []);
  assert.ok(definition('sessions').plots(bars, { weekends: 0 }, context)[0].boxes.length >= 7);
});
