const timestamp = value => value.length === 10 ? value : new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
const base = 'https://www.sec.gov/Archives/edgar/data/320193/';
const sources = ['ecb', 'edgar'];

async function refresh(key) {
  const status = document.getElementById(key + '-status');
  const body = document.getElementById(key + '-rows');
  try {
    const response = await fetch('/api/' + key, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Feed unavailable');
    const data = await response.json();
    if (data.status === 'unavailable') {
      status.textContent = 'Source unavailable · Checked ' + timestamp(data.checkedAt);
      body.replaceChildren();
      return;
    }
    const rows = data.rows.map(item => {
      const row = document.createElement('tr');
      if (key === 'ecb') {
        row.insertCell().textContent = item.currency;
        row.insertCell().textContent = item.rate;
      } else {
        row.insertCell().textContent = item.form;
        row.insertCell().textContent = item.filed;
        const link = document.createElement('a');
        link.href = base + item.accession.replaceAll('-', '') + '/' + item.accession + '-index.htm';
        link.textContent = 'Filing ' + item.accession;
        row.insertCell().append(link);
      }
      return row;
    });
    body.replaceChildren(...rows);
    status.textContent = (data.status === 'stale' ? 'Stale cached data · ' : '') +
      (key === 'ecb' ? 'Reference date ' : 'Latest filing accepted ') + timestamp(data.observedAt) +
      ' · Retrieved ' + timestamp(data.retrievedAt);
  } catch {
    status.textContent = body.children.length ? 'Refresh failed · Showing previously loaded data' : 'Source unavailable';
  }
}

const button = document.getElementById('refresh-feeds');
let timer;
async function refreshAll() {
  if (button.disabled) return;
  clearTimeout(timer);
  button.disabled = true;
  try { await Promise.all(sources.map(refresh)); }
  finally {
    button.disabled = false;
    if (!document.hidden) timer = setTimeout(refreshAll, 60000);
  }
}
button.addEventListener('click', refreshAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else refreshAll();
});
refreshAll();
