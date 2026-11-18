// Tri-signal event bot for the make.fun BTC race (agent-fun/bars-replay/v1).
//
// The bot trades one asset, CBBTC, long only, one position, full cash per buy.
// It speaks the bars-replay protocol through the vendored kit shim
// (vendor/makefun-bars.ts, byte-identical to the kit SDK).
//
// Strategy -- three independent entry signals, one shared exit rule. All
// decisions are exact BigInt arithmetic over the closes the harness already
// sent (no floats, no clock, no network, no randomness), so two runs on the
// same bars answer byte for byte the same.
//
// Entries (only when flat, and only after at least 61 closes):
//   DIP -- the 30-bar return fell at least 200 bps AND this close bounced
//          above the previous close: buy the sharp dip after it turns.
//   MOM -- the 30-bar return freshly crossed at least 70 bps (above it now,
//          below it on the bar before): buy the start of a rally, never a
//          move already half over.
//   QMR -- the 60-bar return fell at least 165 bps: buy a deep one-hour dip.
//   LATE -- after bar 1200, if no buy has filled yet, the QMR bar drops to
//          120 bps: on a dead day this keeps the entry trading at least once
//          (the guardrail needs one trade) instead of holding cash all day.
// A buy spends all cash, capped at 100 bps of slippage past the close it was
// decided on, so a fill that gapped away is refused instead of chased.
//
// Exits (whole position, checked on every close while holding):
//   TP    -- close at least 80 bps above the fill price.
//   SL    -- close at least 150 bps below the fill price.
//   TRAIL -- close at least 200 bps below the highest close since the fill.
//   STALE -- held 120 bars or more AND close at least 100 bps below the fill
//            price: a position bleeding slowly is cut instead of ridden down.
//
// Why these exits: a full-size round trip costs about 26-30 bps in fee,
// slippage and pool impact, so a trade has to catch a move clearly bigger
// than that; the take-profit banks 80 bps when it comes, the stop and the
// trailing stop cap a bad entry, and the stale exit stops the slow bleed
// that no stop would catch (a position can sit 100 bps under water for
// hundreds of bars without ever touching a 150 bps stop).
//
// Entry price, peak and holding time come from the fills the harness reports
// (the buy fill's own price), never from an assumed open.

import { runBars, type BarsState, type Batch, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Entry thresholds, in basis points of the trailing returns.
const DIP_WINDOW = 30;
const DIP_DROP_BPS = 200n;
const MOM_WINDOW = 30;
const MOM_RISE_BPS = 70n;
const QMR_WINDOW = 60;
const QMR_DROP_BPS = 165n;
// The late-activity bar and its relaxed QMR bar (see the header comment).
const LATE_BAR = 1200;
const LATE_QMR_DROP_BPS = 120n;

// Exits, in basis points against the fill price (TP/SL/STALE) or the peak.
const TAKE_PROFIT_BPS = 80n;
const STOP_LOSS_BPS = 150n;
const TRAIL_BPS = 200n;
const STALE_BARS = 120;
const STALE_DROP_BPS = 100n;

const MAX_SLIPPAGE_BPS = 100;
const MIN_NOTIONAL = 1000000n;

// Closes received so far, oldest first, raw price ints at price_scale 5.
const closes: bigint[] = [];
// Fill price of the open position (0n when flat), highest close since the
// fill, and the bar count at the fill.
let entryPrice = 0n;
let peak = 0n;
let since = 0;
// A buy or sell sent on the previous batch, not yet answered by a fill.
let pendingBuy = false;
let pendingSell = false;
// Buy fills so far: the late-activity rule fires only while this is zero.
let buyFills = 0;

/** Return over the last `window` bars, in bps, truncated toward zero. */
function retBps(window: number): bigint {
  return (closes[closes.length - 1] * 10000n) / closes[closes.length - 1 - window] - 10000n;
}

/** Fold this batch's fills into the entry tracking. */
function applyFills(batch: Batch): void {
  for (const fill of batch.fills) {
    if (fill.symbol !== SYMBOL) continue;
    if (fill.side === 'buy') {
      pendingBuy = false;
      if (fill.status === 'filled') {
        entryPrice = BigInt(fill.price);
        peak = entryPrice;
        since = closes.length;
        buyFills += 1;
      }
    } else {
      pendingSell = false;
      if (fill.status === 'filled') {
        entryPrice = 0n;
        peak = 0n;
        since = 0;
      }
    }
  }
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  applyFills(batch);
  for (const bar of batch.bars) {
    if (bar.symbol === SYMBOL) closes.push(BigInt(bar.c));
  }
  if (state.warmingUp) return [];
  const held = state.positions.get(SYMBOL);
  const qty = held === undefined ? 0n : held.qty;
  const close = state.close(SYMBOL);
  if (close === null || closes.length < QMR_WINDOW + 1) return [];
  if (qty > 0n && entryPrice > 0n) {
    if (close > peak) peak = close;
    const take = close * 10000n >= entryPrice * (10000n + TAKE_PROFIT_BPS);
    const stop = close * 10000n <= entryPrice * (10000n - STOP_LOSS_BPS);
    const trail = close * 10000n <= peak * (10000n - TRAIL_BPS);
    const stale = closes.length - since >= STALE_BARS && close * 10000n <= entryPrice * (10000n - STALE_DROP_BPS);
    if (take || stop || trail || stale) {
      if (!pendingSell) {
        pendingSell = true;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
    }
    return [];
  }
  if (qty === 0n && !pendingBuy && state.cash >= MIN_NOTIONAL) {
    const r30 = retBps(DIP_WINDOW);
    const dip = r30 <= -DIP_DROP_BPS && closes[closes.length - 1] > closes[closes.length - 2];
    // Momentum only on a fresh cross: above the bar now, below it one bar ago.
    const r30Prev = (closes[closes.length - 2] * 10000n) / closes[closes.length - 1 - MOM_WINDOW - 1] - 10000n;
    const mom = r30 >= MOM_RISE_BPS && r30Prev < MOM_RISE_BPS;
    const r60 = retBps(QMR_WINDOW);
    const qmrBar = closes.length >= LATE_BAR && buyFills === 0 ? LATE_QMR_DROP_BPS : QMR_DROP_BPS;
    const qmr = r60 <= -qmrBar;
    if (dip || mom || qmr) {
      pendingBuy = true;
      const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [buy];
    }
  }
  return [];
}

await runBars({ onBatch });
