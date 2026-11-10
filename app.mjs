// Workspace shell: toolbars, layouts, side panels, dialogs and persistence around the chart engine.
import { instruments, intervals, intervalLabel, intervalName, find, series, price, csv } from './market.mjs';
import { registry, definition, rsi, sma, formulaHelp, compileFormula } from './indicators.mjs';
import { createChart, styles, paneOf } from './chart.mjs';

const $ = id => document.getElementById(id);
const view = document.defaultView;
const KEY = 'meridian.v2';

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
  hline: 'M3 12h7M14 12h7M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  vline: 'M12 3v7M12 14v7M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  rect: 'M4 6h16v12H4z',
  fib: 'M3 5h18M3 10h18M3 14h18M3 19h18',
  long: 'M4 20h16M4 13h16M12 10V3M9 6l3-3 3 3',
  short: 'M4 4h16M4 11h16M12 14v7M9 18l3 3 3-3',
  brush: 'M4 20c3 0 4-2 4-4l9-11 3 3-11 9c-2 0-4 1-5 3z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  measure: 'M3 17L17 3l4 4L7 21zM8 12l2 2M11 9l2 2M14 6l2 2',
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
  source: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  zoomIn: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM16.5 16.5L21 21M8 11h6M11 8v6',
  zoomOut: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM16.5 16.5L21 21M8 11h6',
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

// State and persistence.
const layouts = {
  1: { count: 1, name: 'Single chart' }, '2h': { count: 2, name: 'Two side by side' }, '2v': { count: 2, name: 'Two stacked' },
  3: { count: 3, name: 'One large, two small' }, 4: { count: 4, name: 'Four charts' }
};
const zones = { UTC: 'UTC', local: 'Device time', 'Europe/Lisbon': 'Lisbon', 'Europe/London': 'London', 'America/New_York': 'New York', 'Asia/Tokyo': 'Tokyo' };
const chartDefaults = () => ({ symbol: 'SPY', interval: 1440, style: 'Candles', log: false, compare: [], indicators: [{ uid: 'volume', id: 'volume', params: {} }] });
const defaults = () => ({
  theme: null, layout: '1', active: 0, charts: [chartDefaults()], panel: (view?.innerWidth ?? 1200) < 760 ? null : 'watch',
  watchlist: ['SPY', 'QQQ', 'AAPL', 'NVDA', 'BTCUSD', 'ETHUSDT.P', 'EURUSD'], alerts: [], log: [], drawings: {}, saved: {},
  paper: { cash: 100000, positions: {}, orders: [] },
  settings: { tz: 'UTC', grid: true, magnet: false, keep: false, lock: false, hide: false, syncSymbol: false, syncInterval: false, syncCross: true }
});

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved) {
      Object.assign(base, saved, { settings: { ...base.settings, ...saved.settings }, paper: { ...base.paper, ...saved.paper } });
    } else {
      // Carry the prototype 0.1 preferences forward.
      const old = JSON.parse(localStorage.getItem('meridian.v1'));
      if (old) {
        base.theme = old.theme ?? null;
        base.charts = [{ ...chartDefaults(), symbol: old.symbol, interval: old.interval * 60, style: old.style, indicators: [
          ...(old.volume === false ? [] : chartDefaults().indicators), ...(old.average ? [{ uid: 'sma20', id: 'sma', params: { length: 20 } }] : [])] }];
      }
    }
  } catch {}
  const list = value => Array.isArray(value) ? value : [];
  base.charts = list(base.charts).filter(chart => find(chart?.symbol) && intervals.includes(chart.interval)).map(chart => ({
    ...chartDefaults(), ...chart, style: styles.includes(chart.style) ? chart.style : 'Candles',
    compare: list(chart.compare).filter(find), indicators: list(chart.indicators).filter(item => definition(item?.id))
  }));
  if (!base.charts.length) base.charts = [chartDefaults()];
  if (!layouts[base.layout]) base.layout = '1';
  if (![null, 'light', 'dark'].includes(base.theme)) base.theme = null;
  if (!zones[base.settings.tz]) base.settings.tz = 'UTC';
  if ((view?.innerWidth ?? 1200) < 760) base.panel = null;
  if (base.panel && !['watch', 'alerts', 'data', 'screener', 'script', 'trade', 'sources'].includes(base.panel)) base.panel = 'watch';
  base.watchlist = list(base.watchlist).filter(find);
  base.alerts = list(base.alerts).filter(alert => find(alert?.symbol));
  return base;
}

