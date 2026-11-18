# btc-race-24h-20261118-1444-entry

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/sofyanadirs-sketch/btc-race-24h-20261118-1444-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/sofyanadirs-sketch/btc-race-24h-20261118-1444-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (CBBTC) against USDC on 1-minute bars, long only, from 1,000 USDC of paper money. Strategy: three independent entry signals with one shared exit rule — buy the sharp dip after it bounces (30-bar return down 200 bps plus an up close), buy a fresh momentum cross (30-bar return newly above 70 bps), or buy a deep one-hour dip (60-bar return down 165 bps); sell the whole position at +80 bps take-profit, −150 bps stop-loss, a 200 bps trailing stop, or a stale exit (held 120 bars and 100 bps under water). After bar 1200, if no buy has filled yet, the dip bar relaxes to 120 bps so a dead day still produces at least one trade. All decisions are exact BigInt arithmetic on the closes the harness sends; no floats, no randomness, no clock, no network.

Dev window (24h ending at the bounty opening): net PnL +$14.84 on 4 trades (win rate 1.0), max drawdown 1.25%, fees $1.61. At doubled fees the dev PnL is still +$13.22. On five synthetic stress windows built from the dev bars (flat, +2% drift, −2% drift, −3% crash-and-recover, +3% rally) the same bot stays positive in every one (worst +$5.82, average +$19.79).

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=h9b99srf&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
