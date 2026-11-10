const ecb = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const sec = 'https://data.sec.gov/submissions/CIK0000320193.json';
const expiry = { ecb: 300000, edgar: 60000 };
const date = /^\d{4}-\d{2}-\d{2}$/;

export function readRates(xml) {
  const observedAt = xml.match(/\btime=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rows = [...xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"](\d+(?:\.\d+)?)['"]\s*\/>/g)]
    .map(([, currency, rate]) => ({ currency, rate }));
  if (!observedAt || !rows.length) throw new Error('Invalid ECB data');
  return { observedAt, rows };
}

export function readFilings(data) {
  const recent = data.filings.recent;
  const rows = recent.form.slice(0, 10).map((form, index) => {
    const filed = recent.filingDate[index];
    const accession = recent.accessionNumber[index];
    const accepted = recent.acceptanceDateTime[index];
    if (typeof form !== 'string' || !date.test(filed) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) {
      throw new Error('Invalid EDGAR filing');
    }
    return { form, filed, accepted: Number.isFinite(Date.parse(accepted)) ? accepted : null, accession };
  });
  if (!rows.length) throw new Error('Empty EDGAR filings');
  return { observedAt: rows[0].accepted ?? rows[0].filed, rows };
}

export function createFeeds({ request = (url, options) => fetch(url, options), now = Date.now, onFailure = () => {}, userAgent = 'Meridian local research workspace' } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function load(key, previous) {
    const checkedAt = new Date(now()).toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let failure = 'network';
    try {
      const response = await request(key === 'ecb' ? ecb : sec, {
        headers: { 'User-Agent': userAgent }, signal: controller.signal, redirect: 'error'
      });
      if (!response.ok) {
        failure = 'http_' + response.status;
        throw new Error('Upstream HTTP ' + response.status);
      }
      failure = 'invalid_response';
      const parsed = key === 'ecb' ? readRates(await response.text()) : readFilings(await response.json());
      return { ...parsed, checkedAt, retrievedAt: new Date(now()).toISOString(), status: 'available' };
    } catch (error) {
      onFailure(key, error);
      if (controller.signal.aborted) failure = 'timeout';
      return previous?.retrievedAt ? { ...previous, checkedAt, status: 'stale', failure } : { checkedAt, status: 'unavailable', failure };
    } finally {
      clearTimeout(timer);
    }
  }
  return async key => {
    if (!Object.hasOwn(expiry, key)) throw new Error('Unknown source');
    const previous = cache.get(key);
    if (previous && now() - Date.parse(previous.checkedAt) < expiry[key]) return previous;
    if (!pending.has(key)) {
      pending.set(key, load(key, previous).then(result => {
        cache.set(key, result);
        return result;
      }).finally(() => pending.delete(key)));
    }
    return pending.get(key);
  };
}
