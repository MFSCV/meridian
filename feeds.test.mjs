import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeeds, readFilings, readRates } from './feeds.mjs';

const xml = "<Cube time='2026-11-10'><Cube currency='USD' rate='1.16'/></Cube>";
const filing = { filings: { recent: {
  form: ['10-K'], filingDate: ['2026-11-09'], acceptanceDateTime: ['2026-11-09T22:00:55.000Z'],
  accessionNumber: ['0000320193-26-000001']
} } };

test('official adapters preserve dates and expose only rate and filing fields', () => {
  assert.deepEqual(readRates(xml), { observedAt: '2026-11-10', rows: [{ currency: 'USD', rate: '1.16' }] });
  assert.deepEqual(readFilings(filing), {
    observedAt: '2026-11-09T22:00:55.000Z',
    rows: [{ form: '10-K', filed: '2026-11-09', accepted: '2026-11-09T22:00:55.000Z', accession: '0000320193-26-000001' }]
  });
  assert.throws(() => readRates('<html>Unavailable</html>'));
  assert.throws(() => readFilings({}));
});

test('feeds coalesce refreshes and label unavailable and stale results independently', async () => {
  let clock = Date.parse('2026-11-10T17:00:00Z');
  let calls = 0;
  const feeds = createFeeds({ now: () => clock, request: async url => {
    calls++;
    if (url.includes('sec.gov') || calls > 2) return new Response(null, { status: 503 });
    return new Response(xml);
  } });
  const [first, shared] = await Promise.all([feeds('ecb'), feeds('ecb')]);
  assert.equal(first.status, 'available');
  assert.deepEqual(shared, first);
  assert.equal(calls, 1);
  assert.equal((await feeds('edgar')).status, 'unavailable');
  assert.deepEqual(await feeds('ecb'), first);
  clock += 301000;
  const stale = await feeds('ecb');
  assert.equal(stale.status, 'stale');
  assert.equal(stale.retrievedAt, first.retrievedAt);
  assert.notEqual(stale.checkedAt, first.checkedAt);
  assert.deepEqual(stale.rows, first.rows);
});
