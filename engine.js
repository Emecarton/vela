// engine.js — the bots' brains. Pure rules, no AI, no network: it runs the same on the phone and in tests.
// Everything works on daily closing prices. A bot "decides" right after a daily close and trades at that close.

export const FEE = 0.001;              // 0.1% per buy or sell, like Binance spot
export const DAY = 864e5;
export const UNIVERSE = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'LTC', 'NEAR', 'UNI', 'TRX', 'BCH'];

// dates: contiguous day numbers (ms / DAY). series: { coin: [close | null, ...] } aligned to dates.
export function makeData(dates, series) {
  const pre = {}, first = {};
  for (const c in series) {
    const s = series[c], p = new Float64Array(s.length + 1);
    let f = -1;
    for (let i = 0; i < s.length; i++) {
      const v = s[i];
      if (v != null && f < 0) f = i;
      p[i + 1] = p[i] + (v ?? 0);
    }
    pre[c] = p; first[c] = f < 0 ? Infinity : f;
  }
  return { dates, px: series, pre, first };
}

function ctxAt(d, i) {
  return {
    i,
    has: (c, n = 1) => !!d.px[c] && d.first[c] <= i - n + 1,
    p: c => d.px[c][i],
    sma: (c, n) => (d.pre[c][i + 1] - d.pre[c][i + 1 - n]) / n,
    ret: (c, n) => d.px[c][i] / d.px[c][i - n] - 1,
  };
}

// The 3 (or 2) strongest coins of the last 30 days, among coins that are trending up,
// and only while Bitcoin itself is above its 200-day average. This is the rule we tested most.
function momentum(x, n) {
  if (!x.has('BTC', 200) || x.p('BTC') <= x.sma('BTC', 200)) return { w: {}, why: {}, out: 'market_down' };
  const picks = UNIVERSE
    .filter(c => x.has(c, 200) && x.p(c) > x.sma(c, 200) && x.sma(c, 20) > x.sma(c, 50))
    .sort((a, b) => x.ret(b, 30) - x.ret(a, 30))
    .slice(0, n);
  const w = {}, why = {};
  for (const c of picks) { w[c] = 1 / n; why[c] = 'strongest'; }
  return { w, why, out: 'left_top' };
}

// every: days between checks. hold: keep coins that stay picked without resizing them.
// drift: how far a weight may wander before the bot resizes it. stop: safety stop vs. average buy price.
export const BOTS = [
  {
    id: 'calm', icon: '🐢', hue: 215, risk: 2, every: 7, drift: 0.1, coins: ['BTC', 'ETH'],
    target(x) {
      const w = {}, why = {};
      for (const [c, wt] of [['BTC', 0.6], ['ETH', 0.4]])
        if (x.has(c, 200) && x.p(c) > x.sma(c, 200)) { w[c] = wt; why[c] = 'above_avg'; }
      return { w, why, out: 'below_avg' };
    },
  },
  {
    id: 'steps', icon: '🪜', hue: 265, risk: 3, every: 7, drift: 0.05, up: 'step_up', down: 'step_down', coins: ['BTC', 'ETH'],
    target(x) {
      const w = {}, why = {};
      for (const [c, wt] of [['BTC', 0.6], ['ETH', 0.4]]) {
        if (!x.has(c, 200)) continue;
        const p = x.p(c), s50 = x.sma(c, 50), s200 = x.sma(c, 200);
        const score = (p > s50) + (p > s200) + (s50 > s200);
        if (score) { w[c] = wt * score / 3; why[c] = 'step_up'; }
      }
      return { w, why, out: 'step_down' };
    },
  },
  {
    id: 'longterm', icon: '🌳', hue: 150, risk: 4, every: 30, drift: 0.05, up: 'rebalance', down: 'rebalance', coins: ['BTC', 'ETH'],
    target(x) {
      const w = {}, why = {};
      const mix = x.has('ETH') ? [['BTC', 0.7], ['ETH', 0.3]] : [['BTC', 1]];
      for (const [c, wt] of mix) { w[c] = wt; why[c] = 'long_hold'; }
      return { w, why, out: 'rebalance' };
    },
  },
  { id: 'momentum', icon: '🚀', hue: 28, risk: 4, every: 7, hold: true, stop: -0.25, flagship: true, pick: 3, coins: UNIVERSE, target: x => momentum(x, 3) },
  { id: 'aggressive', icon: '🔥', hue: 355, risk: 5, every: 7, hold: true, stop: -0.20, pick: 2, coins: UNIVERSE, target: x => momentum(x, 2) },
];
export const botById = id => BOTS.find(b => b.id === id);

