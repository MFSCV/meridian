import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('observed panels automatically refresh while visible and pause while hidden', async () => {
  const { window } = new JSDOM(
    '<button id="refresh-feeds"></button><p id="ecb-status"></p><p id="edgar-status"></p>' +
    '<table><tbody id="ecb-rows"></tbody><tbody id="edgar-rows"></tbody></table>',
    { pretendToBeVisual: true }
  );
  const original = { document: globalThis.document, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const pending = new Set();
  const calls = [];
  let hidden = false;
  let staticHost = false;
  Object.defineProperty(window.document, 'hidden', { get: () => hidden });
  globalThis.document = window.document;
  globalThis.fetch = async path => {
    calls.push(path);
    if (staticHost) return new Response(null, { status: 404 });
    return Response.json({
      status: 'available', observedAt: '2026-11-10', retrievedAt: '2026-11-10T17:00:00Z',
      rows: path.endsWith('ecb') ? [{ currency: 'USD', rate: '1.16' }] :
        [{ form: '10-K', filed: '2026-11-10', accession: '0000320193-26-000001' }]
    });
  };
  globalThis.setTimeout = (callback, ms) => {
    assert.equal(ms, 60000);
    pending.add(callback);
    return callback;
  };
  globalThis.clearTimeout = callback => pending.delete(callback);
  const drain = () => new Promise(resolve => setImmediate(resolve));
  try {
    await import('./observed.mjs');
    await drain();
    assert.equal(calls.length, 2);
    assert.equal(pending.size, 1);
    const refresh = [...pending][0];
    await refresh();
    assert.equal(calls.length, 4);
    assert.equal(pending.size, 1);
    hidden = true;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    assert.equal(pending.size, 0);
    hidden = false;
    window.document.dispatchEvent(new window.Event('visibilitychange'));
    await drain();
    assert.equal(calls.length, 6);
    assert.match(window.document.getElementById('ecb-status').textContent, /Reference date 2026-11-10/);
    staticHost = true;
    for (const id of ['ecb-rows', 'edgar-rows']) window.document.getElementById(id).replaceChildren();
    await [...pending][0]();
    assert.equal(pending.size, 0);
    assert.equal(window.document.getElementById('refresh-feeds').disabled, true);
    assert.equal(window.document.querySelector('#ecb-status a').textContent, 'Open private Meridian');
  } finally {
    Object.assign(globalThis, original);
    window.close();
  }
});
