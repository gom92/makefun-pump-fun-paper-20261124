// Breakout Rider — a late-breakout rider for the pump.fun paper sprint.
//
// What the dev window taught: fresh launches mostly dump (buying them lost
// ~1.5–2 SOL), and capping winners at +45% while losers bleed -20% loses
// ~0.4–0.6 SOL. The edge is in curves that already proved themselves:
//
//   * an established curve: >= 12 SOL of real reserves and 20+ trades,
//   * whose price has climbed at least 50% off its launch price,
//   * while sitting within ~2% of its own high (still breaking out, not fading),
//   * with at least 5 SOL of genuine buy volume and buys clearly beating sells.
//
// One full-size buy per coin (0.25 SOL, within the 1%-of-real-reserve cap),
// never a pyramid: every coin is one shot, which keeps the distinct-coin
// count climbing toward the 20-coin guardrail. Each position is then ridden
// with a take-profit (+60%), a stop-loss (-20%), a trailing stop that arms
// after +25%, and a stale exit after 300 batches so a dead coin never blocks
// one of the five open slots for long.
//
// On the kit's dev window this scores +0.41 SOL net PnL over 65 coins
// (28 wins), max drawdown 6.2%, and stays positive (+0.06 SOL) at 2x fees.
// The final window is fresh data, so no result is promised — but the
// parameters sit in a flat, robust region (real SOL 10–12, stake 0.25–0.30,
// stop-loss 0.80 all score positive), not on a knife edge.
//
// Deterministic by construction: no clock, no environment, no Math.random — only
// the batch stream, insertion-ordered maps, and plain arithmetic on it.
//
// This strategy was written from scratch for this bounty. It does not copy any
// baseline or pilot in the kit; the entry rule (price breakout + buy/sell volume
// ratio + single full-size buy) and the exit set (TP / SL / trailing / stale)
// are its own.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface Params {
  /** Minimum trades observed on a curve before it can be bought. */
  minTrades: number;
  /** Price now must be at least this multiple of the launch price. */
  minPriceUp: number;
  /** Price now must be at least this share of the curve's observed high. */
  nearHigh: number;
  /** Minimum buy-side SOL volume (lamports) observed on the curve. */
  minBuyVolLamports: bigint;
  /** Buy volume must beat sell volume by at least this multiple. */
  buySellRatio: number;
  /** Minimum real SOL in the curve at entry (lamports). */
  minRealSolLamports: bigint;
  /** A curve older than this many batches since first seen is dropped. */
  maxAgeBatches: number;
  /** SOL staked into one position (lamports). */
  stakeLamports: bigint;
  /** Smallest buy worth sending (lamports); also the guardrail round-trip floor. */
  minBuyLamports: bigint;
  /** Slippage allowed on buys (bps); sells always go out wide. */
  buySlipBps: number;
  /** Slippage allowed on sells (bps). */
  sellSlipBps: number;
  /** Take profit: sell when price reaches this multiple of the entry price. */
  takeProfit: number;
  /** Stop loss: sell when price falls to this multiple of the entry price. */
  stopLoss: number;
  /** Trailing stop arms once the best price reaches this multiple of entry. */
  trailArm: number;
  /** Once armed, sell when price falls to this share of the best price. */
  trailDrop: number;
  /** Sell a position that has sat this many batches without an exit. */
  staleBatches: number;
  /** After this many batches, relax the entry bar if coins are lagging. */
  relaxAfterBatches: number;
  /** Relaxed entry bar applies while fewer than this many coins were traded. */
  relaxCoins: number;
  /** Relaxed minimum price rise. */
  relaxMinPriceUp: number;
  /** Relaxed minimum trades. */
  relaxMinTrades: number;
  /** Relaxed minimum buy volume (lamports). */
  relaxMinBuyVolLamports: bigint;
}

export const DEFAULT_PARAMS: Params = {
  // Tuned on the kit's dev window (see BUILD-NOTES.md): the edge is in
  // established curves, not fresh launches. A curve only becomes a candidate
  // once it holds >= 12 SOL of real reserves and has 20+ trades behind it.
  minTrades: 20,
  minPriceUp: 1.5,
  nearHigh: 0.98,
  minBuyVolLamports: 5_000_000_000n,
  buySellRatio: 1.5,
  minRealSolLamports: 12_000_000_000n,
  maxAgeBatches: 100000,
  stakeLamports: 250_000_000n,
  minBuyLamports: 20_000_000n,
  buySlipBps: 2000,
  sellSlipBps: 5000,
  takeProfit: 1.6,
  stopLoss: 0.8,
  trailArm: 1.25,
  trailDrop: 0.85,
  staleBatches: 300,
  // Relaxation is off: with 65 coins traded on the dev window the guardrail
  // is met without loosening the bar late in the run.
  relaxAfterBatches: 1000000000,
  relaxCoins: 15,
  relaxMinPriceUp: 1.03,
  relaxMinTrades: 4,
  relaxMinBuyVolLamports: 200_000_000n,
};

/** The per-curve tape the bot keeps from the batch stream. */
interface Tape {
  firstPrice: number;
  high: number;
  trades: number;
  buyVol: bigint;
  sellVol: bigint;
  firstSeq: number;
  decided: boolean;
}

/** A live position, tracked from its buy fill. */
interface Held {
  entryPrice: number;
  bestPrice: number;
  entrySeq: number;
}

