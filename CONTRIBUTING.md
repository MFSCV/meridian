# Contributing to Meridian

Thank you for helping. Bug reports, ideas, documentation, translations, tests and code are all welcome.

## Before you start

- **Small fixes:** open a pull request directly.
- **Larger changes** (a new panel, a data adapter, a new dependency): open an issue first so the approach can be agreed before you invest time.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 24 or later.

```bash
npm ci --ignore-scripts
```

```bash
npm start
```

```bash
npm test
```

There is no build step. Edit a file and reload the page.

## What a good pull request looks like

- It does one thing and says what and why in the description.
- `npm test` passes, and new behaviour has a test. Indicator maths gets a hand-computed case in `indicators.test.mjs`; interface behaviour is driven through the real controls in `workspace.test.mjs`.
- You tried it in a browser at desktop and phone widths, in the light and dark themes.

## Project rules

These keep the project small and trustworthy. Please follow them, or explain in the issue why a change needs an exception.

1. **No runtime dependencies and no build step.** Plain HTML, CSS and JavaScript modules. Development-only dependencies need a clear reason.
2. **Simulated and observed data stay separate.** Anything simulated is labelled as simulated. Never present generated numbers as market prices.
3. **Data sources need documented rights.** A feed adapter must cite terms that permit the intended display and redistribution, and the interface must show the source and how fresh the data is. Feeds that need a paid entitlement or have unclear terms are not merged as defaults.
4. **No credentials in the browser or the repository.** Broker and data keys are read from the environment by the local server only.
5. **No path from simulated candles to a live order.** Paper trading is a local simulation.
6. **Accessibility.** Every control has an accessible name and works from the keyboard. Colour is never the only signal. The target is WCAG 2.2 AA.
7. **English is the source language** for code, comments, documentation and interface text. Translations will live in separate localisation files.
8. **Original work only.** Do not copy code, icons or designs from proprietary charting products.

## Style

Match the surrounding code: two-space indentation, single quotes, semicolons, descriptive names, and comments only where the reason is not obvious from the code.

## Licence of contributions

By submitting a contribution you agree that it is licensed under the [Apache License 2.0](LICENSE), as section 5 of the licence describes.
