import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { detect, locales, t, useLocale } from './i18n.mjs';
import { check } from './tools/check-locale.mjs';
import { extract } from './tools/extract-strings.mjs';

test('workspace opens in the stored language and applies a shared link', async () => {
  const portuguese = (await import('./locales/pt-PT.mjs')).default;
  const payload = {
    v: 1, layout: '2h', charts: [{ symbol: 'NVDA', interval: 60 }, { symbol: 'AAPL', interval: 240, style: 'Nope' }, { symbol: '???', interval: 60 }],
    drawings: { NVDA: [{ type: 'hline', points: [{ t: 1, p: 2 }] }, { type: 'evil', points: [{ t: 1, p: 2 }] }] }
  };
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  const { window } = new JSDOM(html, { url: 'http://localhost:4173/#share=' + Buffer.from(JSON.stringify(payload)).toString('base64url') });
  const { document } = window;
  window.localStorage.setItem('meridian.v2', JSON.stringify({ locale: 'pt-PT', charts: [{ symbol: 'TSLA', interval: 1440 }] }));
  const globals = {
    document, localStorage: window.localStorage,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    ResizeObserver: class { observe() {} }
  };
  const original = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
  // Live data is on by default; nothing in this test reaches Binance or a local server.
  const network = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => null });
  globalThis.WebSocket = class { close() {} };
  try {
    const { workspace } = await import('./app.mjs');
    const get = id => document.getElementById(id);
    assert.equal(document.documentElement.lang, 'pt-PT');
    assert.equal(document.documentElement.dir, 'ltr');
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.notEqual(portuguese['Add symbol'], 'Add symbol');
    assert.equal(get('watch-add').textContent, portuguese['Add symbol']);
    assert.equal(get('symbol').getAttribute('aria-label'), portuguese['Symbol search']);
    assert.equal(get('tools').getAttribute('aria-label'), portuguese['Drawing tools']);
    assert.equal(get('script-source').value, 'close - sma(close, 20)');
    assert.equal(get('language').textContent, 'PT');
    assert.equal(document.querySelector('.legend .chip').textContent, portuguese.Simulated);

    assert.equal(workspace.state.layout, '2h');
    assert.deepEqual(workspace.charts.map(chart => [chart.state.symbol, chart.state.interval, chart.state.style]), [['NVDA', 60, 'Candles'], ['AAPL', 240, 'Candles']]);
    assert.deepEqual(workspace.state.drawings.NVDA.map(item => item.type), ['hline']);
    assert.deepEqual(workspace.state.saved[portuguese['Before shared link']].charts.map(chart => chart.symbol), ['TSLA']);
    assert.equal(window.location.hash, '');
    assert.match(document.getElementById('toasts').textContent, new RegExp(portuguese['Before shared link']));

    get('language').click();
    const entries = [...document.querySelectorAll('.menu button')];
    assert.equal(entries.length, 21);
    assert.deepEqual(entries.filter(entry => entry.getAttribute('aria-checked') === 'true').map(entry => entry.lang), ['pt-PT']);
    assert.equal(document.querySelector('.menu-heading').textContent, portuguese['Machine-translated, not yet reviewed']);
    // Let the start-up requests settle before the page goes away.
    workspace.broker.stop();
    for (let turn = 0; turn < 6; turn += 1) await new Promise(resolve => setImmediate(resolve));
  } finally {
    Object.assign(globalThis, network);
    window.close();
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('the source catalogue is current and every locale covers it', async () => {
  assert.deepEqual(await extract(), JSON.parse(await readFile(new URL('./locales/source.json', import.meta.url), 'utf8')),
    'run "node tools/extract-strings.mjs" after changing interface text');
  assert.equal(locales.length, 21);
  assert.deepEqual(locales.filter(item => item.dir === 'rtl').map(item => item.tag), ['ar-SA', 'ur-PK', 'arz-Arab-EG']);
  for (const item of locales.filter(entry => entry.tag !== 'en-GB')) assert.deepEqual(await check(item.tag), [], item.tag);
});

test('locales are detected from browser preferences and fall back to English', async () => {
  const pick = (...wanted) => detect(wanted).tag;
  assert.deepEqual([pick('pt-BR'), pick('pt'), pick('pt-AO'), pick('zh-CN'), pick('fr-CA', 'de'), pick('xx', 'ja'), pick('en-US'), pick('xx'), pick()],
    ['pt-BR', 'pt-PT', 'pt-PT', 'zh-Hans-CN', 'fr-FR', 'ja-JP', 'en-GB', 'en-GB', 'en-GB']);
  const arabic = await useLocale('ar-SA');
  assert.equal(arabic.dir, 'rtl');
  assert.notEqual(t('Settings'), 'Settings');
  assert.match(t('Remove {0}', 'SPY'), /SPY/);
  assert.equal((await useLocale('nope')).tag, 'en-GB');
  assert.equal(t('Settings'), 'Settings');
  assert.equal(t('Hello {0}{1}!', 'a'), 'Hello a!');
  assert.equal((await useLocale('de-DE', async () => { throw new Error('offline'); })).tag, 'en-GB');
  assert.equal(t('Settings'), 'Settings');
});
