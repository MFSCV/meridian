// Chart engine: one SVG chart with panes, zoom, pan, crosshair, drawings and bar replay.
import { series, find, price, intervalLabel, tickerLabel } from './market.mjs';
import { definition, heikinAshi } from './indicators.mjs';
import { applyPvsraStyle, pvsraDashes, pvsraStyleVisible, pvsraTimeframe } from './pvsra.mjs';
import { L } from './i18n.mjs';

const NS = 'http://www.w3.org/2000/svg';
export const styles = ['Candles', 'Hollow candles', 'Bars', 'Line', 'Area', 'Baseline', 'Heikin Ashi'];
// Plot kinds that draw shapes rather than one value per bar.
export const shapes = new Set(['barcolor', 'boxes', 'rays', 'band', 'profile']);
export const palette = ['#3b82f6', '#e8912d', '#a366e0', '#17a99a', '#e0559a', '#93a31f'];
const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const ink = '#3b82f6';
const round = value => Math.round(value * 10) / 10;
const candleBody = pitch => Math.max(1, Math.min(pitch - 1, pitch * 0.72));
const lineStyles = ['Line', 'Area', 'Baseline'];
let serial = 0;

function countdownText(seconds) {
  const pair = value => String(value).padStart(2, '0');
  const minutes = pair(Math.floor(seconds / 60) % 60);
  const hours = pair(Math.floor(seconds / 3600) % 24);
  if (seconds >= 86400) return Math.floor(seconds / 86400) + 'd ' + hours + ':' + minutes;
  const short = minutes + ':' + pair(seconds % 60);
  return seconds >= 3600 ? hours + ':' + short : short;
}

function node(parent, tag, attrs = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) element.setAttribute(key, value);
  }
  if (text !== undefined) element.textContent = text;
  parent.append(element);
  return element;
}

function nice(span, target) {
  const rough = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  return (fraction < 1.5 ? 1 : fraction < 3.5 ? 2 : fraction < 7.5 ? 5 : 10) * magnitude;
}

function scale(top, height, min, max, log, pad = 0.08) {
  if (!(max > min)) [min, max] = [min - Math.abs(min || 1) * 0.01, min + Math.abs(min || 1) * 0.01];
  const forward = log && min > 0 ? Math.log : value => value;
  const back = log && min > 0 ? Math.exp : value => value;
  const margin = (forward(max) - forward(min)) * pad;
  const low = forward(min) - margin;
  const high = forward(max) + margin;
  return {
    top, height, low: back(low), high: back(high),
    y: value => top + (high - forward(value)) / (high - low) * height,
    value: y => back(high - (y - top) / height * (high - low))
  };
}

function distance(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const along = dx || dy ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - x1 - along * dx, py - y1 - along * dy);
}

// An indicator with an "overlay" setting chooses its own place; the others use the pane their definition names.
export const paneOf = indicator => indicator.id === 'formula' || indicator.params?.overlay !== undefined
  ? (indicator.params.overlay ? 'overlay' : 'separate') : definition(indicator.id).pane;
// Height of a pane as a share of the standard pane; volume starts smaller.
const paneSize = (indicator, settings) => Math.min(4, Math.max(0.25, settings.size ?? (['volume', 'pvsra-suite'].includes(indicator.id) ? 0.6 : 1)));
export const studyScale = value => Math.min(12, Math.max(0.1, value));

