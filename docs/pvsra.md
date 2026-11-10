# PVSRA studies

Seven studies in the Indicators menu are a port of the open-source Pine script "PVSRA Levels + MACD (fast)". They live in `pvsra.mjs`, which is licensed under the Mozilla Public License 2.0 (see `NOTICE`); the rest of Meridian is Apache-2.0. Each study can be added, hidden and removed on its own.

| Study | What it draws |
| --- | --- |
| PVSRA vector candles and zones | Colours every candle by volume. Green and red: volume at least twice the average of the ten bars before, or the largest spread times volume of those bars. Blue and violet: volume at least 1.5 times that average. Grey: everything else. Each vector candle leaves a zone over its body (or its whole range) that stays until price trades back through it. |
| PVSRA EMAs and cloud | EMAs 5, 13, 50, 200 and 800, with a cloud around the 50 that is a quarter of the 100-bar standard deviation wide on each side. |
| PVSRA levels | Yesterday's and last week's high and low, the daily open, the pivot point with M0 to M5, optional R1 to R3 and S1 to S3, the average daily range projected from today's bar, and the weekly psy high and low. |
| Market sessions | London, New York, Tokyo, Hong Kong, Sydney and the EU and US Brinks hours, each in its exchange's own time zone, so daylight saving is followed automatically. The box is the opening bar's range across the session; the dashed lines are the range of the latest session. Shown on intervals up to 4 hours. |
| Estimated liquidation levels | See below. |
| VWAP with bands | Volume-weighted average price restarted every UTC day, with bands one (configurable) volume-weighted standard deviation away. |
| Volume profile | Volume of the last 300 bars over 120 price rows at the right edge, split into estimated buy and sell volume, with the point of control and the 70% value area. |

Days, weeks and the VWAP restart at 00:00 UTC, which is where Binance's daily bars start. Daily and weekly levels are computed from the symbol's daily bars, so they are the same on every chart interval.

## Estimated liquidation levels

No public feed gives the liquidation price of other traders' positions, so these are estimates. Every vector candle is read as a burst of new positions in its own direction, entered at the candle's typical price. Their liquidation price sits beyond the entry at `1 / leverage - 0.4%` (the maintenance margin). The assumed leverage is 25x, 50x or 100x: the higher the candle's volume against its ten-bar average (2x and 3x are the steps), the higher the tier. A level is removed once price reaches it. The faint line at the entry is the break-even of those positions.

On Binance perpetual futures the estimate uses **real open interest** from Binance's public open interest history, which the Pine version could only read on some symbols:

- a vector candle on which open interest fell is skipped, because the volume was positions closing;
- a candle on which open interest rose more than twice its usual change moves up one leverage tier;
- levels confirmed by open interest are solid; levels older than the 30 days and 500 bars of history Binance keeps, or on symbols without open interest, are dotted and rest on volume alone.

## Differences from the Pine script

- Not ported: the MACD and volume pane (use Meridian's own MACD and Volume indicators), the extra moving-average sets per timeframe (use the SMA, EMA and WMA indicators), the ADR and DST tables, the "next session" countdown and its alerts, the "trading resumed" markers, the Frankfurt session, the symbol override for PVSRA, weekly and monthly average ranges, and the range (RD, RW) levels.
- The script's inputs for colours and line styles are fixed to its defaults here. Each study exposes only its main switches in its settings.
- The weekly psy levels use the crypto rule (the Sydney open on Saturday night). The forex rule is not implemented, because Meridian's forex charts are simulated.
- During bar replay the studies are still computed from the full history, so zones and levels reflect the latest bar rather than the replayed one.
- The order book is still not used: the volume profile's buy and sell split is estimated from where each bar closed inside its range, as in the script.
