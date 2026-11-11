// SPDX-License-Identifier: MPL-2.0
// PVSRA studies: vector candles and zones, price levels, sessions, estimated liquidations,
// VWAP bands, moving averages, volume profile, and a MACD and volume pane.
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
    if (index < 10 || bar.volume <= 0) return bull;
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
  { name: 'US Brinks', zone: 'America/New_York', start: 540, minutes: 60, color: '#ffffff' },
  { name: 'Frankfurt', zone: 'Europe/Berlin', start: 480, minutes: 570, color: '#fd9827', fillOpacity: 0.25, lineOpacity: 0.75 }
];

// Toggles for the existing overlays in the combined study.
export const pvsraComponents = {
  pvsra: 'vectors', 'pvsra-ema': 'emas', 'pvsra-levels': 'levels', sessions: 'markets',
  liquidations: 'liquidations', 'vwap-bands': 'vwap', vprofile: 'profile'
};

function sma(values, length) {
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= length) sum -= values[index - length];
    return index >= length - 1 ? sum / length : null;
  });
}

const averageColors = ['#00bcd4', '#4f8b45', '#c23e38', '#a1a5b0', '#9c27b0'];
const averagePreset = (group, lengths, enabled, exponential = -1) => lengths.map((length, index) => ({
  key: 'ma:' + group + ':' + (index + 1), label: 'Average ' + (index + 1), color: averageColors[group === 'monthly' && index === 1 ? 0 : index],
  enabled: group !== 'weekly' && enabled.includes(index),
  legacyKey: enabled.includes(index) ? (index === exponential ? 'EMA ' : 'SMA ') + length : undefined,
  type: index === exponential ? 'EMA' : 'SMA', length, source: 'close'
}));
export const pvsraAverageGroups = [
  ['Intraday moving averages', averagePreset('intraday', [5, 8, 13, 20, 60], [0, 1, 2])],
  ['Daily moving averages', averagePreset('daily', [10, 21, 50, 200, 300], [0, 1, 2, 3], 1)],
  ['Weekly moving averages', averagePreset('weekly', [10, 20, 40, 100], [0, 1])],
  ['Monthly moving averages', averagePreset('monthly', [6, 10, 24, 40], [1])]
];
export const pvsraAverageTypes = ['SMA', 'EMA', 'RMA', 'VWMA', 'WMA'];
export const pvsraAverageSources = [
  ['close', 'Close'], ['open', 'Open'], ['high', 'High'], ['low', 'Low'], ['hl2', 'HL2'], ['hlc3', 'HLC3'], ['ohlc4', 'OHLC4'], ['hlcc4', 'HLCC4']
];

export function cleanPvsraAverages(input) {
  const values = {};
  for (const [, slots] of pvsraAverageGroups) for (const slot of slots) {
    const item = input?.[slot.key];
    if (!item || typeof item !== 'object') continue;
    const config = {};
    if (typeof item.enabled === 'boolean' && item.enabled !== slot.enabled) config.enabled = item.enabled;
    if (Number.isInteger(item.length) && item.length >= 1 && item.length <= 5000 && item.length !== slot.length) config.length = item.length;
    if (pvsraAverageTypes.includes(item.type) && item.type !== slot.type) config.type = item.type;
    if (pvsraAverageSources.some(([source]) => source === item.source) && item.source !== slot.source) config.source = item.source;
    if (Object.keys(config).length) values[slot.key] = config;
  }
  return Object.keys(values).length ? values : undefined;
}

function averageSource(bar, source) {
  switch (source) {
    case 'hl2': return (bar.high + bar.low) / 2;
    case 'hlc3': return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar.open + bar.high + bar.low + bar.close) / 4;
    case 'hlcc4': return (bar.high + bar.low + 2 * bar.close) / 4;
    default: return bar[source];
  }
}

