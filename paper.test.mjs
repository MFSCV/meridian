import test from 'node:test';
import assert from 'node:assert/strict';
import { paperChecks } from './paper.mjs';

test('paper checks refuse missing and live credentials without making network calls', async () => {
  const check = paperChecks({
    env: { MERIDIAN_ALPACA_PAPER_KEY: 'AKLIVE', MERIDIAN_ALPACA_PAPER_SECRET: 'fixture', MERIDIAN_IBKR_PAPER_ACCOUNT: 'U123' },
    request: () => assert.fail('Unexpected upstream request')
  });
  assert.equal((await check('alpaca')).status, 'not_configured');
  assert.equal((await check('ibkr')).status, 'not_configured');
});

test('paper verification uses fixed read-only endpoints and returns no broker data', async () => {
  const calls = [];
  const check = paperChecks({
    env: { MERIDIAN_ALPACA_PAPER_KEY: 'PKTEST', MERIDIAN_ALPACA_PAPER_SECRET: 'fixture', MERIDIAN_IBKR_PAPER_ACCOUNT: 'DU123' },
    request: async (url, options) => {
      calls.push([url, options.method, options.redirect]);
      return Response.json(url.includes('alpaca') ? { id: 'hidden', status: 'ACTIVE' } : [{ accountId: 'DU123' }]);
    }
  });
  assert.deepEqual(await check('alpaca'), { provider: 'alpaca', mode: 'paper', status: 'connected' });
  assert.deepEqual(await check('ibkr'), { provider: 'ibkr', mode: 'paper', status: 'connected' });
  assert.deepEqual(calls, [
    ['https://paper-api.alpaca.markets/v2/account', 'GET', 'error'],
    ['https://localhost:5000/v1/api/portfolio/accounts', 'GET', 'error']
  ]);
});

test('IBKR verifies the selected paper account before reporting connection', async () => {
  const check = paperChecks({
    env: { MERIDIAN_IBKR_PAPER_ACCOUNT: 'DU123' },
    request: async () => Response.json([{ accountId: 'U123' }])
  });
  assert.equal((await check('ibkr')).status, 'account_unverified');
});