export function createChart(host, state, env) {
  const id = ++serial;
  host.replaceChildren();
  const svg = node(host, 'svg', { class: 'chart', tabindex: 0, role: 'img', 'font-family': 'system-ui, sans-serif', 'font-size': 11 });
  const legend = document.createElement('div');
  legend.className = 'legend';
  host.append(legend);
  const layers = { base: node(svg, 'g'), draw: node(svg, 'g', { 'clip-path': 'url(#main' + id + ')' }), cross: node(svg, 'g', { 'pointer-events': 'none' }) };
  const view = { end: null, width: 8, auto: true, price: null };
  const pointers = new Map();
  const memo = new Map();
  let replay = null;
  let geo;
  let cross = null;
  let selected = null;
  let draft = null;
  let measure = null;
  let drag = null;
  let wheelPan = null;
  let markers = [];
  let liveMode;
  let countdown;

  const instrument = () => find(state.symbol);
  const raw = () => series(instrument(), state.interval);
  const length = () => replay ?? raw().length;
  const drawings = () => env.store.drawings[state.symbol] ??= [];
  function cached(key, make) {
    const full = state.symbol + '|' + state.interval + '|' + key;
    if (!memo.has(full)) {
      if (memo.size > 40) memo.clear();
      memo.set(full, make());
    }
    return memo.get(full);
  }
  const shown = () => state.style === 'Heikin Ashi' ? cached('heikin', () => heikinAshi(raw())) : raw();
  const visibleAtInterval = ({ appearance }) => !appearance ||
    (appearance.timeframes?.includes(pvsraTimeframe(state.interval)) ?? true) &&
    state.interval >= (appearance.min ?? 0) && state.interval <= (appearance.max ?? Infinity);
  function plotsOf(indicator) {
    try {
      const elements = indicator.appearance?.elements;
      return cached(indicator.id + JSON.stringify(indicator.params) + JSON.stringify(elements) + '|' + replay, () => {
        const bars = raw();
        const plots = definition(indicator.id).plots(replay === null ? bars : bars.slice(0, replay), indicator.params, context);
        return elements && Object.keys(elements).length ? applyPvsraStyle(plots, elements) : plots;
      });
    } catch {
      return [];
    }
  }
  // What a study may ask for beyond the bars of this chart. Each value is read only when a study uses it.
  const context = {
    get interval() { return state.interval; },
    get hourly() { return state.interval < 60 ? series(instrument(), 60) : []; },
    get forex() { return instrument().type === 'Forex'; },
    get daily() {
      const daily = series(instrument(), 1440);
      if (replay === null) return daily;
      const bars = raw().slice(0, replay);
      const dayMs = 86_400_000;
      const time = Math.floor(bars.at(-1).time / dayMs) * dayMs;
      const previous = daily.filter(bar => bar.time < time);
      if (state.interval >= 1440) return [...previous, ...daily.filter(bar => bar.time === time)];
      const today = bars.filter(bar => bar.time >= time);
      const open = daily.find(bar => bar.time === time)?.open ?? today[0].open;
      const partial = today.reduce((day, bar) => ({
        ...day, high: Math.max(day.high, bar.high), low: Math.min(day.low, bar.low), close: bar.close, volume: day.volume + bar.volume
      }), { time, open, high: open, low: open, close: open, volume: 0 });
      return [...previous, partial];
    },
    get interest() { return env.interest?.(state.symbol, state.interval) ?? null; }
  };
  const fmt = value => price(value, instrument());
  const compact = value => Math.abs(value) >= 1e6 ? (value / 1e6).toFixed(2) + 'M' : Math.abs(value) >= 1e4 ? (value / 1e3).toFixed(1) + 'K'
    : value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) < 10 ? 4 : 2 });

  function clamp() {
    view.width = Math.min(80, Math.max(0.4, view.width));
    if (geo?.showProfileBars) return;
    const total = length();
    const future = (geo?.timePlot ?? 800) * 0.85 / view.width;
    view.end = Math.min(total + future, Math.max(Math.min(total, 10), view.end));
  }

  function snapToLatest(previousEnd) {
    if (!geo?.showProfileBars) return false;
    const latest = length();
    const offset = view.end - latest;
    const previous = previousEnd - latest;
    const returning = previous > 0 ? offset < previous : previous < 0 && offset > previous;
    if (!returning) return false;
    // Settle after the latest candle is reached, while leaving outward drags unrestricted.
    const latestVisible = offset >= 0 && (offset + 0.5) * view.width < geo.span;
    if (!latestVisible && Math.abs(offset) * view.width > 12) return false;
    view.end = latest;
    return true;
  }

  function timeSpan(plot, pitch, profile) {
    if (!profile || lineStyles.includes(state.style)) return plot;
    // Put the painted right edge of the last candle at the gutter, including its 1px stroke.
    return plot + (pitch - candleBody(pitch) - 1) / 2;
  }

  function cancelWheelPan() {
    clearTimeout(wheelPan?.timer);
    wheelPan = null;
  }

  function linePath(values, y, x, first, last, step = false) {
    let path = '';
    let pen = false;
    for (let index = first; index <= last; index++) {
      const value = values[index];
      if (value === null || value === undefined || Number.isNaN(value)) pen = false;
      else {
        path += pen && step ? 'H' + round(x(index)) + 'V' + round(y(value)) : (pen ? 'L' : 'M') + round(x(index)) + ' ' + round(y(value));
        pen = true;
      }
    }
    return path;
  }

  function render() {
    countdown = null;
    const colors = env.colors();
    const isLive = Boolean(instrument().live);
    if (liveMode !== undefined && liveMode !== isLive) {
      // Simulated and live histories have independent bar indices and lengths.
      cancelWheelPan();
      view.end = replay = cross = null;
      view.auto = true;
      memo.clear();
      buildLegend();
    }
    liveMode = isLive;
    if (!raw().length) {
      geo = null;
      for (const layer of Object.values(layers)) layer.replaceChildren();
      const width = host.clientWidth || 900;
      const height = host.clientHeight || 460;
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      node(layers.base, 'text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: colors.muted, 'font-size': 13, class: 'empty' },
        env.status?.(state) ?? env.t('Loading…'));
      const values = legend.querySelector('.main .values');
      if (values) values.textContent = '';
      return;
    }
    const bars = shown();
    const total = length();
    const width = host.clientWidth || 900;
    const height = host.clientHeight || 460;
    const axis = width < 520 ? 56 : 68;
    const foot = 22;
    const plot = width - axis;
    const active = state.indicators.filter(indicator => !indicator.hidden && visibleAtInterval(indicator)).map(indicator => {
      const pane = paneOf(indicator);
      const plots = plotsOf(indicator).map((item, index) => ({ item, key: item.key ?? index, pane: item.pane ?? (pane === 'both' ? 'overlay' : pane) }));
      return { indicator, plots };
    });
    const overlays = active.flatMap(({ indicator, plots }) => plots.filter(plot => plot.pane === 'overlay').map(plot => ({ indicator, ...plot })));
    const showProfileBars = overlays.some(({ item }) => item.kind === 'profile' && item.profile &&
      ['buy', 'sell'].some(side => pvsraStyleVisible(item.parts?.['profile:' + side])));
    // Reserve a lane next to the price scale while either side of the profile is visible.
    const profileReach = showProfileBars ? Math.min(plot * 0.18, 220) : 0;
    const defaultBars = plot / Math.max(3, Math.min(8, plot / 90));
    const gutterBars = showProfileBars ? 6 : 0;
    const defaultPitch = (plot - profileReach) / (defaultBars + gutterBars);
    const timePlot = plot - profileReach - gutterBars * defaultPitch;
    const separate = active.flatMap(({ indicator, plots }) => {
      const lower = plots.filter(plot => plot.pane === 'separate');
      const main = lower.filter(({ item }) => !item.subpane);
      const volume = lower.filter(({ item }) => item.subpane === 'volume');
      const panes = [];
      if (main.length || paneOf(indicator) === 'separate') panes.push({ indicator, plots: main, settings: indicator });
      if (volume.length) panes.push({ indicator, plots: volume, settings: indicator.volumePane ??= {} });
      return panes;
    });
    const weights = separate.map(({ indicator, settings }) => paneSize(indicator, settings));
    const wanted = weights.reduce((sum, weight) => sum + weight, 0) * 0.21;
    const unit = (height - foot) * 0.21 * Math.min(1, 0.75 / (wanted || 1));
    const tops = [];
    let used = 0;
    for (const weight of weights) {
      tops.push(used);
      used += weight * unit;
    }
    const mainH = height - foot - used;
    host.classList.toggle('hide-legend', env.store.settings.legend === false);
    if (view.auto) {
      const saved = replay === null && state.viewport?.live === isLive ? state.viewport : null;
      view.width = saved ? timePlot / saved.bars : defaultPitch;
      if (saved) {
        view.end = total + saved.offset;
        view.price = saved.price;
      }
    }
    else if (geo?.timePlot > 0 && timePlot !== geo.timePlot) view.width *= timePlot / geo.timePlot;
    view.auto = false;
    if (view.end === null) view.end = total + (showProfileBars ? 0 : 3);
    geo = { timePlot, showProfileBars };
    clamp();
    const span = timeSpan(timePlot, view.width, showProfileBars);
    const from = view.end - span / view.width;
    const x = index => (index - from + 0.5) * view.width;
    const last = view.end <= 0 ? -1 : Math.min(total - 1, Math.ceil(view.end));
    const first = Math.max(0, Math.floor(from));
    const lineStyle = lineStyles.includes(state.style);
    const compares = state.compare.flatMap((symbol, index) => {
      const other = series(find(symbol), state.interval);
      if (!other.length) return [];
      const anchor = Math.min(first, total - 1, other.length - 1);
      const base = other[anchor].close;
      const factor = bars[anchor].close / base;
      return [{ symbol, color: palette[(index + 2) % palette.length], values: other.map(bar => bar.close * factor), base, other }];
    });

    let min = Infinity;
    let max = -Infinity;
    for (let index = first; index <= last; index++) {
      min = Math.min(min, lineStyle ? bars[index].close : bars[index].low);
      max = Math.max(max, lineStyle ? bars[index].close : bars[index].high);
    }
    for (const values of [...overlays.map(plot => plot.item).filter(item => item.kind !== 'volume' && !shapes.has(item.kind)).map(item => item.values),
      ...compares.map(item => item.values)]) {
      for (let index = first; index <= last; index++) {
        if (values[index] !== null && values[index] !== undefined && !Number.isNaN(values[index])) {
          min = Math.min(min, values[index]);
          max = Math.max(max, values[index]);
        }
      }
    }
    for (const { item } of overlays) {
      for (const ray of item.rays ?? []) {
        if (!ray.reference || (ray.from ?? 0) > last || (ray.to ?? Infinity) < first) continue;
        min = Math.min(min, ray.price);
        max = Math.max(max, ray.price);
      }
    }
    if (first > last) {
      const profile = overlays.find(({ item }) => item.kind === 'profile' && item.profile)?.item.profile;
      [min, max] = profile ? [profile.low, profile.high] : [bars[total - 1].low, bars[total - 1].high];
    }
    const main = view.price ? scale(0, mainH, view.price.low, view.price.high, state.log, 0) : scale(0, mainH, min, max, state.log);
    const ms = Math.round(state.interval * 60000);
    geo = { width, height, plot, timePlot, defaultPitch, showProfileBars, span, axis, foot, mainH, from, x, main, first, last, total, ms, t0: raw()[0].time, panes: [] };

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('aria-label', env.t('{0} price chart, {1}. Arrow keys inspect bars, plus and minus zoom. The Data panel lists the same bars as a table.',
      instrument().name, intervalLabel(state.interval)));
    const base = layers.base;
    base.replaceChildren();
    const defs = node(base, 'defs');
    node(node(defs, 'clipPath', { id: 'main' + id }), 'rect', { x: 0, y: 0, width: timePlot, height: mainH });
    node(node(defs, 'clipPath', { id: 'profile' + id }), 'rect', { x: 0, y: 0, width: plot, height: mainH });
    const line = (x1, y1, x2, y2, stroke, extra = {}) => node(base, 'line', { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2), stroke, ...extra });
    const text = (tx, ty, content, extra = {}) => node(base, 'text', { x: round(tx), y: round(ty), fill: colors.muted, ...extra }, content);
    const tag = (ty, content, fill, color = colors.panel) => {
      node(base, 'rect', { x: plot, y: round(ty - 9), width: axis, height: 18, fill, rx: 2 });
      text(plot + 5, ty + 4, content, { fill: color });
    };

    // Grid and axes.
    const grid = env.store.settings.grid ? colors.grid : 'none';
    const step = nice(main.high - main.low, mainH / 54);
    for (let value = Math.ceil(main.low / step) * step; value < main.high; value += step) {
      line(0, main.y(value), plot, main.y(value), grid);
      text(plot + 5, main.y(value) + 4, fmt(value));
    }
    const every = Math.max(1, Math.ceil(88 / view.width));
    let day = '';
    for (let index = Math.ceil(from / every) * every; index < view.end; index += every) {
      const time = geo.t0 + index * ms;
      const current = env.time(time, 'day');
      const label = state.interval >= 1440 || current !== day ? current : env.time(time, 'time', state.interval < 1);
      day = current;
      line(x(index), 0, x(index), height - foot, grid);
      if (x(index) > 20 && x(index) < timePlot - 20) text(x(index), height - 7, label, { 'text-anchor': 'middle' });
    }
    line(plot, 0, plot, height, colors.edge);
    line(0, height - foot, width, height - foot, colors.edge);

    const profileLayer = node(base, 'g', { 'clip-path': 'url(#profile' + id + ')' });
    const series_ = node(base, 'g', { 'clip-path': 'url(#main' + id + ')' });
    const path = (d, extra) => d && node(series_, 'path', { d, fill: 'none', ...extra });
    const body = candleBody(view.width);

    // Volume bars along the bottom of the main pane.
    const volumeOverlay = overlays.find(({ indicator }) => indicator.id === 'volume');
    if (volumeOverlay) {
      let peak = 0;
      const volumeShare = Math.min(0.8, Math.max(0.03, (volumeOverlay.indicator.params.height ?? 18) / 100));
      for (let index = first; index <= last; index++) peak = Math.max(peak, bars[index].volume);
      const parts = { up: '', down: '' };
      for (let index = first; index <= last; index++) {
        const size = bars[index].volume / peak * mainH * volumeShare;
        parts[bars[index].close >= bars[index].open ? 'up' : 'down'] +=
          'M' + round(x(index) - body / 2) + ' ' + round(mainH - size) + 'h' + round(body) + 'v' + round(size) + 'h' + round(-body) + 'Z';
      }
      path(parts.up, { fill: colors.up, opacity: 0.32, class: 'volume' });
      path(parts.down, { fill: colors.down, opacity: 0.32, class: 'volume' });
    }

    // Study shapes that sit behind the price: filled bands, boxes and the volume profile.
    const right = index => index === null || index === undefined ? plot : x(index) + view.width / 2;
    const left = index => index === null || index === undefined || index < 0 ? 0 : x(index) - view.width / 2;
    const studies = overlays.map(plot => plot.item);
    for (const item of studies) {
      if (item.kind === 'band') {
        let from = null;
        const flush = to => {
          if (from === null || to - from < 1) return;
          let d = '';
          for (let index = from; index <= to; index++) d += (index === from ? 'M' : 'L') + round(x(index)) + ' ' + round(main.y(item.upper[index]));
          for (let index = to; index >= from; index--) d += 'L' + round(x(index)) + ' ' + round(main.y(item.lower[index]));
          path(d + 'Z', { fill: item.color, opacity: item.opacity ?? 0.15, class: 'study-band' });
        };
        for (let index = first; index <= last + 1; index++) {
          const filled = index <= last && item.upper[index] !== null && item.upper[index] !== undefined && item.lower[index] !== null && item.lower[index] !== undefined;
          if (filled && from === null) from = index;
          if (!filled && from !== null) {
            flush(index - 1);
            from = null;
          }
        }
      } else if (item.kind === 'boxes') {
        for (const box of item.boxes) {
          const [x1, x2] = [left(box.from), Math.min(plot, right(box.to))];
          if (x2 <= 0 || x1 >= plot || x2 <= x1) continue;
          const [top, bottom] = [main.y(box.top), main.y(box.bottom)];
          if (bottom < 0 || top > mainH) continue;
          node(series_, 'rect', { x: round(Math.max(0, x1)), y: round(top), width: round(x2 - Math.max(0, x1)), height: Math.max(1, round(bottom - top)), fill: box.color, opacity: box.opacity ?? 0.15, class: 'study-box' });
        }
      } else if (item.kind === 'profile' && item.profile) {
        const reach = profileReach;
        const buyVisible = pvsraStyleVisible(item.parts?.['profile:buy']);
        const sellVisible = pvsraStyleVisible(item.parts?.['profile:sell']);
        const rows = item.profile.rows.flatMap(row => {
          const top = main.y(row.high);
          const bottom = main.y(row.low);
          if (bottom < 0 || top >= mainH) return [];
          return [{ top, bottom, buy: buyVisible ? row.buy : 0, sell: sellVisible ? row.sell : 0 }];
        });
        const peak = Math.max(0, ...rows.map(row => row.buy + row.sell));
        const widthPerVolume = peak > 0 ? reach / peak : 0;
        const profileLeft = plot - reach;
        const profileRight = plot;
        const parts = { buy: '', sell: '' };
        for (const row of rows) {
          const { top, bottom } = row;
          const buy = row.buy * widthPerVolume;
          const sell = row.sell * widthPerVolume;
          const tall = Math.max(1, round(bottom - top - 0.5));
          if (buy > 0) parts.buy += 'M' + round(profileRight - buy) + ' ' + round(top) + 'h' + round(buy) + 'v' + tall + 'h' + round(-buy) + 'Z';
          if (sell > 0) parts.sell += 'M' + round(profileRight - buy - sell) + ' ' + round(top) + 'h' + round(sell) + 'v' + tall + 'h' + round(-sell) + 'Z';
        }
        for (const [side, color] of [['buy', '#26a69a'], ['sell', '#ef5350']]) {
          const style = item.parts?.['profile:' + side];
          if (pvsraStyleVisible(style) && parts[side]) node(profileLayer, 'path', { d: parts[side], fill: style?.color ?? color, opacity: (style?.opacity ?? 45) / 100, class: 'study-profile' });
        }
        const edge = profileLeft - 4;
        for (const [value, label, width] of [[item.profile.poc, 'POC', 2], [item.profile.valueHigh, 'VAH', 1], [item.profile.valueLow, 'VAL', 1]]) {
          const style = item.parts?.['profile:' + label];
          const y = main.y(value);
          if (!(y > 0 && y < mainH) || !pvsraStyleVisible(style)) continue;
          const opacity = (style?.opacity ?? 70) / 100;
          node(profileLayer, 'line', { x1: round(edge), y1: round(y), x2: round(profileRight), y2: round(y), stroke: style?.color ?? colors.text, 'stroke-width': style?.width ?? width,
            opacity, 'stroke-dasharray': pvsraDashes[style?.dash] ?? (width === 2 ? null : '3 3') });
          if (style?.labels !== false) node(profileLayer, 'text', { x: round(edge - 4), y: round(y + 4), 'text-anchor': 'end', fill: style?.color ?? colors.muted, opacity }, label);
        }
        const summary = item.parts?.['profile:summary'];
        if (pvsraStyleVisible(summary)) node(profileLayer, 'text', { x: round(profileRight - 6), y: 14, 'text-anchor': 'end',
          fill: summary?.color ?? colors.muted, opacity: (summary?.opacity ?? 100) / 100, class: 'study-profile-note' },
          env.t('Buy {0}% · Sell {1}%', Math.round(item.profile.buyShare * 100), 100 - Math.round(item.profile.buyShare * 100)));
      }
    }
    // A study may give every bar its own colour.
    const tint = studies.find(item => item.kind === 'barcolor')?.colors;

    // Price series.
    if (lineStyle && first <= last) {
      const d = linePath(bars.map(bar => bar.close), main.y, x, first, last);
      const closed = d + 'L' + round(x(last)) + ' {y}L' + round(x(first)) + ' {y}Z';
      if (state.style === 'Area') path(closed.replaceAll('{y}', round(mainH)), { fill: colors.accent, opacity: 0.14, class: 'area' });
      if (state.style === 'Baseline') {
        const level = main.y(bars[first].close);
        node(node(defs, 'clipPath', { id: 'above' + id }), 'rect', { x: 0, y: 0, width: plot, height: Math.max(0, level) });
        node(node(defs, 'clipPath', { id: 'below' + id }), 'rect', { x: 0, y: Math.max(0, level), width: plot, height: mainH });
        for (const [side, color] of [['above', colors.up], ['below', colors.down]]) {
          const group = node(series_, 'g', { 'clip-path': 'url(#' + side + id + ')' });
          node(group, 'path', { d: closed.replaceAll('{y}', round(level)), fill: color, opacity: 0.16 });
          node(group, 'path', { d, fill: 'none', stroke: color, 'stroke-width': 1.8 });
        }
        line(0, level, plot, level, colors.muted, { 'stroke-dasharray': '2 4' });
      } else {
        path(d, { stroke: colors.accent, 'stroke-width': 1.8, class: 'price-line' });
      }
    } else {
      const parts = { up: '', down: '' };
      for (let index = first; index <= last; index++) {
        const bar = bars[index];
        const cx = round(x(index));
        const [open, high, low, close] = [bar.open, bar.high, bar.low, bar.close].map(value => round(main.y(value)));
        const top = Math.min(open, close);
        const bottom = Math.max(open, close);
        const group = tint?.[index] ?? (bar.close >= bar.open ? 'up' : 'down');
        parts[group] = (parts[group] ?? '') + (state.style === 'Bars'
          ? 'M' + cx + ' ' + high + 'V' + low + 'M' + round(cx - body / 2) + ' ' + open + 'H' + cx + 'M' + cx + ' ' + close + 'H' + round(cx + body / 2)
          : 'M' + cx + ' ' + high + 'V' + top + 'M' + cx + ' ' + bottom + 'V' + low +
            'M' + round(cx - body / 2) + ' ' + top + 'h' + round(body) + 'v' + Math.max(1, round(bottom - top)) + 'h' + round(-body) + 'Z');
      }
      const hollow = state.style === 'Hollow candles';
      for (const [group, d] of Object.entries(parts)) {
        if (group !== 'up' && group !== 'down') path(d, { stroke: group, fill: state.style === 'Bars' ? 'none' : group, class: 'candles tinted' });
      }
      path(parts.up, { stroke: colors.up, fill: state.style === 'Bars' ? 'none' : hollow ? colors.panel : colors.up, class: 'candles' });
      path(parts.down, { stroke: colors.down, fill: state.style === 'Bars' ? 'none' : colors.down, class: 'candles' });
    }

    // Overlay studies and comparison symbols.
    for (const { indicator, item, key } of overlays) {
      if (item.kind === 'dots') {
        let dots = '';
        for (let index = first; index <= last; index++) {
          if (item.values[index] !== null && item.values[index] !== undefined) {
            dots += 'M' + round(x(index) - 1.6) + ' ' + round(main.y(item.values[index])) + 'a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0';
          }
        }
        path(dots, { fill: (indicator.colors?.[key] ?? palette[item.color ?? 0]), class: 'study' });
      } else if (item.kind === 'rays') {
        const placed = [];
        const offScale = { above: [], below: [] };
        for (const ray of item.rays) {
          const y = main.y(ray.price);
          const [x1, x2] = [left(ray.from), Math.min(timePlot, right(ray.to))];
          if (x2 <= 0 || x1 >= timePlot) continue;
          if (!(y > 0 && y < mainH)) {
            if (view.price && ray.reference && ray.label && Number.isFinite(y)) offScale[y <= 0 ? 'above' : 'below'].push(ray);
            continue;
          }
          node(series_, 'line', { x1: round(Math.max(0, x1)), y1: round(y), x2: round(x2), y2: round(y), stroke: ray.color, 'stroke-width': ray.width ?? 1,
            'stroke-dasharray': ray.dash ?? null, opacity: ray.opacity ?? 0.85, class: 'study-ray' });
          if (!ray.label) continue;
          // A label sits at the start of a session line, otherwise at the right edge; close neighbours step left.
          if (ray.start) node(series_, 'text', { x: round(Math.max(4, x1 + 3)), y: round(y - 4), fill: ray.color, opacity: ray.opacity, class: 'study-label' }, ray.label);
          else {
            const labelX = placed.filter(other => Math.abs(other.y - y) < 12).reduce((right, other) => Math.min(right, other.left), x2 - 6);
            placed.push({ y, left: labelX - ray.label.length * 7 - 8 });
            node(series_, 'text', { x: round(labelX), y: round(y - 4), 'text-anchor': 'end', fill: ray.color, opacity: ray.opacity, class: 'study-label' }, ray.label);
          }
        }
        for (const [edge, rays] of Object.entries(offScale)) {
          const above = edge === 'above';
          let right = timePlot - 6;
          let y = above ? Math.min(mainH - 8, legend.offsetTop + legend.offsetHeight + 16) : mainH - 8;
          for (const ray of rays) {
            const labelWidth = (ray.label.length + 2) * 7 + 8;
            if (right < labelWidth && right < timePlot - 6) {
              right = timePlot - 6;
              y += above ? 14 : -14;
            }
            const label = node(series_, 'text', { x: round(right), y: round(y), 'text-anchor': 'end', fill: ray.color,
              opacity: ray.opacity, class: 'study-label study-label-offscale', 'data-level': ray.label }, ray.label + (above ? ' ↑' : ' ↓'));
            node(label, 'title', {}, ray.label + ' · ' + fmt(ray.price));
            right -= labelWidth;
          }
        }
      } else if (item.kind !== 'volume' && !shapes.has(item.kind)) {
        path(linePath(item.values, main.y, x, first, last, item.kind === 'step'), { stroke: (indicator.colors?.[key] ?? indicator.colors?.[item.legacyKey] ?? item.stroke ?? palette[item.color ?? 0]),
          'stroke-width': item.width ?? indicator.width ?? 1.4, 'stroke-dasharray': item.dash, opacity: item.opacity,
          class: item.kind === 'step' ? 'study study-step' : 'study' });
      }
    }
    for (const item of compares) path(linePath(item.values, main.y, x, first, last), { stroke: item.color, 'stroke-width': 1.6, class: 'compare' });
    geo.compares = compares;

    // Strategy entries and exits from the last backtest.
    for (const marker of markers) {
      const at = (marker.time - geo.t0) / ms;
      if (at < first || at > last) continue;
      const buying = marker.side === 'buy';
      const y = main.y(buying ? bars[at].low : bars[at].high) + (buying ? 12 : -12);
      node(series_, 'path', { d: 'M' + round(x(at)) + ' ' + round(y - (buying ? 7 : -7)) + 'l5 ' + (buying ? 8 : -8) + 'h-10Z',
        fill: buying ? colors.up : colors.down, class: 'marker' });
    }
    for (const order of (env.store.paper.pending ?? []).filter(item => item.symbol === state.symbol)) {
      const y = main.y(order.price);
      if (y > 0 && y < mainH) {
        line(0, y, plot, y, order.qty > 0 ? colors.up : colors.down, { 'stroke-dasharray': '8 3 2 3', class: 'order-line' });
        text(6, y - 5, (order.qty > 0 ? env.t('Buy') : env.t('Sell')) + ' ' + Math.abs(order.qty) + ' ' + env.t(order.type === 'limit' ? L('limit') : L('stop')));
      }
    }

    // Alerts, the paper position and the last price.
    for (const alert of env.store.alerts.filter(item => item.symbol === state.symbol && item.status === 'active')) {
      const y = main.y(alert.price);
      if (y > 0 && y < mainH) {
        line(0, y, plot, y, colors.alert, { 'stroke-dasharray': '6 4', class: 'alert-line' });
        tag(y, fmt(alert.price), colors.alert);
      }
    }
    const position = env.store.paper.positions[state.symbol];
    if (position?.qty) {
      const y = main.y(position.avg);
      if (y > 0 && y < mainH) {
        line(0, y, plot, y, colors.muted, { 'stroke-dasharray': '2 3' });
        text(6, y - 5, env.t(position.qty > 0 ? 'Long' : 'Short') + ' ' + Math.abs(position.qty) + ' @ ' + fmt(position.avg));
      }
    }
    // Levels from a connected trading account: entry, break-even, liquidation and working orders.
    const labelled = [];
    for (const level of env.levels?.(state.symbol) ?? []) {
      const y = main.y(level.price);
      if (!(y > 0 && y < mainH)) continue;
      const color = colors[level.tone] ?? colors.muted;
      line(0, y, plot, y, color, { 'stroke-dasharray': level.dash ?? '6 3', class: 'account-line' });
      // Labels of levels that sit almost on top of each other are placed side by side.
      const column = labelled.filter(other => Math.abs(other - y) < 12).length;
      labelled.push(y);
      text(6 + column * 190, y - 5, level.label);
      tag(y, fmt(level.price), color);
    }
    const final = bars[total - 1];
    const tone = final.close >= final.open ? colors.up : colors.down;
    const lastY = main.y(final.close);
    if (lastY > 0 && lastY < mainH && env.store.settings.priceLine !== false) {
      line(0, lastY, plot, lastY, tone, { 'stroke-dasharray': '1 3' });
      if (isLive && replay === null) {
        const y = Math.max(9, Math.min(mainH - 9, lastY));
        const above = y + 22 > mainH && y >= 22;
        const box = node(base, 'rect', { x: plot, y: round(y - 9), width: axis, height: 18, fill: tone, rx: 2 });
        text(plot + 5, y + 4, fmt(final.close), { fill: colors.panel });
        const label = text(plot + 5, y + (above ? -10 : 16), '', { fill: colors.panel,
          'font-size': 10, class: 'price-countdown' });
        countdown = { box, label, above, y, open: final.time, end: final.time + ms };
        updateCountdown();
      } else tag(lastY, fmt(final.close), tone);
    }

    // Separate study panes.
    separate.forEach(({ indicator, plots, settings }, order) => {
      const top = mainH + tops[order];
      const subH = weights[order] * unit;
      const spec = definition(indicator.id);
      let low = Infinity;
      let high = -Infinity;
      for (const { item } of plots) {
        for (let index = first; index <= last; index++) {
          const value = item.values[index];
          if (value !== null && value !== undefined && !Number.isNaN(value)) {
            low = Math.min(low, value);
            high = Math.max(high, value);
          }
        }
      }
      if (low === Infinity) [low, high] = [0, 1];
      // Volume bars stand on the floor of their pane.
      const floor = plots.some(({ item }) => item.kind === 'volume');
      if (floor) low = 0;
      if (spec.guides?.includes(0)) { low = Math.min(low, 0); high = Math.max(high, 0); }
      if (spec.range) [low, high] = spec.range;
      const zoom = settings.scaleZoom ?? 1;
      const peak = high || 1;
      const middle = (low + high) / 2;
      const half = (high - low) * zoom / 2;
      const inset = Math.min(18, subH / 4);
      const pane = floor ? scale(top + inset, subH - inset, 0, peak * zoom, false, 0)
        : scale(top + inset, subH - 2 * inset, middle - half, middle + half, false, 0.06);
      const axisUnit = floor && indicator.volumeScale === 'percent' ? peak / 100 : 1;
      const step = nice((pane.high - pane.low) / axisUnit, Math.max(subH >= 60 ? 3 : 2, Math.floor((subH - inset) / 22)));
      const format = value => floor && indicator.volumeScale === 'percent' ? compact(value / axisUnit) + '%'
        : step < 0.0001 && value !== 0 ? value.toExponential(2) : compact(value);
      geo.panes.push({ top, height: subH, scale: pane, format, settings, unit, zoom });
      line(0, top, width, top, colors.edge);
      const zeroStyle = indicator.appearance?.elements?.zero;
      for (const guide of floor ? [] : spec.guides ?? []) if (guide !== 0 || pvsraStyleVisible(zeroStyle)) {
        const style = guide === 0 ? zeroStyle : undefined;
        if (pane.y(guide) < top || pane.y(guide) > top + subH) continue;
        line(0, pane.y(guide), plot, pane.y(guide), style?.color ?? colors.muted,
          { 'stroke-dasharray': pvsraDashes[style?.dash] ?? '3 4', 'stroke-width': style?.width, opacity: (style?.opacity ?? 60) / 100 });
      }
      const firstTick = Math.ceil(pane.low / axisUnit / step);
      const tickCount = Math.floor(pane.high / axisUnit / step + 1e-9) - firstTick + 1;
      for (let i = 0; i < tickCount && i < 64; i++) {
        const tick = firstTick + i;
        const value = tick * step * axisUnit;
        const y = Math.max(top + 10, Math.min(top + subH - 5, pane.y(value)));
        line(plot, y, plot + 3, y, colors.muted);
        text(plot + 5, y + 4, format(value), { class: 'pane-axis-value' });
      }
      const paneId = 'study' + id + '-' + order;
      node(node(defs, 'clipPath', { id: paneId }), 'rect', { x: 0, y: top, width: timePlot, height: subH });
      const paneSeries = node(base, 'g', { 'clip-path': 'url(#' + paneId + ')' });
      const panePath = (d, attrs) => d && node(paneSeries, 'path', { d, fill: 'none', ...attrs });
      for (const { item, key } of plots) {
        if (item.kind === 'volume' || item.kind === 'histogram') {
          const volume = item.kind === 'volume';
          const parts = new Map();
          const zero = pane.y(0);
          for (let index = first; index <= last; index++) {
            const value = item.values[index];
            if (!Number.isFinite(value) || value === 0) continue;
            const y = pane.y(value);
            const up = volume ? bars[index].close >= bars[index].open : value >= 0;
            const color = item.colors?.[index] ?? (up ? colors.up : colors.down);
            if (color === 'transparent') continue;
            parts.set(color, (parts.get(color) ?? '') + 'M' + round(x(index) - body / 2) + ' ' + round(Math.min(y, zero)) + 'h' + round(body) +
              'v' + round(Math.max(0.5, Math.abs(y - zero))) + 'h' + round(-body) + 'Z');
          }
          for (const [fill, d] of parts) panePath(d, { fill, opacity: item.opacity ?? (volume ? 0.6 : 0.55), class: volume || key === 'Volume' ? 'volume' : 'histogram' });
        } else {
          panePath(linePath(item.values, pane.y, x, first, last), { stroke: (indicator.colors?.[key] ?? item.stroke ?? palette[item.color ?? 0]),
            'stroke-width': item.width ?? indicator.width ?? 1.4, 'stroke-dasharray': item.dash, opacity: item.opacity, class: 'study' });
        }
      }
      text(8, top + 13, plots.map(({ item }) => env.t(item.label)).join(' · ') || spec.name, { class: 'pane-title' });
    });
    for (const { top } of geo.panes) {
      node(base, 'rect', { x: 0, y: round(top - 6), width: plot, height: 12, fill: 'transparent', class: 'grip' });
      node(base, 'rect', { x: round(plot / 2 - 20), y: round(top - 2), width: 40, height: 4, rx: 2, fill: colors.muted, opacity: 0.75, class: 'grip' });
    }

    renderDrawings();
    drawCross();
    readout(cross?.index ?? null);
  }

  function updateCountdown(now = Date.now()) {
    if (!countdown) return;
    const { box, label, above, y, open, end } = countdown;
    const remaining = Math.ceil((end - now) / 1000);
    const active = now >= open && remaining > 0;
    const value = active ? countdownText(remaining) : '';
    if (label.textContent !== value) label.textContent = value;
    const height = active ? '31' : '18';
    if (box.getAttribute('height') !== height) {
      box.setAttribute('height', height);
      box.setAttribute('y', round(y - (active && above ? 22 : 9)));
    }
  }

  // Legend: built when structure changes, values refreshed with the crosshair.
  function buildLegend() {
    legend.replaceChildren();
    const row = (className, parts) => {
      const element = document.createElement('div');
      element.className = 'legend-row ' + className;
      element.append(...parts);
      legend.append(element);
      return element;
    };
    const span = (className, content = '') => Object.assign(document.createElement('span'), { className, textContent: content });
    const button = (label, glyph, action) => {
      const element = Object.assign(document.createElement('button'), { type: 'button', textContent: glyph, className: 'legend-button' });
      element.setAttribute('aria-label', label);
      element.onclick = action;
      return element;
    };
    row('main', [span('legend-symbol', tickerLabel(instrument()) + ' · ' + intervalLabel(state.interval)), span('chip', env.t(instrument().live ? 'Live' : 'Simulated')),
      Object.assign(span('values'), { id: 'readout' + id })]);
    svg.setAttribute('aria-describedby', 'readout' + id);
    state.indicators.forEach(indicator => {
      const name = indicator.id === 'formula' ? indicator.params.name : env.t(definition(indicator.id).name);
      const values = span('values');
      values.dataset.indicator = indicator.uid;
      const parts = [span('legend-name', name), values];
      if (Object.keys(indicator.params).length) parts.push(button(env.t('Settings for {0}', name), '⚙', () => env.configure(api, indicator)));
      parts.push(button(env.t(indicator.hidden ? L('Show {0}') : L('Hide {0}'), name), indicator.hidden ? '◌' : '◉', () => api.patchIndicator(indicator.uid, { hidden: !indicator.hidden })),
        button(env.t('Remove {0}', name), '✕', () => api.removeIndicator(indicator.uid)));
      row(indicator.hidden || !visibleAtInterval(indicator) ? 'muted' : '', parts);
    });
    state.compare.forEach((symbol, index) => {
      const values = span('values');
      values.dataset.compare = symbol;
      const name = span('legend-name', symbol);
      name.style.color = palette[(index + 2) % palette.length];
      row('', [name, values, button(env.t('Remove {0} comparison', symbol), '✕', () => api.toggleCompare(symbol))]);
    });
  }

  function readout(index) {
    if (!geo) return;
    const bars = shown();
    const at = Math.max(0, Math.min(geo.total - 1, index ?? geo.total - 1));
    const bar = bars[at];
    const before = bars[at - 1] ?? bar;
    const change = (bar.close / before.close - 1) * 100;
    const main = legend.querySelector('.main .values');
    if (!main) return;
    main.textContent = 'O ' + fmt(bar.open) + '  H ' + fmt(bar.high) + '  L ' + fmt(bar.low) + '  C ' + fmt(bar.close) +
      '  ' + (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    main.className = 'values ' + (change >= 0 ? 'up' : 'down');
    for (const element of legend.querySelectorAll('[data-indicator]')) {
      const indicator = state.indicators.find(item => item.uid === element.dataset.indicator);
      element.textContent = indicator.hidden || !visibleAtInterval(indicator) ? env.t('hidden') : indicator.appearance?.values === false ? '' : plotsOf(indicator).filter(item => !shapes.has(item.kind)).map(item => {
        const value = item.values[at];
        return value === null || value === undefined || Number.isNaN(value) ? '–' : compact(value);
      }).join('  ');
    }
    for (const element of legend.querySelectorAll('[data-compare]')) {
      const item = geo.compares.find(entry => entry.symbol === element.dataset.compare);
      const value = item?.other[at];
      const move = value ? (value.close / item.base - 1) * 100 : null;
      element.textContent = move === null ? '' : (move >= 0 ? '+' : '') + move.toFixed(2) + '%';
    }
  }

  function drawCross() {
    const layer = layers.cross;
    layer.replaceChildren();
    const mode = env.store.settings.crosshair ?? 'cross';
    if (!cross || !geo || mode === 'none') return;
    const colors = env.colors();
    const x = round(geo.x(cross.index));
    if (x < 0 || x > geo.timePlot) return;
    const dash = { stroke: colors.muted, 'stroke-dasharray': '4 4' };
    node(layer, 'line', { x1: x, x2: x, y1: 0, y2: geo.height - geo.foot, ...dash });
    const label = env.time(geo.t0 + cross.index * geo.ms, 'full', geo.ms < 60_000);
    const wide = label.length * 6.4 + 12;
    const left = Math.max(0, Math.min(geo.plot - wide, x - wide / 2));
    node(layer, 'rect', { x: left, y: geo.height - geo.foot + 1, width: wide, height: geo.foot - 2, fill: colors.text, rx: 2 });
    node(layer, 'text', { x: left + 6, y: geo.height - 7, fill: colors.panel }, label);
    if (mode === 'vertical' || cross.y === null || cross.y === undefined || cross.y > geo.height - geo.foot) return;
    const study = cross.y < geo.mainH ? null : geo.panes.find(item => cross.y >= item.top && cross.y < item.top + item.height);
    const pane = study?.scale ?? (cross.y < geo.mainH ? geo.main : null);
    node(layer, 'line', { x1: 0, x2: geo.plot, y1: round(cross.y), y2: round(cross.y), ...dash });
    if (!pane) return;
    node(layer, 'rect', { x: geo.plot, y: round(cross.y - 9), width: geo.axis, height: 18, fill: colors.text, rx: 2 });
    node(layer, 'text', { x: geo.plot + 5, y: round(cross.y + 4), fill: colors.panel }, (study?.format ?? fmt)(pane.value(cross.y)));
  }

  // Drawings. Points are stored as bar time and price so they survive interval changes.
  const pixel = point => ({ x: ((point.t - geo.t0) / geo.ms - geo.from + 0.5) * view.width, y: geo.main.y(point.p) });
  const indexAt = px => Math.floor(geo.from + px / view.width);
  function pointAt(position, snap = env.store.settings.magnet) {
    const index = indexAt(position.x);
    let value = geo.main.value(Math.max(0, Math.min(geo.mainH, position.y)));
    const bar = shown()[index];
    if (snap && bar && index < geo.total) {
      value = [bar.open, bar.high, bar.low, bar.close].reduce((best, candidate) =>
        Math.abs(geo.main.y(candidate) - position.y) < Math.abs(geo.main.y(best) - position.y) ? candidate : best);
    }
    return { t: geo.t0 + index * geo.ms, p: value };
  }

  function segments(drawing) {
    const points = drawing.points.map(pixel);
    const [a, b = a] = points;
    switch (drawing.type) {
      case 'trend': case 'measure': case 'arrow': return [[a.x, a.y, b.x, b.y]];
      case 'extended': {
        const reach = 5000 / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
        return [[a.x - (b.x - a.x) * reach, a.y - (b.y - a.y) * reach, a.x + (b.x - a.x) * reach, a.y + (b.y - a.y) * reach]];
      }
      case 'hray': return [[a.x, a.y, geo.plot, a.y]];
      case 'channel': {
        const c = points[2] ?? a;
        const shift = c.y - (a.y + (b.y - a.y) * (c.x - a.x) / ((b.x - a.x) || 1));
        return [[a.x, a.y, b.x, b.y], [a.x, a.y + shift, b.x, b.y + shift]];
      }
      case 'ellipse': return [[a.x, a.y, b.x, a.y], [b.x, a.y, b.x, b.y], [b.x, b.y, a.x, b.y], [a.x, b.y, a.x, a.y]];
      case 'pricerange': return [[a.x, a.y, a.x, b.y]];
      case 'daterange': return [[a.x, a.y, b.x, a.y]];
      case 'ray': {
        const reach = 5000 / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
        return [[a.x, a.y, a.x + (b.x - a.x) * reach, a.y + (b.y - a.y) * reach]];
      }
      case 'hline': return [[0, a.y, geo.plot, a.y]];
      case 'vline': return [[a.x, 0, a.x, geo.mainH]];
      case 'rect': return [[a.x, a.y, b.x, a.y], [b.x, a.y, b.x, b.y], [b.x, b.y, a.x, b.y], [a.x, b.y, a.x, a.y]];
      case 'fib': return levels.map(level => {
        const y = b.y + (a.y - b.y) * level;
        return [Math.min(a.x, b.x), y, geo.plot, y];
      });
      case 'position': return points.map(point => [a.x, point.y, b.x, point.y]);
      case 'brush': return points.slice(1).map((point, index) => [points[index].x, points[index].y, point.x, point.y]);
      case 'text': return [[a.x, a.y + 3, a.x + drawing.text.length * 7, a.y + 3]];
      default: return [];
    }
  }

  function hitTest(position) {
    for (const drawing of drawings().slice().reverse()) {
      if (drawing.type !== 'brush') {
        const handle = drawing.points.map(pixel).findIndex(point => Math.hypot(point.x - position.x, point.y - position.y) < 9);
        if (handle >= 0) return { drawing, handle };
      }
      if (segments(drawing).some(segment => distance(position.x, position.y, segment) < 7)) return { drawing, handle: null };
      if (drawing.type === 'position') {
        const [entry, target, stop] = drawing.points.map(pixel);
        if (position.x > Math.min(entry.x, target.x) && position.x < Math.max(entry.x, target.x) &&
          position.y > Math.min(target.y, stop.y) && position.y < Math.max(target.y, stop.y)) return { drawing, handle: null };
      }
    }
    return null;
  }

  function renderDrawings() {
    const layer = layers.draw;
    layer.replaceChildren();
    if (!geo) return;
    const colors = env.colors();
    const list = [...(env.store.settings.hide ? [] : drawings()), ...(draft ? [draft] : []), ...(measure ? [measure] : [])];
    for (const drawing of list) {
      const color = drawing.color ?? ink;
      const stroke = { stroke: color, 'stroke-width': (drawing.width ?? 1.5) + (drawing.id === selected ? 0.7 : 0), fill: 'none', class: 'drawing',
        ...(drawing.dash === 'dash' ? { 'stroke-dasharray': '7 5' } : drawing.dash === 'dot' ? { 'stroke-dasharray': '2 4' } : {}) };
      const points = drawing.points.map(pixel);
      const [a, b = a] = points;
      const note = (x, y, content, extra = {}) => node(layer, 'text', { x: round(x), y: round(y), fill: color, ...extra }, content);
      if (['trend', 'ray', 'hline', 'vline', 'extended', 'hray', 'arrow', 'pricerange', 'daterange'].includes(drawing.type)) {
        const [[x1, y1, x2, y2]] = segments(drawing);
        node(layer, 'line', { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2), ...stroke });
        if (drawing.type === 'hline') note(6, a.y - 5, fmt(drawing.points[0].p));
        if (drawing.type === 'hray') note(a.x + 6, a.y - 5, fmt(drawing.points[0].p));
        if (drawing.type === 'arrow') {
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          const wing = turn => round(b.x - 11 * Math.cos(angle + turn)) + ' ' + round(b.y - 11 * Math.sin(angle + turn));
          node(layer, 'path', { d: 'M' + wing(0.45) + 'L' + round(b.x) + ' ' + round(b.y) + 'L' + wing(-0.45), ...stroke });
        }
        if (drawing.type === 'pricerange') {
          const [start, finish] = drawing.points;
          for (const y of [a.y, b.y]) node(layer, 'line', { x1: round(a.x - 7), x2: round(a.x + 7), y1: round(y), y2: round(y), ...stroke });
          note(a.x + 10, (a.y + b.y) / 2 + 4, (finish.p >= start.p ? '+' : '') + fmt(finish.p - start.p) + ' (' + ((finish.p / start.p - 1) * 100).toFixed(2) + '%)');
        }
        if (drawing.type === 'daterange') {
          const [start, finish] = drawing.points;
          for (const x of [a.x, b.x]) node(layer, 'line', { x1: round(x), x2: round(x), y1: round(a.y - 7), y2: round(a.y + 7), ...stroke });
          const count = Math.round(Math.abs(finish.t - start.t) / geo.ms);
          const hours = Math.abs(finish.t - start.t) / 3600000;
          note((a.x + b.x) / 2, a.y - 8, count + ' ' + env.t('bars') + ' · ' + (hours >= 48 ? Math.round(hours / 24) + 'd' : Math.round(hours) + 'h'), { 'text-anchor': 'middle' });
        }
      } else if (drawing.type === 'channel') {
        const [[x1, y1, x2, y2], [x3, y3, x4, y4]] = segments(drawing);
        node(layer, 'path', { d: 'M' + round(x1) + ' ' + round(y1) + 'L' + round(x2) + ' ' + round(y2) + 'L' + round(x4) + ' ' + round(y4) + 'L' + round(x3) + ' ' + round(y3) + 'Z',
          fill: color, 'fill-opacity': 0.1, stroke: 'none' });
        for (const [fromX, fromY, toX, toY] of [[x1, y1, x2, y2], [x3, y3, x4, y4]]) {
          node(layer, 'line', { x1: round(fromX), y1: round(fromY), x2: round(toX), y2: round(toY), ...stroke });
        }
      } else if (drawing.type === 'ellipse') {
        node(layer, 'ellipse', { cx: round((a.x + b.x) / 2), cy: round((a.y + b.y) / 2), rx: round(Math.abs(b.x - a.x) / 2), ry: round(Math.abs(b.y - a.y) / 2),
          ...stroke, fill: color, 'fill-opacity': 0.12 });
      } else if (drawing.type === 'rect') {
        node(layer, 'rect', { x: round(Math.min(a.x, b.x)), y: round(Math.min(a.y, b.y)), width: round(Math.abs(b.x - a.x)),
          height: round(Math.abs(b.y - a.y)), ...stroke, fill: color, 'fill-opacity': 0.12 });
      } else if (drawing.type === 'fib') {
        node(layer, 'line', { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y), ...stroke, 'stroke-dasharray': '3 4', opacity: 0.6 });
        segments(drawing).forEach(([x1, y, x2], index) => {
          node(layer, 'line', { x1: round(x1), y1: round(y), x2: round(x2), y2: round(y), ...stroke, 'stroke-width': 1 });
          note(x1 + 4, y - 4, levels[index] + '  ' + fmt(drawing.points[1].p + (drawing.points[0].p - drawing.points[1].p) * levels[index]));
        });
      } else if (drawing.type === 'position') {
        const [entry, target, stop] = drawing.points;
        const left = Math.min(a.x, b.x);
        const wide = Math.abs(b.x - a.x);
        const box = (from, to, fill) => node(layer, 'rect', { x: round(left), y: round(Math.min(from, to)), width: round(wide),
          height: round(Math.abs(to - from)), fill, 'fill-opacity': 0.2, stroke: fill, class: 'drawing' });
        box(a.y, points[1].y, colors.up);
        box(a.y, points[2].y, colors.down);
        const percent = value => ((value / entry.p - 1) * 100).toFixed(2) + '%';
        const ratio = Math.abs(target.p - entry.p) / (Math.abs(entry.p - stop.p) || 1);
        note(left + 4, points[1].y + (points[1].y < a.y ? -5 : 13), env.t('Target') + ' ' + fmt(target.p) + ' (' + percent(target.p) + ')', { fill: colors.up });
        note(left + 4, points[2].y + (points[2].y < a.y ? -5 : 13), env.t('Stop') + ' ' + fmt(stop.p) + ' (' + percent(stop.p) + ')', { fill: colors.down });
        note(left + 4, a.y - 5, env.t(target.p > entry.p ? 'Long' : 'Short') + ' · ' + env.t('risk/reward') + ' ' + ratio.toFixed(2), { fill: colors.text });
      } else if (drawing.type === 'brush') {
        node(layer, 'polyline', { points: points.map(point => round(point.x) + ',' + round(point.y)).join(' '), ...stroke, 'stroke-linejoin': 'round' });
      } else if (drawing.type === 'text') {
        note(a.x, a.y, drawing.text, { 'font-size': 13, 'font-weight': drawing.id === selected ? 700 : 500, class: 'drawing' });
      } else if (drawing.type === 'measure') {
        const [start, finish] = drawing.points;
        const rising = finish.p >= start.p;
        node(layer, 'rect', { x: round(Math.min(a.x, b.x)), y: round(Math.min(a.y, b.y)), width: round(Math.abs(b.x - a.x)),
          height: round(Math.abs(b.y - a.y)), fill: rising ? colors.up : colors.down, 'fill-opacity': 0.16 });
        const count = Math.round((finish.t - start.t) / geo.ms);
        note((a.x + b.x) / 2, Math.min(a.y, b.y) - 6, (rising ? '+' : '') + fmt(finish.p - start.p) + ' (' +
          ((finish.p / start.p - 1) * 100).toFixed(2) + '%) · ' + count + ' ' + env.t('bars'), { fill: colors.text, 'text-anchor': 'middle', 'font-weight': 600 });
      }
      if (drawing.id === selected && drawing.type !== 'brush' && !env.store.settings.lock) {
        for (const point of points) node(layer, 'circle', { cx: round(point.x), cy: round(point.y), r: 5, fill: colors.panel, stroke: color, 'stroke-width': 2 });
      }
    }
  }

  function add(drawing) {
    if (env.store.settings.drawColor) drawing.color ??= env.store.settings.drawColor;
    if (env.store.settings.drawWidth) drawing.width ??= env.store.settings.drawWidth;
    drawing.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    drawings().push(drawing);
    selected = drawing.id;
    draft = null;
    if (!env.store.settings.keep) env.toolDone();
    env.changed('drawings');
    renderDrawings();
  }

  function finishDraft(point) {
    if (!draft) return;
    if (point && draft.type !== 'brush') draft.points[1] = point;
    if (draft.type === 'channel') draft.points.push({ t: draft.points[0].t, p: draft.points[0].p + (geo.main.high - geo.main.low) * 0.1 });
    if (draft.type === 'measure') {
      measure = draft;
      draft = null;
      env.toolDone();
      renderDrawings();
    } else if (draft.type !== 'brush' || draft.points.length > 1) add(draft);
    else draft = null;
  }

  function useTool(tool, position) {
    const point = pointAt(position);
    if (draft) return finishDraft(point);
    if (tool === 'hline' || tool === 'vline') return add({ type: tool, points: [point] });
    if (tool === 'text') return env.askText(content => content && add({ type: 'text', points: [point], text: content }));
    if (tool === 'long' || tool === 'short') {
      const reach = (geo.main.high - geo.main.low) * 0.16 * (tool === 'long' ? 1 : -1);
      const until = point.t + Math.max(8, Math.round(140 / view.width)) * geo.ms;
      return add({ type: 'position', points: [point, { t: until, p: point.p + reach }, { t: until, p: point.p - reach / 2 }] });
    }
    draft = { type: tool, points: tool === 'brush' ? [point] : [point, point] };
    drag = { kind: tool === 'brush' ? 'brush' : 'draft', x: position.x, y: position.y };
  }

  // Price range helpers. A manual range replaces the automatic one until the scale is reset.
  const yRange = () => view.price ?? { low: geo.main.low, high: geo.main.high };
  const curve = range => state.log && range.low > 0 ? [Math.log, Math.exp] : [value => value, value => value];
  function stretch(range, factor) {
    const [forward, back] = curve(range);
    const middle = (forward(range.low) + forward(range.high)) / 2;
    const half = Math.max(1e-9, (forward(range.high) - forward(range.low)) / 2 * Math.min(50, Math.max(0.02, factor)));
    return { low: back(middle - half), high: back(middle + half) };
  }
  function shift(range, pixels) {
    const [forward, back] = curve(range);
    const move = (forward(range.high) - forward(range.low)) / geo.mainH * pixels;
    return { low: back(forward(range.low) + move), high: back(forward(range.high) + move) };
  }
  // Which part of the chart a point is in: a pane edge, the time axis, the price axis or the plot.
  function zoneAt(position) {
    const pane = geo.panes.find(item => Math.abs(position.y - item.top) < 8);
    if (pane) return { kind: 'pane', pane };
    if (position.y > geo.height - geo.foot) return { kind: 'time' };
    if (position.x >= geo.plot) {
      if (position.y < geo.mainH) return { kind: 'price' };
      const study = geo.panes.find(item => position.y >= item.top && position.y < item.top + item.height);
      if (study) return { kind: 'study-scale', pane: study };
    }
    return { kind: 'plot' };
  }

  const local = event => {
    const bounds = svg.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return { gap: Math.hypot(a.x - b.x, a.y - b.y) || 1, middle: (a.x + b.x) / 2 };
  };
  function zoomAt(factor, px) {
    const anchor = geo.from + px / view.width;
    const width = Math.min(80, Math.max(0.4, view.width * factor));
    view.end = anchor + (timeSpan(geo.timePlot, width, geo.showProfileBars) - px) / width;
    view.width = width;
    clamp();
    render();
  }

  function saveViewport() {
    if (geo && replay === null) {
      const offset = view.end - geo.total;
      const padding = geo.showProfileBars ? 0 : 3;
      if (Math.abs(view.width - geo.defaultPitch) < 1e-8 && Math.abs(offset - padding) < 1e-8 && !view.price) delete state.viewport;
      else state.viewport = { bars: geo.timePlot / view.width, offset, live: liveMode, price: view.price };
    }
    env.changed('view');
  }

  svg.addEventListener('pointerdown', event => {
    if (!geo) return;
    cancelWheelPan();
    env.activate(api);
    const position = local(event);
    pointers.set(event.pointerId ?? 0, position);
    try { svg.setPointerCapture?.(event.pointerId); } catch {}
    if (pointers.size === 2) {
      drag = { kind: 'pinch', ...spread(), width: view.width };
      return;
    }
    const zone = zoneAt(position);
    if (zone.kind !== 'plot') {
      drag = { kind: zone.kind, x: position.x, y: position.y, width: view.width, range: yRange(), pane: zone.pane };
      return;
    }
    const tool = env.tool();
    const inside = position.x < geo.timePlot && position.y < geo.mainH;
    if (tool === 'replay' && inside) {
      env.toolDone();
      return api.replayStart(indexAt(position.x) + 1);
    }
    if (tool !== 'cursor' && inside) return useTool(tool, position);
    measure = null;
    const hit = env.store.settings.hide ? null : hitTest(position);
    selected = hit?.drawing.id ?? null;
    if (hit && !env.store.settings.lock) {
      drag = { kind: 'drawing', hit, from: pointAt(position, false), original: structuredClone(hit.drawing.points) };
    } else {
      drag = { kind: 'pan', x: position.x, y: position.y, end: view.end, range: view.price };
    }
    env.changed('selection');
    renderDrawings();
  });

  svg.addEventListener('pointermove', event => {
    if (!geo) return;
    const position = local(event);
    if (pointers.has(event.pointerId ?? 0)) pointers.set(event.pointerId ?? 0, position);
    if (drag && (position.x !== drag.x || position.y !== drag.y)) drag.moved = true;
    if (drag?.kind === 'pinch' && pointers.size === 2) {
      const now = spread();
      view.width = drag.width;
      return zoomAt(now.gap / drag.gap, now.middle);
    }
    if (drag?.kind === 'price') {
      view.price = stretch(drag.range, Math.exp((position.y - drag.y) * 0.006));
      return render();
    }
    if (drag?.kind === 'time') {
      view.width = drag.width * Math.exp((position.x - drag.x) * 0.006);
      clamp();
      return render();
    }
    if (drag?.kind === 'pane') {
      drag.pane.settings.size = Math.min(4, Math.max(0.25, (drag.pane.height - (position.y - drag.y)) / drag.pane.unit));
      return render();
    }
    if (drag?.kind === 'study-scale') {
      drag.pane.settings.scaleZoom = studyScale(drag.pane.zoom * Math.exp((position.y - drag.y) * 0.006));
      return render();
    }
    if (!drag) svg.style.cursor = { pane: 'row-resize', price: 'ns-resize', 'study-scale': 'ns-resize', time: 'ew-resize' }[zoneAt(position).kind] ?? '';
    if (draft) {
      if (draft.type === 'brush') {
        if (drag) draft.points.push(pointAt(position, false));
      } else draft.points[1] = pointAt(position);
      renderDrawings();
    } else if (drag?.kind === 'pan') {
      view.end = drag.end - (position.x - drag.x) / view.width;
      if (drag.range) view.price = shift(drag.range, position.y - drag.y);
      clamp();
      cross = null;
      return render();
    } else if (drag?.kind === 'drawing') {
      const now = pointAt(position, false);
      const { drawing, handle } = drag.hit;
      if (handle !== null) drawing.points[handle] = pointAt(position);
      else drawing.points = drag.original.map(point => ({ t: point.t + now.t - drag.from.t, p: point.p + now.p - drag.from.p }));
      renderDrawings();
    }
    if (position.x < geo.timePlot) {
      cross = { index: indexAt(position.x), y: position.y };
      drawCross();
      readout(cross.index);
      env.crosshair(api, geo.t0 + cross.index * geo.ms);
    }
  });

  function release(event) {
    if (!geo) return pointers.clear();
    const position = local(event);
    pointers.delete(event.pointerId ?? 0);
    if (drag?.kind === 'draft' && draft && Math.hypot(position.x - drag.x, position.y - drag.y) > 8) finishDraft(pointAt(position));
    if (drag?.kind === 'brush') finishDraft();
    if (drag?.kind === 'drawing') env.changed('drawings');
    if (event.type === 'pointerup' && drag?.kind === 'pan' && snapToLatest(drag.end)) render();
    if (drag?.kind === 'pane' || drag?.kind === 'study-scale') env.changed('view');
    if (drag?.moved && ['pan', 'pinch', 'time', 'price'].includes(drag.kind)) saveViewport();
    if (drag?.kind !== 'pinch' || pointers.size < 2) drag = null;
  }
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('pointerleave', () => {
    if (drag) return;
    cross = null;
    drawCross();
    readout(null);
    env.crosshair(api, null);
  });
  svg.addEventListener('wheel', event => {
    event.preventDefault();
    if (!geo) return;
    const start = wheelPan?.start ?? view.end;
    cancelWheelPan();
    const zone = zoneAt(local(event));
    if (zone.kind === 'study-scale') {
      zone.pane.settings.scaleZoom = studyScale(zone.pane.zoom * Math.exp(event.deltaY * 0.0015));
      render();
      return env.changed('view');
    }
    if (zone.kind === 'price') {
      view.price = stretch(yRange(), Math.exp(event.deltaY * 0.0015));
      render();
      return saveViewport();
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      view.end += (event.deltaX || event.deltaY) / view.width;
      clamp();
      render();
      const end = view.end;
      wheelPan = { start, timer: setTimeout(() => {
        wheelPan = null;
        if (!svg.isConnected || view.end !== end) return;
        if (snapToLatest(start)) render();
        saveViewport();
      }, 140) };
    } else {
      zoomAt(Math.exp(-event.deltaY * 0.0015), local(event).x);
      saveViewport();
    }
  }, { passive: false });
  svg.addEventListener('dblclick', event => {
    if (!geo) return;
    const zone = zoneAt(local(event));
    if (zone.kind === 'study-scale') {
      delete zone.pane.settings.scaleZoom;
      render();
      env.changed('view');
    } else if (zone.kind === 'price') api.setAutoScale(true);
    else api.fit();
  });
  svg.addEventListener('focus', () => env.activate(api));
  svg.addEventListener('keydown', event => {
    if (!geo) return;
    const key = event.key;
    if (key === 'Escape') {
      draft = measure = cross = selected = null;
      env.toolDone();
      render();
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const index = Math.max(0, Math.min(geo.total - 1, (cross?.index ?? geo.total) + (key === 'ArrowLeft' ? -1 : 1)));
      const previousEnd = view.end;
      if (index < geo.from) view.end -= geo.from - index;
      if (index + 1 > view.end) view.end = index + 2;
      cross = { index, y: null };
      render();
      cross.y = geo.main.y(shown()[index].close);
      drawCross();
      env.crosshair(api, geo.t0 + index * geo.ms);
      if (view.end !== previousEnd) saveViewport();
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      api.panPrice(key === 'ArrowUp' ? 0.1 : -0.1);
    } else if (key === '+' || key === '=') api.zoom(1.25);
    else if (key === '-') api.zoom(0.8);
    else if (key === 'Home') api.scrollTo(0);
    else if (key === 'End') api.fit(false);
    else if (key === 'Delete' || key === 'Backspace') api.removeSelected();
  });

  const api = {
    state, host, render, updateCountdown,
    get replaying() { return replay !== null; },
    get replayDone() { return replay !== null && replay >= raw().length; },
    get selected() { return selected; },
    get crossIndex() { return cross?.index ?? null; },
    bars: () => raw().slice(0, length()),
    visible: () => geo && geo.first <= geo.last ? raw().slice(geo.first, geo.last + 1) : [],
    plots: plotsOf,
    last: () => raw()[length() - 1],
    previous: () => raw()[length() - 2],
    set(patch) {
      const moved = (patch.symbol && patch.symbol !== state.symbol) || (patch.interval && patch.interval !== state.interval);
      Object.assign(state, patch);
      if (moved) {
        cancelWheelPan();
        markers = [];
        replay = selected = draft = measure = cross = null;
        view.end = null;
        view.price = null;
        delete state.viewport;
      }
      buildLegend();
      render();
      env.changed('state');
    },
    addIndicator(kind, params = {}) {
      const indicator = { uid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), id: kind, params: { ...definition(kind).params, ...params } };
      state.indicators.push(indicator);
      api.set({});
      return indicator;
    },
    patchIndicator(uid, patch) {
      const indicator = state.indicators.find(item => item.uid === uid);
      if (patch.params) Object.assign(indicator.params, patch.params);
      for (const key of ['hidden', 'colors', 'width', 'size', 'appearance', 'volumeScale']) if (key in patch) indicator[key] = patch[key];
      api.set({});
    },
    removeIndicator(uid) {
      api.set({ indicators: state.indicators.filter(item => item.uid !== uid) });
    },
    toggleCompare(symbol) {
      api.set({ compare: state.compare.includes(symbol) ? state.compare.filter(item => item !== symbol) : [...state.compare, symbol] });
    },
    zoom(factor) {
      if (!geo) return;
      zoomAt(factor, geo.timePlot);
      saveViewport();
    },
    get autoScale() { return !view.price; },
    setAutoScale(on) {
      view.price = on || !geo ? null : yRange();
      render();
      saveViewport();
    },
    // Below 1 stretches prices over more of the pane; above 1 compresses them.
    scalePrice(factor) {
      if (!geo) return;
      view.price = stretch(yRange(), factor);
      render();
      saveViewport();
    },
    panPrice(fraction) {
      if (!geo) return;
      view.price = shift(yRange(), fraction * geo.mainH);
      render();
      saveViewport();
    },
    scroll(barsBy) {
      if (!geo) return;
      cancelWheelPan();
      const previousEnd = view.end;
      view.end += barsBy;
      clamp();
      snapToLatest(previousEnd);
      render();
      saveViewport();
    },
    scrollTo(index) {
      if (!geo) return;
      view.end = index + geo.timePlot / view.width;
      clamp();
      render();
      saveViewport();
    },
    fit(reset = true) {
      cancelWheelPan();
      if (reset) {
        if (replay === null) delete state.viewport;
        [view.auto, view.price] = [true, null];
      }
      view.end = null;
      render();
      if (geo) saveViewport();
      else env.changed('view');
    },
    showBars(count) {
      if (!geo) return;
      const padding = geo.showProfileBars ? 0 : 3;
      view.width = geo.timePlot / (count + padding);
      view.end = length() + padding;
      clamp();
      render();
      saveViewport();
    },
    goTo(time) {
      if (!geo) return;
      const index = Math.round((time - geo.t0) / geo.ms);
      view.end = index + geo.timePlot / view.width / 2;
      clamp();
      cross = { index: Math.max(0, Math.min(geo.total - 1, index)), y: null };
      render();
      saveViewport();
    },
    crossAt(time) {
      if (!geo) return;
      cross = time === null ? null : { index: Math.round((time - geo.t0) / geo.ms), y: null };
      drawCross();
      readout(cross?.index ?? null);
    },
    setMarkers(list) {
      markers = list;
      render();
    },
    // Called when a live feed appends or updates the last bar.
    tick() {
      memo.clear();
      if (geo && view.end >= geo.total) view.end += raw().length - geo.total;
      render();
    },
    removeSelected() {
      if (!selected) return;
      env.store.drawings[state.symbol] = drawings().filter(item => item.id !== selected);
      selected = null;
      env.changed('drawings');
      renderDrawings();
    },
    select(drawingId) {
      selected = drawingId;
      renderDrawings();
    },
    replayStart(index) {
      if (!geo) return;
      const total = raw().length;
      if (total < 2) return;
      replay = Math.min(total - 1, Math.max(30, index ?? total - 100));
      view.end = replay + (geo.showProfileBars ? 0 : 3);
      render();
      env.changed('replay');
    },
    replayStep() {
      if (replay === null || replay >= raw().length) return false;
      replay++;
      if (view.end >= replay - 1) view.end = Math.max(view.end, replay + (geo?.showProfileBars ? 0 : 3));
      render();
      return true;
    },
    replayStop() {
      replay = null;
      view.end = null;
      render();
      env.changed('replay');
    },
    snapshot() {
      if (!geo) return null;
      const colors = env.colors();
      const copy = svg.cloneNode(true);
      copy.setAttribute('xmlns', NS);
      copy.setAttribute('width', geo.width);
      copy.setAttribute('height', geo.height);
      const back = document.createElementNS(NS, 'rect');
      for (const [key, value] of Object.entries({ width: geo.width, height: geo.height, fill: colors.panel })) back.setAttribute(key, value);
      copy.prepend(back);
      node(copy, 'text', { x: 10, y: 20, fill: colors.text, 'font-size': 13, 'font-weight': 700 },
        state.symbol + ' · ' + intervalLabel(state.interval) + ' · Meridian · ' + env.t(instrument().live ? 'Live' : 'Simulated'));
      return { markup: copy.outerHTML, width: geo.width, height: geo.height, background: colors.panel };
    }
  };
  buildLegend();
  render();
  return api;
}