export function configuredAverage(bars, { type, length, source }) {
  const values = bars.map(bar => averageSource(bar, source));
  if (type === 'EMA') return ema(values, length);
  if (type === 'SMA') return sma(values, length);
  let sum = 0;
  let weights = 0;
  let value;
  return values.map((next, index) => {
    const before = index >= length ? values[index - length] : 0;
    if (type === 'WMA') weights += length * next - sum;
    else if (type === 'VWMA') weights += next * bars[index].volume - (index >= length ? before * bars[index - length].volume : 0);
    sum += type === 'VWMA' ? bars[index].volume - (index >= length ? bars[index - length].volume : 0) : next - before;
    if (index < length - 1) return null;
    if (type === 'WMA') return weights / (length * (length + 1) / 2);
    if (type === 'VWMA') return sum > 0 ? weights / sum : null;
    value = value === undefined ? sum / length : value + (next - value) / length;
    return value;
  });
}

function extraAverages(bars, minutes, config) {
  const group = minutes < 1440 ? 0 : minutes < 10080 ? 1 : minutes < 43200 ? 2 : 3;
  const cache = new Map();
  return pvsraAverageGroups[group][1].flatMap(slot => {
    const item = { ...slot, ...config?.[slot.key] };
    if (!item.enabled) return [];
    const identity = item.type + ' ' + item.length + ' ' + item.source;
    if (!cache.has(identity)) cache.set(identity, configuredAverage(bars, item));
    const label = item.type + ' ' + item.length + (item.source === 'close' ? '' : ' · ' + item.source.toUpperCase());
    return [{ ...stroke(label, cache.get(identity), slot.color), key: slot.key, legacyKey: slot.legacyKey }];
  });
}

function recentPeaks(values, length) {
  const queue = [];
  let head = 0;
  return values.map((value, index) => {
    if (queue[head] <= index - length) head++;
    while (queue.length > head && values[queue.at(-1)] <= value) queue.pop();
    queue.push(index);
    return values[queue[head]];
  });
}

export const pvsraSeparateVolume = 'MACD and separate volume';

function lowerPane(bars, p, colors) {
  const close = closes(bars);
  const average = p.oscillatorAverage === 'SMA' ? sma : ema;
  const slow = average(close, p.slow);
  const macd = average(close, p.fast).map((value, index) => value === null || slow[index] === null ? null : value - slow[index]);
  const first = macd.findIndex(value => value !== null);
  const warmup = first < 0 ? macd.length : first;
  const signalAverage = p.signalAverage === 'SMA' ? sma : ema;
  const signal = [...new Array(warmup).fill(null), ...signalAverage(macd.slice(warmup), p.signal)];
  const hist = macd.map((value, index) => signal[index] === null ? null : value - signal[index]);
  const volume = bars.map(bar => bar.volume);
  const plots = [];
  if (p.lower === 'MACD + Volume') {
    const amplitude = macd.map((value, index) => Math.max(Math.abs(value), Math.abs(signal[index]), Math.abs(hist[index])));
    const peaks = recentPeaks(volume, 200);
    const ranges = recentPeaks(amplitude, 200);
    const values = volume.map((value, index) => peaks[index] ? value / peaks[index] * ranges[index] : 0);
    plots.push(shape('histogram', 'Volume (scaled)', { values, colors, opacity: 0.35 }));
  }
  if (p.lower === pvsraSeparateVolume || p.lower === 'Volume') {
    plots.push(shape('volume', 'Volume', { values: volume, colors: p.lower === 'Volume' ? colors : undefined,
      opacity: p.lower === 'Volume' ? 1 : 0.6, subpane: 'volume' }));
  }
  if (p.lower !== 'Volume') {
    const histogramColors = hist.map((value, index) => value >= 0
      ? (hist[index - 1] < value ? '#26a69a' : '#b2dfdb')
      : (hist[index - 1] < value ? '#ffcdd2' : '#ff5252'));
    plots.push(shape('histogram', 'Histogram', { values: hist, colors: histogramColors, opacity: 1 }),
      stroke('MACD', macd, '#2962ff'), stroke('Signal', signal, '#ff6d00'));
  }
  return plots.map(plot => ({ ...plot, pane: 'separate', key: plot.label === 'Volume (scaled)' ? 'Volume' : plot.label }));
}

