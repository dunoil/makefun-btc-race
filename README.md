[![make.fun](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/dunoil/makefun-btc-race/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/dunoil/makefun-btc-race/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# makefun-btc-race

A dip-reversion trading bot for the make.fun BTC 24h race. It trades Coinbase
Wrapped BTC (cbBTC) against USDC on 1-minute on-chain prices, starting from
$1,000, long only.

## Strategy

The pool's 1-minute prices are thin and noisy, so sharp drops over a couple of
hours tend to mean-revert over the next few hours, while a full round trip
costs about 26 bps in fees, slippage and price impact — chasing small moves
is pointless. The bot therefore sits in cash most of the time and only buys a
deep dip:

- **Entry:** the close is at least 120 bps below the highest close of the
  last 120 bars (2 hours). Full size — all cash, one buy.
- **Exit:** the close is at least 100 bps above the fill price (take profit),
  or at least 250 bps below it (hard stop, disaster cover for a window that
  keeps falling), or the trade has been open 480 bars (8 hours) and is still
  under +20 bps (stale trade — free the capital instead of riding a dead
  position to the final flatten).
- **No entries in the last 60 bars:** a dip bought that late has no time to
  revert before the window's final sale.

Everything is deterministic: fixed thresholds, float64 arithmetic on the bars
only, no randomness, no wall clock, no network, no files. At most one open
position and one order per reply.

## Dev-window result

Graded locally with the kit's `grade-local` on the published dev window:
**net PnL +$16.50** on $1,000 (two winning round trips), max drawdown 0.7%,
positive on both halves of the window. Every house baseline lost money on
the same window.

## Run

The entrypoint is `main.ts` (Node 22, erasable TypeScript). It speaks the
`agent-fun/bars-replay/v1` NDJSON protocol via the vendored SDK shim in
`vendor/makefun-bars.ts` (a byte-for-byte copy of the kit's shim).