// Replays a bot day by day. Returns the trades, the daily value and what it holds at the end.
export function simulate(bot, d, { start = 0, end = d.dates.length - 1, cash = 1000 } = {}) {
  const pos = {}, trades = [], eq = [];
  const px = (c, i) => d.px[c][i];
  const value = i => { let v = cash; for (const c in pos) v += pos[c].q * px(c, i); return v; };
  const log = (i, c, side, usd, p, why, q) => trades.push({ day: d.dates[i], c, side, usd, p, why, q });

  const buy = (c, usd, i, why) => {
    usd = Math.min(usd, cash);
    if (usd < 1) return;
    const p = px(c, i), q = usd * (1 - FEE) / p, o = pos[c];
    if (o) { o.entry = (o.entry * o.q + p * q) / (o.q + q); o.q += q; }
    else pos[c] = { q, entry: p };
    cash -= usd;
    log(i, c, 'buy', usd, p, why, q);
  };
  const sell = (c, q, i, why) => {
    const o = pos[c], p = px(c, i);
    if (q >= o.q * 0.999) q = o.q;
    if (q * p < 1 && q < o.q) return;
    const usd = q * p * (1 - FEE);
    cash += usd; o.q -= q;
    if (o.q <= 0) delete pos[c];
    log(i, c, 'sell', usd, p, why, q);
  };

  for (let i = start; i <= end; i++) {
    if (bot.stop) for (const c of Object.keys(pos))
      if (px(c, i) <= pos[c].entry * (1 + bot.stop)) sell(c, pos[c].q, i, 'stop');

    if ((i - start) % bot.every === 0) {
      const t = bot.target(ctxAt(d, i)), E = value(i);
      for (const c of Object.keys(pos)) {
        const tw = t.w[c] || 0, cw = pos[c].q * px(c, i) / E;
        if (!tw) sell(c, pos[c].q, i, t.out);
        else if (!bot.hold && cw - tw > bot.drift) sell(c, (cw - tw) * E / px(c, i), i, bot.down || 'rebalance');
      }
      for (const c of Object.keys(t.w).sort((a, b) => t.w[b] - t.w[a])) {
        const tw = t.w[c];
        if (!pos[c]) buy(c, tw * E, i, t.why[c]);
        else if (!bot.hold) {
          const cw = pos[c].q * px(c, i) / E;
          if (tw - cw > bot.drift) buy(c, (tw - cw) * E, i, bot.up || 'rebalance');
        }
      }
    }
    eq.push(value(i));
  }
  return { trades, eq, pos, cash, start, end };
}

// "Just buy Bitcoin and wait" — the yardstick every bot is compared with.
export function holdBTC(d, { start = 0, end = d.dates.length - 1, cash = 1000 } = {}) {
  const q = cash * (1 - FEE) / d.px.BTC[start], eq = [];
  for (let i = start; i <= end; i++) eq.push(q * d.px.BTC[i]);
  return eq;
}

export function stats(eq) {
  const a = eq[0], z = eq[eq.length - 1], days = eq.length - 1;
  let peak = a, worst = 0;
  for (const v of eq) { if (v > peak) peak = v; worst = Math.min(worst, v / peak - 1); }
  return { start: a, end: z, ret: z / a - 1, perYear: days >= 365 ? (z / a) ** (365 / days) - 1 : null, worst };
}

// % gain or loss in each calendar year (partial years included, marked).
export function yearly(dates, eq, start = 0) {
  const at = k => new Date(dates[start + k] * DAY), out = [];
  let y0 = at(0).getUTCFullYear(), base = eq[0];
  for (let k = 1; k < eq.length; k++) {
    const y = at(k).getUTCFullYear();
    if (y !== y0) { out.push({ year: y0, ret: eq[k - 1] / base - 1 }); base = eq[k - 1]; y0 = y; }
  }
  out.push({ year: y0, ret: eq[eq.length - 1] / base - 1 });
  const s = at(0), e = at(eq.length - 1);
  if (s.getUTCMonth() || s.getUTCDate() > 1) out[0].partial = true;
  if (e.getUTCMonth() < 11 || e.getUTCDate() < 31) out[out.length - 1].partial = true;
  return out;
}