const pvsraSuite = {
  id: 'pvsra-suite', name: 'PVSRA Levels + MACD', pane: 'both', guides: [0],
  params: { vectors: 1, zones: 0, wicks: 0, limit: 500, emas: 1, averages: 0, levels: 1, markets: 1, sessionFills: 0,
    liquidations: 0, vwap: 1, vwapAnchor: 'Session', vwapMode: 'Standard Deviation', band1: 1, band2: 0, band3: 0,
    hideVwapDaily: 0, profile: 1, lower: pvsraSeparateVolume, fast: 12, slow: 26, signal: 9,
    trimZones: 1, weekends: 0, daily: 1, psy: 1, supports: 0, adrLength: 14, both: 0, liquidationLimit: 60, profileLength: 300, rows: 120,
    oscillatorAverage: 'EMA', signalAverage: 'EMA', historicalLevels: 1, frankfurt: 0 },
  choices: { lower: [pvsraSeparateVolume, 'MACD + Volume', 'MACD', 'Volume', 'Off'], vwapAnchor: ['Session', 'Week', 'Month', 'Quarter', 'Year', 'Decade', 'Century'],
    vwapMode: ['Standard Deviation', 'Percentage'], oscillatorAverage: ['EMA', 'SMA'], signalAverage: ['EMA', 'SMA'] },
  plots(bars, p, context = {}) {
    const overlays = pvsraIndicators.filter(spec => spec.id !== 'vwap-bands' && p[pvsraComponents[spec.id]]).flatMap(spec => {
      const overrides = {
        pvsra: { zones: p.zones, wicks: p.wicks, limit: p.limit, trimZones: p.trimZones },
        sessions: { weekends: p.weekends, frankfurt: p.frankfurt, fill: Boolean(p.sessionFills) },
        'pvsra-levels': { daily: p.daily, psy: p.psy, supports: p.supports, length: p.adrLength, historicalLevels: p.historicalLevels },
        liquidations: { both: p.both, limit: p.liquidationLimit },
        vprofile: { length: p.profileLength, rows: p.rows }
      };
      const params = { ...spec.params, ...overrides[spec.id] };
      return spec.plots(bars, params, context).map(plot => ({
        ...plot, key: plot.key ?? spec.id + ':' + plot.label,
        ...(spec.id === 'liquidations' ? { rays: plot.rays.map(ray => ({ ...ray, label: '' })) } : {})
      }));
    });
    if (p.vwap && !(p.hideVwapDaily && context.interval >= 1440)) overlays.push(...suiteVwap(bars, p));
    if (p.averages) overlays.push(...extraAverages(bars, context.interval ?? 60, p.averagesConfig));
    if (p.lower !== 'Off') {
      const colors = overlays.find(plot => plot.kind === 'barcolor')?.colors ?? pvsraFlags(bars).map(flag => vectorColors[flag]);
      overlays.push(...lowerPane(bars, p, colors));
    }
    return overlays;
  }
};

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

const historicalFields = [
  ['YDay Hi', '#2962ff', 'dayHigh'], ['YDay Lo', '#2962ff', 'dayLow'], ['Daily Open', '#feea4e', 'open'],
  ['yDO', '#c19b4d', 'dayOpen'], ['LWeek Hi', '#4caf50', 'weekHigh'], ['LWeek Lo', '#4caf50', 'weekLow']
];
const displayLevel = { 'YDay Hi': 'yHi', 'YDay Lo': 'yLow', 'LWeek Hi': 'lw Hi', 'LWeek Lo': 'lw Low', 'Psy-Hi': 'Psy Hi', 'Psy-Lo': 'Psy Low' };
const referenceRay = (value, label, color, from) => ray(value, displayLevel[label] ?? label, color,
  { from, width: 2, styleKey: 'level:' + label, reference: true });

