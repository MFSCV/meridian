// PVSRA studies: vector candles and their zones, range and pivot levels, market sessions, weekly psy levels,
// estimated liquidation levels, VWAP bands and a volume profile.
//
// Ported from the MPL-2.0 Pine script "PVSRA Levels + MACD (fast)", itself derived from the open-source
// "Traders Reality Main" indicator and "Traders_Reality_Lib" library (pattern formation by plasmapug; rise retrace
// continuation by infernix, peshocore and xtech5192; DST and psy refactor by xtech5192). The upstream licence note asks
// that derivatives do not carry the upstream name. This file is covered by the Mozilla Public License 2.0
// (https://mozilla.org/MPL/2.0/); the rest of Meridian is Apache-2.0. See NOTICE.
//
// Every function here is pure: bars in, numbers and shapes out. The chart draws the shapes.

const DAY = 86400000;
export const vectorColors = { 3: '#00e676', '-3': '#ff1744', 2: '#2979ff', '-2': '#e040fb', 1: '#999999', '-1': '#4d4d4d' };

// ── Small series helpers ─────────────────────────────────────────────────────────────────────
// Seeded with the first value, as Pine's ta.ema is, so a long average is drawn from the first bar instead of
// staying empty until `length` bars exist. It converges on the usual value as history accumulates.
function ema(values, length) {
  const factor = 2 / (length + 1);
  let value = null;
  return values.map(next => {
    value = value === null ? next : value + (next - value) * factor;
    return value;
  });
}
function stdev(values, length) {
  return values.map((_, index) => {
    if (index < length - 1) return null;
    let sum = 0;
    for (let at = index - length + 1; at <= index; at++) sum += values[at];
    const mean = sum / length;
    let spread = 0;
    for (let at = index - length + 1; at <= index; at++) spread += (values[at] - mean) ** 2;
    return Math.sqrt(spread / length);
  });
}

// ── Vector candles ───────────────────────────────────────────────────────────────────────────
// 3 / -3: climax up / down (volume at least twice the average of the 10 bars before, or the largest spread x volume of
// those bars). 2 / -2: volume at least 1.5 times that average. 1 / -1: a regular up / down bar.
export function pvsraFlags(bars) {
  return bars.map((bar, index) => {
    const bull = bar.close > bar.open ? 1 : -1;
    if (index < 10) return bull;
    let volume = 0;
    let widest = 0;
    for (let at = index - 10; at < index; at++) {
      volume += bars[at].volume;
      widest = Math.max(widest, bars[at].volume * (bars[at].high - bars[at].low));
    }
    const average = volume / 10;
    if (bar.volume >= 2 * average || bar.volume * (bar.high - bar.low) >= widest) return 3 * bull;
    return bar.volume >= 1.5 * average ? 2 * bull : bull;
  });
}

// Zones left by vector candles that price has not come back through yet. A zone under price is cleared when a low
// reaches its bottom and trimmed when a low only dips in; a zone over price mirrors that with highs.
export function vectorZones(bars, flags, { wicks = false, trim = true, max = 500 } = {}) {
  const below = [];
  const above = [];
  let count = 0;
  for (let index = 1; index < bars.length; index++) {
    const { low, high } = bars[index];
    for (let at = below.length - 1; at >= 0; at--) {
      const zone = below[at];
      if (trim ? zone.top < low : zone.bottom < low) break;
      if (low <= zone.bottom) below.splice(at, 1);
      else if (trim && low < zone.top) zone.top = low;
    }
    for (let at = above.length - 1; at >= 0; at--) {
      const zone = above[at];
      if (trim ? zone.bottom > high : zone.top > high) break;
      if (high >= zone.top) above.splice(at, 1);
      else if (trim && high > zone.bottom) zone.bottom = high;
    }
    const flag = flags[index - 1];
    if (Math.abs(flag) >= 2) {
      count += 1;
      const one = bars[index - 1];
      const top = wicks ? one.high : Math.max(one.open, one.close);
      const bottom = wicks ? one.low : Math.min(one.open, one.close);
      if (low > bottom) below.push({ from: index - 1, top: trim && low < top ? low : top, bottom, flag, order: count });
      if (high < top) above.push({ from: index - 1, top, bottom: trim && high > bottom ? high : bottom, flag, order: count });
    }
    if (below.length && count - below[0].order >= max) below.shift();
    if (above.length && count - above[0].order >= max) above.shift();
  }
  return [...below, ...above].filter(zone => zone.top > zone.bottom);
}

