// Workspace shell: toolbars, layouts, side panels, dialogs and persistence around the chart engine.
import { instruments, liveInstruments, intervals, intervalLabel, find, series, price, csv, useLive } from './market.mjs';
import { registry, definition, rsi, sma, macd, atr } from './indicators.mjs';
import { compileScript, backtest, formulaHelp } from './script.mjs';
import { createChart, styles, paneOf, palette } from './chart.mjs';
import { createLive, liveTerms } from './live.mjs';
import { locales, locale, detect, useLocale, t, L, translateTree } from './i18n.mjs';

const $ = id => document.getElementById(id);
const view = document.defaultView;
const KEY = 'meridian.v2';
const REPO = 'https://github.com/MFSCV/meridian';

function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key === 'html') element.innerHTML = value;
    else if (key.startsWith('on')) element[key] = value;
    else element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.flat().filter(child => child !== undefined && child !== null && child !== false));
  return element;
}

const icons = {
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM16.5 16.5L21 21',
  compare: 'M12 8v8M8 12h8M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z',
  candle: 'M8 3v4M8 15v6M6 7h4v8H6zM16 5v3M16 14v5M14 8h4v6h-4z',
  indicators: 'M3 17l5-6 4 3 5-8 4 5',
  alert: 'M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  replay: 'M11 6l-7 6 7 6zM20 6l-7 6 7 6z',
  undo: 'M9 6L4 11l5 5M4 11h10a5 5 0 0 1 0 10h-3',
  redo: 'M15 6l5 5-5 5M20 11H10a5 5 0 0 0 0 10h3',
  layout: 'M4 4h16v16H4zM12 4v16M4 12h16',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  cursor: 'M12 3v18M3 12h18',
  trend: 'M6.5 17.5l11-11M5 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ray: 'M6.5 17L20 7M5 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 6h5v5',
  extended: 'M3 20L21 4M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  arrow: 'M5 19L19 5M10 5h9v9',
  hline: 'M3 12h7M14 12h7M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  hray: 'M7 12h14M5 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  vline: 'M12 3v7M12 14v7M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  channel: 'M3 15L17 5M7 20L21 10',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z',
  fib: 'M3 5h18M3 10h18M3 14h18M3 19h18',
  long: 'M4 20h16M4 13h16M12 10V3M9 6l3-3 3 3',
  short: 'M4 4h16M4 11h16M12 14v7M9 18l3 3 3-3',
  brush: 'M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-4 1-5 3z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  measure: 'M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2',
  pricerange: 'M12 4v16M8 4h8M8 20h8',
  daterange: 'M4 12h16M4 8v8M20 8v8',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  keep: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  list: 'M4 6h16M4 12h16M4 18h10',
  table: 'M4 5h16v14H4zM4 10h16M10 5v14',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V5h12M15 13h2',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  share: 'M18 8a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  source: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  zoomIn: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM16.5 16.5L21 21M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM16.5 16.5L21 21M8 11h6',
  priceIn: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4', priceOut: 'M12 3v6M12 15v6M8 5l4 4 4-4M8 19l4-4 4 4',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', latest: 'M6 5l7 7-7 7M18 5v14'
};
const icon = name => '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + icons[name] + '"/></svg>';

// Buttons carry an accessible name, a tooltip and an optional visible label.
function button(id, { glyph, label, text, run, always }) {
  const element = h('button', { type: 'button', id, title: label, 'aria-label': label, html: glyph ? icon(glyph) : '', onclick: () => run(element) });
  if (text !== undefined) element.append(h('span', { class: always ? 'label always' : 'label', text }));
  return element;
}
const setLabel = (id, text) => { $(id).querySelector('.label').textContent = text; };
const setGlyph = (id, glyph) => { $(id).querySelector('svg').outerHTML = icon(glyph); };
const press = (element, on) => element.setAttribute('aria-pressed', String(Boolean(on)));

// Labels are marked with L() here and translated with t() where they are shown.
const layouts = {
  1: { count: 1, name: L('Single chart') }, '2h': { count: 2, name: L('Two side by side') }, '2v': { count: 2, name: L('Two stacked') },
  3: { count: 3, name: L('One large, two small') }, 4: { count: 4, name: L('Four charts') }
};
const zones = { UTC: 'UTC', local: L('Device time'), 'Europe/Lisbon': L('Lisbon'), 'Europe/London': L('London'), 'America/New_York': L('New York'), 'Asia/Tokyo': L('Tokyo') };
const intervalNames = { 5: L('5 minutes'), 15: L('15 minutes'), 30: L('30 minutes'), 60: L('1 hour'), 120: L('2 hours'), 240: L('4 hours'),
  720: L('12 hours'), 1440: L('1 day'), 10080: L('1 week') };
export const styleNames = [L('Candles'), L('Hollow candles'), L('Bars'), L('Line'), L('Area'), L('Baseline'), L('Heikin Ashi')];
const typeNames = [L('Stock'), L('ETF'), L('Crypto'), L('Forex'), L('Commodity')];
const conditions = { cross: L('Crossing'), above: L('Greater than'), below: L('Less than') };
const toolGroups = [
  { id: 'cursor', tools: [['cursor', L('Crosshair')]] },
  { id: 'lines', tools: [['trend', L('Trend line')], ['ray', L('Ray')], ['extended', L('Extended line')], ['arrow', L('Arrow')],
    ['hline', L('Horizontal line')], ['hray', L('Horizontal ray')], ['vline', L('Vertical line')], ['channel', L('Parallel channel')]] },
  { id: 'fib', tools: [['fib', L('Fibonacci retracement')]] },
  { id: 'shapes', tools: [['rect', L('Rectangle')], ['ellipse', L('Ellipse')], ['brush', L('Brush')]] },
  { id: 'position', tools: [['long', L('Long position')], ['short', L('Short position')]] },
  { id: 'text', tools: [['text', L('Text note')]] },
  { id: 'measure', tools: [['measure', L('Measure')], ['pricerange', L('Price range')], ['daterange', L('Date range')]] }
];
const drawingNames = Object.fromEntries([...toolGroups.flatMap(group => group.tools), ['position', L('Position')]]);
const panels = [['watch', 'list', L('Watchlist and details')], ['alerts', 'alert', L('Alerts')], ['data', 'table', L('Data window and object tree')],
  ['screener', 'filter', L('Screener')], ['script', 'code', L('Formulas and strategies')], ['trade', 'wallet', L('Paper trading')],
  ['insights', 'bulb', L('Insights')], ['community', 'share', L('Share and community')], ['sources', 'source', L('Official sources')]];
const ranges = [['1D', 5, 288, L('1 day in 5 minute bars')], ['5D', 15, 480, L('5 days in 15 minute bars')], ['1M', 60, 720, L('1 month in 1 hour bars')],
  ['3M', 240, 540, L('3 months in 4 hour bars')], [L('All'), 1440, 144, L('All data in daily bars')]];
const columns = [['symbol', L('Symbol')], ['last', L('Last')], ['change', L('Chg%')], ['week', L('1W%')], ['month', L('1M%')], ['rsi', 'RSI'], ['trend', L('vs SMA 50')]];
const examples = [[L('Momentum'), 'close - sma(close, 20)'], [L('MACD line'), 'ema(close, 12) - ema(close, 26)'],
  [L('Range position'), '(close - lowest(low, 14)) / (highest(high, 14) - lowest(low, 14)) * 100'],
  [L('Moving average cross strategy'), 'fast = ema(close, 12)\nslow = ema(close, 26)\nplot fast as Fast\nplot slow as Slow\nbuy when crossover(fast, slow)\nsell when crossunder(fast, slow)'],
  [L('RSI reversal strategy'), 'strength = rsi(close, 14)\nplot strength\nbuy when crossover(strength, 30)\nsell when crossunder(strength, 70)']];
const extraLabels = [L('Use light theme'), L('Long'), L('Short'), L('Buy'), L('Sell'), L('Formula')];
const paramNames = { length: L('Length'), width: L('Width'), fast: L('Fast length'), slow: L('Slow length'), signal: L('Signal length'), smooth: L('Smoothing'),
  span: L('Span length'), height: L('Height (% of the price pane)'), expression: L('Formula or script'), name: L('Name') };

const densities = { compact: L('Compact'), cozy: L('Comfortable'), roomy: L('Large') };
const crosshairs = { cross: L('Cross'), vertical: L('Vertical line only'), none: L('Hidden') };
const themes = { auto: L('Match device'), light: L('Light'), dark: L('Dark') };
const sides = { right: L('Right'), left: L('Left') };
const strokes = { '': L('Default'), 1: '1', 2: '2', 3: '3', 4: '4' };
// Top bar buttons that can be hidden from Settings.
const optional = [['compare', L('Compare symbols')], ['style', L('Chart type')], ['indicators', L('Indicators and formulas')], ['alert', L('Create alert')],
  ['replay', L('Bar replay')], ['undo', L('Undo drawing change')], ['redo', L('Redo drawing change')], ['layout', L('Layout setup')],
  ['layouts', L('Save and load layouts')], ['snapshot', L('Download chart image')], ['fullscreen', L('Full screen')]];
const isColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// State and persistence.
const chartDefaults = () => ({ symbol: 'SPY', interval: 1440, style: 'Candles', log: false, compare: [], indicators: [{ uid: 'volume', id: 'volume', params: { height: 18 } }] });
const defaults = () => ({
  theme: null, locale: null, look: { accent: null, up: null, down: null, density: 'cozy' }, hidden: [], panelWidth: null, layout: '1', active: 0, charts: [chartDefaults()], panel: (view?.innerWidth ?? 1200) < 760 ? null : 'watch',
  watchlist: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'BTCUSD', 'ETHUSDT.P', 'EURUSD'], alerts: [], log: [], drawings: {}, saved: {},
  paper: { cash: 100000, positions: {}, orders: [], pending: [] },
  settings: { tz: 'UTC', grid: true, magnet: false, keep: false, lock: false, hide: false, syncSymbol: false, syncInterval: false, syncCross: true, live: false,
    priceLine: true, legend: true, crosshair: 'cross', drawColor: null, drawWidth: null, panelSide: 'right', tools: true, bottom: true }
});
const list = value => Array.isArray(value) ? value : [];
const cleanCharts = value => list(value).filter(chart => find(chart?.symbol) && intervals.includes(chart.interval)).map(chart => ({
  ...chartDefaults(), ...chart, style: styles.includes(chart.style) ? chart.style : 'Candles',
  compare: list(chart.compare).filter(symbol => find(symbol) && !find(symbol).live), indicators: list(chart.indicators).filter(item => definition(item?.id)).map(item => ({
    ...item, params: { ...definition(item.id).params, ...item.params },
    size: Number.isFinite(item.size) ? Math.min(4, Math.max(0.25, item.size)) : undefined,
    width: Number.isFinite(item.width) ? Math.min(6, Math.max(0.5, item.width)) : undefined,
    colors: item.colors && typeof item.colors === 'object' ? Object.fromEntries(Object.entries(item.colors).filter(([, value]) => isColor(value))) : undefined
  }))
}));
const cleanDrawings = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
  .filter(([symbol]) => find(symbol))
  .map(([symbol, items]) => [symbol, list(items).filter(item => drawingNames[item?.type] && list(item.points).length &&
    item.points.every(point => Number.isFinite(point?.t) && Number.isFinite(point?.p)) && (item.type !== 'text' || typeof item.text === 'string'))]));

