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
  const network = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  // Nothing in this test reaches the network: Binance and the local server are unreachable until a later step stubs them.
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => null });
  globalThis.WebSocket = class { close() {} };
  try {
    const { workspace } = await import('./app.mjs');
    const get = id => document.getElementById(id);
    // Binance live data is on by default. The simulated workflow below runs with it turned off.
    assert.ok(workspace.live);
    get('settings').click();
    get('live-toggle').click();
    get('dialog-close').click();
    assert.equal(workspace.live, null);
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

    // A narrow-to-wide resize preserves the visible history rather than adding empty chart space.
    const host = chart().host;
    let width = 320;
    Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => width });
    chart().fit();
    const narrow = chart().visible().map(bar => bar.time);
    width = 1100;
    chart().render();
    assert.deepEqual(chart().visible().map(bar => bar.time), narrow);
    delete host.clientWidth;
    chart().fit();

    // The command palette supports filtering and dispatches existing controls from the keyboard.
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    assert.equal(document.activeElement, get('action-query'));
    get('action-query').value = 'watchlist';
    get('action-query').dispatchEvent(new window.Event('input'));
    assert.equal(all('#action-results button').length, 1);
    get('action-query').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    if (workspace.state.panel !== 'watch') get('panel-watch').click();
    get('close-panel-watch').click();
    assert.equal(workspace.state.panel, null);
    assert.equal(document.activeElement, get('panel-watch'));
    get('panel-watch').click();

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
    // Volume has its own pane, next to the two studies.
    assert.equal(all('#charts .pane-title').length, 3);
    document.querySelector('[aria-label="Remove MACD"]').click();
    assert.equal(all('#charts .pane-title').length, 2);
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
    point('pointerdown', 100, 270);
    point('pointerdown', 220, 230);
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

    // More drawing tools, strategies with a backtest report, working orders, insights and share links.
    const spy = () => workspace.state.drawings.SPY ?? [];
    get('tool-lines').click();
    get('tool-lines').click();
    pick('Parallel channel');
    point('pointerdown', 150, 90);
    point('pointerdown', 350, 60);
    assert.deepEqual([spy().at(-1).type, spy().at(-1).points.length], ['channel', 3]);
    get('tool-measure').click();
    get('tool-measure').click();
    pick('Price range');
    point('pointerdown', 200, 100);
    point('pointerdown', 200, 40);
    assert.equal(spy().at(-1).type, 'pricerange');
    assert.match(svg().textContent, /%\)/);
    get('remove').click();
    pick('Remove all drawings');

    get('panel-script').click();
    all('#script-examples button').find(button => button.textContent === 'Moving average cross strategy').click();
    get('script-test').click();
    assert.match(get('backtest').textContent, /Net profit/);
    assert.ok(get('backtest').querySelector('polyline').getAttribute('points').length > 20);
    assert.ok(svg().querySelectorAll('.marker').length > 0);
    get('script-add').click();
    assert.equal(chart().plots(chart().state.indicators.at(-1)).length, 2);
    get('script-source').value = 'close';
    get('script-test').click();
    assert.match(get('script-error').textContent, /buy when/);

    get('panel-trade').click();
    const last = chart().last().close;
    get('trade-type').value = 'limit';
    get('trade-type').dispatchEvent(new window.Event('change'));
    assert.ok(!get('trade-price-field').hidden);
    get('trade-qty').value = '5';
    get('trade-price').value = String(last * 0.9);
    get('trade-tp').value = String(last * 1.1);
    get('trade-sl').value = String(last * 0.8);
    get('trade-buy').click();
    assert.equal(workspace.state.paper.pending.length, 1);
    assert.ok(svg().querySelector('.order-line'));
    assert.match(get('pending').textContent, /Limit at/);
    assert.equal(workspace.fillOrders('SPY', { high: last, low: last * 0.95 }), false);
    assert.equal(workspace.fillOrders('SPY', { high: last, low: last * 0.85 }), true);
    assert.equal(workspace.state.paper.positions.SPY.qty, 5);
    assert.deepEqual(workspace.state.paper.pending.map(item => item.type), ['limit', 'stop']);
    assert.equal(workspace.fillOrders('SPY', { high: last * 1.2, low: last }), true);
    assert.deepEqual([workspace.state.paper.positions, workspace.state.paper.pending], [{}, []]);
    assert.ok(Math.abs(workspace.state.paper.cash - (100000 + 5 * last * 0.2)) < 1e-6);
    get('trade-reset').click();
    get('trade-type').value = 'market';

    get('panel-insights').click();
    assert.match(get('insights').textContent, /Trend/);
    assert.equal(get('insights').querySelectorAll('.card').length, 6);
    assert.ok(workspace.shareLink().startsWith('http://localhost:4173/#share='));
    get('panel-insights').click();

    // Persistence, theme and reset.
    assert.equal(stored().charts[0].symbol, 'SPY');
    assert.equal(stored().saved.Desk.layout, '4');
    get('theme').click();
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(stored().theme, 'light');
    get('settings').click();
    get('reset').click();
    assert.equal(window.localStorage.getItem('meridian.v1'), null);
    assert.deepEqual([chart().state.symbol, chart().state.interval, workspace.state.alerts.length], ['BTCUSDT.P', 60, 0]);
    // The reset restored the defaults, live Binance data included; carry on with a simulated chart.
    assert.ok(workspace.live);
    get('settings').click();
    get('live-toggle').click();
    get('dialog-close').click();
    chart().set({ symbol: 'SPY', interval: 1440 });
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(all('#symbols .symbol').length, 7);

    // Price and time axes: drag, buttons and double-click.
    const drag = (fromX, fromY, toX, toY) => {
      point('pointerdown', fromX, fromY);
      point('pointermove', toX, toY);
      point('pointerup', toX, toY);
    };
    const axisLabels = () => all('#charts svg text').map(node => node.textContent).join('|');
    assert.equal(get('auto').getAttribute('aria-pressed'), 'true');
    const automatic = axisLabels();
    drag(880, 100, 880, 220);
    assert.equal(get('auto').getAttribute('aria-pressed'), 'false');
    assert.notEqual(axisLabels(), automatic);
    get('auto').click();
    assert.equal(get('auto').getAttribute('aria-pressed'), 'true');
    assert.equal(axisLabels(), automatic);
    get('price-in').click();
    assert.equal(chart().autoScale, false);
    svg().dispatchEvent(new window.MouseEvent('dblclick', { clientX: 880, clientY: 100, bubbles: true }));
    assert.equal(chart().autoScale, true);
    svg().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
    assert.equal(chart().autoScale, false);
    get('fit').click();
    assert.equal(chart().autoScale, true);
    const shown = chart().visible().length;
    drag(400, 450, 250, 450);
    assert.ok(chart().visible().length > shown);
    get('fit').click();
    assert.equal(chart().visible().length, shown);

    // Indicator panes resize by dragging their top edge; colour, width, height and visibility are per indicator.
    const study = chart().addIndicator('rsi');
    assert.equal(study.size, undefined);
    drag(400, 346, 400, 300);
    assert.ok(study.size > 1.4 && study.size < 1.6);
    assert.ok(stored().charts[0].indicators.at(-1).size > 1.4);
    document.querySelector('[aria-label^="Settings for Relative"]').click();
    document.querySelector('#dialog-body [data-plot="0"]').value = '#ff0000';
    get('line-width').value = '3';
    all('#dialog-body button').at(-1).click();
    const curve = all('#charts svg .study').at(-1);
    assert.deepEqual([curve.getAttribute('stroke'), curve.getAttribute('stroke-width')], ['#ff0000', '3']);
    // Volume is a pane of its own: dragging its top edge makes it taller, and a setting draws it over the price instead.
    const volumeHeight = () => Math.max(...svg().querySelector('.volume').getAttribute('d').match(/v[0-9.]+/g).map(part => Number(part.slice(1))));
    const volume = chart().state.indicators.find(item => item.id === 'volume');
    const panes = all('#charts .pane-title').length;
    const edge = Number(all('#charts svg .grip')[0].getAttribute('y')) + 4;
    const standing = volumeHeight();
    drag(400, edge, 400, edge - 60);
    assert.ok(volume.size > 1);
    assert.ok(volumeHeight() > standing * 1.5);
    assert.ok(stored().charts[0].indicators.find(item => item.id === 'volume').size > 1);
    document.querySelector('[aria-label="Settings for Volume"]').click();
    document.querySelector('#dialog-body [data-key="overlay"]').checked = true;
    all('#dialog-body button').at(-1).click();
    assert.equal(all('#charts .pane-title').length, panes - 1);
    const low = volumeHeight();
    document.querySelector('[aria-label="Settings for Volume"]').click();
    document.querySelector('#dialog-body [data-key="height"]').value = '50';
    all('#dialog-body button').at(-1).click();
    assert.ok(volumeHeight() > low * 2);
    document.querySelector('[aria-label^="Hide Relative"]').click();
    assert.equal(all('#charts .pane-title').length, 0);
    document.querySelector('[aria-label^="Show Relative"]').click();
    assert.equal(all('#charts .pane-title').length, 1);
    chart().removeIndicator(study.uid);

    // The selected drawing can be restyled from its toolbar.
    assert.ok(get('drawbar').hidden);
    workspace.setTool('trend');
    point('pointerdown', 200, 200);
    point('pointerdown', 400, 150);
    assert.ok(!get('drawbar').hidden);
    get('draw-color').value = '#00ff00';
    get('draw-color').dispatchEvent(new window.Event('input'));
    get('draw-dash').value = 'dash';
    get('draw-dash').dispatchEvent(new window.Event('change'));
    get('draw-width').value = '3';
    get('draw-width').dispatchEvent(new window.Event('change'));
    const styled = workspace.state.drawings.SPY.at(-1);
    assert.deepEqual([styled.color, styled.dash, styled.width], ['#00ff00', 'dash', 3]);
    const mark = svg().querySelector('line.drawing');
    assert.deepEqual([mark.getAttribute('stroke'), mark.getAttribute('stroke-dasharray'), mark.getAttribute('stroke-width')], ['#00ff00', '7 5', '3.7']);
    get('draw-delete').click();
    assert.ok(get('drawbar').hidden);

    // Appearance, layout and toolbar choices apply immediately and are saved.
    const root = document.documentElement;
    get('settings').click();
    assert.ok(get('dialog').classList.contains('wide'));
    get('look-accent').value = '#ff00aa';
    get('look-accent').dispatchEvent(new window.Event('input'));
    assert.equal(root.style.getPropertyValue('--accent'), '#ff00aa');
    get('look-density').value = 'compact';
    get('look-density').dispatchEvent(new window.Event('change'));
    assert.equal(root.dataset.density, 'compact');
    get('look-side').value = 'left';
    get('look-side').dispatchEvent(new window.Event('change'));
    assert.equal(document.body.dataset.side, 'left');
    get('look-tools').click();
    assert.equal(document.body.dataset.tools, 'false');
    document.querySelector('[data-show="replay"]').click();
    document.querySelector('[data-show="panel-watch"]').click();
    assert.ok(get('replay').hidden && get('panel-watch').hidden);
    assert.equal(document.body.dataset.panel, '');
    get('look-theme').value = 'dark';
    get('look-theme').dispatchEvent(new window.Event('change'));
    assert.equal(root.dataset.theme, 'dark');
    assert.deepEqual([stored().look.accent, stored().look.density, stored().hidden, stored().settings.panelSide], ['#ff00aa', 'compact', ['replay', 'panel-watch'], 'left']);
    get('look-reset').click();
    assert.equal(root.style.getPropertyValue('--accent'), '');
    get('dialog-close').click();
    get('panel-grip').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    assert.equal(root.style.getPropertyValue('--panel-width'), '344px');

    // Imported workspaces are sanitised before use.
    workspace.importWorkspace({
      layout: '9', charts: [{ symbol: 'TSLA', interval: 60, indicators: [{ id: 'nope' }], compare: ['???'] }, { symbol: '???', interval: 60 }],
      drawings: { TSLA: [{ type: 'trend', points: [{ t: 1, p: 'x' }] }, { type: 'hline', points: [{ t: 1, p: 2 }] }], NOPE: [] },
      paper: { cash: 'lots', pending: [{ symbol: 'TSLA', qty: 1, price: -1, type: 'limit' }] }, alerts: [{ symbol: 'TSLA', condition: 'x', price: 1 }]
    });
    assert.deepEqual([workspace.state.layout, workspace.state.charts.length, chart().state.symbol], ['1', 1, 'TSLA']);
    assert.deepEqual([chart().state.indicators, chart().state.compare], [[], []]);
    assert.deepEqual(Object.keys(workspace.state.drawings), ['TSLA']);
    assert.equal(workspace.state.drawings.TSLA.length, 1);
    assert.deepEqual([workspace.state.paper.cash, workspace.state.paper.pending, workspace.state.alerts], [100000, [], []]);
    assert.deepEqual([workspace.state.look.accent, workspace.state.hidden, document.body.dataset.side, get('replay').hidden], [null, [], 'right', false]);

    // An imported workspace from before 0.3 is switched to live data. Switched off, live charts say so; switched on, it loads, streams and drives alerts.
    assert.ok(workspace.live);
    get('settings').click();
    get('live-toggle').click();
    get('dialog-close').click();
    assert.equal(workspace.live, null);
    const sockets = [];
    const row = (time, close) => [time, String(close), String(close + 1), String(close - 1), String(close), '5'];
    globalThis.fetch = async () => ({ ok: true, json: async () => Array.from({ length: 80 }, (_, index) => row(index * 86400000, 100 + index)) });
    globalThis.WebSocket = class {
      constructor(url) {
        this.url = url;
        sockets.push(this);
      }
      close() {}
    };
    chart().set({ symbol: 'BTCUSDT', interval: 1440 });
    assert.match(svg().textContent, /Live data is turned off/);
    get('settings').click();
    get('live-toggle').click();
    get('dialog-close').click();
    assert.ok(workspace.state.watchlist.includes('BTCUSDT'));
    assert.match(svg().textContent, /Loading live data/);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(svg().querySelector('.candles'));
    assert.equal(chart().bars().length, 80);
    assert.match(get('status').textContent, /Live data · Binance spot/);
    assert.match(document.querySelector('.legend .chip').textContent, /Live/);
    // One stream for the chart, then one daily stream per live watchlist symbol while the watchlist is open.
    assert.match(sockets[0].url, /btcusdt@kline_1d$/);
    assert.equal(new Set(sockets.map(socket => socket.url)).size, sockets.length);
    get('alert').click();
    get('alert-condition').value = 'cross';
    get('alert-price').value = '200';
    get('alert-create').click();
    sockets[0].onmessage({ data: JSON.stringify({ k: { t: 80 * 86400000, o: '179', h: '205', l: '179', c: '204', v: '3' } }) });
    assert.equal(workspace.state.alerts[0].status, 'triggered');
    assert.equal(chart().bars().length, 81);
    get('settings').click();
    get('live-toggle').click();
    assert.equal(workspace.live, null);
    assert.match(svg().textContent, /Live data is turned off/);

    // Binance account: positions and orders reach the panel and the chart, and every order waits for approval.
    get('live-toggle').click();
    get('dialog-close').click();
    const posted = [];
    let account = {
      at: 1, mode: 'testnet', hedge: false, revision: 1, account: { wallet: 1000, margin: 1010, available: 900, unrealized: 10, maintenance: 4 },
      positions: [{ symbol: 'BTCUSDT', side: 'BOTH', amount: 0.01, entry: 150, breakEven: 151, mark: 160, liquidation: 120, unrealized: 0.1, notional: 1.6, margin: 1, leverage: 20, marginType: 'CROSSED' }],
      orders: [{ id: '21', algo: true, symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH', kind: 'stop', quantity: null, filled: 0, price: null, trigger: 140, reduceOnly: false, closePosition: true }]
    };
    const candles = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      if (!String(url).startsWith('./api/binance')) return candles(url, options);
      const reply = data => ({ ok: true, status: 200, json: async () => data });
      if (url === './api/binance') return reply({ provider: 'binance', status: 'connected', mode: 'testnet', hedge: false });
      if (url === './api/binance/account') return reply(account);
      posted.push([url.slice('./api/binance/'.length), JSON.parse(options.body)]);
      account = { ...account, at: account.at + 1 };
      return reply({});
    };
    assert.equal(workspace.broker.state.status, 'unavailable');
    chart().set({ symbol: 'BTCUSDT.P', interval: 1440 });
    await new Promise(resolve => setImmediate(resolve));
    get('panel-trade').click();
    get('trade-binance').click();
    assert.equal(workspace.state.tradeAccount, 'binance');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(workspace.broker.state.status, 'connected');
    assert.deepEqual([get('paper-pane').hidden, get('bn-connect').hidden, get('bn-live').hidden], [true, true, false]);
    assert.match(get('bn-note').textContent, /Connected to Binance.*Testnet/);
    assert.match(get('bn-positions').textContent, /Long 0\.01 BTCUSDT · 20x.*Entry150\.0.*Break-even151\.0.*Liquidation120\.0/);
    assert.match(get('bn-orders').textContent, /Sell whole position BTCUSDT.*Stop loss · Trigger price 140\.0/);
    assert.equal(svg().querySelectorAll('.account-line').length, 4);
    assert.match(svg().textContent, /Liquidation/);
    assert.equal(get('bn-buy').disabled, false);
    const approve = async () => {
      get('bn-confirm').click();
      for (let turn = 0; turn < 4; turn += 1) await new Promise(resolve => setImmediate(resolve));
    };
    all('#bn-positions button').find(button => button.textContent === 'Reverse').click();
    assert.match(get('bn-confirm-text').textContent, /Reverse Long 0\.01 BTCUSDT at market/);
    assert.equal(posted.length, 0, 'nothing is sent before approval');
    await approve();
    assert.deepEqual(posted.at(-1), ['reverse', { symbol: 'BTCUSDT' }]);
    get('bn-type').value = 'limit';
    get('bn-type').dispatchEvent(new window.Event('change'));
    assert.deepEqual([get('bn-price-field').hidden, get('bn-trigger-field').hidden, get('bn-tp-field').hidden], [false, true, false]);
    get('bn-buy').click();
    assert.match(get('toasts').textContent, /Enter a quantity above zero/);
    get('bn-qty').value = '0.02';
    get('bn-price').value = '145';
    get('bn-sl').value = '130';
    get('bn-buy').click();
    assert.match(get('bn-confirm-text').textContent, /Buy 0\.02 BTCUSDT · Limit · Limit at 145 · Stop loss 130/);
    await approve();
    assert.deepEqual(posted.at(-1), ['order', { symbol: 'BTCUSDT', side: 'BUY', kind: 'limit', quantity: '0.02', reduceOnly: false, price: '145', stopLoss: '130' }]);
    get('bn-type').value = 'trailing';
    get('bn-type').dispatchEvent(new window.Event('change'));
    get('bn-callback').value = '1.5';
    get('bn-sell').click();
    await approve();
    assert.deepEqual(posted.at(-1), ['order', { symbol: 'BTCUSDT', side: 'SELL', kind: 'trailing', quantity: '0.02', reduceOnly: true, callbackRate: '1.5' }]);
    all('#bn-orders button').find(button => button.textContent === 'Cancel').click();
    await approve();
    assert.deepEqual(posted.at(-1), ['cancel', { symbol: 'BTCUSDT', id: '21', algo: true }]);
    // A spot chart cannot be traded on the futures account, and the paper account is untouched throughout.
    chart().set({ symbol: 'BTCUSDT', interval: 1440 });
    assert.equal(get('bn-buy').disabled, true);
    assert.equal(svg().querySelectorAll('.account-line').length, 0);
    get('trade-paper').click();
    assert.deepEqual([get('paper-pane').hidden, get('binance-pane').hidden], [false, true]);
    workspace.broker.stop();
    get('settings').click();
    get('live-toggle').click();
    assert.equal(workspace.live, null);
    // The panel refresh that live prices schedule runs up to a second later; let it finish while the page still exists.
    await new Promise(resolve => setTimeout(resolve, 1100));
  } finally {
    Object.assign(globalThis, network);
    window.close();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
