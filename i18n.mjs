// Interface translations. English text is the key; each locale file maps it to a translation.
// Only en-GB has been reviewed. Every other locale is machine-translated and marked as such in the menu.
export const locales = [
  ['en-GB', 'English'], ['zh-Hans-CN', '简体中文'], ['hi-IN', 'हिन्दी'], ['es-ES', 'Español'], ['ar-SA', 'العربية', 'rtl'],
  ['fr-FR', 'Français'], ['bn-BD', 'বাংলা'], ['pt-PT', 'Português (Portugal)'], ['pt-BR', 'Português (Brasil)'],
  ['id-ID', 'Bahasa Indonesia'], ['ur-PK', 'اردو', 'rtl'], ['ru-RU', 'Русский'], ['de-DE', 'Deutsch'], ['ja-JP', '日本語'],
  ['pcm-Latn-NG', 'Naijá'], ['arz-Arab-EG', 'مصرى', 'rtl'], ['mr-IN', 'मराठी'], ['vi-VN', 'Tiếng Việt'], ['te-IN', 'తెలుగు'],
  ['sw-KE', 'Kiswahili'], ['ha-Latn-NG', 'Hausa']
].map(([tag, name, dir = 'ltr']) => ({ tag, name, dir, short: tag.split('-')[0].toUpperCase(), reviewed: tag === 'en-GB' }));

let dictionary = {};
export let locale = locales[0];

// Picks the first supported locale from the browser's preferences: an exact tag, then the same language.
export function detect(preferred = globalThis.navigator?.languages ?? []) {
  for (const wanted of preferred) {
    const lower = String(wanted).toLowerCase();
    const match = locales.find(item => item.tag.toLowerCase() === lower)
      ?? locales.find(item => {
        const parts = item.tag.toLowerCase().split('-');
        return parts[0] === lower.split('-')[0] && (lower.split('-').length === 1 || parts.at(-1) === lower.split('-').at(-1));
      })
      ?? locales.find(item => item.tag.toLowerCase().split('-')[0] === lower.split('-')[0]);
    if (match) return match;
  }
  return locales[0];
}

export async function useLocale(tag, load = wanted => import('./locales/' + wanted + '.mjs')) {
  locale = locales.find(item => item.tag === tag) ?? locales[0];
  dictionary = {};
  if (locale.tag !== 'en-GB') {
    try {
      dictionary = (await load(locale.tag)).default;
    } catch {
      locale = locales[0];
    }
  }
  return locale;
}

export function t(key, ...values) {
  return (dictionary[key] || key).replace(/\{(\d+)\}/g, (_, index) => values[index] ?? '');
}

// Marks a string for the extraction tool where it is defined; it is translated where it is displayed.
export const L = text => text;

// Translates the static markup in place: text nodes and the attributes people read or hear.
export function translateTree(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.nodeValue.trim();
    if (text && dictionary[text] && !node.parentElement.closest('script, style, textarea')) node.nodeValue = node.nodeValue.replace(text, dictionary[text]);
  }
  for (const element of root.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const name of ['aria-label', 'placeholder', 'title']) {
      const value = element.getAttribute(name);
      if (value && dictionary[value]) element.setAttribute(name, dictionary[value]);
    }
  }
}