export function historicalLevels(bars, daily) {
  const values = Object.fromEntries(historicalFields.map(([, , key]) => [key, []]));
  const weeks = weekly(daily);
  let dayIndex = -1;
  let weekIndex = -1;
  for (const bar of bars) {
    const day = Math.floor(bar.time / DAY);
    const week = Math.floor((day + 3) / 7);
    while (dayIndex + 1 < daily.length && Math.floor(daily[dayIndex + 1].time / DAY) <= day) dayIndex++;
    while (weekIndex + 1 < weeks.length && weeks[weekIndex + 1].key < week) weekIndex++;
    const today = daily[dayIndex];
    const hasOpen = today && Math.floor(today.time / DAY) === day;
    const yesterday = daily[dayIndex - Number(Boolean(hasOpen))];
    values.open.push(hasOpen ? today.open : null);
    values.dayOpen.push(yesterday?.open ?? null);
    values.dayHigh.push(yesterday?.high ?? null);
    values.dayLow.push(yesterday?.low ?? null);
    values.weekHigh.push(weeks[weekIndex]?.high ?? null);
    values.weekLow.push(weeks[weekIndex]?.low ?? null);
  }
  return values;
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
    start: today.time, open: today.open, dayOpen: yesterday.open, dayHigh: yesterday.high, dayLow: yesterday.low,
    weekHigh: weeks.length > 1 ? weeks.at(-2).high : null, weekLow: weeks.length > 1 ? weeks.at(-2).low : null,
    pivot, r1, r2, r3, s1, s2, s3, m0: (s2 + s3) / 2, m1: (s1 + s2) / 2, m2: (pivot + s1) / 2, m3: (pivot + r1) / 2, m4: (r1 + r2) / 2, m5: (r2 + r3) / 2,
    adr: dayRange, adrHigh: dayRange === null ? null : rangeHigh(dayRange, today), adrLow: dayRange === null ? null : rangeLow(dayRange, today),
    awr: weekRange, awrHigh: weekRange === null ? null : rangeHigh(weekRange, weeks.at(-1)), awrLow: weekRange === null ? null : rangeLow(weekRange, weeks.at(-1))
  };
}