// Turns anything read from storage, a file or a link into a valid state.
function normalize(saved) {
  const base = defaults();
  if (saved && typeof saved === 'object') {
    Object.assign(base, saved, { settings: { ...base.settings, ...saved.settings }, paper: { ...base.paper, ...saved.paper } });
  }
  base.charts = cleanCharts(base.charts);
  if (!base.charts.length) base.charts = [chartDefaults()];
  if (!layouts[base.layout]) base.layout = '1';
  if (![null, 'light', 'dark'].includes(base.theme)) base.theme = null;
  if (!locales.some(item => item.tag === base.locale)) base.locale = null;
  if (!zones[base.settings.tz]) base.settings.tz = 'UTC';
  if (!crosshairs[base.settings.crosshair]) base.settings.crosshair = 'cross';
  if (!sides[base.settings.panelSide]) base.settings.panelSide = 'right';
  if (!isColor(base.settings.drawColor)) base.settings.drawColor = null;
  if (!(base.settings.drawWidth >= 1 && base.settings.drawWidth <= 4)) base.settings.drawWidth = null;
  const look = saved?.look && typeof saved.look === 'object' ? saved.look : {};
  base.look = { accent: isColor(look.accent) ? look.accent : null, up: isColor(look.up) ? look.up : null, down: isColor(look.down) ? look.down : null,
    density: densities[look.density] ? look.density : 'cozy' };
  base.hidden = list(base.hidden).filter(id => optional.some(([name]) => name === id) || panels.some(([name]) => 'panel-' + name === id));
  base.panelWidth = Number.isFinite(base.panelWidth) ? Math.min(720, Math.max(240, base.panelWidth)) : null;
  if ((view?.innerWidth ?? 1200) < 760) base.panel = null;
  if (base.panel && !panels.some(([name]) => name === base.panel)) base.panel = 'watch';
  base.active = Number.isInteger(base.active) && base.active >= 0 ? base.active : 0;
  base.watchlist = list(base.watchlist).filter(find);
  base.alerts = list(base.alerts).filter(alert => find(alert?.symbol) && conditions[alert.condition] && alert.price > 0);
  base.log = list(base.log).filter(entry => typeof entry?.message === 'string');
  base.drawings = cleanDrawings(base.drawings);
  base.saved = Object.fromEntries(Object.entries(base.saved && typeof base.saved === 'object' ? base.saved : {})
    .map(([name, entry]) => [name, { layout: layouts[entry?.layout] ? entry.layout : '1', charts: cleanCharts(entry?.charts) }])
    .filter(([, entry]) => entry.charts.length));
  base.paper = {
    cash: Number.isFinite(base.paper.cash) ? base.paper.cash : 100000,
    positions: Object.fromEntries(Object.entries(base.paper.positions ?? {}).filter(([symbol, item]) => find(symbol) && Number.isFinite(item?.qty) && Number.isFinite(item?.avg))),
    orders: list(base.paper.orders).filter(item => find(item?.symbol) && Number.isFinite(item.qty) && Number.isFinite(item.price)),
    pending: list(base.paper.pending).filter(item => find(item?.symbol) && Number.isFinite(item.qty) && item.price > 0 && ['limit', 'stop'].includes(item.type))
  };
  return base;
}

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) {
      // Carry the prototype 0.1 preferences forward.
      const old = JSON.parse(localStorage.getItem('meridian.v1'));
      if (old) {
        saved = { theme: old.theme ?? null, charts: [{ ...chartDefaults(), symbol: old.symbol, interval: old.interval * 60, style: old.style, indicators: [
          ...(old.volume === false ? [] : chartDefaults().indicators), ...(old.average ? [{ uid: 'sma20', id: 'sma', params: { length: 20 } }] : [])] }] };
      }
    }
  } catch {}
  return normalize(saved);
}

let state = load();
await useLocale(state.locale ?? detect().tag);
document.documentElement.lang = locale.tag;
document.documentElement.dir = locale.dir;
translateTree(document.body);

let charts = [];
let tool = 'cursor';
let timer = null;
let live = null;
let refresh = null;
const past = [];
const future = [];
const lastTool = {};
const sort = { key: 'change', down: true };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
const active = () => charts[state.active] ?? charts[0];
const universe = () => [...instruments, ...(state.settings.live ? liveInstruments : [])];

// Theme and formatting.
const deviceTheme = matchMedia('(prefers-color-scheme: dark)');
let colorCache;
function colors() {
  if (!colorCache) {
    const style = view?.getComputedStyle?.(document.documentElement);
    const read = (name, fallback) => style?.getPropertyValue(name).trim() || fallback;
    colorCache = {
      text: read('--text', '#18251f'), muted: read('--muted', '#51645b'), edge: read('--edge', '#d6e1da'), grid: read('--grid', '#e8eeea'),
      up: read('--rise', '#087854'), down: read('--fall', '#ad3151'), accent: read('--accent', '#087854'),
      panel: read('--panel', '#ffffff'), alert: read('--alert', '#b86a00')
    };
  }
  return colorCache;
}
function applyTheme() {
  const theme = state.theme ?? (deviceTheme.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  colorCache = null;
  const control = $('theme');
  if (control) {
    setGlyph('theme', theme === 'dark' ? 'moon' : 'sun');
    control.title = t(theme === 'dark' ? 'Use light theme' : 'Use dark theme');
    control.setAttribute('aria-label', control.title);
  }
  charts.forEach(chart => chart.render());
}
function applyLook() {
  const root = document.documentElement;
  for (const [name, value] of [['--accent', state.look.accent], ['--rise', state.look.up], ['--fall', state.look.down],
    ['--panel-width', state.panelWidth ? state.panelWidth + 'px' : null]]) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.dataset.density = state.look.density;
  document.body.dataset.side = state.settings.panelSide;
  document.body.dataset.tools = String(state.settings.tools !== false);
  document.body.dataset.bottom = String(state.settings.bottom !== false);
  for (const id of [...optional.map(([name]) => name), ...panels.map(([name]) => 'panel-' + name)]) {
    if ($(id)) $(id).hidden = state.hidden.includes(id);
  }
  colorCache = null;
}
const formats = new Map();
function time(value, kind) {
  const timeZone = state.settings.tz === 'local' ? undefined : state.settings.tz;
  const key = kind + timeZone;
  if (!formats.has(key)) {
    formats.set(key, new Intl.DateTimeFormat(locale.tag, kind === 'day' ? { day: 'numeric', month: 'short', timeZone }
      : kind === 'time' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }
      : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }));
  }
  return formats.get(key).format(value);
}
const signed = (value, digits = 2) => (value >= 0 ? '+' : '') + value.toFixed(digits) + '%';
const tone = value => value >= 0 ? 'up' : 'down';
const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const statsCache = new Map();
// Daily statistics for a symbol, or null while a live symbol has not loaded.
function stats(instrument) {
  const daily = series(instrument, 1440);
  if (daily.length < 2) return null;
  const stamp = daily.length + ':' + daily.at(-1).close;
  const cached = statsCache.get(instrument.symbol);
  if (cached?.stamp === stamp) return cached;
  const closes = daily.map(bar => bar.close);
  const last = daily.at(-1);
  const move = back => (last.close / (daily.at(-1 - back) ?? daily[0]).close - 1) * 100;
  const result = {
    stamp, last: last.close, bar: last, change: move(1), week: move(7), month: move(30), rsi: rsi(closes, 14).at(-1) ?? 50,
    trend: (last.close / (sma(closes, 50).at(-1) ?? last.close) - 1) * 100, high: Math.max(...daily.map(bar => bar.high)), low: Math.min(...daily.map(bar => bar.low))
  };
  statsCache.set(instrument.symbol, result);
  return result;
}
// Latest price for a symbol: the replaying chart, then the live feed, then the last daily bar.
function quote(symbol) {
  const chart = charts.find(item => item.state.symbol === symbol && item.replaying);
  if (chart) return chart.last().close;
  if (find(symbol).live) return live?.last(symbol)?.close ?? null;
  return stats(find(symbol)).last;
}

function toast(message) {
  const note = h('div', { class: 'toast', text: message });
  $('toasts').append(note);
  setTimeout(() => note.remove(), 4500).unref?.();
}

// Menus and the shared dialog.
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.box.remove();
  openMenu.anchor.removeAttribute('aria-expanded');
  openMenu = null;
}
function menu(anchor, items, side) {
  if (openMenu?.anchor === anchor) return closeMenu();
  closeMenu();
  const box = h('div', { class: 'menu', role: 'menu' }, items.map(item => {
    if (item === '-') return h('hr');
    if (item.heading) return h('p', { class: 'menu-heading', text: item.heading });
    return h('button', {
      type: 'button', role: item.checked === undefined ? 'menuitem' : 'menuitemradio', lang: item.lang,
      'aria-checked': item.checked === undefined ? null : String(item.checked),
      onclick: () => {
        closeMenu();
        item.run();
      }
    }, h('span', { text: item.label }), item.hint && h('small', { text: item.hint }));
  }));
  document.body.append(box);
  const bounds = anchor.getBoundingClientRect();
  const left = side === 'right' ? bounds.right + 6 : bounds.left;
  const top = side === 'right' ? bounds.top : bounds.bottom + 4;
  box.style.left = Math.max(8, Math.min(left, (view?.innerWidth ?? 1200) - box.offsetWidth - 8)) + 'px';
  box.style.top = Math.max(8, Math.min(top, (view?.innerHeight ?? 800) - box.offsetHeight - 8)) + 'px';
  anchor.setAttribute('aria-expanded', 'true');
  openMenu = { box, anchor };
  box.querySelector('button')?.focus();
  box.onkeydown = event => {
    const entries = [...box.querySelectorAll('button')];
    const at = entries.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      entries[(at + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length].focus();
    } else if (event.key === 'Escape') {
      closeMenu();
      anchor.focus();
    }
  };
}
document.addEventListener('pointerdown', event => {
  if (openMenu && !openMenu.box.contains(event.target) && !openMenu.anchor.contains(event.target)) closeMenu();
});