// ── Time zones ───────────────────────────────────────────────────────────────────────────────
// Offset of a zone from UTC in milliseconds, looked up once per zone and UTC day, so daylight saving is followed
// without any table to maintain.
const offsets = new Map();
const formats = new Map();
export function zoneOffset(zone, time) {
  const key = zone + '|' + Math.floor(time / DAY);
  if (!offsets.has(key)) {
    if (!formats.has(zone)) {
      formats.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    }
    const noon = Math.floor(time / DAY) * DAY + DAY / 2;
    const parts = Object.fromEntries(formats.get(zone).formatToParts(noon).map(part => [part.type, Number(part.value)]));
    if (offsets.size > 4000) offsets.clear();
    offsets.set(key, Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - noon);
  }
  return offsets.get(key);
}

// ── Market sessions ──────────────────────────────────────────────────────────────────────────
// Start (minutes after local midnight) and length in minutes, in each exchange's own time zone.
export const sessions = [
  { name: 'London', zone: 'Europe/London', start: 480, minutes: 510, color: '#787b86' },
  { name: 'NewYork', zone: 'America/New_York', start: 570, minutes: 390, color: '#fb565b' },
  { name: 'Tokyo', zone: 'Asia/Tokyo', start: 540, minutes: 390, color: '#50ae55' },
  { name: 'HongKong', zone: 'Asia/Hong_Kong', start: 570, minutes: 390, color: '#807f17' },
  { name: 'Sydney', zone: 'Australia/Sydney', start: 480, minutes: 480, color: '#25e47b' },
  { name: 'EU Brinks', zone: 'Europe/London', start: 480, minutes: 60, color: '#ffffff' },
  { name: 'US Brinks', zone: 'America/New_York', start: 540, minutes: 60, color: '#ffffff' }
];

// Every occurrence of a session inside the bars: where it starts and ends, its opening bar and its range so far.
export function sessionRanges(bars, session, interval, weekends = false) {
  const found = [];
  let current = null;
  for (let index = 0; index < bars.length; index++) {
    const local = bars[index].time + zoneOffset(session.zone, bars[index].time);
    const day = Math.floor(local / DAY);
    const minute = Math.floor((local - day * DAY) / 60000);
    const weekday = (day + 4) % 7;
    const inside = minute >= session.start && minute < session.start + session.minutes && (weekends || (weekday >= 1 && weekday <= 5));
    if (!inside) {
      current = null;
    } else if (!current || current.day !== day) {
      const left = Math.max(0, Math.round((session.minutes - (minute - session.start)) / interval));
      current = { day, from: index, to: index + left, openHigh: bars[index].high, openLow: bars[index].low, high: bars[index].high, low: bars[index].low };
      found.push(current);
    } else {
      current.high = Math.max(current.high, bars[index].high);
      current.low = Math.min(current.low, bars[index].low);
    }
  }
  return found;
}

// ── Higher timeframe levels ──────────────────────────────────────────────────────────────────
const trueRange = (bar, before) => before ? Math.max(bar.high - bar.low, Math.abs(bar.high - before.close), Math.abs(bar.low - before.close)) : bar.high - bar.low;
// Average true range of the `length` periods before the last one.
function averageRange(periods, length) {
  const end = periods.length - 1;
  if (end < length) return null;
  let sum = 0;
  for (let at = end - length; at < end; at++) sum += trueRange(periods[at], periods[at - 1]);
  return sum / length;
}
const rangeHigh = (range, bar) => bar.high - bar.low < range ? bar.low + range : bar.close >= bar.open ? bar.low + range : bar.high;
const rangeLow = (range, bar) => bar.high - bar.low < range ? bar.high - range : bar.close >= bar.open ? bar.low : bar.high - range;

