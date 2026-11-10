# The optional local server

The workspace is a set of static files. `npm start` runs a small Node server that serves them on `http://127.0.0.1:4173/` and adds three optional features. Set `MERIDIAN_PORT`, or pass `--port=4174`, to use another port.

## Official sources panel

The panel shows observed data, kept apart from the simulated charts:

| Source | What is shown | Notes |
| --- | --- | --- |
| European Central Bank | Daily euro reference rates | Published around 16:00 CET on working days. [Terms](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html) |
| SEC EDGAR | Metadata for recent Apple Inc. filings | Public API without keys. Respect the SEC [fair access](https://www.sec.gov/about/developer-resources) rules. |

The server shares upstream requests and caches results for five minutes (ECB) and one minute (EDGAR). When a source fails, the panel shows the last result as stale or reports the source as unavailable. The page refreshes both sources every minute while it is visible.

Set `MERIDIAN_SEC_USER_AGENT` to identify your organisation and a monitored contact when you use the SEC API in an automated way.

On static hosting, such as the public demo, these routes do not exist and the panel reports the sources as unavailable.

## Binance futures account

The Trading panel has a Binance tab. With the local server running, it connects one Binance USDⓈ-M futures account and lets you manage trades from the chart. **Orders sent from this tab are real orders on your account**, unless you connect to the testnet.

### Connect

1. In Binance, open API Management and create an API key. Enable **Futures**, leave **withdrawals disabled**, and restrict the key to your IP address.
2. Start Meridian with `npm start` and open the Trading panel, then Binance.
3. Paste the API key and the secret and choose Connect. Tick "Use the Binance futures testnet" to use a [testnet](https://testnet.binancefuture.com) key instead; nothing on the testnet uses real funds.

The key and the secret are posted once to the server on your own computer and kept in its memory until it stops or you disconnect. They are never written to disk, never sent back to the page and never stored in the browser. To connect without typing them each time, set `MERIDIAN_BINANCE_KEY` and `MERIDIAN_BINANCE_SECRET` (and `MERIDIAN_BINANCE_TESTNET=1` for the testnet) in the shell that starts the server, through your own secret store.

### What it does

| Area | Details |
| --- | --- |
| Account | Wallet balance, available balance, margin balance and open profit and loss, refreshed when Binance's account stream reports a change |
| Positions | Size, leverage, entry price, break-even price, mark price and liquidation price, in the panel and as lines on the chart of that symbol |
| Orders | Market, limit, stop loss, take profit and trailing stop (callback rate and optional activation price). Entry orders can carry a take profit and a stop loss that close the whole position. Reduce-only is optional on entry orders and always set on exits |
| Position actions | Close, close half, reverse (long to short of the same size, or back), move the stop loss to break-even, and an Exits dialog for take profit, stop loss and trailing stop |
| Settings per symbol | Leverage and cross or isolated margin |
| Working orders | Listed with their prices and drawn on the chart; cancel one, or all orders on the chart's symbol |

Open a perpetual futures chart (a symbol ending in `.P`, such as `BTCUSDT.P`) to trade that symbol. Every action is shown for approval before it is sent; that can be turned off in Settings. One-way and hedge position modes are both handled. Quantities are rounded down to the symbol's lot size and prices to its tick size. Stop, take-profit and trailing orders use Binance's conditional (algo) order endpoints, which replaced the plain order endpoint for those types in December 2025.

Not covered: spot, margin, COIN-M futures and options accounts, transfers and withdrawals, limit versions of stop and take-profit orders from the ticket, and changes of position mode or multi-asset mode.

### Routes

`GET /api/binance` (connection status), `GET /api/binance/account` (balances, positions, orders) and `POST /api/binance/` followed by `connect`, `disconnect`, `order`, `cancel`, `cancel-all`, `close`, `reverse`, `break-even`, `leverage` or `margin-type`. They answer only to the Meridian page served by the same server: the Host must be local, POST bodies must be JSON, and a cross-site or cross-origin request is refused.

### Try it without an account

`node tools/demo-account.mjs --port=4175` serves Meridian with a made-up account held in memory. It never contacts the Binance account API and no order leaves the process.

## Paper-account connection checks

Two routes check that a broker **paper** account is reachable. They return only the provider, the mode and a status. They never return account data and never submit orders.

| Route | Configuration |
| --- | --- |
| `GET /api/paper/alpaca` | `MERIDIAN_ALPACA_PAPER_KEY` and `MERIDIAN_ALPACA_PAPER_SECRET` from an Alpaca paper account. Keys that are not paper keys are refused without a network call. |
| `GET /api/paper/ibkr` | `MERIDIAN_IBKR_PAPER_ACCOUNT` set to the paper account ID (it starts with `DU`), with the Interactive Brokers Client Portal Gateway running and signed in on `https://localhost:5000`. |

Possible statuses: `connected`, `not_configured`, `authorization_required`, `account_unverified`, `unavailable`.

Set the variables in the shell that starts the server, through your own secret store. Never put a credential in the browser code, the repository or an issue. Leave TLS verification enabled; if the Gateway certificate is not trusted by Node, point `NODE_EXTRA_CA_CERTS` at the approved certificate chain.

The paper trading panel in the workspace does not use these routes. It is a local simulation on simulated prices.