function dialog(title, body, wide) {
  const element = $('dialog');
  $('dialog-title').textContent = title;
  $('dialog-body').replaceChildren(...[body].flat().filter(Boolean));
  element.classList.toggle('wide', Boolean(wide));
  if (!element.hasAttribute('open')) {
    try { element.showModal(); } catch { element.setAttribute('open', ''); }
  }
}
function closeDialog() {
  const element = $('dialog');
  try { element.close(); } catch {}
  element.removeAttribute('open');
}
const field = (label, control) => h('label', { class: 'field' }, h('span', { text: label }), control);
const actions = (...controls) => h('div', { class: 'actions' }, controls);
const hint = (text, ...more) => h('p', { class: 'hint', text }, more);

function symbolDialog(title, pick, { stay, query = '', simulatedOnly } = {}) {
  const input = h('input', { type: 'search', id: 'symbol-query', placeholder: t('Symbol or name'), 'aria-label': t('Search symbols'), value: query });
  const kind = h('select', { 'aria-label': t('Instrument type') }, [h('option', { value: '', text: t('All types') }),
    ...typeNames.map(name => h('option', { value: name, text: t(name) }))]);
  const results = h('div', { class: 'results', id: 'symbol-results' });
  const fill = () => {
    const words = input.value.trim().toLowerCase();
    const found = universe().filter(item => (item.symbol + ' ' + item.name).toLowerCase().includes(words) &&
      (!kind.value || item.type === kind.value) && !(simulatedOnly && item.live));
    results.replaceChildren(...found.map(item => {
      const data = stats(item);
      return h('button', { type: 'button', class: 'result', 'data-symbol': item.symbol, onclick: () => {
        if (!stay) closeDialog();
        pick(item);
      } }, h('strong', { text: item.symbol }), h('span', { text: item.name }), h('small', { text: item.live ? t('Live') + ' · ' + item.source : t(item.type) }),
      h('span', { class: 'num', text: data ? price(data.last, item) : '…' }), h('span', { class: 'num ' + (data ? tone(data.change) : ''), text: data ? signed(data.change) : '' }));
    }));
    if (!found.length) results.append(hint(t('No matching symbols.')));
  };
  input.oninput = kind.onchange = fill;
  dialog(title, [h('div', { class: 'row' }, input, kind), results]);
  fill();
  input.focus();
}

const indicatorName = indicator => indicator.id === 'formula' ? indicator.params.name : t(definition(indicator.id).name);
function configure(chart, indicator) {
  const spec = definition(indicator.id);
  const error = h('p', { role: 'alert', class: 'error' });
  const inputs = Object.entries(indicator.params).map(([key, value]) => {
    const control = key === 'overlay' ? h('input', { type: 'checkbox', checked: Boolean(value) })
      : typeof spec.params[key] === 'number' ? h('input', { type: 'number', min: key === 'width' ? 0.1 : 1, max: 500, step: key === 'width' ? 0.1 : 1, value })
      : key === 'expression' ? h('textarea', { rows: 6, spellcheck: 'false', text: value }) : h('input', { type: 'text', value, spellcheck: 'false' });
    control.dataset.key = key;
    return key === 'overlay' ? h('label', { class: 'check' }, control, t('Draw on the price pane')) : field(t(paramNames[key] ?? key), control);
  });
  // Colour and width apply to the lines an indicator draws.
  const swatches = chart.plots(indicator).map((plot, order) => {
    if (['volume', 'histogram'].includes(plot.kind)) return null;
    const control = h('input', { type: 'color', value: indicator.colors?.[order] ?? palette[plot.color ?? 0] });
    control.dataset.plot = order;
    return field(t('Colour of {0}', plot.label), control);
  }).filter(Boolean);
  const width = h('select', { id: 'line-width' }, [1, 1.4, 2, 3, 4].map(value => h('option', { value, text: String(value), selected: value === (indicator.width ?? 1.4) })));
  dialog(indicatorName(indicator), [...inputs, swatches.length ? h('h3', { text: t('Style') }) : null, ...swatches,
    swatches.length ? field(t('Line width'), width) : null, error, actions(
    h('button', { type: 'button', class: 'primary', text: t('Apply'), onclick: () => {
      const params = {};
      for (const control of $('dialog-body').querySelectorAll('[data-key]')) {
        const key = control.dataset.key;
        params[key] = control.type === 'checkbox' ? Number(control.checked) : control.type === 'number' ? Number(control.value) : control.value.trim();
        if (control.type === 'number' && !(params[key] >= Number(control.min) && params[key] <= 500 && (key === 'width' || Number.isInteger(params[key])))) {
          error.textContent = t('Enter a value from {0} to 500 for {1}.', control.min, t(paramNames[key] ?? key));
          return;
        }
      }
      try {
        if (indicator.id === 'formula') compileScript(params.expression)(chart.bars().slice(0, 60));
      } catch (problem) {
        error.textContent = problem.message;
        return;
      }
      const colors = { ...indicator.colors };
      for (const control of $('dialog-body').querySelectorAll('[data-plot]')) colors[control.dataset.plot] = control.value;
      chart.patchIndicator(indicator.uid, { params, colors, width: Number(width.value) });
      closeDialog();
    } }))]);
}

function indicatorsDialog() {
  const chart = active();
  const input = h('input', { type: 'search', placeholder: t('Search indicators'), 'aria-label': t('Search indicators') });
  const results = h('div', { class: 'results' });
  const current = h('div', { class: 'results' });
  const fill = () => {
    const words = input.value.trim().toLowerCase();
    results.replaceChildren(...registry.filter(item => (item.name + ' ' + t(item.name)).toLowerCase().includes(words)).map(item =>
      h('button', { type: 'button', class: 'result', 'data-indicator': item.id, onclick: () => {
        if (item.id === 'formula') {
          closeDialog();
          return openPanel('script', true);
        }
        chart.addIndicator(item.id);
        toast(t('{0} added to {1}', t(item.name), chart.state.symbol));
        fill();
      } }, h('strong', { text: t(item.name) }),
      h('small', { text: t(item.id === 'formula' ? L('Opens the editor') : item.pane === 'overlay' ? L('On the price pane') : L('In its own pane')) }))));
    current.replaceChildren(...chart.state.indicators.map(item => h('div', { class: 'result' },
      h('strong', { text: indicatorName(item) }),
      h('small', { text: Object.entries(item.params).filter(([key]) => !['expression', 'name', 'overlay'].includes(key)).map(([, value]) => value).join(' · ') }),
      Object.keys(item.params).length ? h('button', { type: 'button', text: t('Settings'), onclick: () => configure(chart, item) }) : null,
      h('button', { type: 'button', text: t(item.hidden ? L('Show') : L('Hide')), onclick: () => {
        chart.patchIndicator(item.uid, { hidden: !item.hidden });
        fill();
      } }),
      h('button', { type: 'button', text: t('Remove'), onclick: () => {
        chart.removeIndicator(item.uid);
        fill();
      } }))));
    if (!chart.state.indicators.length) current.append(hint(t('No indicators on this chart.')));
  };
  input.oninput = fill;
  dialog(t('Indicators'), [input, results, h('h3', { text: t('On this chart') }), current]);
  fill();
  input.focus();
}

// Alerts.
function alertDialog() {
  const chart = active();
  const instrument = find(chart.state.symbol);
  const last = chart.last();
  if (!last) return toast(t('No price is available for {0} yet.', chart.state.symbol));
  const condition = h('select', { id: 'alert-condition' }, Object.entries(conditions).map(([value, text]) => h('option', { value, text: t(text) })));
  const level = h('input', { id: 'alert-price', type: 'number', step: 'any', min: 0, value: last.close.toFixed(instrument.digits ?? 2) });
  const note = h('input', { id: 'alert-note', type: 'text', maxlength: 80, placeholder: t('Optional') });
  const error = h('p', { role: 'alert', class: 'error' });
  dialog(t('Create alert on {0}', chart.state.symbol), [field(t('Condition'), condition), field(t('Price'), level), field(t('Message'), note), error, actions(
    h('button', { type: 'button', id: 'alert-create', class: 'primary', text: t('Create'), onclick: () => {
      const value = Number(level.value);
      if (!(value > 0)) {
        error.textContent = t('Enter a price above zero.');
        return;
      }
      const alert = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), symbol: chart.state.symbol, condition: condition.value,
        price: value, note: note.value.trim(), status: 'active', created: Date.now() };
      state.alerts.unshift(alert);
      closeDialog();
      const now = chart.last();
      if (alert.condition !== 'cross') checkAlerts(alert.symbol, now.close, now.close, now.time);
      if (state.panel !== 'alerts') openPanel('alerts', true);
      afterChange();
    } }))]);
}

function checkAlerts(symbol, previous, current, at) {
  let fired = false;
  for (const alert of state.alerts) {
    if (alert.symbol !== symbol || alert.status !== 'active') continue;
    const hit = alert.condition === 'above' ? current > alert.price : alert.condition === 'below' ? current < alert.price
      : (previous - alert.price) * (current - alert.price) <= 0 && previous !== current;
    if (!hit) continue;
    fired = true;
    alert.status = 'triggered';
    alert.at = at;
    const message = symbol + ' ' + t(conditions[alert.condition]).toLowerCase() + ' ' + price(alert.price, find(symbol)) + (alert.note ? ' · ' + alert.note : '');
    state.log.unshift({ message, at: Date.now() });
    state.log.length = Math.min(state.log.length, 40);
    toast(t('Alert: {0}', message));
  }
  return fired;
}

// Undo history for drawings.
function before() {
  past.push(JSON.stringify(state.drawings));
  if (past.length > 80) past.shift();
  future.length = 0;
}
function travel(from, to) {
  const now = JSON.stringify(state.drawings);
  let next = from.pop();
  while (next === now && from.length) next = from.pop();
  if (next === undefined || next === now) return;
  to.push(now);
  state.drawings = JSON.parse(next);
  afterChange();
}

function setTool(next) {
  tool = next;
  for (const group of toolGroups) {
    const mine = group.tools.find(([name]) => name === next);
    if (mine) lastTool[group.id] = next;
    const [name, label] = group.tools.find(([entry]) => entry === (lastTool[group.id] ?? group.tools[0][0]));
    const control = $('tool-' + group.id);
    setGlyph(control.id, name);
    control.title = group.tools.length > 1 ? t('{0} — select again for more tools', t(label)) : t(label);
    control.setAttribute('aria-label', control.title);
    press(control, Boolean(mine));
  }
  document.body.dataset.tool = next;
  syncReplay();
}