// Weekly psy range for crypto: the first eight hours of the Sydney session that opens the week, from Saturday 22:00
// GMT, or 21:00 GMT while Sydney is on summer time. Returns the latest one found in the bars.
export function psyLevels(bars, forex = false) {
  let found = null;
  let current = null;
  for (let index = 0; index < bars.length; index++) {
    const time = bars[index].time;
    const summer = !forex && zoneOffset('Australia/Sydney', time) === 11 * 3600000;
    const shifted = time + (summer ? 3600000 : 0);
    const day = Math.floor(shifted / DAY);
    const hour = (shifted - day * DAY) / 3600000;
    const weekday = (day + 4) % 7;
    const inside = forex ? weekday === 1 && hour < 8 : (weekday === 6 && hour >= 22) || (weekday === 0 && hour < 6);
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
function anchorPeriod(time, anchor) {
  const day = Math.floor(time / DAY);
  if (anchor === 'Session') return day;
  if (anchor === 'Week') return Math.floor((day + 3) / 7);
  const date = new Date(time);
  const months = { Month: 1, Quarter: 3, Year: 12, Decade: 120, Century: 1200 }[anchor] ?? 1;
  return Math.floor((date.getUTCFullYear() * 12 + date.getUTCMonth()) / months);
}

function weightedVwap(bars, anchor, percentage) {
  const vwap = [];
  const basis = [];
  let period = null;
  let volume = 0;
  let sum = 0;
  let squares = 0;
  for (const bar of bars) {
    const now = anchorPeriod(bar.time, anchor);
    if (now !== period) [period, volume, sum, squares] = [now, 0, 0, 0];
    const typical = (bar.high + bar.low + bar.close) / 3;
    volume += bar.volume;
    sum += typical * bar.volume;
    squares += typical * typical * bar.volume;
    const value = volume ? sum / volume : null;
    vwap.push(value);
    basis.push(value === null ? 0 : percentage ? value / 100 : Math.sqrt(Math.max(0, squares / volume - value * value)));
  }
  return { vwap, basis };
}

function vwapEnvelope(vwap, basis, width) {
  const edge = sign => vwap.map((value, index) => value === null ? null : value + sign * basis[index] * width);
  return { upper: edge(1), lower: edge(-1) };
}

export function vwapBands(bars, width = 1) {
  const { vwap, basis } = weightedVwap(bars, 'Session', false);
  return { vwap, ...vwapEnvelope(vwap, basis, width) };
}

function suiteVwap(bars, p) {
  const { vwap, basis } = weightedVwap(bars, p.vwapAnchor, p.vwapMode === 'Percentage');
  const plots = [stroke('VWAP', vwap, '#2962ff')];
  for (const [index, width] of [p.band1, p.band2, p.band3].entries()) {
    if (!width) continue;
    const n = index + 1;
    const { upper, lower } = vwapEnvelope(vwap, basis, width);
    const color = ['#4caf50', '#808000', '#008080'][index];
    plots.push(shape('band', 'VWAP band ' + n, { upper, lower, color, opacity: 0.07 }),
      stroke('VWAP upper ' + n, upper, color), stroke('VWAP lower ' + n, lower, color));
  }
  return plots.map(plot => ({ ...plot, key: plot.label }));
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
        plots.push(shape('boxes', 'Vector zones', { boxes: vectorZones(bars, flags, { wicks: Boolean(p.wicks), trim: p.trimZones !== 0, max: p.limit })
          .map(zone => ({ from: zone.from, to: null, top: zone.top, bottom: zone.bottom, color: '#ffe64b', opacity: 0.12, styleKey: 'zone:' + zone.flag })) }));
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
      const interval = context.interval ?? 60;
      const intraday = interval < 1440;
      const daily = context.daily ?? [];
      const levels = dailyLevels(daily, { adr: p.length });
      const historical = p.daily && p.historicalLevels && interval < 10080 && daily.length;
      if (levels) {
        const start = bars.findIndex(bar => bar.time >= levels.start - DAY);
        const from = start < 0 ? null : start;
        const add = (value, label, color, more) => present(value) && rays.push(ray(value, label, color, { from, ...more }));
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
      if (p.psy && interval <= 60 && bars.length) {
        const olderHours = (context.hourly ?? []).filter(bar => bar.time + 3600000 <= bars[0].time);
        const psy = psyLevels([...olderHours, ...bars], context.forex);
        if (psy) {
          const from = Math.max(0, psy.from - olderHours.length);
          rays.push(referenceRay(psy.high, 'Psy-Hi', '#ff9800', from), referenceRay(psy.low, 'Psy-Lo', '#ff9800', from));
        }
      }
      const history = [];
      if (p.daily && daily.length && bars.length) {
        const values = historicalLevels(bars, daily);
        for (const [label, color, key] of intraday ? historicalFields : historicalFields.slice(4)) {
          const series = values[key];
          if (historical) history.push({ ...stroke(displayLevel[label] ?? label, series, color, 2), key: 'level:' + label, kind: 'step', opacity: 0.85 });
          if (!present(series.at(-1))) continue;
          const period = key.startsWith('week') ? 7 : 1;
          const day = Math.floor(bars.at(-1).time / DAY);
          const boundary = (day - (period === 7 ? (day + 3) % 7 : 0)) * DAY;
          const from = historical ? bars.length - 1 : bars.findIndex(bar => bar.time >= boundary);
          rays.push(referenceRay(series.at(-1), label, color, from));
        }
      }
      return [shape('rays', 'Levels', { rays }), ...history];
    } },
  { id: 'sessions', name: 'Market sessions', pane: 'overlay', params: { weekends: 0 },
    plots: (bars, p, context = {}) => {
      const interval = context.interval ?? 60;
      if (interval > 240) return [shape('boxes', 'Sessions', { boxes: [] })];
      const boxes = [];
      const rays = [];
      for (const session of sessions) {
        if (session.name === 'Frankfurt' && !p.frankfurt) continue;
        const ranges = sessionRanges(bars, session, interval, Boolean(p.weekends));
        if (p.fill !== false) for (const range of ranges) {
          boxes.push({ from: range.from, to: range.to, top: range.openHigh, bottom: range.openLow, color: session.color,
            opacity: session.fillOpacity ?? (session.name.endsWith('Brinks') ? 0.3 : 0.22), styleKey: 'session-fill:' + session.name });
        }
        const latest = ranges.at(-1);
        if (latest) {
          const range = { from: latest.from, to: latest.to, dash: '5 4', opacity: session.lineOpacity, tag: false, styleKey: 'session-line:' + session.name };
          rays.push(ray(latest.high, session.name, session.color, { ...range, start: true }), ray(latest.low, '', session.color, range));
        }
      }
      return [shape('boxes', 'Sessions', { boxes }), shape('rays', 'Session ranges', { rays })];
    } },
  { id: 'liquidations', name: 'Estimated liquidation levels', pane: 'overlay', params: { both: 0, limit: 60 },
    plots: (bars, p, context = {}) => {
      const tiers = ['#ffeb3b', '#ff9800', '#f44336'];
      const levels = liquidationLevels(bars, pvsraFlags(bars), { interest: context.interest ?? null, both: Boolean(p.both), max: p.limit });
      return [shape('rays', 'Liquidation estimates', { rays: levels.flatMap(level => [
        ray(level.price, (level.side === 'long' ? 'Long' : 'Short') + ' liq ' + level.leverage + 'x', tiers[level.tier - 1], { from: level.from, width: level.tier, dash: level.confirmed ? null : '2 3', tag: false, opacity: 0.7, styleKey: 'liquidation:' + level.side + ':' + level.tier }),
        ray(level.entry, '', '#00bcd4', { from: level.from, dash: level.confirmed ? null : '2 3', tag: false, opacity: 0.4, styleKey: 'break-even' })]) })];
    } },
  { id: 'vwap-bands', name: 'VWAP with bands (daily)', pane: 'overlay', params: { width: 1 },
    plots: (bars, p) => {
      const bands = vwapBands(bars, p.width);
      return [shape('band', 'VWAP band', { upper: bands.upper, lower: bands.lower, color: '#4caf50', opacity: 0.07 }),
        stroke('VWAP', bands.vwap, '#2962ff'), stroke('Upper band', bands.upper, '#4caf50'), stroke('Lower band', bands.lower, '#4caf50')];
    } },
  { id: 'vprofile', name: 'Volume profile with buy and sell split', pane: 'overlay', params: { length: 300, rows: 120 },
    plots: (bars, p) => [shape('profile', 'Volume profile', { profile: volumeProfile(bars, { lookback: p.length, rows: p.rows }) })] },
  pvsraSuite
];

const vectorClasses = [[3, 'Climax up'], [-3, 'Climax down'], [2, 'Above-average up'], [-2, 'Above-average down'], [1, 'Regular up'], [-1, 'Regular down']];
const histogramClasses = [['Positive rising', '#26a69a'], ['Positive falling', '#b2dfdb'], ['Negative rising', '#ffcdd2'], ['Negative falling', '#ff5252']];
const bandColors = ['#4caf50', '#808000', '#008080'];
const element = (key, label, color, kind = 'line', opacity = 100) => ({ key, label, color, kind, opacity });
export const pvsraStyleGroups = [
  ['Candle colors and zones', [
    ...vectorClasses.map(([flag, label]) => element('candle:' + vectorColors[flag], label, vectorColors[flag], 'fill')),
    ...vectorClasses.slice(0, 4).map(([flag, label]) => element('zone:' + flag, label + ' zone', '#ffe64b', 'fill', 12))
  ]],
  ['Moving averages', [
    ...[[5, '#feea4a'], [13, '#fd5457'], [50, '#1fbcd3'], [200, '#b8bcc8'], [800, '#5b43d6']].map(([period, color]) =>
      element('pvsra-ema:EMA ' + period, 'EMA ' + period, color)),
    element('pvsra-ema:EMA 50 cloud', 'EMA 50 cloud', '#9b2fae', 'fill', 28)
  ]],
  ...pvsraAverageGroups.map(([name, slots]) => [name, slots.map(slot => ({
    ...element(slot.key, slot.label, slot.color), legacyKey: slot.legacyKey
  }))]),
  ['Price levels', [
    ...[['YDay Hi', '#2962ff'], ['YDay Lo', '#2962ff'], ['Daily Open', '#feea4e'], ['yDO', '#c19b4d'], ['LWeek Hi', '#4caf50'], ['LWeek Lo', '#4caf50'], ['PP', '#feea4e'],
      ...[0, 1, 2, 3, 4, 5].map(n => ['M' + n, '#b8bcc8']), ...[1, 2, 3].map(n => ['R' + n, '#4caf50']), ...[1, 2, 3].map(n => ['S' + n, '#f44336']),
      ['Hi-ADR', '#c0c0c0'], ['Lo-ADR', '#c0c0c0'], ['Psy-Hi', '#ff9800'], ['Psy-Lo', '#ff9800']].map(([label, color]) => element('level:' + label, displayLevel[label] ?? label, color, 'level', 85))
  ]],
  ['Market sessions', sessions.flatMap(({ name, color }) => [
    element('session-fill:' + name, name + ' fill', color, 'fill', name === 'Frankfurt' ? 25 : name.endsWith('Brinks') ? 30 : 22),
    element('session-line:' + name, name + ' range', color, 'level', name === 'Frankfurt' ? 75 : 85)
  ])],
  ['Estimated liquidation levels', [
    ...['long', 'short'].flatMap(side => ['#ffeb3b', '#ff9800', '#f44336'].map((color, index) =>
      element('liquidation:' + side + ':' + (index + 1), (side === 'long' ? 'Long ' : 'Short ') + [25, 50, 100][index] + 'x', color, 'line', 70))),
    element('break-even', 'Break-even', '#00bcd4', 'line', 40)
  ]],
  ['VWAP and bands', [element('VWAP', 'VWAP', '#2962ff'), ...bandColors.flatMap((color, index) => {
    const n = index + 1;
    return [element('VWAP upper ' + n, 'VWAP upper ' + n, color), element('VWAP lower ' + n, 'VWAP lower ' + n, color),
      element('VWAP band ' + n, 'VWAP band ' + n + ' fill', color, 'fill', 7)];
  })]],
  ['Volume profile', [
    element('profile:buy', 'Buy volume', '#26a69a', 'fill', 45), element('profile:sell', 'Sell volume', '#ef5350', 'fill', 45),
    ...['POC', 'VAH', 'VAL'].map(label => element('profile:' + label, label, '#8b95a6', 'level', 70)),
    element('profile:summary', 'Buy and sell percentages', '#8b95a6', 'fill')
  ]],
  ['MACD and volume', [
    element('MACD', 'MACD', '#2962ff'), element('Signal', 'Signal', '#ff6d00'),
    element('Histogram', 'Histogram', '#26a69a', 'fill'),
    ...histogramClasses.map(([label, color]) => element('histogram:' + color, label, color, 'fill')),
    element('Volume', 'Volume', '#999999', 'fill'),
    element('zero', 'Zero line', '#8b95a6', 'line', 60)
  ]]
];

export const pvsraTimeframes = [['seconds', 'Seconds'], ['minutes', 'Minutes'], ['hours', 'Hours'], ['days', 'Days'], ['weeks', 'Weeks'], ['months', 'Months and years']];
const timeframeBounds = [1, 60, 1440, 10080, 43200, Infinity];
export const pvsraTimeframe = interval => pvsraTimeframes[timeframeBounds.findIndex(limit => interval < limit)]?.[0];
export const pvsraDashes = { solid: '', dashed: '6 4', dotted: '2 3' };

export function cleanPvsraAppearance(value) {
  if (!value || typeof value !== 'object') return undefined;
  const elements = {};
  for (const [, group] of pvsraStyleGroups) for (const { key, legacyKey } of group) {
    const entry = value.elements?.[key] ?? (legacyKey && value.elements?.[legacyKey]);
    if (!entry || typeof entry !== 'object') continue;
    const style = {};
    if (entry.visible === false) style.visible = false;
    if (entry.labels === false) style.labels = false;
    if (typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color)) style.color = entry.color;
    if (Number.isFinite(entry.opacity) && entry.opacity >= 0 && entry.opacity <= 100) style.opacity = entry.opacity;
    if (Number.isFinite(entry.width) && entry.width >= 0.5 && entry.width <= 6) style.width = entry.width;
    if (Object.hasOwn(pvsraDashes, entry.dash)) style.dash = entry.dash;
    if (Object.keys(style).length) elements[key] = style;
  }
  return { elements, values: value.values !== false,
    timeframes: Array.isArray(value.timeframes) ? pvsraTimeframes.map(([id]) => id).filter(id => value.timeframes.includes(id)) : undefined,
    min: Number.isFinite(value.min) && value.min > 0 ? value.min : undefined,
    max: Number.isFinite(value.max) && value.max > 0 ? value.max : undefined };
}

