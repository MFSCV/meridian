# Security policy

## Reporting a vulnerability

Please report security problems privately. On the repository page, open the **Security** tab and choose **Report a vulnerability**. Do not open a public issue or pull request for a suspected vulnerability.

Include what you found, how to reproduce it and what an attacker could do with it. You will get a reply in the private advisory thread.

## Scope

- The browser workspace stores preferences, drawings, alerts and the simulated paper account in the browser's local storage. It sends none of it anywhere.
- The optional local server listens on the loopback address only, rejects requests whose Host header is not `127.0.0.1:4173` or `localhost:4173`, and accepts GET requests only.
- Custom formulas are parsed by a small expression parser. They are never passed to `eval` or `Function`.
- Broker credentials are read from environment variables by the local server and are used only for read-only paper-account checks. They must never be committed or placed in browser code.

Only the latest commit on `main` is supported.