// Paper orders. Market orders fill at the latest price; limit and stop orders wait for a bar to reach them.
function order(symbol, quantity, fill = quote(symbol)) {
  if (!(fill > 0)) {
    toast(t('No price is available for {0} yet.', symbol));
    return false;
  }
  const position = state.paper.positions[symbol] ?? { qty: 0, avg: 0 };
  const total = position.qty + quantity;
  if (position.qty === 0 || Math.sign(position.qty) === Math.sign(quantity)) {
    position.avg = (position.avg * Math.abs(position.qty) + fill * Math.abs(quantity)) / Math.abs(total);
  } else if (Math.abs(quantity) > Math.abs(position.qty)) position.avg = fill;
  position.qty = Math.round(total * 1e8) / 1e8;
  state.paper.cash -= quantity * fill;
  if (position.qty) state.paper.positions[symbol] = position;
  else delete state.paper.positions[symbol];
  state.paper.orders.unshift({ at: Date.now(), symbol, qty: quantity, price: fill });
  state.paper.orders.length = Math.min(state.paper.orders.length, 30);
  toast(t(quantity > 0 ? L('Bought {0} {1} at {2} (simulated)') : L('Sold {0} {1} at {2} (simulated)'), Math.abs(quantity), symbol, price(fill, find(symbol))));
  return true;
}
// Take-profit and stop-loss orders that cancel each other.
function bracket(symbol, quantity, takeProfit, stopLoss) {
  const oco = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  if (takeProfit > 0) state.paper.pending.push({ id: oco + 't', symbol, qty: -quantity, type: 'limit', price: takeProfit, oco });
  if (stopLoss > 0) state.paper.pending.push({ id: oco + 's', symbol, qty: -quantity, type: 'stop', price: stopLoss, oco });
}
function fillOrders(symbol, bar) {
  let filled = false;
  for (const item of state.paper.pending.filter(entry => entry.symbol === symbol)) {
    if (!state.paper.pending.includes(item)) continue;
    const buying = item.qty > 0;
    const reached = item.type === 'limit' ? (buying ? bar.low <= item.price : bar.high >= item.price) : (buying ? bar.high >= item.price : bar.low <= item.price);
    if (!reached) continue;
    state.paper.pending = state.paper.pending.filter(entry => entry !== item && !(item.oco && entry.oco === item.oco));
    order(symbol, item.qty, item.price);
    bracket(symbol, item.qty, item.tp, item.sl);
    filled = true;
  }
  return filled;
}
function submitTicket(side) {
  const symbol = active().state.symbol;
  const number = id => Number($(id).value);
  const quantity = number('trade-qty') * side;
  const type = $('trade-type').value;
  if (!(Math.abs(quantity) > 0)) return toast(t('Enter a quantity above zero.'));
  if (type === 'market') {
    if (order(symbol, quantity)) bracket(symbol, quantity, number('trade-tp'), number('trade-sl'));
  } else {
    if (!(number('trade-price') > 0)) return toast(t('Enter an order price above zero.'));
    state.paper.pending.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), symbol, qty: quantity, type,
      price: number('trade-price'), tp: number('trade-tp') || undefined, sl: number('trade-sl') || undefined });
    toast(t('Order placed. It fills when the price reaches {0}.', price(number('trade-price'), find(symbol))));
  }
  afterChange();
}

// Bar replay.
function pause() {
  clearInterval(timer);
  timer = null;
  syncReplay();
}
function step() {
  const chart = active();
  const previous = chart.last().close;
  if (!chart.replayStep()) return pause();
  const bar = chart.last();
  checkAlerts(chart.state.symbol, previous, bar.close, bar.time);
  fillOrders(chart.state.symbol, bar);
  if (chart.replayDone) pause();
  afterChange();
}
function syncReplay() {
  const chart = active();
  if (!chart) return;
  $('replaybar').hidden = !chart.replaying;
  press($('replay'), chart.replaying);
  $('replay-play').textContent = t(timer ? L('Pause') : L('Play'));
  $('replay-play').disabled = $('replay-step').disabled = chart.replayDone;
  press($('replay-pick'), tool === 'replay');
}

// Live data: started only when the visitor has turned it on.
const liveKeys = () => new Set(charts.filter(chart => find(chart.state.symbol).live).map(chart => chart.state.symbol + '|' + chart.state.interval));
// Refreshes the open panel at most once a second while live prices arrive.
function later() {
  refresh ??= setTimeout(() => {
    refresh = null;
    renderPanel();
  }, 1000);
  refresh.unref?.();
}
function syncLive() {
  if (state.settings.live && !live) {
    live = createLive({
      onData: symbol => {
        charts.filter(chart => chart.state.symbol === symbol).forEach(chart => chart.tick());
        live?.watch(liveKeys());
        later();
      },
      onTick: (symbol, minutes, previous, bar) => {
        const fired = checkAlerts(symbol, previous, bar.close, bar.time);
        const filled = fillOrders(symbol, bar);
        charts.filter(chart => chart.state.symbol === symbol && chart.state.interval === minutes && !chart.replaying).forEach(chart => chart.tick());
        if (fired || filled) afterChange();
        else later();
      }
    });
    useLive(live);
  } else if (!state.settings.live && live) {
    live.stop();
    live = null;
    useLive(null);
  }
  live?.watch(liveKeys());
}

// Chart grid.
function buildCharts() {
  const spec = layouts[state.layout];
  while (state.charts.length < spec.count) state.charts.push(structuredClone(state.charts[state.active] ?? state.charts[0]));
  state.active = Math.min(state.active, spec.count - 1);
  const root = $('charts');
  root.className = 'layout-' + state.layout;
  root.replaceChildren();
  pause();
  charts = state.charts.slice(0, spec.count).map(chartState => {
    const cell = h('div', { class: 'cell' });
    root.append(cell);
    return createChart(cell, chartState, {
      store: state, colors, time, before, configure, t,
      tool: () => tool,
      toolDone: () => tool !== 'cursor' && setTool('cursor'),
      status: chart => !find(chart.symbol).live ? null : !state.settings.live ? t('Live data is turned off. Turn it on in Settings.')
        : live?.status(chart.symbol, chart.interval) === 'error' ? t('Live data is unavailable right now.') : t('Loading live data…'),
      askText: done => {
        const input = h('input', { type: 'text', id: 'note-text', maxlength: 60 });
        const confirm = () => {
          closeDialog();
          done(input.value.trim());
        };
        input.onkeydown = event => event.key === 'Enter' && confirm();
        dialog(t('Text note'), [field(t('Text'), input), actions(h('button', { type: 'button', class: 'primary', text: t('Place'), onclick: confirm }))]);
        input.focus();
      },
      activate: chart => {
        const index = charts.indexOf(chart);
        if (index < 0 || index === state.active) return;
        state.active = index;
        pause();
        afterChange();
      },
      crosshair: (chart, at) => {
        if (state.settings.syncCross) charts.forEach(other => other !== chart && other.crossAt(at));
        if (state.panel === 'data' && chart === active()) renderWindow();
      },
      changed: kind => {
        if (kind === 'state') propagate(charts.find(chart => chart.state === chartState));
        afterChange(kind);
      }
    });
  });
}
let syncing = false;
function propagate(source) {
  if (syncing || !source) return;
  syncing = true;
  for (const chart of charts) {
    if (chart === source) continue;
    const patch = {};
    if (state.settings.syncSymbol && chart.state.symbol !== source.state.symbol) patch.symbol = source.state.symbol;
    if (state.settings.syncInterval && chart.state.interval !== source.state.interval) patch.interval = source.state.interval;
    if (Object.keys(patch).length) chart.set(patch);
  }
  syncing = false;
}

// Called after anything changes: persists, then refreshes toolbars and the open panel.
function afterChange(kind) {
  save();
  syncLive();
  applyLook();
  if (kind !== 'selection' && kind !== 'state' && kind !== 'replay' && kind !== 'view') charts.forEach(chart => chart.render());
  const chart = active();
  if (!chart) return;
  charts.forEach((item, index) => item.host.classList.toggle('active', charts.length > 1 && index === state.active));
  const instrument = find(chart.state.symbol);
  setLabel('symbol', chart.state.symbol);
  setLabel('interval', intervalLabel(chart.state.interval));
  setLabel('style', t(chart.state.style));
  $('status').textContent = instrument.live ? t('Live data') + ' · ' + instrument.source : t('Simulated data');
  $('undo').disabled = !past.length;
  $('redo').disabled = !future.length;
  press($('log'), chart.state.log);
  press($('auto'), chart.autoScale);
  const drawing = (state.drawings[chart.state.symbol] ?? []).find(item => item.id === chart.selected);
  $('drawbar').hidden = !drawing;
  if (drawing) {
    $('draw-color').value = drawing.color ?? state.settings.drawColor ?? '#3b82f6';
    $('draw-width').value = String(drawing.width ?? 1.5);
    $('draw-dash').value = drawing.dash ?? 'solid';
  }
  setLabel('zone', t(zones[state.settings.tz]));
  for (const name of ['magnet', 'keep', 'lock', 'hide']) press($('toggle-' + name), state.settings[name]);
  syncReplay();
  renderPanel();
}

function quickActions() {
  const primary = ['symbol', 'interval', 'style', 'indicators', 'compare', 'alert', 'replay',
    'layout', 'layouts', 'snapshot', 'fullscreen', 'settings', 'language', 'theme'];
  const controls = [...primary, ...panels.map(([name]) => 'panel-' + name)]
    .map(id => $(id)).filter(control => control && !control.hidden);
  const input = h('input', { type: 'search', id: 'action-query', placeholder: t('Find a workspace action'),
    'aria-label': t('Find a workspace action') });
  const results = h('div', { class: 'action-results', id: 'action-results' });
  const choose = control => {
    closeDialog();
    control.focus();
    control.click();
  };
  const fill = () => {
    const query = input.value.trim().toLocaleLowerCase();
    results.replaceChildren(...controls.filter(control =>
      control.getAttribute('aria-label').toLocaleLowerCase().includes(query)
    ).map(control => h('button', {
      type: 'button', class: 'action-result', onclick: () => choose(control)
    }, h('span', { text: control.getAttribute('aria-label') }), h('span', { text: '↗', 'aria-hidden': 'true' }))));
    if (!results.children.length) results.append(hint(t('No matching actions.')));
  };
  input.oninput = fill;
  input.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      const first = results.querySelector('button');
      if (!first) return;
      event.preventDefault();
      if (event.key === 'Enter') first.click();
      else first.focus();
    }
  };
  dialog(t('Quick actions'), [input, results]);
  fill();
  input.focus();
}