let state = load();
let charts = [];
let tool = 'cursor';
let timer = null;
const past = [];
const future = [];
const lastTool = {};
const sort = { key: 'change', down: true };

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}
const active = () => charts[state.active] ?? charts[0];

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
  const next = theme === 'dark' ? 'light' : 'dark';
  const control = $('theme');
  if (control) {
    setGlyph('theme', theme === 'dark' ? 'moon' : 'sun');
    control.title = 'Use ' + next + ' theme';
    control.setAttribute('aria-label', 'Use ' + next + ' theme');
  }
  charts.forEach(chart => chart.render());
}
const formats = new Map();
function time(value, kind) {
  const timeZone = state.settings.tz === 'local' ? undefined : state.settings.tz;
  const key = kind + timeZone;
  if (!formats.has(key)) {
    formats.set(key, new Intl.DateTimeFormat('en-GB', kind === 'day' ? { day: 'numeric', month: 'short', timeZone }
      : kind === 'time' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }
      : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }));
  }
  return formats.get(key).format(value);
}
const signed = (value, digits = 2) => (value >= 0 ? '+' : '') + value.toFixed(digits) + '%';
const tone = value => value >= 0 ? 'up' : 'down';
const statsCache = new Map();
function stats(instrument) {
  if (!statsCache.has(instrument.symbol)) {
    const daily = series(instrument, 1440);
    const closes = daily.map(bar => bar.close);
    const last = daily.at(-1);
    const move = back => (last.close / daily.at(-1 - back).close - 1) * 100;
    statsCache.set(instrument.symbol, {
      last: last.close, bar: last, change: move(1), week: move(7), month: move(30), rsi: rsi(closes, 14).at(-1),
      trend: (last.close / sma(closes, 50).at(-1) - 1) * 100, high: Math.max(...daily.map(bar => bar.high)), low: Math.min(...daily.map(bar => bar.low))
    });
  }
  return statsCache.get(instrument.symbol);
}
// Latest price for a symbol, following the active chart while it replays.
function quote(symbol) {
  const chart = charts.find(item => item.state.symbol === symbol && item.replaying);
  return chart ? chart.last().close : stats(find(symbol)).last;
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
      type: 'button', role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
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
  $('dialog-body').replaceChildren(...[body].flat());
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

function symbolDialog(title, pick, { stay, query = '' } = {}) {
  const input = h('input', { type: 'search', id: 'symbol-query', placeholder: 'Symbol or name', 'aria-label': 'Search symbols', value: query });
  const kind = h('select', { 'aria-label': 'Instrument type' }, ['All types', 'Stock', 'ETF', 'Crypto', 'Forex', 'Commodity'].map(text => h('option', { text })));
  const results = h('div', { class: 'results', id: 'symbol-results' });
  const fill = () => {
    const words = input.value.trim().toLowerCase();
    const found = instruments.filter(item => (item.symbol + ' ' + item.name).toLowerCase().includes(words) &&
      (kind.selectedIndex <= 0 || item.type === kind.value));
    results.replaceChildren(...found.map(item => {
      const data = stats(item);
      return h('button', { type: 'button', class: 'result', 'data-symbol': item.symbol, onclick: () => {
        if (!stay) closeDialog();
        pick(item);
      } }, h('strong', { text: item.symbol }), h('span', { text: item.name }), h('small', { text: item.type }),
      h('span', { class: 'num', text: price(data.last, item) }), h('span', { class: 'num ' + tone(data.change), text: signed(data.change) }));
    }));
    if (!found.length) results.append(h('p', { class: 'hint', text: 'No matching symbols.' }));
  };
  input.oninput = kind.onchange = fill;
  dialog(title, [h('div', { class: 'row' }, input, kind), results]);
  fill();
  input.focus();
}

function configure(chart, indicator) {
  const spec = definition(indicator.id);
  const error = h('p', { role: 'alert', class: 'error' });
  const inputs = Object.entries(indicator.params).map(([key, value]) => {
    const control = key === 'overlay' ? h('input', { type: 'checkbox', checked: Boolean(value) })
      : typeof spec.params[key] === 'number' ? h('input', { type: 'number', min: key === 'width' ? 0.1 : 1, max: 500, step: key === 'width' ? 0.1 : 1, value })
      : h('input', { type: 'text', value, spellcheck: 'false' });
    control.dataset.key = key;
    return key === 'overlay' ? h('label', { class: 'check' }, control, 'Draw on the price pane')
      : field(key[0].toUpperCase() + key.slice(1), control);
  });
  dialog(indicator.id === 'formula' ? indicator.params.name : spec.name, [...inputs, error, actions(
    h('button', { type: 'button', class: 'primary', text: 'Apply', onclick: () => {
      const params = {};
      for (const control of $('dialog-body').querySelectorAll('[data-key]')) {
        const key = control.dataset.key;
        params[key] = control.type === 'checkbox' ? Number(control.checked) : control.type === 'number' ? Number(control.value) : control.value.trim();
        if (control.type === 'number' && !(params[key] >= Number(control.min) && params[key] <= 500 && (key === 'width' || Number.isInteger(params[key])))) {
          error.textContent = 'Enter a value from ' + control.min + ' to 500 for ' + key + '.';
          return;
        }
      }
      try {
        if (indicator.id === 'formula') compileFormula(params.expression)(chart.bars().slice(0, 60));
      } catch (problem) {
        error.textContent = problem.message;
        return;
      }
      chart.patchIndicator(indicator.uid, { params });
      closeDialog();
    } }))]);
}

function indicatorsDialog() {
  const chart = active();
  const input = h('input', { type: 'search', placeholder: 'Search indicators', 'aria-label': 'Search indicators' });
  const results = h('div', { class: 'results' });
  const current = h('div', { class: 'results' });
  const fill = () => {
    results.replaceChildren(...registry.filter(item => item.name.toLowerCase().includes(input.value.trim().toLowerCase())).map(item =>
      h('button', { type: 'button', class: 'result', 'data-indicator': item.id, onclick: () => {
        if (item.id === 'formula') {
          closeDialog();
          return openPanel('script', true);
        }
        chart.addIndicator(item.id);
        toast(item.name + ' added to ' + chart.state.symbol);
        fill();
      } }, h('strong', { text: item.name }), h('small', { text: item.id === 'formula' ? 'Opens the formula editor' : item.pane === 'overlay' ? 'On the price pane' : 'In its own pane' }))));
    current.replaceChildren(...chart.state.indicators.map(item => h('div', { class: 'result' },
      h('strong', { text: item.id === 'formula' ? item.params.name : definition(item.id).name }),
      h('small', { text: Object.entries(item.params).filter(([key]) => !['expression', 'name', 'overlay'].includes(key)).map(([key, value]) => key + ' ' + value).join(' · ') }),
      Object.keys(item.params).length ? h('button', { type: 'button', text: 'Settings', onclick: () => configure(chart, item) }) : null,
      h('button', { type: 'button', text: 'Remove', onclick: () => {
        chart.removeIndicator(item.uid);
        fill();
      } }))));
    if (!chart.state.indicators.length) current.append(h('p', { class: 'hint', text: 'No indicators on this chart.' }));
  };
  input.oninput = fill;
  dialog('Indicators', [input, results, h('h3', { text: 'On this chart' }), current]);
  fill();
  input.focus();
}

// Alerts.
const conditions = { cross: 'Crossing', above: 'Greater than', below: 'Less than' };
function alertDialog() {
  const chart = active();
  const instrument = find(chart.state.symbol);
  const condition = h('select', { id: 'alert-condition' }, Object.entries(conditions).map(([value, text]) => h('option', { value, text })));
  const level = h('input', { id: 'alert-price', type: 'number', step: 'any', min: 0, value: chart.last().close.toFixed(instrument.digits ?? 2) });
  const note = h('input', { id: 'alert-note', type: 'text', maxlength: 80, placeholder: 'Optional' });
  const error = h('p', { role: 'alert', class: 'error' });
  dialog('Create alert on ' + chart.state.symbol, [field('Condition', condition), field('Price', level), field('Message', note), error, actions(
    h('button', { type: 'button', id: 'alert-create', class: 'primary', text: 'Create', onclick: () => {
      const value = Number(level.value);
      if (!(value > 0)) {
        error.textContent = 'Enter a price above zero.';
        return;
      }
      const alert = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), symbol: chart.state.symbol, condition: condition.value,
        price: value, note: note.value.trim(), status: 'active', created: Date.now() };
      state.alerts.unshift(alert);
      closeDialog();
      const last = chart.last();
      if (alert.condition !== 'cross') checkAlerts(alert.symbol, last.close, last.close, last.time);
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
    const message = symbol + ' ' + conditions[alert.condition].toLowerCase() + ' ' + price(alert.price, find(symbol)) + (alert.note ? ' · ' + alert.note : '');
    state.log.unshift({ message, at: Date.now() });
    state.log.length = Math.min(state.log.length, 40);
    toast('Alert: ' + message);
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
    control.title = label + (group.tools.length > 1 ? ' — select again for more tools' : '');
    control.setAttribute('aria-label', control.title);
    press(control, Boolean(mine));
  }
  document.body.dataset.tool = next;
  syncReplay();
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
  if (chart.replayDone) pause();
  afterChange();
}
function syncReplay() {
  const chart = active();
  if (!chart) return;
  $('replaybar').hidden = !chart.replaying;
  press($('replay'), chart.replaying);
  $('replay-play').textContent = timer ? 'Pause' : 'Play';
  $('replay-play').disabled = $('replay-step').disabled = chart.replayDone;
  press($('replay-pick'), tool === 'replay');
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
      store: state, colors, time, before, configure,
      tool: () => tool,
      toolDone: () => tool !== 'cursor' && setTool('cursor'),
      askText: done => {
        const input = h('input', { type: 'text', id: 'note-text', maxlength: 60 });
        const confirm = () => {
          closeDialog();
          done(input.value.trim());
        };
        input.onkeydown = event => event.key === 'Enter' && confirm();
        dialog('Text note', [field('Text', input), actions(h('button', { type: 'button', class: 'primary', text: 'Place', onclick: confirm }))]);
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
  if (kind !== 'selection' && kind !== 'state' && kind !== 'replay') charts.forEach(chart => chart.render());
  const chart = active();
  if (!chart) return;
  charts.forEach((item, index) => item.host.classList.toggle('active', charts.length > 1 && index === state.active));
  setLabel('symbol', chart.state.symbol);
  setLabel('interval', intervalLabel(chart.state.interval));
  setLabel('style', chart.state.style);
  $('undo').disabled = !past.length;
  $('redo').disabled = !future.length;
  press($('log'), chart.state.log);
  setLabel('zone', zones[state.settings.tz]);
  for (const name of ['magnet', 'keep', 'lock', 'hide']) press($('toggle-' + name), state.settings[name]);
  syncReplay();
  renderPanel();
}

// Toolbars.
const toolGroups = [
  { id: 'cursor', tools: [['cursor', 'Crosshair']] },
  { id: 'lines', tools: [['trend', 'Trend line'], ['ray', 'Ray'], ['hline', 'Horizontal line'], ['vline', 'Vertical line']] },
  { id: 'fib', tools: [['fib', 'Fibonacci retracement']] },
  { id: 'shapes', tools: [['rect', 'Rectangle'], ['brush', 'Brush']] },
  { id: 'position', tools: [['long', 'Long position'], ['short', 'Short position']] },
  { id: 'text', tools: [['text', 'Text note']] },
  { id: 'measure', tools: [['measure', 'Measure']] }
];
const panels = [['watch', 'list', 'Watchlist and details'], ['alerts', 'alert', 'Alerts'], ['data', 'table', 'Data window and object tree'],
  ['screener', 'filter', 'Screener'], ['script', 'code', 'Formula editor'], ['trade', 'wallet', 'Paper trading'], ['sources', 'source', 'Official sources']];
const ranges = [['1D', 5, 288, '1 day in 5 minute bars'], ['5D', 15, 480, '5 days in 15 minute bars'], ['1M', 60, 720, '1 month in 1 hour bars'],
  ['3M', 240, 540, '3 months in 4 hour bars'], ['All', 1440, 144, 'All data in daily bars']];

function build() {
  const gap = () => h('span', { class: 'gap' });
  $('top').append(
    h('a', { class: 'brand', href: './', 'aria-label': 'Meridian home' }, h('span', { class: 'mark', text: '◈' })),
    button('symbol', { glyph: 'search', label: 'Symbol search', text: '', always: true, run: () => symbolDialog('Symbol search', item => active().set({ symbol: item.symbol })) }),
    button('compare', { glyph: 'compare', label: 'Compare symbols', run: () => symbolDialog('Compare with ' + active().state.symbol, item => {
      if (item.symbol !== active().state.symbol) active().toggleCompare(item.symbol);
    }) }),
    gap(),
    button('interval', { label: 'Interval', text: '', always: true, run: anchor => menu(anchor, intervals.map(minutes => ({
      label: intervalName(minutes), checked: minutes === active().state.interval, run: () => active().set({ interval: minutes }) }))) }),
    button('style', { glyph: 'candle', label: 'Chart type', text: '', run: anchor => menu(anchor, styles.map(name => ({
      label: name, checked: name === active().state.style, run: () => active().set({ style: name }) }))) }),
    button('indicators', { glyph: 'indicators', label: 'Indicators and formulas', text: 'Indicators', run: indicatorsDialog }),
    button('alert', { glyph: 'alert', label: 'Create alert', text: 'Alert', run: alertDialog }),
    button('replay', { glyph: 'replay', label: 'Bar replay', text: 'Replay', run: () => {
      pause();
      if (active().replaying) active().replayStop();
      else active().replayStart();
    } }),
    gap(),
    button('undo', { glyph: 'undo', label: 'Undo drawing change', run: () => travel(past, future) }),
    button('redo', { glyph: 'redo', label: 'Redo drawing change', run: () => travel(future, past) }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'chip status', text: 'Simulated data' }),
    button('layout', { glyph: 'layout', label: 'Layout setup', run: anchor => menu(anchor, [
      ...['1', '2h', '2v', '3', '4'].map(key => ({ label: layouts[key].name, checked: key === state.layout, run: () => {
        state.layout = key;
        buildCharts();
        afterChange();
      } })), '-',
      ...[['syncSymbol', 'Sync symbol'], ['syncInterval', 'Sync interval'], ['syncCross', 'Sync crosshair']].map(([key, label]) => ({
        label, checked: state.settings[key], run: () => {
          state.settings[key] = !state.settings[key];
          propagate(active());
          afterChange();
        } }))]) }),
    button('layouts', { glyph: 'save', label: 'Save and load layouts', run: anchor => menu(anchor, [
      { label: 'Save layout as…', run: saveLayoutDialog },
      ...(Object.keys(state.saved).length ? [{ heading: 'Load' }] : []),
      ...Object.keys(state.saved).map(name => ({ label: name, run: () => {
        const copy = structuredClone(state.saved[name]);
        state.layout = copy.layout;
        state.charts = copy.charts;
        state.active = 0;
        buildCharts();
        afterChange();
        toast('Layout "' + name + '" loaded');
      } })),
      ...(Object.keys(state.saved).length ? [{ heading: 'Delete' }] : []),
      ...Object.keys(state.saved).map(name => ({ label: 'Delete ' + name, run: () => {
        delete state.saved[name];
        afterChange();
      } }))]) }),
    button('snapshot', { glyph: 'camera', label: 'Download chart image', run: snapshot }),
    button('fullscreen', { glyph: 'full', label: 'Full screen', run: () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    } }),
    button('settings', { glyph: 'gear', label: 'Settings', run: settingsDialog }),
    button('language', { glyph: 'globe', label: 'Language: English', text: 'EN', always: true, run: anchor => menu(anchor, [{ label: 'English', checked: true, run() {} }]) }),
    button('theme', { glyph: 'sun', label: 'Toggle theme', run: () => {
      state.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      save();
    } })
  );

  $('tools').append(
    ...toolGroups.map(group => {
      const control = button('tool-' + group.id, { glyph: group.tools[0][0], label: group.tools[0][1], run: anchor => {
        const current = group.tools.some(([name]) => name === tool);
        if (group.tools.length > 1 && current) {
          menu(anchor, group.tools.map(([name, label]) => ({ label, checked: name === tool, run: () => setTool(name) })), 'right');
        } else setTool(lastTool[group.id] ?? group.tools[0][0]);
      } });
      if (group.tools.length > 1) control.classList.add('more');
      return control;
    }),
    h('hr'),
    ...[['magnet', 'magnet', 'Magnet: snap drawings to open, high, low or close'], ['keep', 'keep', 'Stay in drawing mode'],
      ['lock', 'lock', 'Lock all drawings'], ['hide', 'eye', 'Hide all drawings']].map(([key, glyph, label]) =>
      button('toggle-' + key, { glyph, label, run: () => {
        state.settings[key] = !state.settings[key];
        afterChange();
      } })),
    button('remove', { glyph: 'trash', label: 'Remove objects', run: anchor => menu(anchor, [
      { label: 'Remove selected drawing', run: () => active().removeSelected() },
      { label: 'Remove all drawings on ' + active().state.symbol, run: () => {
        before();
        state.drawings[active().state.symbol] = [];
        afterChange();
      } },
      { label: 'Remove all indicators', run: () => active().set({ indicators: [] }) }], 'right') })
  );

  $('bottom').append(
    ...ranges.map(([label, interval, count, name]) => h('button', { type: 'button', 'data-range': label, title: name, 'aria-label': name, text: label, onclick: () => {
      active().set({ interval });
      active().showBars(count);
    } })),
    button('goto', { label: 'Go to date', text: 'Go to…', always: true, run: gotoDialog }),
    h('span', { class: 'spacer' }),
    button('scroll-left', { glyph: 'left', label: 'Scroll to earlier bars', run: () => active().scroll(-20) }),
    button('scroll-right', { glyph: 'right', label: 'Scroll to later bars', run: () => active().scroll(20) }),
    button('latest', { glyph: 'latest', label: 'Scroll to the most recent bar', run: () => active().fit(false) }),
    button('zoom-out', { glyph: 'zoomOut', label: 'Zoom out', run: () => active().zoom(0.8) }),
    button('zoom-in', { glyph: 'zoomIn', label: 'Zoom in', run: () => active().zoom(1.25) }),
    button('fit', { label: 'Reset chart view', text: 'Reset', always: true, run: () => active().fit() }),
    button('log', { label: 'Logarithmic price scale', text: 'Log', always: true, run: () => active().set({ log: !active().state.log }) }),
    button('zone', { label: 'Time zone', text: '', always: true, run: anchor => menu(anchor, Object.entries(zones).map(([key, label]) => ({
      label, checked: key === state.settings.tz, run: () => {
        state.settings.tz = key;
        afterChange();
      } }))) })
  );

  $('rail').append(...panels.map(([name, glyph, label]) => button('panel-' + name, { glyph, label, run: () => openPanel(name) })));
}

function saveLayoutDialog() {
  const input = h('input', { type: 'text', id: 'layout-name', maxlength: 30, value: active().state.symbol + ' ' + layouts[state.layout].name.toLowerCase() });
  const confirm = () => {
    const name = input.value.trim();
    if (!name) return;
    state.saved[name] = structuredClone({ layout: state.layout, charts: state.charts.slice(0, layouts[state.layout].count) });
    closeDialog();
    afterChange();
    toast('Layout "' + name + '" saved on this device');
  };
  input.onkeydown = event => event.key === 'Enter' && confirm();
  dialog('Save layout', [field('Name', input), actions(h('button', { type: 'button', class: 'primary', id: 'layout-save', text: 'Save', onclick: confirm }))]);
  input.select();
}

function gotoDialog() {
  const bars = active().bars();
  const day = value => new Date(value).toISOString().slice(0, 10);
  const input = h('input', { type: 'date', id: 'goto-date', min: day(bars[0].time), max: day(bars.at(-1).time), value: day(bars.at(-1).time) });
  dialog('Go to date', [field('Date (UTC)', input), actions(h('button', { type: 'button', class: 'primary', text: 'Go', onclick: () => {
    if (!input.value) return;
    closeDialog();
    active().goTo(Date.parse(input.value + 'T00:00:00Z'));
  } }))]);
}

function settingsDialog() {
  const toggle = (key, label) => {
    const control = h('input', { type: 'checkbox', checked: state.settings[key], onchange: () => {
      state.settings[key] = control.checked;
      propagate(active());
      afterChange();
    } });
    return h('label', { class: 'check' }, control, label);
  };
  const zone = h('select', { onchange: () => {
    state.settings.tz = zone.value;
    afterChange();
  } }, Object.entries(zones).map(([value, text]) => h('option', { value, text, selected: value === state.settings.tz })));
  dialog('Settings', [
    field('Time zone', zone), toggle('grid', 'Show grid lines'), toggle('syncCross', 'Sync crosshair across charts'),
    toggle('syncSymbol', 'Sync symbol across charts'), toggle('syncInterval', 'Sync interval across charts'),
    h('h3', { text: 'Keyboard' }),
    h('p', { class: 'hint', text: 'Type a letter to search symbols. On a focused chart: arrow keys inspect bars, + and − zoom, Home and End jump, ' +
      'Delete removes the selected drawing, Escape cancels. Ctrl+Z and Ctrl+Y undo and redo drawings.' }),
    h('h3', { text: 'Preferences' }),
    h('p', { class: 'hint', text: 'Restores automatic theme, the default layout and watchlist, and removes drawings, alerts, saved layouts and the paper account from this browser.' }),
    actions(h('button', { type: 'button', id: 'reset', class: 'danger', text: 'Reset preferences', onclick: () => {
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
    } }))]);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function snapshot() {
  const shot = active().snapshot();
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

// Side panels.
function applyPanel() {
  document.body.dataset.panel = state.panel ?? '';
  for (const section of $('panel').children) section.hidden = section.dataset.panel !== state.panel;
  for (const [name] of panels) press($('panel-' + name), name === state.panel);
}
function openPanel(name, force) {
  state.panel = state.panel === name && !force ? null : name;
  applyPanel();
  save();
  renderPanel(true);
}

function renderWatch() {
  const container = $('symbols');
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.symbol : null;
  const current = active().state.symbol;
  container.replaceChildren(...state.watchlist.map(symbol => {
    const item = find(symbol);
    const data = stats(item);
    const row = h('div', { class: 'symbol-row' },
      h('button', { type: 'button', class: 'symbol', 'data-symbol': symbol, 'aria-pressed': String(symbol === current), onclick: () => active().set({ symbol }) },
        h('span', {}, h('strong', { text: symbol }), h('small', { text: item.name })),
        h('span', { class: 'num', text: price(data.last, item) }), h('span', { class: 'num ' + tone(data.change), text: signed(data.change) })),
      h('button', { type: 'button', class: 'ghost', 'aria-label': 'Remove ' + symbol + ' from watchlist', text: '✕', onclick: () => {
        state.watchlist = state.watchlist.filter(entry => entry !== symbol);
        afterChange();
      } }));
    return row;
  }));
  if (!state.watchlist.length) container.append(h('p', { class: 'hint', text: 'Your watchlist is empty. Use Add symbol.' }));
  if (focused) container.querySelector('[data-symbol="' + focused + '"]')?.focus();

  const item = find(current);
  const data = stats(item);
  const place = (data.last - data.bar.low) / ((data.bar.high - data.bar.low) || 1) * 100;
  $('details').replaceChildren(
    h('p', { class: 'eyebrow', text: item.type + ' · simulated · daily' }), h('h3', { text: item.name }),
    h('p', { class: 'big' }, h('strong', { text: price(data.last, item) }), ' ', h('span', { class: tone(data.change), text: signed(data.change) })),
    h('div', { class: 'range', role: 'img', 'aria-label': 'Day range ' + price(data.bar.low, item) + ' to ' + price(data.bar.high, item) },
      h('span', { text: price(data.bar.low, item) }), h('i', {}, h('b', { style: 'left:' + place.toFixed(1) + '%' })), h('span', { text: price(data.bar.high, item) })),
    h('dl', {}, ...[['Volume', data.bar.volume.toLocaleString('en-US')], ['1 week', signed(data.week)], ['1 month', signed(data.month)],
      ['RSI 14', data.rsi.toFixed(1)], ['Period high', price(data.high, item)], ['Period low', price(data.low, item)]]
      .flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })])));
}

function renderAlerts() {
  $('alert-list').replaceChildren(...state.alerts.map(alert => h('div', { class: 'card ' + alert.status },
    h('strong', { text: alert.symbol + ' · ' + conditions[alert.condition] + ' ' + price(alert.price, find(alert.symbol)) }),
    h('small', { text: (alert.status === 'active' ? 'Active' : 'Triggered on bar ' + time(alert.at, 'full')) + (alert.note ? ' · ' + alert.note : '') }),
    h('span', { class: 'card-actions' },
      alert.status === 'triggered' && h('button', { type: 'button', text: 'Re-arm', onclick: () => {
        alert.status = 'active';
        afterChange();
      } }),
      h('button', { type: 'button', text: 'Delete', 'aria-label': 'Delete alert on ' + alert.symbol, onclick: () => {
        state.alerts = state.alerts.filter(entry => entry !== alert);
        afterChange();
      } })))));
  if (!state.alerts.length) $('alert-list').append(h('p', { class: 'hint', text: 'No alerts yet.' }));
  $('alert-log').replaceChildren(...state.log.map(entry => h('p', { class: 'log', text: time(entry.at, 'full') + ' — ' + entry.message })));
  if (!state.log.length) $('alert-log').append(h('p', { class: 'hint', text: 'Nothing has triggered.' }));
}

function renderWindow() {
  const chart = active();
  const bars = chart.bars();
  const index = Math.max(0, Math.min(bars.length - 1, chart.crossIndex ?? bars.length - 1));
  const bar = bars[index];
  const item = find(chart.state.symbol);
  const change = (bar.close / (bars[index - 1] ?? bar).close - 1) * 100;
  const rows = [['Time', time(bar.time, 'full')], ['Open', price(bar.open, item)], ['High', price(bar.high, item)], ['Low', price(bar.low, item)],
    ['Close', price(bar.close, item)], ['Change', signed(change)], ['Volume', bar.volume.toLocaleString('en-US')]];
  for (const indicator of chart.state.indicators.filter(entry => entry.id !== 'volume' && !entry.hidden)) {
    for (const plot of chart.plots(indicator)) {
      const value = plot.values[index];
      rows.push([plot.label, value === null || value === undefined || Number.isNaN(value) ? '–' : value.toLocaleString('en-US', { maximumFractionDigits: 4 })]);
    }
  }
  $('window').replaceChildren(...rows.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })]));
}

