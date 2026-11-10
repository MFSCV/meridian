# Localization

English is the source language. This page records which languages exist, where their files are, and what is still missing.

## Status

| Kind | State |
| --- | --- |
| Interface text | English (`en-GB`) is the source and the only reviewed language. Twenty more locales are **machine-translated and have not been reviewed by a native speaker**. The language menu lists them under "Machine-translated, not yet reviewed". |
| Voice-over | None. Meridian has no audio. |
| Documentation | English only. |

## Locales

The list follows the 20 most spoken languages by total speakers (Ethnologue 200, 2026 edition), with Portuguese in both its European and Brazilian variants.

| Tag | Language | Script | Direction | Text | Reviewed |
| --- | --- | --- | --- | --- | --- |
| `en-GB` | English | Latin | left to right | Source | Yes |
| `zh-Hans-CN` | Mandarin Chinese | Simplified Han | left to right | Machine | No |
| `hi-IN` | Hindi | Devanagari | left to right | Machine | No |
| `es-ES` | Spanish | Latin | left to right | Machine | No |
| `ar-SA` | Modern Standard Arabic | Arabic | right to left | Machine | No |
| `fr-FR` | French | Latin | left to right | Machine | No |
| `bn-BD` | Bengali | Bengali | left to right | Machine | No |
| `pt-PT` | Portuguese (Portugal) | Latin | left to right | Machine | No |
| `pt-BR` | Portuguese (Brazil) | Latin | left to right | Machine | No |
| `id-ID` | Indonesian | Latin | left to right | Machine | No |
| `ur-PK` | Urdu | Arabic | right to left | Machine | No |
| `ru-RU` | Russian | Cyrillic | left to right | Machine | No |
| `de-DE` | German | Latin | left to right | Machine | No |
| `ja-JP` | Japanese | Japanese | left to right | Machine | No |
| `pcm-Latn-NG` | Nigerian Pidgin | Latin | left to right | Machine | No |
| `arz-Arab-EG` | Egyptian Arabic | Arabic | right to left | Machine | No |
| `mr-IN` | Marathi | Devanagari | left to right | Machine | No |
| `vi-VN` | Vietnamese | Latin | left to right | Machine | No |
| `te-IN` | Telugu | Telugu | left to right | Machine | No |
| `sw-KE` | Swahili | Latin | left to right | Machine | No |
| `ha-Latn-NG` | Hausa | Latin | left to right | Machine | No |

## Files

| Path | Purpose |
| --- | --- |
| `locales/source.json` | Every English interface string, generated from the code and markup |
| `locales/<tag>.mjs` | One file per locale: an object mapping each English string to its translation |
| `i18n.mjs` | The locale list, browser-language detection, the `t()` lookup and markup translation |
| `tools/extract-strings.mjs` | Regenerates `locales/source.json` |
| `tools/check-locale.mjs` | Reports missing strings, extra strings and placeholder mismatches per locale |

The tests fail if `source.json` is out of date or if any locale is missing a string, so coverage cannot silently drop. A missing string falls back to English at run time; that fallback is a safety net, not coverage.

## How the language is chosen

Without an explicit choice, Meridian uses the first supported language in the browser's preferences, and English otherwise. Choosing a language from the globe menu stores the choice in the browser. Settings → Reset preferences returns to automatic detection.

## What is missing

- **Native review of all 20 machine-translated locales.** Financial terms, short labels that must fit buttons, and tone all need checking. The Hausa, Swahili, Nigerian Pidgin, Marathi, Telugu and Egyptian Arabic files deserve the most scrutiny, because trading vocabulary in those languages is the least settled.
- **Right-to-left layout review.** The page direction switches for Arabic, Egyptian Arabic and Urdu and charts stay left to right, but the layout has not been checked by a right-to-left reader.
- **Numbers.** Prices, percentages and currency amounts use English formatting in every locale. Dates and times follow the selected locale.
- **Not translated by design:** symbols and instrument names, indicator acronyms, script keywords, error messages produced by the script parser, and text returned by the Official sources panel.
- **More regional variants** (for example Latin American Spanish or Traditional Chinese).

## Changing or adding text

1. Write the English string in the code with `t('…')`, or `L('…')` where a label is defined before it is displayed. Use `{0}`, `{1}` for values.
2. Run `node tools/extract-strings.mjs`.
3. Add the string to every file in `locales/`, then run `node tools/check-locale.mjs`.

To review a locale, edit its file and say in the pull request which strings you checked. When a locale has been fully reviewed, set `reviewed` for it in `i18n.mjs` and update the table above.