// Toolbars.
function build() {
  const gap = () => h('span', { class: 'gap' });
  const pickSymbol = query => symbolDialog(t('Symbol search'), item => active().set({ symbol: item.symbol }), { query });
  $('top').append(
    h('a', { class: 'brand', href: './', 'aria-label': t('Meridian home') }, h('span', { class: 'mark', text: '◈', 'aria-hidden': 'true' }),
      h('span', { class: 'wordmark', text: 'Meridian', 'aria-hidden': 'true' })),
    button('quick-actions', { glyph: 'search', label: t('Quick actions'), text: t('Quick actions'), run: quickActions }),
    button('symbol', { glyph: 'search', label: t('Symbol search'), text: '', always: true, run: () => pickSymbol() }),
    button('compare', { glyph: 'compare', label: t('Compare symbols'), run: () => symbolDialog(t('Compare with {0}', active().state.symbol), item => {
      if (item.symbol !== active().state.symbol) active().toggleCompare(item.symbol);
    }, { simulatedOnly: true }) }),
    gap(),
    button('interval', { label: t('Interval'), text: '', always: true, run: anchor => menu(anchor, intervals.map(minutes => ({
      label: t(intervalNames[minutes]), checked: minutes === active().state.interval, run: () => active().set({ interval: minutes }) }))) }),
    button('style', { glyph: 'candle', label: t('Chart type'), text: '', run: anchor => menu(anchor, styles.map(name => ({
      label: t(name), checked: name === active().state.style, run: () => active().set({ style: name }) }))) }),
    button('indicators', { glyph: 'indicators', label: t('Indicators and formulas'), text: t('Indicators'), run: indicatorsDialog }),
    button('alert', { glyph: 'alert', label: t('Create alert'), text: t('Alert'), run: alertDialog }),
    button('replay', { glyph: 'replay', label: t('Bar replay'), text: t('Replay'), run: () => {
      pause();
      if (active().replaying) active().replayStop();
      else active().replayStart();
    } }),
    gap(),
    button('undo', { glyph: 'undo', label: t('Undo drawing change'), run: () => travel(past, future) }),
    button('redo', { glyph: 'redo', label: t('Redo drawing change'), run: () => travel(future, past) }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'chip status', id: 'status' }),
    button('layout', { glyph: 'layout', label: t('Layout setup'), run: anchor => menu(anchor, [
      ...['1', '2h', '2v', '3', '4'].map(key => ({ label: t(layouts[key].name), checked: key === state.layout, run: () => {
        state.layout = key;
        buildCharts();
        afterChange();
      } })), '-',
      ...[['syncSymbol', L('Sync symbol')], ['syncInterval', L('Sync interval')], ['syncCross', L('Sync crosshair')]].map(([key, label]) => ({
        label: t(label), checked: state.settings[key], run: () => {
          state.settings[key] = !state.settings[key];
          propagate(active());
          afterChange();
        } }))]) }),
    button('layouts', { glyph: 'save', label: t('Save and load layouts'), run: anchor => menu(anchor, [
      { label: t('Save layout as…'), run: saveLayoutDialog },
      ...(Object.keys(state.saved).length ? [{ heading: t('Load') }] : []),
      ...Object.keys(state.saved).map(name => ({ label: name, run: () => {
        const copy = structuredClone(state.saved[name]);
        state.layout = copy.layout;
        state.charts = copy.charts;
        state.active = 0;
        buildCharts();
        afterChange();
        toast(t('Layout "{0}" loaded', name));
      } })),
      ...(Object.keys(state.saved).length ? [{ heading: t('Delete') }] : []),
      ...Object.keys(state.saved).map(name => ({ label: t('Delete {0}', name), run: () => {
        delete state.saved[name];
        afterChange();
      } }))]) }),
    button('snapshot', { glyph: 'camera', label: t('Download chart image'), run: snapshot }),
    button('fullscreen', { glyph: 'full', label: t('Full screen'), run: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    } }),
    button('settings', { glyph: 'gear', label: t('Settings'), run: settingsDialog }),
    button('language', { glyph: 'globe', label: t('Language: {0}', locale.name), text: locale.short, always: true, run: anchor => {
      const entry = item => ({ label: item.name, lang: item.tag, checked: item.tag === locale.tag, run: () => {
        state.locale = item.tag;
        save();
        view.location.reload();
      } });
      menu(anchor, [...locales.filter(item => item.reviewed).map(entry), { heading: t('Machine-translated, not yet reviewed') },
        ...locales.filter(item => !item.reviewed).map(entry)]);
    } }),
    button('theme', { glyph: 'sun', label: t('Use dark theme'), run: () => {
      state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      save();
    } })
  );

  $('tools').append(
    ...toolGroups.map(group => {
      const control = button('tool-' + group.id, { glyph: group.tools[0][0], label: t(group.tools[0][1]), run: anchor => {
        const current = group.tools.some(([name]) => name === tool);
        if (group.tools.length > 1 && current) {
          menu(anchor, group.tools.map(([name, label]) => ({ label: t(label), checked: name === tool, run: () => setTool(name) })), 'right');
        } else setTool(lastTool[group.id] ?? group.tools[0][0]);
      } });
      if (group.tools.length > 1) control.classList.add('more');
      return control;
    }),
    h('hr'),
    ...[['magnet', 'magnet', L('Magnet: snap drawings to open, high, low or close')], ['keep', 'keep', L('Stay in drawing mode')],
      ['lock', 'lock', L('Lock all drawings')], ['hide', 'eye', L('Hide all drawings')]].map(([key, glyph, label]) =>
      button('toggle-' + key, { glyph, label: t(label), run: () => {
        state.settings[key] = !state.settings[key];
        afterChange();
      } })),
    button('remove', { glyph: 'trash', label: t('Remove objects'), run: anchor => menu(anchor, [
      { label: t('Remove selected drawing'), run: () => active().removeSelected() },
      { label: t('Remove all drawings on {0}', active().state.symbol), run: () => {
        before();
        state.drawings[active().state.symbol] = [];
        afterChange();
      } },
      { label: t('Remove all indicators'), run: () => active().set({ indicators: [] }) }], 'right') })
  );

  $('bottom').append(
    ...ranges.map(([label, interval, count, name]) => h('button', { type: 'button', 'data-range': label, title: t(name), 'aria-label': t(name), text: t(label), onclick: () => {
      active().set({ interval });
      active().showBars(count);
    } })),
    button('goto', { label: t('Go to date'), text: t('Go to…'), always: true, run: gotoDialog }),
    h('span', { class: 'spacer' }),
    button('scroll-left', { glyph: 'left', label: t('Scroll to earlier bars'), run: () => active().scroll(-20) }),
    button('scroll-right', { glyph: 'right', label: t('Scroll to later bars'), run: () => active().scroll(20) }),
    button('latest', { glyph: 'latest', label: t('Scroll to the most recent bar'), run: () => active().fit(false) }),
    button('zoom-out', { glyph: 'zoomOut', label: t('Zoom out'), run: () => active().zoom(0.8) }),
    button('zoom-in', { glyph: 'zoomIn', label: t('Zoom in'), run: () => active().zoom(1.25) }),
    button('fit', { label: t('Reset chart view'), text: t('Reset'), always: true, run: () => active().fit() }),
    button('price-in', { glyph: 'priceIn', label: t('Stretch the price scale'), run: () => active().scalePrice(0.8) }),
    button('price-out', { glyph: 'priceOut', label: t('Compress the price scale'), run: () => active().scalePrice(1.25) }),
    button('auto', { label: t('Automatic price scale'), text: t('Auto'), always: true, run: () => active().setAutoScale(!active().autoScale) }),
    button('log', { label: t('Logarithmic price scale'), text: t('Log'), always: true, run: () => active().set({ log: !active().state.log }) }),
    button('zone', { label: t('Time zone'), text: '', always: true, run: anchor => menu(anchor, Object.entries(zones).map(([key, label]) => ({
      label: t(label), checked: key === state.settings.tz, run: () => {
        state.settings.tz = key;
        afterChange();
      } }))) })
  );

  $('rail').append(...panels.map(([name, glyph, label]) => button('panel-' + name, { glyph, label: t(label), run: () => openPanel(name) })));
  for (const section of $('panel').querySelectorAll('section[data-panel]')) {
    const header = section.querySelector('.panel-head');
    if (!header) continue;
    const name = section.dataset.panel;
    const close = button('close-panel-' + name, { label: t('Close'), run: () => {
      openPanel(name);
      $('panel-' + name).focus();
    } });
    close.className = 'panel-close';
    close.textContent = '×';
    header.append(close);
  }
  return pickSymbol;
}

function saveLayoutDialog() {
  const input = h('input', { type: 'text', id: 'layout-name', maxlength: 30, value: active().state.symbol + ' ' + t(layouts[state.layout].name).toLowerCase() });
  const confirm = () => {
    const name = input.value.trim();
    if (!name) return;
    state.saved[name] = structuredClone({ layout: state.layout, charts: state.charts.slice(0, layouts[state.layout].count) });
    closeDialog();
    afterChange();
    toast(t('Layout "{0}" saved on this device', name));
  };
  input.onkeydown = event => event.key === 'Enter' && confirm();
  dialog(t('Save layout'), [field(t('Name'), input), actions(h('button', { type: 'button', class: 'primary', id: 'layout-save', text: t('Save'), onclick: confirm }))]);
  input.select();
}

function gotoDialog() {
  const bars = active().bars();
  if (!bars.length) return;
  const day = value => new Date(value).toISOString().slice(0, 10);
  const input = h('input', { type: 'date', id: 'goto-date', min: day(bars[0].time), max: day(bars.at(-1).time), value: day(bars.at(-1).time) });
  dialog(t('Go to date'), [field(t('Date (UTC)'), input), actions(h('button', { type: 'button', class: 'primary', text: t('Go'), onclick: () => {
    if (!input.value) return;
    closeDialog();
    active().goTo(Date.parse(input.value + 'T00:00:00Z'));
  } }))]);
}

