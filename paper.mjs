const alpacaEndpoint = 'https://paper-api.alpaca.markets/v2/account';
const ibkrEndpoint = 'https://localhost:5000/v1/api/portfolio/accounts';

export function paperChecks({ env = process.env, request = fetch } = {}) {
  const alpaca = {
    ready: /^PK[A-Z0-9]+$/.test(env.MERIDIAN_ALPACA_PAPER_KEY ?? '') && Boolean(env.MERIDIAN_ALPACA_PAPER_SECRET),
    url: alpacaEndpoint,
    headers: {
      'APCA-API-KEY-ID': env.MERIDIAN_ALPACA_PAPER_KEY,
      'APCA-API-SECRET-KEY': env.MERIDIAN_ALPACA_PAPER_SECRET
    },
    valid: data => typeof data?.id === 'string' && typeof data?.status === 'string'
  };
  const account = env.MERIDIAN_IBKR_PAPER_ACCOUNT;
  const ibkr = {
    ready: /^DU\d+$/.test(account ?? ''),
    url: ibkrEndpoint,
    headers: {},
    valid: data => Array.isArray(data) && data.some(row => row?.accountId === account)
  };
  const checks = { alpaca, ibkr };
  return async provider => {
    if (!Object.hasOwn(checks, provider)) throw new Error('Unknown paper provider');
    const check = checks[provider];
    if (!check.ready) return { provider, mode: 'paper', status: 'not_configured' };
    let status = 'unavailable';
    try {
      const response = await request(check.url, {
        method: 'GET', headers: { ...check.headers, Accept: 'application/json' },
        redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      if (response.status === 401 || response.status === 403) status = 'authorization_required';
      if (response.ok) status = check.valid(await response.json()) ? 'connected' : 'account_unverified';
    } catch {}
    return { provider, mode: 'paper', status };
  };
}