// What a practice wallet looks like now. Its history is replayed from its start day, so it never drifts
// out of sync even if the phone was off for weeks.
export function runWallet(w, d, live = {}) {
  const bot = botById(w.bot), last = d.dates.length - 1;
  const start = d.dates.findIndex(day => day >= w.startDay);
  if (start < 0) {
    const next = (w.startDay + 1) * DAY;
    return { bot, pending: true, value: w.cash, cash: w.cash, pos: {}, trades: [], eq: [w.cash], nextAt: next, start: null };
  }
  const r = simulate(bot, d, { start, cash: w.cash });
  let value = r.cash;
  const holdings = [];
  for (const c in r.pos) {
    const p = live[c] ?? d.px[c][last], v = r.pos[c].q * p;
    value += v;
    holdings.push({ c, value: v, gain: p / r.pos[c].entry - 1, entry: r.pos[c].entry, now: p });
  }
  holdings.sort((a, b) => b.value - a.value);
  const k = Math.floor((last - start) / bot.every) + 1;
  const nextDay = d.dates[start] + k * bot.every;
  return { bot, pending: false, value, cash: r.cash, holdings, trades: r.trades, eq: [...r.eq, value], nextAt: (nextDay + 1) * DAY, start };
}

// What the bot "sees" at a given close: market trend, every coin it watches and what it would pick.
// Drives the live agents panel. Same rules as target(), just laid out for people.
export function explain(bot, d, i = d.dates.length - 1) {
  const x = ctxAt(d, i), t = bot.target(x);
  const btcUp = x.has('BTC', 200) ? x.p('BTC') > x.sma('BTC', 200) : null;
  const coins = bot.coins.filter(c => x.has(c)).map(c => {
    const long = x.has(c, 200);
    const signals = long ? [x.p(c) > x.sma(c, 50), x.p(c) > x.sma(c, 200), x.sma(c, 50) > x.sma(c, 200)] : [];
    const trend = bot.pick ? long && x.p(c) > x.sma(c, 200) && x.sma(c, 20) > x.sma(c, 50) : long && x.p(c) > x.sma(c, 200);
    return {
      c, p: x.p(c), trend, score: signals.filter(Boolean).length,
      ret30: x.has(c, 31) ? x.ret(c, 30) : null, ret1: x.has(c, 2) ? x.ret(c, 1) : null,
      avg200: long ? x.sma(c, 200) : null, w: t.w[c] || 0,
    };
  });
  coins.sort((a, b) => (b.w - a.w) || ((b.trend - a.trend)) || ((b.ret30 ?? -9) - (a.ret30 ?? -9)));
  return { day: d.dates[i], btcUp, btc: x.p('BTC'), btcAvg: x.has('BTC', 200) ? x.sma('BTC', 200) : null, coins, target: t.w, out: t.out };
}

// Closed results from a trade list: wins, losses, best and last sell (each sell vs. its average cost).
export function tradeStats(trades) {
  const book = {}, sells = [], rows = [];
  for (const t of trades) {
    const b = book[t.c] || (book[t.c] = { q: 0, cost: 0 });
    if (t.side === 'buy') { b.q += t.q; b.cost += t.usd; rows.push(t); }
    else {
      const share = b.q ? Math.min(1, t.q / b.q) : 1, cost = b.cost * share;
      const s = { ...t, pnl: t.usd - cost, pct: cost ? t.usd / cost - 1 : 0 };
      sells.push(s); rows.push(s);
      b.q -= t.q; b.cost -= cost; if (b.q <= 1e-12) { b.q = 0; b.cost = 0; }
    }
  }
  const wins = sells.filter(s => s.pnl > 0).length;
  return { rows, sells, wins, losses: sells.length - wins, best: sells.reduce((m, s) => (!m || s.pct > m.pct ? s : m), null), last: sells[sells.length - 1] || null };
}