function settingsDialog() {
  const changed = () => {
    applyTheme();
    afterChange();
  };
  const flag = (key, label, id) => {
    const control = h('input', { type: 'checkbox', id, checked: Boolean(state.settings[key]), onchange: () => {
      state.settings[key] = control.checked;
      if (key === 'live' && control.checked) {
        for (const symbol of ['BTCUSDT', 'ETHUSDT']) if (!state.watchlist.includes(symbol)) state.watchlist.push(symbol);
        toast(t('Live symbols were added to your watchlist.'));
      }
      propagate(active());
      afterChange();
    } });
    return h('label', { class: 'check' }, control, label);
  };
  const choice = (label, options, value, set, id) => {
    const control = h('select', { id, onchange: () => {
      set(control.value);
      changed();
    } }, Object.entries(options).map(([key, text]) => h('option', { value: key, text: t(text), selected: key === String(value) })));
    return field(label, control);
  };
  const colour = (label, read, write, id) => {
    const control = h('input', { type: 'color', id, value: read(), oninput: () => {
      write(control.value);
      changed();
    } });
    return field(label, control);
  };
  const shown = (id, label) => {
    const control = h('input', { type: 'checkbox', 'data-show': id, checked: !state.hidden.includes(id), onchange: () => {
      state.hidden = control.checked ? state.hidden.filter(entry => entry !== id) : [...state.hidden, id];
      if (!control.checked && id === 'panel-' + state.panel) state.panel = null;
      applyPanel();
      afterChange();
    } });
    return h('label', { class: 'check' }, control, label);
  };
  const group = (title, ...rows) => h('section', { class: 'group' }, h('h3', { text: title }), rows);
  const now = colors();
  dialog(t('Settings'), [
    group(t('Appearance'),
      choice(t('Theme'), themes, state.theme ?? 'auto', value => { state.theme = value === 'auto' ? null : value; }, 'look-theme'),
      choice(t('Size of controls and text'), densities, state.look.density, value => { state.look.density = value; }, 'look-density'),
      colour(t('Accent colour'), () => state.look.accent ?? now.accent, value => { state.look.accent = value; }, 'look-accent'),
      colour(t('Rising colour'), () => state.look.up ?? now.up, value => { state.look.up = value; }, 'look-up'),
      colour(t('Falling colour'), () => state.look.down ?? now.down, value => { state.look.down = value; }, 'look-down'),
      actions(h('button', { type: 'button', id: 'look-reset', text: t('Use default colours'), onclick: () => {
        Object.assign(state.look, { accent: null, up: null, down: null });
        changed();
        settingsDialog();
      } }))),
    group(t('Chart'),
      flag('grid', t('Show grid lines')), flag('priceLine', t('Show the last price line')), flag('legend', t('Show the legend')),
      choice(t('Crosshair'), crosshairs, state.settings.crosshair, value => { state.settings.crosshair = value; }),
      colour(t('Colour of new drawings'), () => state.settings.drawColor ?? '#3b82f6', value => { state.settings.drawColor = value; }, 'draw-default'),
      choice(t('Line width of new drawings'), strokes, state.settings.drawWidth ?? '', value => { state.settings.drawWidth = value ? Number(value) : null; }),
      flag('syncCross', t('Sync crosshair across charts')), flag('syncSymbol', t('Sync symbol across charts')), flag('syncInterval', t('Sync interval across charts'))),
    group(t('Layout'),
      choice(t('Side panel position'), sides, state.settings.panelSide, value => { state.settings.panelSide = value; }, 'look-side'),
      flag('tools', t('Show the drawing toolbar'), 'look-tools'), flag('bottom', t('Show the bottom bar')),
      choice(t('Time zone'), zones, state.settings.tz, value => { state.settings.tz = value; }),
      hint(t('Drag the price axis to stretch prices and the time axis to stretch time. Drag the line above an indicator pane to resize it, and the edge of the side panel to widen it. Double-click the price axis to return to automatic scaling.'))),
    group(t('Toolbar buttons'), ...optional.map(([id, label]) => shown(id, t(label)))),
    group(t('Side panels'), ...panels.map(([name, , label]) => shown('panel-' + name, t(label)))),
    group(t('Live data'),
      flag('live', t('Show live crypto prices from Binance'), 'live-toggle'),
      hint(t('When this is on, your browser connects directly to the public market data service of Binance to load and stream prices for five crypto pairs. Meridian does not relay or store that data, and your use of it is subject to the terms of Binance.') + ' ',
        h('a', { href: liveTerms, target: '_blank', rel: 'noopener', text: t('Binance terms') }))),
    group(t('Keyboard'),
      hint(t('Type a letter to search symbols. On a focused chart: arrow keys inspect bars, + and − zoom, Home and End jump, Delete removes the selected drawing, Escape cancels. Ctrl+Z and Ctrl+Y undo and redo drawings.')),
      hint(t('Up and Down move the price scale.'))),
    group(t('Preferences'),
      hint(t('Restores automatic language and theme, the default layout and watchlist, and removes drawings, alerts, saved layouts and the paper account from this browser.')),
      actions(h('button', { type: 'button', id: 'reset', class: 'danger', text: t('Reset preferences'), onclick: () => {
        const translated = state.locale !== null;
        try {
          localStorage.removeItem(KEY);
          localStorage.removeItem('meridian.v1');
        } catch {}
        state = defaults();
        past.length = future.length = 0;
        closeDialog();
        applyTheme();
        buildCharts();
        applyPanel();
        afterChange();
        if (translated && detect().tag !== locale.tag) view.location.reload();
      } })))
  ], true);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function snapshot() {
  const shot = active().snapshot();
  if (!shot) return;
  const name = 'meridian-' + active().state.symbol + '-' + intervalLabel(active().state.interval);
  const vector = new Blob([shot.markup], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(vector);
  const image = new view.Image();
  image.onload = () => {
    const canvas = h('canvas', { width: shot.width * 2, height: shot.height * 2 });
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(bitmap => download(bitmap ?? vector, name + (bitmap ? '.png' : '.svg')));
  };
  image.onerror = () => download(vector, name + '.svg');
  image.src = url;
}

// Sharing: the layout travels inside the link, so nothing is uploaded.
function shareLink() {
  const shown = state.charts.slice(0, layouts[state.layout].count);
  const payload = { v: 1, layout: state.layout, charts: shown, drawings: Object.fromEntries(shown.map(chart => [chart.symbol, state.drawings[chart.symbol] ?? []])) };
  let binary = '';
  for (const byte of new TextEncoder().encode(JSON.stringify(payload))) binary += String.fromCharCode(byte);
  const here = view.location;
  return here.origin + here.pathname + '#share=' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function openShared(hash) {
  if (!hash.startsWith('#share=')) return false;
  try {
    const binary = atob(hash.slice(7).replaceAll('-', '+').replaceAll('_', '/'));
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    const shared = cleanCharts(payload.charts);
    if (payload.v !== 1 || !shared.length) return false;
    state.saved[t('Before shared link')] = structuredClone({ layout: state.layout, charts: state.charts.slice(0, layouts[state.layout].count) });
    state.layout = layouts[payload.layout]?.count === shared.length ? payload.layout : '1';
    state.charts = shared;
    state.active = 0;
    Object.assign(state.drawings, cleanDrawings(payload.drawings));
    return true;
  } catch {
    return false;
  }
}

// Side panels.
function applyPanel() {
  document.body.dataset.panel = state.panel ?? '';
  for (const section of $('panel').querySelectorAll('section')) section.hidden = section.dataset.panel !== state.panel;
  for (const [name] of panels) press($('panel-' + name), name === state.panel);
}
function openPanel(name, force) {
  state.panel = state.panel === name && !force ? null : name;
  applyPanel();
  save();
  renderPanel(true);
}
const pairs = rows => rows.flatMap(([label, value, className]) => [h('dt', { text: label }), h('dd', { text: value, class: className })]);

function renderWatch() {
  const container = $('symbols');
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.symbol : null;
  const current = active().state.symbol;
  container.replaceChildren(...state.watchlist.map(symbol => {
    const item = find(symbol);
    const data = stats(item);
    return h('div', { class: 'symbol-row' },
      h('button', { type: 'button', class: 'symbol', 'data-symbol': symbol, 'aria-pressed': String(symbol === current), onclick: () => active().set({ symbol }) },
        h('span', {}, h('strong', { text: symbol }), h('small', { text: item.name })),
        h('span', { class: 'num', text: data ? price(data.last, item) : '…' }), h('span', { class: 'num ' + (data ? tone(data.change) : ''), text: data ? signed(data.change) : '' })),
      h('button', { type: 'button', class: 'ghost', 'aria-label': t('Remove {0} from watchlist', symbol), text: '✕', onclick: () => {
        state.watchlist = state.watchlist.filter(entry => entry !== symbol);
        afterChange();
      } }));
  }));
  if (!state.watchlist.length) container.append(hint(t('Your watchlist is empty. Use Add symbol.')));
  if (focused) container.querySelector('[data-symbol="' + focused + '"]')?.focus();

  const item = find(current);
  const data = stats(item);
  if (!data) return $('details').replaceChildren(h('h3', { text: item.name }), hint(t(state.settings.live ? L('Loading live data…') : L('Live data is turned off. Turn it on in Settings.'))));
  const place = (data.last - data.bar.low) / ((data.bar.high - data.bar.low) || 1) * 100;
  $('details').replaceChildren(
    h('p', { class: 'eyebrow', text: t(item.type) + ' · ' + (item.live ? t('Live') + ' · ' + item.source : t('Simulated')) + ' · ' + t('Daily') }), h('h3', { text: item.name }),
    h('p', { class: 'big' }, h('strong', { text: price(data.last, item) }), ' ', h('span', { class: tone(data.change), text: signed(data.change) })),
    h('div', { class: 'range', role: 'img', 'aria-label': t('Day range {0} to {1}', price(data.bar.low, item), price(data.bar.high, item)) },
      h('span', { text: price(data.bar.low, item) }), h('i', {}, h('b', { style: 'left:' + place.toFixed(1) + '%' })), h('span', { text: price(data.bar.high, item) })),
    h('dl', {}, pairs([[t('Volume'), data.bar.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })], [t('1 week'), signed(data.week)], [t('1 month'), signed(data.month)],
      ['RSI 14', data.rsi.toFixed(1)], [t('Period high'), price(data.high, item)], [t('Period low'), price(data.low, item)]])));
}

function renderAlerts() {
  $('alert-list').replaceChildren(...state.alerts.map(alert => h('div', { class: 'card ' + alert.status },
    h('strong', { text: alert.symbol + ' · ' + t(conditions[alert.condition]) + ' ' + price(alert.price, find(alert.symbol)) }),
    h('small', { text: (alert.status === 'active' ? t('Active') : t('Triggered on bar {0}', time(alert.at, 'full'))) + (alert.note ? ' · ' + alert.note : '') }),
    h('span', { class: 'card-actions' },
      alert.status === 'triggered' && h('button', { type: 'button', text: t('Re-arm'), onclick: () => {
        alert.status = 'active';
        afterChange();
      } }),
      h('button', { type: 'button', text: t('Delete'), 'aria-label': t('Delete alert on {0}', alert.symbol), onclick: () => {
        state.alerts = state.alerts.filter(entry => entry !== alert);
        afterChange();
      } })))));
  if (!state.alerts.length) $('alert-list').append(hint(t('No alerts yet.')));
  $('alert-log').replaceChildren(...state.log.map(entry => h('p', { class: 'log', text: time(entry.at, 'full') + ' — ' + entry.message })));
  if (!state.log.length) $('alert-log').append(hint(t('Nothing has triggered.')));
}

function renderWindow() {
  const chart = active();
  const bars = chart.bars();
  if (!bars.length) return $('window').replaceChildren();
  const index = Math.max(0, Math.min(bars.length - 1, chart.crossIndex ?? bars.length - 1));
  const bar = bars[index];
  const item = find(chart.state.symbol);
  const change = (bar.close / (bars[index - 1] ?? bar).close - 1) * 100;
  const rows = [[t('Time'), time(bar.time, 'full')], [t('Open'), price(bar.open, item)], [t('High'), price(bar.high, item)], [t('Low'), price(bar.low, item)],
    [t('Close'), price(bar.close, item)], [t('Change'), signed(change)], [t('Volume'), bar.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })]];
  for (const indicator of chart.state.indicators.filter(entry => entry.id !== 'volume' && !entry.hidden)) {
    for (const plot of chart.plots(indicator)) {
      const value = plot.values[index];
      rows.push([plot.label, value === null || value === undefined || Number.isNaN(value) ? '–' : value.toLocaleString('en-US', { maximumFractionDigits: 4 })]);
    }
  }
  $('window').replaceChildren(...pairs(rows));
}