// Daily bars merged into weeks that start on Monday (UTC).
export function weekly(daily) {
  const weeks = [];
  for (const bar of daily) {
    const start = Math.floor((bar.time / DAY + 3) / 7);
    const week = weeks.at(-1);
    if (week?.key === start) {
      week.high = Math.max(week.high, bar.high);
      week.low = Math.min(week.low, bar.low);
      week.close = bar.close;
      week.volume += bar.volume;
    } else {
      weeks.push({ key: start, time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    }
  }
  return weeks;
}

// Yesterday's and last week's range, today's open, pivot points with M levels and the average daily and weekly range.
export function dailyLevels(daily, { adr = 14, awr = 4 } = {}) {
  if (daily.length < 2) return null;
  const today = daily.at(-1);
  const yesterday = daily.at(-2);
  const weeks = weekly(daily);
  const pivot = (yesterday.high + yesterday.low + yesterday.close) / 3;
  const r1 = 2 * pivot - yesterday.low;
  const s1 = 2 * pivot - yesterday.high;
  const r2 = pivot - s1 + r1;
  const s2 = pivot - r1 + s1;
  const r3 = 2 * pivot + yesterday.high - 2 * yesterday.low;
  const s3 = 2 * pivot - (2 * yesterday.high - yesterday.low);
  const dayRange = averageRange(daily, adr);
  const weekRange = weeks.length > 1 ? averageRange(weeks, awr) : null;
  return {
    start: today.time, open: today.open, dayHigh: yesterday.high, dayLow: yesterday.low,
    weekHigh: weeks.length > 1 ? weeks.at(-2).high : null, weekLow: weeks.length > 1 ? weeks.at(-2).low : null,
    pivot, r1, r2, r3, s1, s2, s3, m0: (s2 + s3) / 2, m1: (s1 + s2) / 2, m2: (pivot + s1) / 2, m3: (pivot + r1) / 2, m4: (r1 + r2) / 2, m5: (r2 + r3) / 2,
    adr: dayRange, adrHigh: dayRange === null ? null : rangeHigh(dayRange, today), adrLow: dayRange === null ? null : rangeLow(dayRange, today),
    awr: weekRange, awrHigh: weekRange === null ? null : rangeHigh(weekRange, weeks.at(-1)), awrLow: weekRange === null ? null : rangeLow(weekRange, weeks.at(-1))
  };
}

// Weekly psy range for crypto: the first eight hours of the Sydney session that opens the week, from Saturday 22:00
// GMT, or 21:00 GMT while Sydney is on summer time. Returns the latest one found in the bars.
export function psyLevels(bars) {
  let found = null;
  let current = null;
  for (let index = 0; index < bars.length; index++) {
    const time = bars[index].time;
    const summer = zoneOffset('Australia/Sydney', time) === 11 * 3600000;
    const shifted = time + (summer ? 3600000 : 0);
    const day = Math.floor(shifted / DAY);
    const hour = (shifted - day * DAY) / 3600000;
    const weekday = (day + 4) % 7;
    const inside = (weekday === 6 && hour >= 22) || (weekday === 0 && hour < 6);
    if (!inside) current = null;
    else if (!current) found = current = { from: index, high: bars[index].high, low: bars[index].low };
    else {
      current.high = Math.max(current.high, bars[index].high);
      current.low = Math.min(current.low, bars[index].low);
    }
  }
  return found;
}

// ── Estimated liquidation levels ─────────────────────────────────────────────────────────────
// A vector candle is read as a burst of new positions in its own direction. Their entry is taken as the candle's
// typical price and their liquidation price sits beyond it at 1 / leverage minus the maintenance margin. The leverage
// tier rises with the volume against its 10-bar average. Open interest, when known, confirms that positions were
// opened: a candle on which it fell is skipped, and one on which it jumped moves up a tier. A level is dropped once
// price reaches it. These are estimates, never real liquidation data.
export function liquidationLevels(bars, flags, { interest = null, both = false, max = 60, leverage = [25, 50, 100], thresholds = [2, 3], maintenance = 0.4 } = {}) {
  const longs = [];
  const shorts = [];
  const oi = interest ? bars.map(bar => interest.get(bar.time) ?? null) : null;
  const moves = [];
  for (let index = 1; index < bars.length; index++) {
    const { low, high } = bars[index];
    for (let at = longs.length - 1; at >= 0; at--) if (low <= longs[at].price) longs.splice(at, 1);
    for (let at = shorts.length - 1; at >= 0; at--) if (high >= shorts[at].price) shorts.splice(at, 1);
    const at = index - 1;
    const change = oi && oi[at] !== null && oi[at - 1] !== null && oi[at - 1] !== undefined ? oi[at] - oi[at - 1] : null;
    if (change !== null) moves.push(Math.abs(change));
    const flag = flags[at];
    if (Math.abs(flag) < 2 || at < 10) continue;
    if (change !== null && change <= 0) continue;
    let volume = 0;
    for (let back = at - 10; back < at; back++) volume += bars[back].volume;
    const relative = volume ? bars[at].volume / (volume / 10) : 0;
    let tier = relative >= thresholds[1] ? 3 : relative >= thresholds[0] ? 2 : 1;
    const recent = moves.slice(-21, -1);
    const usual = recent.length === 20 ? recent.reduce((sum, value) => sum + value, 0) / 20 : null;
    if (change !== null && usual !== null && change > 2 * usual && tier < 3) tier += 1;
    const distance = Math.max(0, 1 / leverage[tier - 1] - maintenance / 100);
    const entry = (bars[at].high + bars[at].low + bars[at].close) / 3;
    const level = { from: at, entry, tier, leverage: leverage[tier - 1], confirmed: change !== null };
    if ((flag > 0 || both) && low > entry * (1 - distance)) {
      longs.push({ ...level, side: 'long', price: entry * (1 - distance) });
      if (longs.length > max) longs.shift();
    }
    if ((flag < 0 || both) && high < entry * (1 + distance)) {
      shorts.push({ ...level, side: 'short', price: entry * (1 + distance) });
      if (shorts.length > max) shorts.shift();
    }
  }
  return [...longs, ...shorts];
}

// ── VWAP with bands ──────────────────────────────────────────────────────────────────────────
// Volume-weighted average price of the typical price, restarted every UTC day, with its volume-weighted deviation.
export function vwapBands(bars, width = 1) {
  const out = { vwap: [], upper: [], lower: [] };
  let day = null;
  let volume = 0;
  let sum = 0;
  let squares = 0;
  for (const bar of bars) {
    const now = Math.floor(bar.time / DAY);
    if (now !== day) [day, volume, sum, squares] = [now, 0, 0, 0];
    const typical = (bar.high + bar.low + bar.close) / 3;
    volume += bar.volume;
    sum += typical * bar.volume;
    squares += typical * typical * bar.volume;
    const value = volume ? sum / volume : typical;
    const deviation = volume ? Math.sqrt(Math.max(0, squares / volume - value * value)) : 0;
    out.vwap.push(value);
    out.upper.push(value + deviation * width);
    out.lower.push(value - deviation * width);
  }
  return out;
}

// ── Volume profile ───────────────────────────────────────────────────────────────────────────
// Volume of the last `lookback` bars spread evenly over the price rows each bar covers. Buy volume is estimated from
// where a bar closed inside its range; no order book is involved.
export function volumeProfile(bars, { lookback = 300, rows = 120, area = 70 } = {}) {
  const window = bars.slice(-lookback).filter(bar => bar.volume > 0);
  if (window.length < 2) return null;
  const low = Math.min(...window.map(bar => bar.low));
  const high = Math.max(...window.map(bar => bar.high));
  if (!(high > low)) return null;
  const step = (high - low) / rows;
  const buy = new Array(rows).fill(0);
  const total = new Array(rows).fill(0);
  let bought = 0;
  let traded = 0;
  for (const bar of window) {
    const first = Math.min(rows - 1, Math.max(0, Math.floor((bar.low - low) / step)));
    const last = Math.min(rows - 1, Math.max(0, Math.floor((bar.high - low) / step)));
    const span = last - first + 1;
    const share = bar.high > bar.low ? bar.volume * (bar.close - bar.low) / (bar.high - bar.low) : bar.volume / 2;
    bought += share;
    traded += bar.volume;
    for (let row = first; row <= last; row++) {
      buy[row] += share / span;
      total[row] += bar.volume / span;
    }
  }
  const peak = Math.max(...total);
  const poc = total.indexOf(peak);
  let [from, to, inside] = [poc, poc, total[poc]];
  while (inside < traded * area / 100 && (from > 0 || to < rows - 1)) {
    const up = to < rows - 1 ? total[to + 1] : -1;
    const down = from > 0 ? total[from - 1] : -1;
    if (up >= down) inside += total[++to];
    else inside += total[--from];
  }
  return {
    low, high, step, peak, rows: total.map((value, row) => ({ low: low + row * step, high: low + (row + 1) * step, buy: buy[row], sell: value - buy[row] })),
    poc: low + (poc + 0.5) * step, valueLow: low + from * step, valueHigh: low + (to + 1) * step, buyShare: traded ? bought / traded : 0.5
  };
}

// ── Indicator definitions ────────────────────────────────────────────────────────────────────
// Plot kinds understood by the chart besides lines: 'barcolor' (a colour per bar), 'boxes', 'rays' (horizontal
// segments), 'band' (a filled area between two series) and 'profile'. Colours are fixed here rather than taken from
// the chart palette, because the PVSRA colours carry meaning.
const closes = bars => bars.map(bar => bar.close);
const shape = (kind, label, more) => ({ kind, label, values: [], ...more });
const stroke = (label, values, color, width) => ({ label, values, stroke: color, width });
const ray = (price, label, color, more = {}) => ({ price, label, color, from: null, to: null, ...more });
const present = value => value !== null && value !== undefined && Number.isFinite(value);

export const pvsraIndicators = [
  { id: 'pvsra', name: 'PVSRA vector candles and zones', pane: 'overlay', params: { zones: 1, wicks: 0, limit: 500 },
    plots: (bars, p) => {
      const flags = pvsraFlags(bars);
      const plots = [shape('barcolor', 'PVSRA', { colors: flags.map(flag => vectorColors[flag]) })];
      if (p.zones) {
        plots.push(shape('boxes', 'Vector zones', { boxes: vectorZones(bars, flags, { wicks: Boolean(p.wicks), max: p.limit })
          .map(zone => ({ from: zone.from, to: null, top: zone.top, bottom: zone.bottom, color: '#ffe64b', opacity: 0.12 })) }));
      }
      return plots;
    } },
  { id: 'pvsra-ema', name: 'PVSRA EMAs (5, 13, 50, 200, 800) and cloud', pane: 'overlay', params: {},
    plots: bars => {
      const values = closes(bars);
      const fifty = ema(values, 50);
      const spread = stdev(values, 100);
      const edge = sign => fifty.map((value, index) => value === null || spread[index] === null ? null : value + sign * spread[index] / 4);
      return [shape('band', 'EMA 50 cloud', { upper: edge(1), lower: edge(-1), color: '#9b2fae', opacity: 0.28 }),
        stroke('EMA 5', ema(values, 5), '#feea4a'), stroke('EMA 13', ema(values, 13), '#fd5457'), stroke('EMA 50', fifty, '#1fbcd3'),
        stroke('EMA 200', ema(values, 200), '#b8bcc8'), stroke('EMA 800', ema(values, 800), '#5b43d6', 2)];
    } },
  { id: 'pvsra-levels', name: 'PVSRA levels: pivots, daily and weekly ranges, psy', pane: 'overlay', params: { daily: 1, pivots: 1, supports: 0, adr: 1, length: 14, psy: 1 },
    plots: (bars, p, context = {}) => {
      const rays = [];
      const intraday = (context.interval ?? 60) < 1440;
      const levels = dailyLevels(context.daily?.length ? context.daily : [], { adr: p.length });
      if (levels) {
        const start = bars.findIndex(bar => bar.time >= levels.start - DAY);
        const from = start < 0 ? null : start;
        const add = (value, label, color, more) => present(value) && rays.push(ray(value, label, color, { from, ...more }));
        if (p.daily) {
          if (intraday) {
            add(levels.dayHigh, 'YDay Hi', '#2962ff', { width: 2 });
            add(levels.dayLow, 'YDay Lo', '#2962ff', { width: 2 });
            add(levels.open, 'Daily Open', '#feea4e', { width: 2, from: bars.findIndex(bar => bar.time >= levels.start) });
          }
          add(levels.weekHigh, 'LWeek Hi', '#4caf50', { width: 2 });
          add(levels.weekLow, 'LWeek Lo', '#4caf50', { width: 2 });
        }
        if (p.pivots && intraday) {
          add(levels.pivot, 'PP', '#feea4e', { dash: '6 4' });
          for (const name of ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']) add(levels[name], name.toUpperCase(), '#b8bcc8', { dash: '6 4' });
        }
        if (p.supports && intraday) {
          for (const name of ['r1', 'r2', 'r3']) add(levels[name], name.toUpperCase(), '#4caf50', { dash: '6 4' });
          for (const name of ['s1', 's2', 's3']) add(levels[name], name.toUpperCase(), '#f44336', { dash: '6 4' });
        }
        if (p.adr && intraday) {
          add(levels.adrHigh, 'Hi-ADR', '#c0c0c0', { dash: '2 3' });
          add(levels.adrLow, 'Lo-ADR', '#c0c0c0', { dash: '2 3' });
        }
      }
      if (p.psy && [5, 15, 30, 60].includes(context.interval ?? 60)) {
        const psy = psyLevels(bars);
        if (psy) rays.push(ray(psy.high, 'Psy-Hi', '#ff9800', { from: psy.from, width: 2 }), ray(psy.low, 'Psy-Lo', '#ff9800', { from: psy.from, width: 2 }));
      }
      return [shape('rays', 'Levels', { rays })];
    } },
  { id: 'sessions', name: 'Market sessions', pane: 'overlay', params: { weekends: 0 },
    plots: (bars, p, context = {}) => {
      const interval = context.interval ?? 60;
      if (interval > 240) return [shape('boxes', 'Sessions', { boxes: [] })];
      const boxes = [];
      const rays = [];
      for (const session of sessions) {
        const ranges = sessionRanges(bars, session, interval, Boolean(p.weekends));
        for (const range of ranges) boxes.push({ from: range.from, to: range.to, top: range.openHigh, bottom: range.openLow, color: session.color, opacity: session.name.endsWith('Brinks') ? 0.3 : 0.22 });
        const latest = ranges.at(-1);
        if (latest) {
          rays.push(ray(latest.high, session.name, session.color, { from: latest.from, to: latest.to, dash: '5 4', tag: false, start: true }),
            ray(latest.low, '', session.color, { from: latest.from, to: latest.to, dash: '5 4', tag: false }));
        }
      }
      return [shape('boxes', 'Sessions', { boxes }), shape('rays', 'Session ranges', { rays })];
    } },
  { id: 'liquidations', name: 'Estimated liquidation levels', pane: 'overlay', params: { both: 0, limit: 60 },
    plots: (bars, p, context = {}) => {
      const tiers = ['#ffeb3b', '#ff9800', '#f44336'];
      const levels = liquidationLevels(bars, pvsraFlags(bars), { interest: context.interest ?? null, both: Boolean(p.both), max: p.limit });
      return [shape('rays', 'Liquidation estimates', { rays: levels.flatMap(level => [
        ray(level.price, (level.side === 'long' ? 'Long' : 'Short') + ' liq ' + level.leverage + 'x', tiers[level.tier - 1], { from: level.from, width: level.tier, dash: level.confirmed ? null : '2 3', tag: false, opacity: 0.7 }),
        ray(level.entry, '', '#00bcd4', { from: level.from, dash: level.confirmed ? null : '2 3', tag: false, opacity: 0.4 })]) })];
    } },
  { id: 'vwap-bands', name: 'VWAP with bands (daily)', pane: 'overlay', params: { width: 1 },
    plots: (bars, p) => {
      const bands = vwapBands(bars, p.width);
      return [shape('band', 'VWAP band', { upper: bands.upper, lower: bands.lower, color: '#4caf50', opacity: 0.07 }),
        stroke('VWAP', bands.vwap, '#2962ff'), stroke('Upper band', bands.upper, '#4caf50'), stroke('Lower band', bands.lower, '#4caf50')];
    } },
  { id: 'vprofile', name: 'Volume profile with buy and sell split', pane: 'overlay', params: { length: 300, rows: 120 },
    plots: (bars, p) => [shape('profile', 'Volume profile', { profile: volumeProfile(bars, { lookback: p.length, rows: p.rows }) })] }
];
