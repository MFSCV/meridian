# Security policy

## Reporting a vulnerability

Please report security problems privately. On the repository page, open the **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for a suspected vulnerability.

Include what you found, how to reproduce it and what an attacker could do with it. You will get a reply in the private advisory thread.

## Scope

- The browser workspace stores preferences, drawings, alerts and the simulated paper account in the browser's local storage. It sends none of it anywhere.
- The optional local server listens on the loopback address only and rejects requests whose Host header is not `127.0.0.1` or `localhost` on its own port. Everything is GET-only except the Binance account routes, which also require a JSON body, a same-origin `Origin` header and a request that is not cross-site, so another website open in the same browser cannot reach them.
- Custom formulas are parsed by a small expression parser. They are never passed to `eval` or `Function`.
- Broker credentials are read from environment variables by the local server, or, for Binance, entered once in the Trading panel and posted to the local server. They are kept in that process's memory only: never written to disk, never returned by any route, never stored in the browser. They must never be committed or placed in browser code. Use a Binance API key with withdrawals disabled and an IP restriction.

Only the latest commit on `main` is supported.
