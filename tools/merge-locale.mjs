// Brings every locale file in line with locales/source.json.
//   node tools/merge-locale.mjs            lists the strings each locale is missing (writes locales/pending/todo.json)
//   node tools/merge-locale.mjs --apply    merges locales/pending/<tag>.json into locales/<tag>.mjs and drops stale strings
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { locales } from '../i18n.mjs';

const root = new URL('../locales/', import.meta.url);
const source = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
const apply = process.argv.includes('--apply');
await mkdir(new URL('pending/', root), { recursive: true });
const todo = new Set();

for (const { tag } of locales.filter(item => item.tag !== 'en-GB')) {
  const current = (await import(new URL(tag + '.mjs', root) + '?' + Date.now())).default;
  let pending = {};
  if (apply) {
    try {
      pending = JSON.parse(await readFile(new URL('pending/' + tag + '.json', root), 'utf8'));
    } catch {}
  }
  const merged = {};
  for (const key of source) {
    const value = typeof pending[key] === 'string' && pending[key].trim() ? pending[key] : current[key];
    if (typeof value === 'string' && value.trim()) merged[key] = value;
    else todo.add(key);
  }
  if (apply) {
    const body = Object.entries(merged).map(([key, value]) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(value)).join(',\n');
    await writeFile(new URL(tag + '.mjs', root), 'export default {\n' + body + '\n};\n');
  }
  console.log(tag + ': ' + (source.length - Object.keys(merged).length) + ' missing');
}
if (!apply) {
  await writeFile(new URL('pending/todo.json', root), JSON.stringify([...todo].sort(), null, 2) + '\n');
  console.log(todo.size + ' strings to translate, listed in locales/pending/todo.json');
}