function renderData() {
  renderWindow();
  const chart = active();
  const item = find(chart.state.symbol);
  const entry = (label, detail, remove, select) => h('div', { class: 'card' },
    select ? h('button', { type: 'button', class: 'link', text: label, onclick: select }) : h('strong', { text: label }),
    h('small', { text: detail }),
    h('span', { class: 'card-actions' }, h('button', { type: 'button', text: t('Remove'), 'aria-label': t('Remove {0}', label), onclick: remove })));
  const drawings = state.drawings[chart.state.symbol] ?? [];
  $('objects').replaceChildren(
    ...chart.state.indicators.map(indicator => entry(indicatorName(indicator),
      t('Indicator') + ' · ' + t(paneOf(indicator) === 'overlay' ? 'On the price pane' : 'In its own pane'), () => chart.removeIndicator(indicator.uid))),
    ...chart.state.compare.map(symbol => entry(symbol, t('Comparison'), () => chart.toggleCompare(symbol))),
    ...drawings.map(drawing => entry(t(drawingNames[drawing.type]) + (drawing.text ? ' “' + drawing.text + '”' : ''),
      t('Drawing') + ' · ' + price(drawing.points[0].p, item) + (drawing.id === chart.selected ? ' · ' + t('selected') : ''), () => {
        before();
        state.drawings[chart.state.symbol] = drawings.filter(other => other !== drawing);
        afterChange();
      }, () => {
        chart.select(drawing.id);
        renderData();
      })));
  if (!$('objects').children.length) $('objects').append(hint(t('No indicators or drawings on this chart.')));
  $('data').replaceChildren(...chart.visible().slice(-300).reverse().map(bar => h('tr', {},
    ...[time(bar.time, 'full'), ...[bar.open, bar.high, bar.low, bar.close].map(value => price(value, item)), bar.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })]
      .map(text => h('td', { text })))));
}

function renderScreener() {
  const type = $('screen-type').value;
  const move = $('screen-move').value;
  const strength = $('screen-rsi').value;
  const rows = instruments.map(item => ({ item, symbol: item.symbol, ...stats(item) }))
    .filter(row => (!type || row.item.type === type) && (!move || (move === 'up') === (row.change >= 0)) &&
      (!strength || (strength === 'high' ? row.rsi > 70 : row.rsi < 30)))
    .sort((a, b) => (typeof a[sort.key] === 'string' ? a[sort.key].localeCompare(b[sort.key]) : a[sort.key] - b[sort.key]) * (sort.down ? -1 : 1));
  $('screen').tHead.rows[0].replaceChildren(...columns.map(([key, label]) => h('th', { scope: 'col',
    'aria-sort': sort.key === key ? (sort.down ? 'descending' : 'ascending') : null },
    h('button', { type: 'button', class: 'link', text: t(label) + (sort.key === key ? (sort.down ? ' ↓' : ' ↑') : ''), onclick: () => {
      sort.down = sort.key === key ? !sort.down : key !== 'symbol';
      sort.key = key;
      renderScreener();
    } }))));
  $('screen').tBodies[0].replaceChildren(...rows.map(row => h('tr', {},
    h('td', {}, h('button', { type: 'button', class: 'link', title: row.item.name, text: row.symbol, onclick: () => active().set({ symbol: row.symbol }) })),
    h('td', { text: price(row.last, row.item) }), ...['change', 'week', 'month'].map(key => h('td', { class: tone(row[key]), text: signed(row[key]) })),
    h('td', { text: row.rsi.toFixed(1) }), h('td', { class: tone(row.trend), text: signed(row.trend, 1) }))));
  if (!rows.length) $('screen').tBodies[0].append(h('tr', {}, h('td', { colspan: columns.length, text: t('No symbols match these filters.') })));
}

function runBacktest() {
  const chart = active();
  const bars = chart.bars();
  const item = find(chart.state.symbol);
  let result;
  try {
    const script = compileScript($('script-source').value);
    if (!script.strategy) throw new SyntaxError(t('Add a "buy when" line and a "sell when" line to run a backtest.'));
    if (bars.length < 2) throw new RangeError(t('No price is available for {0} yet.', chart.state.symbol));
    result = script(bars);
  } catch (problem) {
    $('script-error').textContent = problem.message;
    return;
  }
  $('script-error').textContent = '';
  const report = backtest(bars, result.buy, result.sell);
  chart.setMarkers([...report.trades.flatMap(trade => [{ time: trade.entryTime, side: 'buy' }, { time: trade.exitTime, side: 'sell' }]),
    ...(report.open ? [{ time: report.open.entryTime, side: 'buy' }] : [])]);
  const percent = value => value === null ? '–' : signed(value * 100);
  const low = Math.min(...report.equity);
  const high = Math.max(...report.equity);
  const stride = Math.max(1, Math.floor(report.equity.length / 300));
  const points = report.equity.filter((_, index) => index % stride === 0)
    .map((value, index, all) => (index / Math.max(1, all.length - 1) * 280).toFixed(1) + ',' + (58 - (value - low) / ((high - low) || 1) * 54).toFixed(1)).join(' ');
  $('backtest').replaceChildren(
    h('h3', { text: t('Backtest of {0}, {1}', chart.state.symbol, intervalLabel(chart.state.interval)) }),
    h('dl', {}, pairs([[t('Net profit'), percent(report.net), tone(report.net)], [t('Buy and hold'), percent(report.buyHold), tone(report.buyHold)],
      [t('Closed trades'), String(report.trades.length)], [t('Winning trades'), report.winRate === null ? '–' : (report.winRate * 100).toFixed(0) + '%'],
      [t('Profit factor'), report.profitFactor === null ? '–' : report.profitFactor.toFixed(2)], [t('Largest drawdown'), (report.drawdown * 100).toFixed(2) + '%'],
      [t('Final equity'), money(report.equity.at(-1))]])),
    h('div', { class: 'equity', role: 'img', 'aria-label': t('Equity curve from {0} to {1}', money(report.capital), money(report.equity.at(-1))),
      html: '<svg viewBox="0 0 280 60" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="' + points + '"/></svg>' }),
    hint(t('Long only. Each signal fills at the open of the next bar with the whole balance and a 0.1% fee per side. Past results on this data say nothing about future results.')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, [t('Entry'), t('Exit'), t('Result')].map(text => h('th', { scope: 'col', text })))),
      h('tbody', {}, report.trades.slice(-40).reverse().map(trade => h('tr', {},
        h('td', { text: time(trade.entryTime, 'full') + ' · ' + price(trade.entryPrice, item) }), h('td', { text: time(trade.exitTime, 'full') + ' · ' + price(trade.exitPrice, item) }),
        h('td', { class: tone(trade.change), text: percent(trade.change) })))))),
    report.open ? hint(t('A position opened on {0} is still open and is valued at the last close.', time(report.open.entryTime, 'full'))) : null);
}

function renderTrade() {
  const open = Object.entries(state.paper.positions);
  const value = symbol => quote(symbol) ?? state.paper.positions[symbol].avg;
  const worth = open.reduce((sum, [symbol, position]) => sum + position.qty * value(symbol), 0);
  const profit = open.reduce((sum, [symbol, position]) => sum + position.qty * (value(symbol) - position.avg), 0);
  $('account').replaceChildren(...pairs([[t('Equity'), money(state.paper.cash + worth)], [t('Cash'), money(state.paper.cash)], [t('Open profit and loss'), money(profit)]]));
  const symbol = active().state.symbol;
  $('trade-buy').textContent = t('Buy {0}', symbol);
  $('trade-sell').textContent = t('Sell {0}', symbol);
  $('trade-price-field').hidden = $('trade-type').value === 'market';
  $('positions').replaceChildren(...open.map(([name, position]) => {
    const gain = position.qty * (value(name) - position.avg);
    return h('div', { class: 'card' }, h('strong', { text: t(position.qty > 0 ? 'Long' : 'Short') + ' ' + Math.abs(position.qty) + ' ' + name }),
      h('small', {}, t('Average {0}', price(position.avg, find(name))) + ' · ', h('span', { class: tone(gain), text: money(gain) })),
      h('span', { class: 'card-actions' }, h('button', { type: 'button', text: t('Close'), 'aria-label': t('Close {0} position', name), onclick: () => {
        order(name, -position.qty);
        afterChange();
      } })));
  }));
  if (!open.length) $('positions').append(hint(t('No open positions.')));
  $('pending').replaceChildren(...state.paper.pending.map(item => h('div', { class: 'card' },
    h('strong', { text: t(item.qty > 0 ? 'Buy' : 'Sell') + ' ' + Math.abs(item.qty) + ' ' + item.symbol }),
    h('small', { text: t(item.type === 'limit' ? L('Limit at {0}') : L('Stop at {0}'), price(item.price, find(item.symbol))) + (item.oco ? ' · ' + t('linked exit') : '') }),
    h('span', { class: 'card-actions' }, h('button', { type: 'button', text: t('Cancel'), 'aria-label': t('Cancel order on {0}', item.symbol), onclick: () => {
      state.paper.pending = state.paper.pending.filter(entry => entry !== item);
      afterChange();
    } })))));
  if (!state.paper.pending.length) $('pending').append(hint(t('No working orders.')));
  $('orders').replaceChildren(...state.paper.orders.map(entry => h('p', { class: 'log',
    text: time(entry.at, 'full') + ' — ' + t(entry.qty > 0 ? 'Buy' : 'Sell') + ' ' + Math.abs(entry.qty) + ' ' + entry.symbol + ' @ ' + price(entry.price, find(entry.symbol)) })));
  if (!state.paper.orders.length) $('orders').append(hint(t('No orders yet.')));
}

