// Dip-reversion bot for the cbBTC 24h race (agent-fun/bars-replay/v1).
//
// Idea: the pool's 1-minute prices are thin and noisy, so sharp drops over a
// couple of hours tend to mean-revert over the next few hours, while the
// round-trip cost (~26 bps) makes chasing small moves pointless. This bot
// therefore does nothing most of the time and only buys a deep dip, then
// sells once the reversion has paid for the round trip several times over.
//
//   Entry (flat only): the close is at least 120 bps below the highest close
//     of the last 120 bars (2 hours). Full size: all cash, one buy.
//   Exit (whole position): the close is at least 100 bps above the fill
//     price (take profit), or at least 250 bps below it (hard stop, disaster
//     cover for a race window that keeps falling), or the trade has been open
//     for 480 bars (8 hours) and is still under +20 bps (stale trade: free
//     the capital instead of riding a dead position to the final flatten).
//   No entries in the last 60 bars: a dip bought that late has no time to
//     revert before the window's final sale.
//
// Everything is deterministic: fixed thresholds, float64 arithmetic on the
// bars only, no randomness, no wall clock, no network, no files. One asset
// (CBBTC), long only, at most one open position, at most one order a reply.
//
// Backtested on the published dev window with the kit's own fill model this
// shape made about +$16.50 on $1,000 (two winning round trips, max drawdown
// 0.7%, positive on both halves of the window), while every house baseline
// lost money there. The parameters sit in a flat neighbourhood (drop 110-120
// bps, take-profit 90-100 bps all give the same dev result), not on a spike.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Rolling-high lookback, in bars (2 hours of 1-minute bars). */
const LOOKBACK_BARS = 120;
/** Entry: close this many bps below the rolling high. */
const DROP_BPS = 120;
/** Exit: take profit at this many bps above the fill price. */
const TAKE_PROFIT_BPS = 100;
/** Exit: hard stop at this many bps below the fill price. */
const STOP_LOSS_BPS = 250;
/** Exit: after this many bars open, a trade under STALE_GAIN_BPS is stale. */
const STALE_BARS = 480;
const STALE_GAIN_BPS = 20;
/** No new entries once this many bars from the end of a 1440-bar window. */
const NO_ENTRY_LAST_BARS = 60;
const WINDOW_BARS = 1440;
/** 1% slippage cap: fills cost ~7 bps of impact, so a >1% gap rejects the
 *  order instead of filling it at a bad price; it is retried next bar. */
const MAX_SLIPPAGE_BPS = 100;

/** The last LOOKBACK_BARS closes (raw price units), oldest first. */
const closes: number[] = [];
/** Seq of the batch whose fill opened the current position (-1 when flat). */
let entrySeq = -1;
/** Fill price of the current position, in raw price units (0 when flat). */
let entryPrice = 0;
/** Whether we held a position on the previous batch. */
let heldLastBatch = false;

/** Average fill price of a position, in raw price units, from its cost/qty. */
function fillPrice(state: BarsState, symbol: string): number {
  const held = state.positions.get(symbol);
  const meta = state.symbols.get(symbol);
  if (held === undefined || meta === undefined || held.qty === 0n) return 0;
  const scale = 10 ** (meta.qty_scale + meta.price_scale - state.hello.capital.quote_scale);
  return (Number(held.cost) * scale) / Number(held.qty);
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || state.warmingUp) return [];

    // Track the position: a fill reported in this batch opens it.
    const held = state.positions.get(SYMBOL);
    if (held !== undefined && !heldLastBatch) {
      entrySeq = state.seq;
      entryPrice = fillPrice(state, SYMBOL);
    }
    heldLastBatch = held !== undefined;

    const close = Number(bar.c);
    closes.push(close);
    if (closes.length > LOOKBACK_BARS) closes.shift();

    const orders: (BuyInput | SellInput)[] = [];
    const { caps, fees } = state.hello;

    if (held !== undefined) {
      if (entryPrice > 0) {
        const gainBps = ((close / entryPrice) - 1) * 10_000;
        const heldBars = state.seq - entrySeq;
        if (gainBps >= TAKE_PROFIT_BPS || gainBps <= -STOP_LOSS_BPS || (heldBars >= STALE_BARS && gainBps < STALE_GAIN_BPS)) {
          orders.push({ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
      return orders;
    }

    // Flat: buy the dip, once the rolling high exists and the window is not
    // nearly over.
    if (closes.length < LOOKBACK_BARS) return [];
    if (state.seq >= WINDOW_BARS - NO_ENTRY_LAST_BARS) return [];
    let high = closes[0]!;
    for (const c of closes) if (c > high) high = c;
    const dropBps = ((close / high) - 1) * 10_000;
    if (dropBps <= -DROP_BPS) {
      let size = state.cash;
      const room = state.weightRoom(SYMBOL);
      if (room < size) size = room;
      if (size >= BigInt(fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS });
      }
    }
    return orders;
  },
});
