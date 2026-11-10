// Checks locale files against locales/source.json.
// Run with: node tools/check-locale.mjs            (all locales)
//       or: node tools/check-locale.mjs pt-PT fr-FR
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { locales } from '../i18n.mjs';

const root = new URL('../locales/', import.meta.url);
const holes = text => (text.match(/\{\d+\}/g) ?? []).sort().join();

// Returns a list of problems for one locale; an empty list means full coverage.
export async function check(tag) {
  const source = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  let dictionary;
  try {
    dictionary = (await import(new URL(tag + '.mjs', root))).default;
  } catch (problem) {
    return ['cannot load ' + tag + '.mjs: ' + problem.message];
  }
  const problems = [];
  for (const key of source) {
    const value = dictionary[key];
    if (typeof value !== 'string' || !value.trim()) problems.push('missing: ' + key);
    else if (holes(value) !== holes(key)) problems.push('placeholders differ: ' + key);
  }
  for (const key of Object.keys(dictionary)) {
    if (!source.includes(key)) problems.push('not in source: ' + key);
  }
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tags = process.argv.length > 2 ? process.argv.slice(2) : locales.filter(item => item.tag !== 'en-GB').map(item => item.tag);
  let failed = false;
  for (const tag of tags) {
    const problems = await check(tag);
    failed ||= problems.length > 0;
    console.log(tag + ': ' + (problems.length ? problems.length + ' problems' : 'complete'));
    for (const problem of problems.slice(0, 15)) console.log('  ' + problem);
  }
  process.exitCode = failed ? 1 : 0;
}
