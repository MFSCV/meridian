// Browser side of the Binance account connection. It talks only to the local Meridian server, which holds
// the API key and signs every request; the key and the secret never stay in the page.
export function createBroker({ request = (...args) => fetch(...args), onChange = () => {}, every = 2500,
  repeat = (run, delay) => { const timer = setInterval(run, delay); timer.unref?.(); return timer; }, stop = clearInterval } = {}) {
  // status: unknown, no_server, not_configured, connected, authorization_required, unavailable
  const state = { status: 'unknown', mode: null, hedge: false, message: null, account: null, positions: [], orders: [], revision: -1 };
  let timer = null;
  let busy = false;

  async function send(path, body) {
    let response;
    try {
      response = await request('./api/binance' + path, body === undefined ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw Object.assign(new Error('The local Meridian server did not answer.'), { offline: true });
    }
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.status === 404 || response.status === 405 || (response.ok && data?.provider === undefined && path === '')) {
      throw Object.assign(new Error('This copy of Meridian has no local server.'), { offline: true });
    }
    if (!response.ok) throw Object.assign(new Error(data?.error ?? 'The request failed.'), { status: response.status });
    return data;
  }

  function apply(status) {
    Object.assign(state, { status: status.status, mode: status.mode ?? null, hedge: Boolean(status.hedge), message: status.message ?? null });
    if (state.status !== 'connected') Object.assign(state, { account: null, positions: [], orders: [], revision: -1 });
    if (state.status === 'connected' && !timer) timer = repeat(() => api.refresh(), every);
    if (state.status !== 'connected' && timer) {
      stop(timer);
      timer = null;
    }
  }

  const api = {
    state,
    // Reads the connection status once, for example when the page opens.
    async check() {
      try {
        apply(await send(''));
        if (state.status === 'connected') await api.refresh(true);
      } catch (problem) {
        apply({ status: problem.offline ? 'no_server' : 'unavailable', message: problem.message });
      }
      onChange();
      return state.status;
    },
    // Loads balances, positions and orders. Skips the update when nothing changed.
    async refresh(force) {
      if (busy || state.status !== 'connected') return;
      busy = true;
      try {
        const data = await send('/account');
        const changed = force || data.at !== state.at;
        Object.assign(state, { account: data.account, positions: data.positions, orders: data.orders, revision: data.revision, hedge: data.hedge, mode: data.mode, at: data.at, message: null });
        if (changed) onChange();
      } catch (problem) {
        if (problem.status === 409 || problem.status === 401) apply({ status: problem.status === 401 ? 'authorization_required' : 'not_configured', message: problem.message });
        else state.message = problem.message;
        onChange();
      } finally {
        busy = false;
      }
    },
    async connect(key, secret, testnet) {
      apply(await send('/connect', { key, secret, testnet }));
      await api.refresh(true);
      onChange();
    },
    async disconnect() {
      apply(await send('/disconnect', {}));
      onChange();
    },
    // Runs one account action (order, cancel, close, reverse, ...) and reloads the account.
    async act(action, body) {
      const result = await send('/' + action, body);
      await api.refresh(true);
      return result;
    },
    stop() {
      if (timer) stop(timer);
      timer = null;
    }
  };
  return api;
}

// The Binance futures pair behind a chart symbol, or null when the symbol is not a perpetual future.
export const futuresPair = symbol => typeof symbol === 'string' && symbol.endsWith('.P') ? symbol.slice(0, -2) : null;
