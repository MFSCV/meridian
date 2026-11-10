// Chart engine: one SVG chart with panes, zoom, pan, crosshair, drawings and bar replay.
import { series, find, price, intervalLabel } from './market.mjs';
import { definition, heikinAshi } from './indicators.mjs';
import { L } from './i18n.mjs';

const NS = 'http://www.w3.org/2000/svg';
export const styles = ['Candles', 'Hollow candles', 'Bars', 'Line', 'Area', 'Baseline', 'Heikin Ashi'];
export const palette = ['#3b82f6', '#e8912d', '#a366e0', '#17a99a', '#e0559a', '#93a31f'];
const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const ink = '#3b82f6';
const round = value => Math.round(value * 10) / 10;
let serial = 0;

function node(parent, tag, attrs = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
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

export const paneOf = indicator => indicator.id === 'formula'
  ? (indicator.params.overlay ? 'overlay' : 'separate') : definition(indicator.id).pane;

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
  let markers = [];

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
  function plotsOf(indicator) {
    try {
      return cached(indicator.id + JSON.stringify(indicator.params), () => definition(indicator.id).plots(raw(), indicator.params));
    } catch {
      return [];
    }
  }
  const fmt = value => price(value, instrument());
  const compact = value => Math.abs(value) >= 1e6 ? (value / 1e6).toFixed(2) + 'M' : Math.abs(value) >= 1e4 ? (value / 1e3).toFixed(1) + 'K'
    : value.toLocaleString('en-US', { maximumFractionDigits: Math.abs(value) < 10 ? 4 : 2 });

  function clamp() {
    const count = (geo?.plot ?? 800) / view.width;
    view.width = Math.min(80, Math.max(0.4, view.width));
    view.end = Math.min(length() + count * 0.85, Math.max(Math.min(length(), 10), view.end));
  }

  function linePath(values, y, x, first, last) {
    let path = '';
    let pen = false;
    for (let index = first; index <= last; index++) {
      const value = values[index];
      if (value === null || value === undefined || Number.isNaN(value)) pen = false;
      else {
        path += (pen ? 'L' : 'M') + round(x(index)) + ' ' + round(y(value));
        pen = true;
      }
    }
    return path;
  }

  function render() {
    const colors = env.colors();
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
    const separate = state.indicators.filter(indicator => !indicator.hidden && paneOf(indicator) === 'separate');
    const weights = separate.map(indicator => Math.min(4, Math.max(0.25, indicator.size ?? 1)));
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
    if (view.auto) view.width = Math.max(3, Math.min(8, plot / 90));
    view.auto = false;
    if (view.end === null) view.end = total + 3;
    geo = { plot };
    clamp();
    const from = view.end - plot / view.width;
    const x = index => (index - from + 0.5) * view.width;
    const last = Math.min(total - 1, Math.ceil(view.end));
    const first = Math.min(last, Math.max(0, Math.floor(from)));
    const lineStyle = ['Line', 'Area', 'Baseline'].includes(state.style);
    const overlays = state.indicators.filter(indicator => !indicator.hidden && paneOf(indicator) === 'overlay');
    const compares = state.compare.map((symbol, index) => {
      const other = series(find(symbol), state.interval);
      const factor = bars[first].close / other[first].close;
      return { symbol, color: palette[(index + 2) % palette.length], values: other.map(bar => bar.close * factor), base: other[first].close, other };
    });

    let min = Infinity;
    let max = -Infinity;
    for (let index = first; index <= last; index++) {
      min = Math.min(min, lineStyle ? bars[index].close : bars[index].low);
      max = Math.max(max, lineStyle ? bars[index].close : bars[index].high);
    }
    for (const values of [...overlays.flatMap(indicator => plotsOf(indicator).filter(item => item.kind !== 'volume').map(item => item.values)),
      ...compares.map(item => item.values)]) {
      for (let index = first; index <= last; index++) {
        if (values[index] !== null && values[index] !== undefined && !Number.isNaN(values[index])) {
          min = Math.min(min, values[index]);
          max = Math.max(max, values[index]);
        }
      }
    }
    const main = view.price ? scale(0, mainH, view.price.low, view.price.high, state.log, 0) : scale(0, mainH, min, max, state.log);
    const ms = state.interval * 60000;
    geo = { width, height, plot, axis, foot, mainH, from, x, main, first, last, total, ms, t0: raw()[0].time, panes: [] };

    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('aria-label', env.t('{0} price chart, {1}. Arrow keys inspect bars, plus and minus zoom. The Data panel lists the same bars as a table.',
      instrument().name, intervalLabel(state.interval)));
    const base = layers.base;
    base.replaceChildren();
    const defs = node(base, 'defs');
    node(node(defs, 'clipPath', { id: 'clip' + id }), 'rect', { x: 0, y: 0, width: plot, height: height - foot });
    node(node(defs, 'clipPath', { id: 'main' + id }), 'rect', { x: 0, y: 0, width: plot, height: mainH });
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
      const label = state.interval >= 1440 || current !== day ? current : env.time(time, 'time');
      day = current;
      line(x(index), 0, x(index), height - foot, grid);
      if (x(index) > 20 && x(index) < plot - 20) text(x(index), height - 7, label, { 'text-anchor': 'middle' });
    }
    line(plot, 0, plot, height, colors.edge);
    line(0, height - foot, width, height - foot, colors.edge);

    const series_ = node(base, 'g', { 'clip-path': 'url(#clip' + id + ')' });
    const path = (d, extra) => d && node(series_, 'path', { d, fill: 'none', ...extra });
    const body = Math.max(1, Math.min(view.width - 1, view.width * 0.72));

    // Volume bars along the bottom of the main pane.
    if (overlays.some(indicator => indicator.id === 'volume')) {
      let peak = 0;
      const volumeShare = Math.min(0.8, Math.max(0.03, (overlays.find(indicator => indicator.id === 'volume').params.height ?? 18) / 100));
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

    // Price series.
    if (lineStyle) {
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
        parts[bar.close >= bar.open ? 'up' : 'down'] += state.style === 'Bars'
          ? 'M' + cx + ' ' + high + 'V' + low + 'M' + round(cx - body / 2) + ' ' + open + 'H' + cx + 'M' + cx + ' ' + close + 'H' + round(cx + body / 2)
          : 'M' + cx + ' ' + high + 'V' + top + 'M' + cx + ' ' + bottom + 'V' + low +
            'M' + round(cx - body / 2) + ' ' + top + 'h' + round(body) + 'v' + Math.max(1, round(bottom - top)) + 'h' + round(-body) + 'Z';
      }
      const hollow = state.style === 'Hollow candles';
      path(parts.up, { stroke: colors.up, fill: state.style === 'Bars' ? 'none' : hollow ? colors.panel : colors.up, class: 'candles' });
      path(parts.down, { stroke: colors.down, fill: state.style === 'Bars' ? 'none' : colors.down, class: 'candles' });
    }

    // Overlay studies and comparison symbols.
    for (const indicator of overlays) {
      for (const [order, item] of plotsOf(indicator).entries()) {
        if (item.kind === 'dots') {
          let dots = '';
          for (let index = first; index <= last; index++) {
            if (item.values[index] !== null && item.values[index] !== undefined) {
              dots += 'M' + round(x(index) - 1.6) + ' ' + round(main.y(item.values[index])) + 'a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0 -3.2 0';
            }
          }
          path(dots, { fill: (indicator.colors?.[order] ?? palette[item.color ?? 0]), class: 'study' });
        } else if (item.kind !== 'volume') {
          path(linePath(item.values, main.y, x, first, last), { stroke: (indicator.colors?.[order] ?? palette[item.color ?? 0]), 'stroke-width': indicator.width ?? 1.4, class: 'study' });
        }
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
    const final = bars[total - 1];
    const tone = final.close >= final.open ? colors.up : colors.down;
    const lastY = main.y(final.close);
    if (lastY > 0 && lastY < mainH && env.store.settings.priceLine !== false) {
      line(0, lastY, plot, lastY, tone, { 'stroke-dasharray': '1 3' });
      tag(lastY, fmt(final.close), tone);
    }

    // Separate study panes.
    separate.forEach((indicator, order) => {
      const top = mainH + tops[order];
      const subH = weights[order] * unit;
      const spec = definition(indicator.id);
      const plots = plotsOf(indicator);
      let low = Infinity;
      let high = -Infinity;
      for (const item of plots) {
        for (let index = first; index <= last; index++) {
          const value = item.values[index];
          if (value !== null && value !== undefined && !Number.isNaN(value)) {
            low = Math.min(low, value);
            high = Math.max(high, value);
          }
        }
      }
      if (low === Infinity) [low, high] = [0, 1];
      const pane = spec.range ? scale(top, subH, spec.range[0], spec.range[1], false, 0.04) : scale(top + 16, subH - 20, low, high, false, 0.06);
      geo.panes.push({ top, height: subH, scale: pane, indicator, unit });
      line(0, top, width, top, colors.edge);
      node(base, 'rect', { x: round(plot / 2 - 16), y: round(top - 2), width: 32, height: 4, rx: 2, fill: colors.muted, opacity: 0.55, class: 'grip' });
      for (const guide of spec.guides ?? []) line(0, pane.y(guide), plot, pane.y(guide), colors.muted, { 'stroke-dasharray': '3 4', opacity: 0.6 });
      for (const value of spec.range ? spec.guides : [low, high]) text(plot + 5, Math.min(top + subH - 3, Math.max(top + 10, pane.y(value) + 4)), compact(value));
      for (const [order, item] of plots.entries()) {
        if (item.kind === 'histogram') {
          const parts = { up: '', down: '' };
          const zero = pane.y(0);
          for (let index = first; index <= last; index++) {
            const value = item.values[index];
            if (value === null || value === undefined) continue;
            const y = pane.y(value);
            parts[value >= 0 ? 'up' : 'down'] += 'M' + round(x(index) - body / 2) + ' ' + round(Math.min(y, zero)) + 'h' + round(body) +
              'v' + round(Math.max(0.5, Math.abs(y - zero))) + 'h' + round(-body) + 'Z';
          }
          path(parts.up, { fill: colors.up, opacity: 0.55 });
          path(parts.down, { fill: colors.down, opacity: 0.55 });
        } else {
          path(linePath(item.values, pane.y, x, first, last), { stroke: (indicator.colors?.[order] ?? palette[item.color ?? 0]), 'stroke-width': indicator.width ?? 1.4, class: 'study' });
        }
      }
      text(8, top + 13, plots.map(item => item.label).join(' · ') || spec.name, { class: 'pane-title' });
    });

    renderDrawings();
    drawCross();
    readout(cross?.index ?? null);
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
    row('main', [span('legend-symbol', state.symbol + ' · ' + intervalLabel(state.interval)), span('chip', env.t(instrument().live ? 'Live' : 'Simulated')),
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
      row(indicator.hidden ? 'muted' : '', parts);
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
      element.textContent = indicator.hidden ? env.t('hidden') : plotsOf(indicator).map(item => {
        const value = item.values[at];
        return value === null || value === undefined || Number.isNaN(value) ? '–' : compact(value);
      }).join('  ');
    }
    for (const element of legend.querySelectorAll('[data-compare]')) {
      const item = geo.compares.find(entry => entry.symbol === element.dataset.compare);
      const move = (item.other[at].close / item.base - 1) * 100;
      element.textContent = (move >= 0 ? '+' : '') + move.toFixed(2) + '%';
    }
  }

  function drawCross() {
    const layer = layers.cross;
    layer.replaceChildren();
    const mode = env.store.settings.crosshair ?? 'cross';
    if (!cross || !geo || mode === 'none') return;
    const colors = env.colors();
    const x = round(geo.x(cross.index));
    if (x < 0 || x > geo.plot) return;
    const dash = { stroke: colors.muted, 'stroke-dasharray': '4 4' };
    node(layer, 'line', { x1: x, x2: x, y1: 0, y2: geo.height - geo.foot, ...dash });
    const label = env.time(geo.t0 + cross.index * geo.ms, 'full');
    const wide = label.length * 6.4 + 12;
    const left = Math.max(0, Math.min(geo.plot - wide, x - wide / 2));
    node(layer, 'rect', { x: left, y: geo.height - geo.foot + 1, width: wide, height: geo.foot - 2, fill: colors.text, rx: 2 });
    node(layer, 'text', { x: left + 6, y: geo.height - 7, fill: colors.panel }, label);
    if (mode === 'vertical' || cross.y === null || cross.y === undefined || cross.y > geo.height - geo.foot) return;
    const pane = cross.y < geo.mainH ? geo.main : geo.panes.find(item => cross.y >= item.top && cross.y < item.top + item.height)?.scale;
    node(layer, 'line', { x1: 0, x2: geo.plot, y1: round(cross.y), y2: round(cross.y), ...dash });
    if (!pane) return;
    node(layer, 'rect', { x: geo.plot, y: round(cross.y - 9), width: geo.axis, height: 18, fill: colors.text, rx: 2 });
    node(layer, 'text', { x: geo.plot + 5, y: round(cross.y + 4), fill: colors.panel }, cross.y < geo.mainH ? fmt(pane.value(cross.y)) : compact(pane.value(cross.y)));
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
    env.before();
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
    const pane = geo.panes.find(item => Math.abs(position.y - item.top) < 6);
    if (pane) return { kind: 'pane', pane };
    if (position.y > geo.height - geo.foot) return { kind: 'time' };
    if (position.x > geo.plot && position.y < geo.mainH) return { kind: 'price' };
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
    view.end = anchor - px / width + geo.plot / width;
    view.width = width;
    clamp();
    render();
  }

  svg.addEventListener('pointerdown', event => {
    if (!geo) return;
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
    const inside = position.x < geo.plot && position.y < geo.mainH;
    if (tool === 'replay' && inside) {
      env.toolDone();
      return api.replayStart(indexAt(position.x) + 1);
    }
    if (tool !== 'cursor' && inside) return useTool(tool, position);
    measure = null;
    const hit = env.store.settings.hide ? null : hitTest(position);
    selected = hit?.drawing.id ?? null;
    if (hit && !env.store.settings.lock) {
      env.before();
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
      drag.pane.indicator.size = Math.min(4, Math.max(0.25, (drag.pane.height - (position.y - drag.y)) / drag.pane.unit));
      return render();
    }
    if (!drag) svg.style.cursor = { pane: 'row-resize', price: 'ns-resize', time: 'ew-resize' }[zoneAt(position).kind] ?? '';
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
    if (position.x < geo.plot) {
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
    if (drag?.kind === 'pane' || drag?.kind === 'price') env.changed('view');
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
    if (zoneAt(local(event)).kind === 'price') {
      view.price = stretch(yRange(), Math.exp(event.deltaY * 0.0015));
      render();
      return env.changed('view');
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      view.end += (event.deltaX || event.deltaY) / view.width;
      clamp();
      render();
    } else zoomAt(Math.exp(-event.deltaY * 0.0015), local(event).x);
  }, { passive: false });
  svg.addEventListener('dblclick', event => {
    if (!geo) return;
    if (zoneAt(local(event)).kind === 'price') api.setAutoScale(true);
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
      if (index < geo.from) view.end -= geo.from - index;
      if (index + 1 > view.end) view.end = index + 2;
      cross = { index, y: null };
      render();
      cross.y = geo.main.y(shown()[index].close);
      drawCross();
      env.crosshair(api, geo.t0 + index * geo.ms);
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
    state, host, render,
    get replaying() { return replay !== null; },
    get replayDone() { return replay !== null && replay >= raw().length; },
    get selected() { return selected; },
    get crossIndex() { return cross?.index ?? null; },
    bars: () => raw().slice(0, length()),
    visible: () => geo ? raw().slice(geo.first, geo.last + 1) : [],
    plots: plotsOf,
    last: () => raw()[length() - 1],
    previous: () => raw()[length() - 2],
    set(patch) {
      const moved = (patch.symbol && patch.symbol !== state.symbol) || (patch.interval && patch.interval !== state.interval);
      Object.assign(state, patch);
      if (moved) {
        markers = [];
        replay = selected = draft = measure = cross = null;
        view.end = null;
        view.price = null;
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
      for (const key of ['hidden', 'colors', 'width', 'size']) if (key in patch) indicator[key] = patch[key];
      api.set({});
    },
    removeIndicator(uid) {
      api.set({ indicators: state.indicators.filter(item => item.uid !== uid) });
    },
    toggleCompare(symbol) {
      api.set({ compare: state.compare.includes(symbol) ? state.compare.filter(item => item !== symbol) : [...state.compare, symbol] });
    },
    zoom(factor) { if (geo) zoomAt(factor, geo.plot); },
    get autoScale() { return !view.price; },
    setAutoScale(on) {
      view.price = on || !geo ? null : yRange();
      render();
      env.changed('view');
    },
    // Below 1 stretches prices over more of the pane; above 1 compresses them.
    scalePrice(factor) {
      if (!geo) return;
      view.price = stretch(yRange(), factor);
      render();
      env.changed('view');
    },
    panPrice(fraction) {
      if (!geo) return;
      view.price = shift(yRange(), fraction * geo.mainH);
      render();
      env.changed('view');
    },
    scroll(barsBy) {
      if (!geo) return;
      view.end += barsBy;
      clamp();
      render();
    },
    scrollTo(index) {
      if (!geo) return;
      view.end = index + geo.plot / view.width;
      clamp();
      render();
    },
    fit(reset = true) {
      if (reset) [view.auto, view.price] = [true, null];
      view.end = length() + 3;
      render();
    },
    showBars(count) {
      if (!geo) return;
      view.width = geo.plot / (count + 3);
      view.end = length() + 3;
      clamp();
      render();
    },
    goTo(time) {
      if (!geo) return;
      const index = Math.round((time - geo.t0) / geo.ms);
      view.end = index + geo.plot / view.width / 2;
      clamp();
      cross = { index: Math.max(0, Math.min(geo.total - 1, index)), y: null };
      render();
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
      env.before();
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
      replay = Math.max(30, Math.min(total - 1, index ?? total - 100));
      view.end = replay + 3;
      render();
      env.changed('replay');
    },
    replayStep() {
      if (replay === null || replay >= raw().length) return false;
      replay++;
      if (view.end >= replay - 1) view.end = Math.max(view.end, replay + 3);
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
