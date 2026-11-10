# The optional local server

The workspace is a set of static files. `npm start` runs a small Node server that serves them on `http://127.0.0.1:4173/` and adds two optional features.

## Official sources panel

The panel shows observed data, kept apart from the simulated charts:

| Source | What is shown | Notes |
| --- | --- | --- |
| European Central Bank | Daily euro reference rates | Published around 16:00 CET on working days. [Terms](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html) |
| SEC EDGAR | Metadata for recent Apple Inc. filings | Public API without keys. Respect the SEC [fair access](https://www.sec.gov/about/developer-resources) rules. |

The server shares upstream requests and caches results for five minutes (ECB) and one minute (EDGAR). When a source fails, the panel shows the last result as stale or reports the source as unavailable. The page refreshes both sources every minute while it is visible.

Set `MERIDIAN_SEC_USER_AGENT` to identify your organisation and a monitored contact when you use the SEC API in an automated way.

On static hosting, such as the public demo, these routes do not exist and the panel reports the sources as unavailable.

## Paper-account connection checks

Two routes check that a broker **paper** account is reachable. They return only the provider, the mode and a status. They never return account data and never submit orders.

| Route | Configuration |
| --- | --- |
| `GET /api/paper/alpaca` | `MERIDIAN_ALPACA_PAPER_KEY` and `MERIDIAN_ALPACA_PAPER_SECRET` from an Alpaca paper account. Keys that are not paper keys are refused without a network call. |
| `GET /api/paper/ibkr` | `MERIDIAN_IBKR_PAPER_ACCOUNT` set to the paper account ID (it starts with `DU`), with the Interactive Brokers Client Portal Gateway running and signed in on `https://localhost:5000`. |

Possible statuses: `connected`, `not_configured`, `authorization_required`, `account_unverified`, `unavailable`.

Set the variables in the shell that starts the server, through your own secret store. Never put a credential in the browser code, the repository or an issue. Leave TLS verification enabled; if the Gateway certificate is not trusted by Node, point `NODE_EXTRA_CA_CERTS` at the approved certificate chain.

The paper trading panel in the workspace does not use these routes. It is a local simulation on simulated prices.
