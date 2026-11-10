# Meridian

An open-source market charting workspace that runs entirely in the browser: charts, drawing tools, indicators, multi-chart layouts, alerts, bar replay, a screener, custom formulas and a simulated paper account.

**[Open the workspace](https://mfscv.github.io/meridian/)** · [Contribute](CONTRIBUTING.md) · [Roadmap](#roadmap)

![The Meridian workspace showing a candlestick chart, drawing tools and a watchlist](docs/workspace.jpg)

> **All chart prices are simulated.** Meridian ships with deterministic synthetic data so that it works offline and has no data-licensing obligations. It is not a source of market prices and nothing in it is investment advice. Connecting real feeds is on the roadmap.

Meridian is an independent project. It is not affiliated with, endorsed by or derived from TradingView or any other charting vendor, and it contains none of their code or assets.

## What it does

| Area | Included |
| --- | --- |
| Charts | Seven chart types, nine intervals from 5 minutes to 1 week, zoom, pan, pinch, crosshair, log scale, date ranges, go to date, time zones, PNG snapshot, CSV export |
| Layouts | One to four charts with optional symbol, interval and crosshair sync; named layouts saved in the browser |
| Drawings | Trend line, ray, horizontal and vertical line, rectangle, brush, Fibonacci retracement, long and short position, text, measure; magnet, lock, hide, undo and redo |
| Indicators | Volume, SMA, EMA, Bollinger Bands, VWAP, RSI, MACD, Stochastic, ATR, plus symbol comparison |
| Formulas | Custom one-expression indicators, for example `ema(close, 12) - ema(close, 26)` |
| Alerts | Price crossing, greater than and less than, checked in the browser |
| Replay | Start from any bar, play at four speeds or step bar by bar |
| Screener | Sortable table with type, direction and RSI filters |
| Paper trading | Simulated account with market orders, positions and order history |

It has no build step, no framework and no runtime dependencies: plain HTML, CSS and JavaScript modules, with charts drawn in SVG.

## Run it locally

You need [Node.js](https://nodejs.org/) 24 or later.

```bash
git clone https://github.com/MFSCV/meridian.git
```

```bash
cd meridian
```

```bash
npm start
```

Open `http://127.0.0.1:4173/`. The workspace is the landing page.

To run the tests:

```bash
npm ci --ignore-scripts
```

```bash
npm test
```

The files are static, so any web server can host them. The local Node server additionally provides two optional features that static hosting does not: the Official sources panel (European Central Bank reference rates and SEC EDGAR filing metadata, fetched from the publishers) and read-only connection checks for Alpaca and Interactive Brokers paper accounts. See [docs/server.md](docs/server.md).

## Using the workspace

- **Top bar:** symbol, comparison, interval, chart type, indicators, alerts, replay, layout, saved layouts, snapshot, full screen, settings, language and theme.
- **Left rail:** drawing tools. Select a tool group again to see its other tools.
- **Bottom bar:** date ranges, scroll, zoom, price scale and time zone.
- **Right rail:** one side panel at a time (watchlist, alerts, data window, screener, formula editor, paper trading, official sources).
- **On a chart:** drag to pan, use the wheel or pinch to zoom, double-click to reset, click a drawing to select, move or delete it.
- **Keyboard:** type a letter to search symbols. On a focused chart, arrow keys inspect bars, `+` and `-` zoom, `Home` and `End` jump, `Delete` removes the selected drawing and `Escape` cancels. `Ctrl+Z` and `Ctrl+Y` undo and redo drawings.

Preferences, drawings, alerts, layouts and the paper account are stored in your browser only. Settings → Reset preferences clears them.

## Project layout

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | Page structure and styling |
| `app.mjs` | Workspace shell: toolbars, panels, dialogs, persistence |
| `chart.mjs` | Chart engine: rendering, zoom and pan, crosshair, drawings, replay |
| `indicators.mjs` | Indicator maths, the indicator registry and the formula parser |
| `market.mjs` | Simulated instruments and price history |
| `observed.mjs`, `feeds.mjs` | Official sources panel and its server-side adapters |
| `paper.mjs`, `server.mjs` | Paper-account connection checks and the local server |
| `*.test.mjs` | Tests, run with `node --test` |

## Roadmap

Contributions in any of these areas are welcome. Open an issue first for larger changes so the approach can be agreed.

- **Market data:** adapters for feeds whose terms permit display and redistribution, with source, venue and freshness shown in the interface.
- **More drawing tools and indicators,** with per-drawing styling.
- **Strategies and backtesting** on top of the formula language.
- **Translations.** The interface is English only; the goal is the 20 most spoken languages, including right-to-left scripts.
- **Accessibility.** The target is WCAG 2.2 AA. Controls are labelled and the chart is keyboard operable, but it has not been audited with assistive technology.
- **Server-side alerts** with notifications.
- **Order types and broker integrations** for paper trading.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE).