// Rule-based reading of the active chart. No model is involved.
function renderInsights() {
  const chart = active();
  const bars = chart.bars();
  const item = find(chart.state.symbol);
  if (bars.length < 60) return $('insights').replaceChildren(hint(t('Not enough bars for a summary yet.')));
  const closes = bars.map(bar => bar.close);
  const last = closes.at(-1);
  const [short, medium] = [sma(closes, 20).at(-1), sma(closes, 50).at(-1)];
  const strength = rsi(closes, 14).at(-1);
  const momentum = macd(closes, 12, 26, 9);
  const range = atr(bars, 14).at(-1);
  const recent = bars.slice(-20);
  const [top, bottom] = [Math.max(...recent.map(bar => bar.high)), Math.min(...recent.map(bar => bar.low))];
  const trend = last > medium && short > medium ? L('Uptrend') : last < medium && short < medium ? L('Downtrend') : L('Mixed');
  const side = above => t(above ? L('above') : L('below'));
  const card = (title, value, detail, className) => h('div', { class: 'card' }, h('strong', { text: title }), h('small', { text: detail }),
    h('span', { class: 'card-actions ' + (className ?? ''), text: value }));
  $('insights').replaceChildren(
    h('h3', { text: chart.state.symbol + ' · ' + intervalLabel(chart.state.interval) }),
    card(t('Trend'), t(trend), t('Price is {0} its 50-bar average and the 20-bar average is {1} it.', side(last > medium), side(short > medium)),
      trend === 'Uptrend' ? 'up' : trend === 'Downtrend' ? 'down' : ''),
    card(t('Momentum (RSI 14)'), strength.toFixed(1), t(strength > 70 ? L('Above 70, often called overbought.') : strength < 30 ? L('Below 30, often called oversold.') : L('Between 30 and 70, a neutral reading.'))),
    card('MACD', t(momentum.line.at(-1) > momentum.signal.at(-1) ? L('Above signal') : L('Below signal')),
      t('The MACD line is {0} its signal line.', side(momentum.line.at(-1) > momentum.signal.at(-1))), tone(momentum.histogram.at(-1))),
    card(t('Volatility (ATR 14)'), (range / last * 100).toFixed(2) + '%', t('A typical bar moves about {0}.', price(range, item))),
    card(t('20-bar range'), price(bottom, item) + ' – ' + price(top, item), t('Price is {0} below the high and {1} above the low.',
      ((1 - last / top) * 100).toFixed(2) + '%', ((last / bottom - 1) * 100).toFixed(2) + '%')),
    card(t('Change over 20 bars'), signed((last / closes.at(-21) - 1) * 100), t('From {0} to {1}.', price(closes.at(-21), item), price(last, item)), tone(last - closes.at(-21))));
}

function renderPanel(opened) {
  if (state.panel === 'watch') renderWatch();
  else if (state.panel === 'alerts') renderAlerts();
  else if (state.panel === 'data') renderData();
  else if (state.panel === 'trade') renderTrade();
  else if (state.panel === 'insights') renderInsights();
  else if (state.panel === 'screener' && opened) renderScreener();
}

function importWorkspace(parsed) {
  const keep = state.locale;
  state = normalize(parsed);
  state.locale = keep;
  past.length = future.length = 0;
  applyTheme();
  buildCharts();
  applyPanel();
  afterChange();
  renderPanel(true);
  toast(t('Workspace imported.'));
}

// Static controls.
function wire(pickSymbol) {
  $('dialog-close').onclick = closeDialog;
  $('watch-add').onclick = () => symbolDialog(t('Add to watchlist'), item => {
    if (!state.watchlist.includes(item.symbol)) state.watchlist.push(item.symbol);
    toast(t('{0} is on your watchlist', item.symbol));
    afterChange();
  }, { stay: true });
  $('alert-new').onclick = alertDialog;
  $('export').onclick = () => download(new Blob([csv(active().visible())], { type: 'text/csv;charset=utf-8' }),
    'meridian-' + active().state.symbol + '-' + intervalLabel(active().state.interval) + '.csv');
  for (const name of ['screen-type', 'screen-move', 'screen-rsi']) $(name).onchange = renderScreener;
  $('script-help').textContent = t('Fields: {0}. Functions: {1}. Operators: + - * / and comparisons, with and, or, not. Lengths are whole numbers from 1 to 500. A script can assign names, draw with "plot value as Name" and trade with "buy when" and "sell when".',
    formulaHelp.fields.join(', '), formulaHelp.functions.join(', '));
  $('script-name').value = t('Momentum');
  $('script-examples').append(...examples.map(([name, source]) => h('button', { type: 'button', text: t(name), onclick: () => {
    $('script-name').value = t(name);
    $('script-source').value = source;
    $('script-error').textContent = '';
  } })));
  $('script-add').onclick = () => {
    const expression = $('script-source').value.trim();
    try {
      compileScript(expression)(active().bars().slice(0, 60));
    } catch (problem) {
      $('script-error').textContent = problem.message;
      return;
    }
    $('script-error').textContent = '';
    const name = $('script-name').value.trim() || t('Formula');
    active().addIndicator('formula', { expression, name, overlay: Number($('script-overlay').checked) });
    toast(t('{0} added to {1}', name, active().state.symbol));
  };
  $('script-test').onclick = runBacktest;
  $('trade-buy').onclick = () => submitTicket(1);
  $('trade-sell').onclick = () => submitTicket(-1);
  $('trade-type').onchange = renderTrade;
  $('trade-reset').onclick = () => {
    state.paper = defaults().paper;
    afterChange();
  };
  $('share-copy').onclick = async () => {
    const link = shareLink();
    try {
      await view.navigator.clipboard.writeText(link);
      toast(t('Share link copied.'));
    } catch {
      const input = h('input', { type: 'text', readonly: true, value: link, id: 'share-link' });
      dialog(t('Share link'), [field(t('Copy this link'), input)]);
      input.select();
    }
  };
  $('share-idea').onclick = () => {
    const chart = active();
    const title = chart.state.symbol + ' ' + intervalLabel(chart.state.interval) + ': ';
    const body = t('Describe your idea here.') + '\n\n[' + t('Open this chart in Meridian') + '](' + shareLink() + ')';
    view.open(REPO + '/discussions/new?category=show-and-tell&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body), '_blank', 'noopener');
  };
  $('workspace-export').onclick = () => download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'meridian-workspace.json');
  $('workspace-import').onclick = () => $('workspace-file').click();
  $('workspace-file').onchange = async event => {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.charts)) throw new Error('shape');
      importWorkspace(parsed);
    } catch {
      toast(t('That file is not a Meridian workspace.'));
    }
  };
  // Style of the selected drawing.
  const restyle = patch => {
    const chart = active();
    const drawing = (state.drawings[chart.state.symbol] ?? []).find(item => item.id === chart.selected);
    if (!drawing) return;
    before();
    Object.assign(drawing, patch);
    afterChange();
  };
  $('draw-color').oninput = event => restyle({ color: event.target.value });
  $('draw-width').onchange = event => restyle({ width: Number(event.target.value) });
  $('draw-dash').onchange = event => restyle({ dash: event.target.value });
  $('draw-delete').onclick = () => active().removeSelected();
  // The side panel is resized by dragging its inner edge, or with the arrow keys when the edge has focus.
  const grip = $('panel-grip');
  const inward = () => state.settings.panelSide === 'left' ? 1 : -1;
  const resize = width => { state.panelWidth = Math.round(Math.min(720, Math.max(240, width))); };
  grip.onpointerdown = event => {
    const start = $('panel').getBoundingClientRect().width;
    const from = event.clientX;
    try { grip.setPointerCapture?.(event.pointerId); } catch {}
    grip.onpointermove = move => {
      resize(start + inward() * (move.clientX - from));
      applyLook();
    };
    grip.onpointerup = () => {
      grip.onpointermove = grip.onpointerup = null;
      afterChange();
    };
  };
  grip.onkeydown = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    resize((state.panelWidth ?? ($('panel').getBoundingClientRect().width || 320)) + inward() * (event.key === 'ArrowRight' ? 24 : -24));
    afterChange();
  };
  $('replay-pick').onclick = () => {
    pause();
    setTool(tool === 'replay' ? 'cursor' : 'replay');
    if (tool === 'replay') toast(t('Select the bar where the replay should start.'));
  };
  $('replay-play').onclick = () => {
    if (timer) return pause();
    timer = setInterval(step, Number($('replay-speed').value));
    syncReplay();
  };
  $('replay-speed').onchange = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = setInterval(step, Number($('replay-speed').value));
  };
  $('replay-step').onclick = () => {
    pause();
    step();
  };
  $('replay-exit').onclick = () => {
    pause();
    active().replayStop();
  };
  document.addEventListener('keydown', event => {
    const typing = event.target.closest?.('input, textarea, select, dialog, .menu');
    if ((event.ctrlKey || event.metaKey) && !typing) {
      const key = event.key.toLowerCase();
      if (key === 'k') quickActions();
      else if (key === 'z' && !event.shiftKey) travel(past, future);
      else if (key === 'y' || key === 'z') travel(future, past);
      else return;
      event.preventDefault();
    } else if (!typing && !event.altKey && !event.ctrlKey && !event.metaKey && /^[a-z]$/i.test(event.key) && !$('dialog').hasAttribute('open')) {
      event.preventDefault();
      pickSymbol(event.key);
    }
  });
  deviceTheme.addEventListener('change', applyTheme);
  new ResizeObserver(() => charts.forEach(chart => chart.render())).observe($('charts'));
}

const shared = openShared(view?.location?.hash ?? '');
const pickSymbol = build();
applyLook();
applyTheme();
buildCharts();
applyPanel();
wire(pickSymbol);
setTool('cursor');
afterChange();
renderPanel(true);
if (shared) {
  view.history?.replaceState(null, '', view.location.pathname + view.location.search);
  toast(t('Shared layout opened. Your previous layout was saved as "{0}".', t('Before shared link')));
}

// Handle for the automated checks.
export const workspace = { get state() { return state; }, get charts() { return charts; }, get live() { return live; },
  active, setTool, checkAlerts, order, fillOrders, shareLink, importWorkspace };
