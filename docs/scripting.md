# Formulas and strategies

Open the **Formulas and strategies** panel from the right rail. A script runs in your browser on the bars of the active chart. It is parsed by a small parser in `script.mjs`; it is never passed to `eval` or `Function`.

## One-line formulas

A script that is a single expression becomes one indicator line:

```
close - sma(close, 20)
```

## Scripts

A script is a list of lines. Each line is one of:

| Line | Meaning |
| --- | --- |
| `name = expression` | Stores a value under a name for later lines |
| `plot expression` or `plot expression as Label` | Draws a line |
| `buy when condition` | Strategy entry signal |
| `sell when condition` | Strategy exit signal |
| `# comment` or `// comment` | Ignored |

```
fast = ema(close, 12)
slow = ema(close, 26)
plot fast as Fast
plot slow as Slow
buy when crossover(fast, slow)
sell when crossunder(fast, slow)
```

## Expressions

- **Price fields:** `open`, `high`, `low`, `close`, `volume`, `hl2`, `hlc3`.
- **Arithmetic:** `+ - * /` and parentheses. Dividing by zero gives an empty value.
- **Comparisons:** `> < >= <= == !=`, combined with `and`, `or`, `not`. A true condition is 1 and a false one is 0.
- **Functions with a length** (a whole number from 1 to 500): `sma`, `ema`, `wma`, `rsi`, `highest`, `lowest`, `stdev`, `change`.
- **Other functions:** `abs(x)`, `max(a, b)`, `min(a, b)`, `crossover(a, b)` (a rises through b), `crossunder(a, b)` (a falls through b).

Values are empty during an indicator's warm-up period, and any calculation with an empty value is empty.

## Backtesting

**Run backtest** needs at least one `buy when` and one `sell when` line. The model is deliberately simple:

- Long only, one position at a time, using the whole balance.
- A signal on one bar is filled at the **open of the next bar**.
- A fee of 0.1% is charged on each side.
- Starting balance 10,000. A position still open at the end is valued at the last close and is not counted as a closed trade.

The report shows net profit, the buy-and-hold return over the same bars, the number of closed trades, the share of winning trades, the profit factor (gross profit divided by gross loss), the largest drawdown and the equity curve. Entries and exits are marked on the chart.

A backtest on simulated bars tells you only that the script does what you meant. On any data, past results say nothing about future results.

## Not supported yet

Short selling, position sizing, stop-loss and take-profit inside a script, multiple symbols or intervals, loops and user-defined functions.