export const pvsraStyleVisible = style => style?.visible !== false && style?.opacity !== 0;

export function applyPvsraStyle(plots, elements) {
  const paint = (item, key) => {
    const style = elements[key];
    if (!style) return item;
    if (!pvsraStyleVisible(style)) return null;
    const dash = pvsraDashes[style.dash] ?? item.dash;
    const color = style.color ?? item.color;
    const label = style.labels === false && item.price !== undefined ? '' : item.label;
    return { ...item, color, label, stroke: style.color ?? item.stroke, width: style.width ?? item.width,
      opacity: style.opacity === undefined ? item.opacity : style.opacity / 100, dash };
  };
  const rgba = (color, opacity) => opacity === undefined || opacity === 100 ? color
    : color + Math.round(opacity * 2.55).toString(16).padStart(2, '0');
  const recolor = (item, prefix, fallback) => {
    const colors = new Map();
    for (const color of new Set(item.colors)) {
      const style = elements[prefix + color];
      colors.set(color, pvsraStyleVisible(style) ? rgba(style?.color ?? color, style?.opacity) : fallback);
    }
    return item.colors.map(color => colors.get(color));
  };
  return plots.flatMap(item => {
    const painted = paint(item, item.key);
    if (!painted) return [];
    const styled = { ...painted };
    if (item.kind === 'rays') styled.rays = item.rays.map(ray => paint(ray, ray.styleKey ?? 'level:' + ray.label)).filter(Boolean);
    if (item.kind === 'boxes') styled.boxes = item.boxes.map(box => paint(box, box.styleKey)).filter(Boolean);
    if (item.kind === 'barcolor') styled.colors = recolor(item, 'candle:', null);
    if (item.key === 'Histogram') styled.colors = recolor(item, 'histogram:', 'transparent');
    if (item.key === 'Volume') {
      if (elements.Volume?.color) styled.colors = item.values.map(() => elements.Volume.color);
      else if (item.colors) styled.colors = recolor(item, 'candle:', null);
    }
    if (item.kind === 'profile') styled.parts = elements;
    return [styled];
  });
}