const drawingNames = { trend: 'Trend line', ray: 'Ray', hline: 'Horizontal line', vline: 'Vertical line', rect: 'Rectangle', fib: 'Fibonacci retracement',
  position: 'Position', brush: 'Brush', text: 'Text note' };
function renderData() {
  renderWindow();
  const chart = active();
  const item = find(chart.state.symbol);
  const entry = (label, detail, remove, select) => h('div', { class: 'card' },
    select ? h('button', { type: 'button', class: 'link', text: label, onclick: select }) : h('strong', { text: label }),
    h('small', { text: detail }),
    h('span', { class: 'card-actions' }, h('button', { type: 'button', text: 'Remove', 'aria-label': 'Remove ' + label, onclick: remove })));
  const drawings = state.drawings[chart.state.symbol] ?? [];
  $('objects').replaceChildren(
    ...chart.state.indicators.map(indicator => entry(indicator.id === 'formula' ? indicator.params.name : definition(indicator.id).name,
      'Indicator · ' + (paneOf(indicator) === 'overlay' ? 'price pane' : 'own pane'), () => chart.removeIndicator(indicator.uid))),
    ...chart.state.compare.map(symbol => entry(symbol, 'Comparison', () => chart.toggleCompare(symbol))),
    ...drawings.map(drawing => entry(drawingNames[drawing.type] + (drawing.text ? ' “' + drawing.text + '”' : ''),
      'Drawing · ' + price(drawing.points[0].p, item) + (drawing.id === chart.selected ? ' · selected' : ''), () => {
        before();
        state.drawings[chart.state.symbol] = drawings.filter(other => other !== drawing);
        afterChange();
      }, () => {
        chart.select(drawing.id);
        renderData();
      })));
  if (!$('objects').children.length) $('objects').append(h('p', { class: 'hint', text: 'No indicators or drawings on this chart.' }));
  $('data').replaceChildren(...chart.visible().slice(-300).reverse().map(bar => h('tr', {},
    ...[time(bar.time, 'full'), ...[bar.open, bar.high, bar.low, bar.close].map(value => price(value, item)), bar.volume.toLocaleString('en-US')]
      .map(text => h('td', { text })))));
}

