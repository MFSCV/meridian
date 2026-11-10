// Collects every interface string that needs translating and writes locales/source.json.
// Run with: node tools/extract-strings.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { registry } from '../indicators.mjs';
import '../script.mjs';

const root = new URL('../', import.meta.url);

export async function extract() {
  const keys = new Set(registry.map(item => item.name));
  for (const file of ['app.mjs', 'chart.mjs']) {
    const source = await readFile(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/\b[tL]\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(match[1].replaceAll("\\'", "'"));
  }
  const { document } = new JSDOM(await readFile(new URL('index.html', root), 'utf8')).window;
  const walker = document.createTreeWalker(document.body, 4);
  while (walker.nextNode()) {
    if (!walker.currentNode.parentElement.closest('script, style, textarea')) keys.add(walker.currentNode.nodeValue.trim());
  }
  for (const element of document.body.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const name of ['aria-label', 'placeholder', 'title']) keys.add(element.getAttribute(name) ?? '');
  }
  return [...keys].filter(key => /\p{L}/u.test(key)).sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = await extract();
  await writeFile(new URL('locales/source.json', root), JSON.stringify(keys, null, 2) + '\n');
  console.log(keys.length + ' strings written to locales/source.json');
}
