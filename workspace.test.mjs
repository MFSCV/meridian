import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('workspace drives charts, drawings, alerts, replay, panels and preferences through its controls', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html, { url: 'http://localhost:4173' });
  const { document } = window;
  window.localStorage.setItem('meridian.v1', JSON.stringify({ symbol: 'AAPL', interval: 4, style: 'Line', average: true, volume: true, theme: 'dark' }));
  const globals = {
    document, localStorage: window.localStorage,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class { observe() {} }
  };
  const original = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  try {
    const { workspace } = await import('./app.mjs');
    const get = id => document.getElementById(id);
    const all = selector => [...document.querySelectorAll(selector)];
    const pick = label => {
      const entry = all('.menu button').find(button => button.textContent.startsWith(label));
      assert.ok(entry, 'menu entry ' + label);
      entry.click();
    };
    const chart = () => workspace.active();
    const svg = () => document.querySelector('#charts svg');
    const point = (type, x, y) => svg().dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    const stored = () => JSON.parse(window.localStorage.getItem('meridian.v2'));
    const readout = () => document.querySelector('.legend .main .values').textContent;

    // Prototype 0.1 preferences migrate into the new workspace.
    assert.deepEqual([chart().state.symbol, chart().state.interval, chart().state.style], ['AAPL', 240, 'Line']);
    assert.deepEqual(chart().state.indicators.map(item => item.id), ['volume', 'sma']);
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(get('theme').getAttribute('aria-label'), 'Use light theme');
    assert.ok(svg().querySelector('.price-line'));

    // Symbol search, interval and chart type.
    get('symbol').click();
    get('symbol-query').value = 'ethereum';
    get('symbol-query').dispatchEvent(new window.Event('input'));
    assert.deepEqual(all('#symbol-results .result').map(item => item.dataset.symbol), ['ETHUSDT.P']);
    document.querySelector('#symbol-results .result').click();
    assert.equal(chart().state.symbol, 'ETHUSDT.P');
    assert.ok(!get('dialog').hasAttribute('open'));
    assert.match(get('symbol').textContent, /ETHUSDT\.P/);
    get('interval').click();
    assert.equal(all('.menu button').length, 9);
    pick('5 minutes');
    assert.equal(chart().state.interval, 5);
    assert.equal(chart().bars().length, 41472);
    for (const [style, marker] of [['Bars', '.candles'], ['Area', '.area'], ['Heikin Ashi', '.candles'], ['Candles', '.candles']]) {
      get('style').click();
      pick(style);
      assert.ok(svg().querySelector(marker), style);
    }
    assert.ok(svg().querySelector('.volume'));

    // Indicators, comparison and the legend.
    get('indicators').click();
    for (const id of ['rsi', 'macd', 'bb']) document.querySelector('[data-indicator="' + id + '"]').click();
    get('dialog-close').click();
    assert.equal(all('.legend-row').length, 6);
    assert.equal(all('#charts .pane-title').length, 2);
    document.querySelector('[aria-label="Remove MACD"]').click();
    assert.equal(all('#charts .pane-title').length, 1);
    document.querySelector('[aria-label^="Settings for Relative"]').click();
    document.querySelector('#dialog-body [data-key="length"]').value = '0';
    all('#dialog-body button').at(-1).click();
    assert.match(document.querySelector('#dialog-body .error').textContent, /from 1 to 500/);
    document.querySelector('#dialog-body [data-key="length"]').value = '21';
    all('#dialog-body button').at(-1).click();
    assert.equal(chart().state.indicators.find(item => item.id === 'rsi').params.length, 21);
    get('compare').click();
    document.querySelector('#symbol-results [data-symbol="BTCUSD"]').click();
    assert.ok(svg().querySelector('.compare'));
    assert.match(document.querySelector('[data-compare="BTCUSD"]').textContent, /%$/);

    // Zoom, scroll, ranges and keyboard inspection.
    const visible = () => chart().visible().length;
    const wide = visible();
    get('zoom-in').click();
    assert.ok(visible() < wide);
    get('fit').click();
    assert.equal(visible(), wide);
    const latest = readout();
    get('scroll-left').click();
    assert.ok(chart().visible().at(-1).time < chart().last().time);
    get('latest').click();
    assert.equal(chart().visible().at(-1).time, chart().last().time);
    document.querySelector('[data-range="1M"]').click();
    assert.equal(chart().state.interval, 60);
    assert.equal(visible(), 720);
    svg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    svg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    assert.notEqual(readout(), latest);
    assert.equal(chart().crossIndex, chart().bars().length - 2);
    svg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(chart().crossIndex, null);

    // Drawings with undo, redo, magnet, lock and removal.
    const drawings = () => workspace.state.drawings['ETHUSDT.P'] ?? [];
    get('tool-lines').click();
    assert.equal(get('tool-lines').getAttribute('aria-pressed'), 'true');
    point('pointerdown', 120, 120);
    point('pointermove', 300, 200);
    point('pointerdown', 300, 200);
    assert.deepEqual(drawings().map(item => item.type), ['trend']);
    assert.equal(get('tool-cursor').getAttribute('aria-pressed'), 'true');
    assert.equal(svg().querySelectorAll('circle').length, 2);
    get('undo').click();
    assert.equal(drawings().length, 0);
    get('redo').click();
    assert.equal(drawings().length, 1);
    get('tool-lines').click();
    get('tool-lines').click();
    pick('Horizontal line');
    get('toggle-magnet').click();
    point('pointerdown', 200, 150);
    const level = drawings()[1].points[0];
    const bar = chart().bars().find(item => item.time === level.t);
    assert.ok([bar.open, bar.high, bar.low, bar.close].includes(level.p));
    for (const [group, type, clicks] of [['fib', 'fib', 2], ['shapes', 'rect', 2], ['position', 'position', 1]]) {
      get('tool-' + group).click();
      point('pointerdown', 400, 100);
      if (clicks === 2) point('pointerdown', 500, 220);
      assert.equal(drawings().at(-1).type, type);
    }
    assert.equal(drawings().at(-1).points.length, 3);
    get('tool-text').click();
    point('pointerdown', 250, 90);
    get('note-text').value = 'Breakout';
    all('#dialog-body button').at(-1).click();
    assert.equal(drawings().at(-1).text, 'Breakout');
    get('tool-measure').click();
    point('pointerdown', 100, 300);
    point('pointerdown', 220, 260);
    assert.equal(drawings().length, 6);
    assert.match(svg().textContent, /bars/);
    get('toggle-hide').click();
    assert.equal(svg().querySelectorAll('.drawing').length, 0);
    get('toggle-hide').click();
    assert.ok(svg().querySelectorAll('.drawing').length >= 6);
    svg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete' }));
    assert.deepEqual(drawings().map(item => item.type), ['trend', 'hline', 'fib', 'rect', 'position']);
    point('pointerdown', 210, 160);
    point('pointerup', 210, 160);
    assert.equal(chart().selected, drawings()[0].id);
    svg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete' }));
    assert.equal(drawings().length, 4);
    get('remove').click();
    pick('Remove all drawings');
    assert.equal(drawings().length, 0);

    // Multi-chart layouts with symbol sync, then saved layouts.
    get('layout').click();
    pick('Four charts');
    assert.equal(all('#charts svg').length, 4);
    get('layout').click();
    pick('Sync symbol');
    workspace.charts[0].set({ symbol: 'NVDA' });
    assert.deepEqual(workspace.charts.map(item => item.state.symbol), ['NVDA', 'NVDA', 'NVDA', 'NVDA']);
    get('layouts').click();
    pick('Save layout');
    get('layout-name').value = 'Desk';
    get('layout-save').click();
    get('layout').click();
    pick('Single chart');
    assert.equal(all('#charts svg').length, 1);
    get('layouts').click();
    pick('Desk');
    assert.equal(all('#charts svg').length, 4);
    get('layout').click();
    pick('Single chart');

    // Alerts trigger on creation and when a replay bar crosses the level.
    get('alert').click();
    get('alert-condition').value = 'above';
    get('alert-price').value = '1';
    get('alert-create').click();
    assert.equal(workspace.state.alerts[0].status, 'triggered');
    assert.equal(workspace.state.panel, 'alerts');
    assert.match(get('alert-list').textContent, /Triggered on bar/);
    get('replay').click();
    assert.ok(chart().replaying && !get('replaybar').hidden);
    const start = chart().last();
    const next = chart().state && workspace.charts[0].bars().length;
    get('alert').click();
    get('alert-condition').value = 'cross';
    get('alert-price').value = String(start.close);
    get('alert-create').click();
    assert.equal(workspace.state.alerts[0].status, 'active');
    assert.ok(svg().querySelector('.alert-line'));
    get('replay-step').click();
    assert.equal(chart().bars().length, next + 1);
    assert.equal(workspace.state.alerts[0].status, 'triggered');
    assert.equal(workspace.state.log.length, 2);
    get('replay-exit').click();
    assert.ok(!chart().replaying && get('replaybar').hidden);

    // Side panels: paper trading, screener, formulas, data window and watchlist.
    get('panel-trade').click();
    get('trade-qty').value = '10';
    get('trade-buy').click();
    get('trade-buy').click();
    get('trade-sell').click();
    assert.equal(workspace.state.paper.positions.NVDA.qty, 10);
    assert.match(get('positions').textContent, /Long 10 NVDA/);
    assert.match(get('account').textContent, /\$100,000\.00/);
    document.querySelector('[aria-label="Close NVDA position"]').click();
    assert.deepEqual(workspace.state.paper.positions, {});
    assert.equal(workspace.state.paper.cash, 100000);
    get('panel-screener').click();
    assert.equal(get('screen').tBodies[0].rows.length, 18);
    get('screen-type').value = 'Crypto';
    get('screen-type').dispatchEvent(new window.Event('change'));
    assert.equal(get('screen').tBodies[0].rows.length, 3);
    get('screen').tHead.querySelector('button').click();
    assert.deepEqual([...get('screen').tBodies[0].rows].map(row => row.cells[0].textContent), ['BTCUSD', 'ETHUSDT.P', 'SOLUSD']);
    get('panel-script').click();
    get('script-source').value = 'close +';
    get('script-add').click();
    assert.match(get('script-error').textContent, /too early/);
    get('script-source').value = 'ema(close, 12) - ema(close, 26)';
    get('script-add').click();
    assert.equal(chart().state.indicators.at(-1).id, 'formula');
    get('panel-data').click();
    assert.match(get('window').textContent, /Close/);
    assert.match(get('objects').textContent, /Momentum/);
    assert.ok(get('data').rows.length > 100);
    get('panel-watch').click();
    assert.equal(all('#symbols .symbol').length, 7);
    document.querySelector('[aria-label="Remove QQQ from watchlist"]').click();
    assert.equal(all('#symbols .symbol').length, 6);
    document.querySelector('#symbols [data-symbol="SPY"]').click();
    assert.equal(chart().state.symbol, 'SPY');
    assert.match(get('details').textContent, /S&P 500 ETF/);
    get('panel-watch').click();
    assert.equal(document.body.dataset.panel, '');

    // Persistence, theme and reset.
    assert.equal(stored().charts[0].symbol, 'SPY');
    assert.equal(stored().saved.Desk.layout, '4');
    get('theme').click();
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(stored().theme, 'light');
    get('settings').click();
    get('reset').click();
    assert.equal(window.localStorage.getItem('meridian.v1'), null);
    assert.deepEqual([chart().state.symbol, chart().state.interval, workspace.state.alerts.length], ['SPY', 1440, 0]);
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(all('#symbols .symbol').length, 7);
  } finally {
    window.close();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
