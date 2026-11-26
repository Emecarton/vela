# EME Bots

Simple crypto bots you can practice with. Pick a bot personality, give it pretend money, and watch it trade on real prices. Or use the time machine to see how it would have done in the past.

**Everything runs on the phone.** The bots follow plain rules (moving averages and momentum), not a paid AI, so there are no API costs. Prices come from Binance's free public market data and are saved on the device.

## The bots

| Bot | What it does | Risk |
|---|---|---|
| 🐢 Calm | Holds BTC 60% / ETH 40% only while each is above its 200-day average; otherwise cash. Weekly. | Low* |
| 🪜 Step by step | Same coins, but goes in/out in thirds as the trend gets stronger or weaker. Weekly. | Medium |
| 🌳 Long term | Buys BTC 70% / ETH 30% and keeps it. Rebalances monthly. Never goes to cash. | High |
| 🚀 Momentum | Top 3 of 15 big coins by 30-day rise (only coins trending up, only while BTC > 200-day avg). −25% safety stop. Weekly. | High |
| 🔥 Aggressive | Same as Momentum with the top 2 and a −20% stop. | Very high |

\*Low *for crypto*.

All simulations: decisions on the daily close, trades at that close, 0.1% fee per trade, stops checked on daily closes.

## Files

- `engine.js`: bot rules, simulator, stats. Pure functions, no network.
- `data.js`: downloads and stores daily prices.
- `app.js`, `app.css`, `index.html`, `i18n.js`: the app (Spanish and English).
- `sw.js`, `manifest.webmanifest`: installable and works offline.
- `test/engine.test.mjs`: run with `node test/engine.test.mjs`.

## Install on a phone

Open the GitHub Pages link in Safari (iPhone) or Chrome (Android), then Share → **Add to Home Screen**.

---

Prototype. Not financial advice. Crypto can fall more than 50%.