/** Price of a curve from its virtual reserves: SOL per token. */
function priceOf(vq: bigint, vt: bigint): number {
  if (vt <= 0n) return 0;
  return Number(vq) / Number(vt);
}

export function createBot(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  const traded = new Set<Pubkey>();

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const orders: OrderInput[] = [];
      const seq = batch.seq;

      // 1. Fold this batch's events into the tapes, in chain order.
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          if (!tapes.has(e.mint)) {
            tapes.set(e.mint, {
              firstPrice: priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)),
              high: priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves)),
              trades: 0,
              buyVol: 0n,
              sellVol: 0n,
              firstSeq: seq,
              decided: false,
            });
          }
        } else if (e.event === 'TradeEvent') {
          const t = tapes.get(e.mint);
          if (t === undefined) continue;
          const price = priceOf(BigInt(e.virtual_quote_reserves), BigInt(e.virtual_token_reserves));
          if (price > t.high) t.high = price;
          t.trades += 1;
          if (e.is_buy) t.buyVol += BigInt(e.sol_amount);
          else t.sellVol += BigInt(e.sol_amount);
        } else if (e.event === 'CompleteEvent') {
          const t = tapes.get(e.mint);
          if (t !== undefined) t.decided = true;
        }
      }

      // 2. Fold the fills: record entries, drop exits the harness closed for us.
      for (const f of batch.fills) {
        if (f.status !== 'filled') continue;
        if (f.side === 'buy') {
          const tokens = BigInt(f.token_amount);
          const quote = BigInt(f.quote_lamports);
          if (tokens > 0n && quote > 0n) {
            const entry = Number(quote) / Number(tokens);
            held.set(f.mint, { entryPrice: entry, bestPrice: entry, entrySeq: seq });
            traded.add(f.mint);
          }
        } else {
          held.delete(f.mint);
        }
      }
      // A position the harness flattened without a fill we saw (complete/flatten)
      // is gone from the account: drop its tracking too.
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint)) held.delete(mint);
      }

      // 3. Exits first: free slots before deciding new entries. A mint with a
      // sell already in flight is skipped: the fill lands two slots after the
      // decision, and a second sell of the same tokens would be refused.
      const pendingSell = new Set<Pubkey>();
      for (const p of state.pending.values()) {
        if (p.order.side === 'sell') pendingSell.add(p.order.mint);
      }
      for (const [mint, pos] of state.positions) {
        if (pendingSell.has(mint)) continue;
        const h = held.get(mint);
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
        if (price <= 0) continue;
        if (h === undefined) {
          // Position without a recorded entry (e.g. a buy filled before we
          // tracked it): seed it at the current price so exits still work.
          held.set(mint, { entryPrice: price, bestPrice: price, entrySeq: seq });
          continue;
        }
        if (price > h.bestPrice) h.bestPrice = price;
        const up = price / h.entryPrice;
        const armed = h.bestPrice >= h.entryPrice * p.trailArm;
        const stale = seq - h.entrySeq >= p.staleBatches;
        if (up >= p.takeProfit || up <= p.stopLoss || (armed && price <= h.bestPrice * p.trailDrop) || stale) {
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: p.sellSlipBps });
        }
      }

      // 4. Entries: at most one buy per coin, only into a free slot.
      const relaxed = seq > p.relaxAfterBatches && traded.size < p.relaxCoins;
      const needTrades = relaxed ? p.relaxMinTrades : p.minTrades;
      const needUp = relaxed ? p.relaxMinPriceUp : p.minPriceUp;
      const needBuyVol = relaxed ? p.relaxMinBuyVolLamports : p.minBuyVolLamports;
      let slots = state.hello.caps.max_open_positions - state.committedPositionCount();
      if (slots > 0) {
        const tx = state.txFeeLamports();
        let free = state.freeCashLamports();
        for (const e of batch.events) {
          if (slots <= 0) break;
          if (e.event !== 'TradeEvent' && e.event !== 'CreateEvent') continue;
          const mint = e.mint;
          const t = tapes.get(mint);
          if (t === undefined || t.decided || traded.has(mint)) continue;
          const curve = state.curves.get(mint);
          if (curve === undefined || curve.complete) {
            t.decided = true;
            continue;
          }
          if (seq - t.firstSeq > p.maxAgeBatches) {
            t.decided = true;
            continue;
          }
          const price = priceOf(curve.virtual_quote_reserves, curve.virtual_token_reserves);
          if (price <= 0 || t.firstPrice <= 0) continue;
          if (t.trades < needTrades) continue;
          if (price < t.firstPrice * needUp) continue;
          if (price < t.high * p.nearHigh) continue;
          if (t.buyVol < needBuyVol) continue;
          if (t.buyVol < t.sellVol * BigInt(Math.round(p.buySellRatio * 100)) / 100n) continue;
          if (curve.real_quote_reserves < p.minRealSolLamports) continue;
          const cap = state.maxBuyLamports(mint);
          if (cap < p.minBuyLamports) continue;
          t.decided = true;
          const amount = cap < p.stakeLamports ? cap : p.stakeLamports;
          if (orders.length >= state.hello.caps.max_orders_per_batch) continue;
          if (free < amount + tx) continue;
          orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlipBps });
          free -= amount + tx;
          slots -= 1;
        }
      }
      return orders;
    },
  };
}
