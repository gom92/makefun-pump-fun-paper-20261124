# makefun-pump-fun-paper-20261124

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/gom92/makefun-pump-fun-paper-20261124/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/gom92/makefun-pump-fun-paper-20261124/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

Breakout Rider — a late-breakout paper-trading bot for pump.fun bonding curves, built for make.fun's "Pump.fun Paper Sprint: Any Bot Can Win" bounty. One Node program (`main.ts`) that paper-trades a 6-hour pump.fun replay; the house ranks entries by net PnL.

## Strategy

Fresh launches mostly dump, so this bot waits for curves that already proved themselves: at least 12 SOL of real reserves, 20+ trades, price up 50% off launch while sitting within 2% of its own high, with 5+ SOL of genuine buy volume beating sells. One 0.25 SOL buy per coin, then a take-profit (+60%), a stop-loss (-20%), a trailing stop (arms at +25%), and a stale exit after 300 batches.

On the kit's dev window it scores **+0.41 SOL net PnL over 65 coins (28 wins), max drawdown 6.2%**, and stays positive at 2x fees. The final window is fresh data, so nothing is promised — but the parameters sit in a flat, robust region, not on a knife edge.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` with this directory mounted at `/bot`. Zero dependencies, erasable TypeScript only — no build, no install. `vendor/makefun-bot.ts` is the kit's protocol shim, copied byte-identical.

## Files

- `main.ts` — entrypoint: wires the strategy to the harness shim.
- `strategy.ts` — the Breakout Rider strategy (entry, exits, tape tracking).
- `vendor/makefun-bot.ts` — the kit's `agent-fun/replay/v2` shim (vendored, not authored).

---

<sub>Entered on [make.fun](https://make.fun/?ref=radjee14&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