const columns = [['symbol', 'Symbol'], ['last', 'Last'], ['change', 'Chg%'], ['week', '1W%'], ['month', '1M%'], ['rsi', 'RSI'], ['trend', 'vs SMA 50']];
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
    h('button', { type: 'button', class: 'link', text: label + (sort.key === key ? (sort.down ? ' ↓' : ' ↑') : ''), onclick: () => {
      sort.down = sort.key === key ? !sort.down : key !== 'symbol';
      sort.key = key;
      renderScreener();
    } }))));
  $('screen').tBodies[0].replaceChildren(...rows.map(row => h('tr', {},
    h('td', {}, h('button', { type: 'button', class: 'link', title: row.item.name, text: row.symbol, onclick: () => active().set({ symbol: row.symbol }) })),
    h('td', { text: price(row.last, row.item) }), ...['change', 'week', 'month'].map(key => h('td', { class: tone(row[key]), text: signed(row[key]) })),
    h('td', { text: row.rsi.toFixed(1) }), h('td', { class: tone(row.trend), text: signed(row.trend, 1) }))));
  if (!rows.length) $('screen').tBodies[0].append(h('tr', {}, h('td', { colspan: columns.length, text: 'No symbols match these filters.' })));
}

function order(symbol, quantity) {
  const fill = quote(symbol);
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
  toast((quantity > 0 ? 'Bought ' : 'Sold ') + Math.abs(quantity) + ' ' + symbol + ' at ' + price(fill, find(symbol)) + ' (simulated)');
  afterChange();
}
function renderTrade() {
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const open = Object.entries(state.paper.positions);
  const worth = open.reduce((sum, [symbol, position]) => sum + position.qty * quote(symbol), 0);
  const profit = open.reduce((sum, [symbol, position]) => sum + position.qty * (quote(symbol) - position.avg), 0);
  $('account').replaceChildren(...[['Equity', money(state.paper.cash + worth)], ['Cash', money(state.paper.cash)], ['Open profit and loss', money(profit)]]
    .flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })]));
  const symbol = active().state.symbol;
  $('trade-buy').textContent = 'Buy ' + symbol;
  $('trade-sell').textContent = 'Sell ' + symbol;
  $('positions').replaceChildren(...open.map(([name, position]) => {
    const gain = position.qty * (quote(name) - position.avg);
    return h('div', { class: 'card' }, h('strong', { text: (position.qty > 0 ? 'Long ' : 'Short ') + Math.abs(position.qty) + ' ' + name }),
      h('small', {}, 'Average ' + price(position.avg, find(name)) + ' · ', h('span', { class: tone(gain), text: money(gain) })),
      h('span', { class: 'card-actions' }, h('button', { type: 'button', text: 'Close', 'aria-label': 'Close ' + name + ' position', onclick: () => order(name, -position.qty) })));
  }));
  if (!open.length) $('positions').append(h('p', { class: 'hint', text: 'No open positions.' }));
  $('orders').replaceChildren(...state.paper.orders.map(entry => h('p', { class: 'log',
    text: time(entry.at, 'full') + ' — ' + (entry.qty > 0 ? 'Buy ' : 'Sell ') + Math.abs(entry.qty) + ' ' + entry.symbol + ' at ' + price(entry.price, find(entry.symbol)) })));
  if (!state.paper.orders.length) $('orders').append(h('p', { class: 'hint', text: 'No orders yet.' }));
}

