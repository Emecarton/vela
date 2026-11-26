// live.js — the ⚡ Live bot. Trades on 15-minute candles, around the clock, at the price of that moment.
// Its state is saved after every run, so when the app opens again it catches up on every candle it missed,
// using the real prices of those exact moments. Pure functions: no network here.
import { FEE } from './engine.js';

export const LIVE = {
  coins: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK'],
  ms: 15 * 60e3,   // candle size
  avg: 96,         // 24-hour average (96 × 15 min)
  look: 48,        // "strength" = move over the last 12 hours
  minMove: 0.02,   // needs at least +2% in 12 h to be interesting
  stop: -0.05,     // safety stop: −5% from the buy price
  trailAt: 0.05,   // once +5% up…
  trail: 0.025,    // …sell if it falls 2.5% from its best price
  maxBars: 288,    // never hold longer than 3 days
  cool: 16,        // wait 4 h after selling before buying again
  // Settings picked on real 15-minute prices (Aug–Nov 2026): the faster version traded ~3×/day and fees ate it.
  size: 0.98,      // use 98% of the cash per trade
};

export function newLiveState(cash, startTs, P = LIVE) {
  return { cash, start: cash, pos: null, trades: [], eq: [], last: Math.floor(startTs / P.ms) * P.ms - P.ms, coolUntil: 0 };
}

// bars: { coin: [{ t, o, h, l, c }] } — closed candles, oldest first, with enough history before st.last for the 24-h average.
export function liveStep(st, bars, P = LIVE) {
  const pre = {}, at = {};
  for (const c in bars) {
    const b = bars[c], p = new Float64Array(b.length + 1);
    for (let k = 0; k < b.length; k++) p[k + 1] = p[k] + b[k].c;
    pre[c] = p; at[c] = new Map(b.map((x, k) => [x.t, k]));
  }
  const avg = (c, k) => (k >= P.avg - 1 ? (pre[c][k + 1] - pre[c][k + 1 - P.avg]) / P.avg : null);
  const ret = (c, k, n) => (k >= n ? bars[c][k].c / bars[c][k - n].c - 1 : null);
  const lastPx = {};
  const times = (bars.BTC || []).map(b => b.t).filter(t => t > st.last);

  const sell = (t, px, why) => {
    const o = st.pos, usd = o.q * px * (1 - FEE);
    st.cash += usd;
    st.trades.push({ ts: t + P.ms, c: o.c, side: 'sell', usd, p: px, q: o.q, why, pnl: usd - o.cost });
    st.pos = null; st.coolUntil = t + P.cool * P.ms;
  };

  for (const t of times) {
    for (const c in bars) { const k = at[c].get(t); if (k != null) lastPx[c] = bars[c][k].c; }
    const o = st.pos;
    if (o) {
      const k = at[o.c].get(t);
      if (k != null) {
        const b = bars[o.c][k], sp = o.entry * (1 + P.stop);
        const tp = o.peak >= o.entry * (1 + P.trailAt) ? o.peak * (1 - P.trail) : null;
        if (b.l <= sp) sell(t, Math.min(b.o, sp), 'live_stop');
        else if (tp != null && b.l <= tp) sell(t, Math.min(b.o, tp), 'live_profit');
        else {
          o.peak = Math.max(o.peak, b.h); o.bars++;
          const a = avg(o.c, k);
          if (o.bars >= P.maxBars) sell(t, b.c, 'live_time');
          else if (a != null && b.c < a) sell(t, b.c, 'live_trend');
        }
      }
    }
    if (!st.pos && t >= st.coolUntil) {
      const kb = at.BTC.get(t), ab = kb != null ? avg('BTC', kb) : null;
      if (ab != null && bars.BTC[kb].c > ab) {
        let best = null;
        for (const c of P.coins) {
          const k = at[c]?.get(t);
          if (k == null) continue;
          const a = avg(c, k), r = ret(c, k, P.look), r1 = ret(c, k, 4);
          if (a == null || r == null || r1 == null) continue;
          if (bars[c][k].c > a && r > P.minMove && r1 > 0 && (!best || r > best.r)) best = { c, k, r };
        }
        if (best) {
          const px = bars[best.c][best.k].c, usd = st.cash * P.size, q = usd * (1 - FEE) / px;
          st.cash -= usd;
          st.pos = { c: best.c, q, entry: px, peak: px, bars: 0, cost: usd, since: t + P.ms };
          st.trades.push({ ts: t + P.ms, c: best.c, side: 'buy', usd, p: px, q, why: 'live_mom', move: best.r });
        }
      }
    }
    st.last = t;
    {  // value after every candle (the Home chart draws these)
      const v = st.cash + (st.pos ? st.pos.q * (lastPx[st.pos.c] ?? st.pos.entry) : 0);
      if (st.eq.length && st.eq[st.eq.length - 1][0] === t + P.ms) st.eq[st.eq.length - 1][1] = v; else st.eq.push([t + P.ms, v]);
    }
  }
  if (st.eq.length > 2000) st.eq = st.eq.filter((_, k) => k % 2 === 0 || k === st.eq.length - 1);
  return st;
}

// What the live bot sees on the newest candle (for the analysis panel and the agents).
export function liveExplain(bars, P = LIVE) {
  const btc = bars.BTC || [], kb = btc.length - 1;
  const mean = (b, k) => { if (k < P.avg - 1) return null; let s = 0; for (let j = k - P.avg + 1; j <= k; j++) s += b[j].c; return s / P.avg; };
  const ab = kb >= 0 ? mean(btc, kb) : null;
  const coins = P.coins.filter(c => bars[c]?.length).map(c => {
    const b = bars[c], k = b.length - 1, a = mean(b, k);
    const r = k >= P.look ? b[k].c / b[k - P.look].c - 1 : null, r1 = k >= 4 ? b[k].c / b[k - 4].c - 1 : null;
    return { c, p: b[k].c, avg: a, up: a != null && b[k].c > a, r, r1, trend: a != null && b[k].c > a && r > P.minMove && r1 > 0 };
  });
  [...coins].sort((x, y) => (y.r ?? -9) - (x.r ?? -9)).forEach((x, k) => (x.rank = k + 1));
  const btcUp = ab != null && btc[kb].c > ab;
  const pick = btcUp ? coins.filter(x => x.trend).sort((x, y) => y.r - x.r)[0] : null;
  for (const x of coins) x.w = pick && x.c === pick.c ? 1 : 0;
  coins.sort((x, y) => (y.w - x.w) || (y.trend - x.trend) || ((y.r ?? -9) - (x.r ?? -9)));
  return { t: btc[kb]?.t, btcUp, btc: btc[kb]?.c, btcAvg: ab, coins };
}