function renderPanel(opened) {
  if (state.panel === 'watch') renderWatch();
  else if (state.panel === 'alerts') renderAlerts();
  else if (state.panel === 'data') renderData();
  else if (state.panel === 'trade') renderTrade();
  else if (state.panel === 'screener' && opened) renderScreener();
}

// Static controls.
function wire() {
  $('dialog-close').onclick = closeDialog;
  $('watch-add').onclick = () => symbolDialog('Add to watchlist', item => {
    if (!state.watchlist.includes(item.symbol)) state.watchlist.push(item.symbol);
    toast(item.symbol + ' is on your watchlist');
    afterChange();
  }, { stay: true });
  $('alert-new').onclick = alertDialog;
  $('export').onclick = () => download(new Blob([csv(active().visible())], { type: 'text/csv;charset=utf-8' }),
    'meridian-' + active().state.symbol + '-' + intervalLabel(active().state.interval) + '.csv');
  for (const name of ['screen-type', 'screen-move', 'screen-rsi']) $(name).onchange = renderScreener;
  $('script-help').textContent = 'Fields: ' + formulaHelp.fields.join(', ') + '. Functions: ' + formulaHelp.functions.join(', ') +
    '. Operators: + − × ÷ written as + - * / with parentheses. Lengths are whole numbers from 1 to 500.';
  $('script-examples').append(...[['Momentum', 'close - sma(close, 20)'], ['MACD line', 'ema(close, 12) - ema(close, 26)'],
    ['Range position', '(close - lowest(low, 14)) / (highest(high, 14) - lowest(low, 14)) * 100'], ['Average volume', 'sma(volume, 20)']]
    .map(([name, source]) => h('button', { type: 'button', text: name, onclick: () => {
      $('script-name').value = name;
      $('script-source').value = source;
      $('script-error').textContent = '';
    } })));
  $('script-add').onclick = () => {
    const expression = $('script-source').value.trim();
    try {
      compileFormula(expression)(active().bars().slice(0, 60));
    } catch (problem) {
      $('script-error').textContent = problem.message;
      return;
    }
    $('script-error').textContent = '';
    const name = $('script-name').value.trim() || 'Formula';
    active().addIndicator('formula', { expression, name, overlay: Number($('script-overlay').checked) });
    toast(name + ' added to ' + active().state.symbol);
  };
  for (const [name, side] of [['trade-buy', 1], ['trade-sell', -1]]) {
    $(name).onclick = () => {
      const quantity = Number($('trade-qty').value);
      if (quantity > 0) order(active().state.symbol, side * quantity);
      else toast('Enter a quantity above zero.');
    };
  }
  $('trade-reset').onclick = () => {
    state.paper = defaults().paper;
    afterChange();
  };
  $('replay-pick').onclick = () => {
    pause();
    setTool(tool === 'replay' ? 'cursor' : 'replay');
    if (tool === 'replay') toast('Select the bar where the replay should start.');
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
      if (key === 'z' && !event.shiftKey) travel(past, future);
      else if (key === 'y' || key === 'z') travel(future, past);
      else return;
      event.preventDefault();
    } else if (!typing && !event.altKey && !event.ctrlKey && !event.metaKey && /^[a-z]$/i.test(event.key) && !$('dialog').hasAttribute('open')) {
      event.preventDefault();
      symbolDialog('Symbol search', item => active().set({ symbol: item.symbol }), { query: event.key });
    }
  });
  deviceTheme.addEventListener('change', applyTheme);
  new ResizeObserver(() => charts.forEach(chart => chart.render())).observe($('charts'));
}

build();
applyTheme();
buildCharts();
applyPanel();
wire();
setTool('cursor');
afterChange();
renderPanel(true);

// Handle for the automated checks.
export const workspace = { get state() { return state; }, get charts() { return charts; }, active, setTool, checkAlerts, order };
