// node test/engine.test.mjs — checks the bot rules on made-up prices (no internet needed).
import assert from 'node:assert/strict';
import { makeData, simulate, holdBTC, stats, yearly, runWallet, explain, tradeStats, BOTS, botById, UNIVERSE, FEE, DAY } from '../engine.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };

// Build a market: every coin follows a path function f(coin, i).
function market(days, f, startDay = Math.floor(Date.UTC(2021, 0, 1) / DAY), coins = UNIVERSE) {
  const dates = Array.from({ length: days }, (_, i) => startDay + i);
  const series = {};
  for (const c of coins) series[c] = dates.map((_, i) => f(c, i));
  return makeData(dates, series);
}
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

test('calm buys BTC+ETH in an up-trend and sells when they fall below the 200-day average', () => {
  // 300 days up, then 200 days down hard
  const d = market(500, (c, i) => i < 300 ? 100 * 1.003 ** i : 100 * 1.003 ** 300 * 0.99 ** (i - 300));
  const r = simulate(botById('calm'), d, { start: 0 });
  const firstBuy = r.trades.find(t => t.side === 'buy');
  assert.ok(firstBuy, 'should buy');
  assert.ok(d.dates.indexOf(firstBuy.day) >= 199, 'cannot buy before 200 days of history');
  assert.equal(Object.keys(r.pos).length, 0, 'ends in cash after the crash');
  assert.ok(r.trades.some(t => t.side === 'sell' && t.why === 'below_avg'));
});

test('momentum picks the 3 strongest trending coins and equal-weights them', () => {
  const speed = Object.fromEntries(UNIVERSE.map((c, k) => [c, 1 + 0.0005 * (k + 1)])); // BCH fastest
  const d = market(260, (c, i) => 10 * speed[c] ** i);
  const r = simulate(botById('momentum'), d, { start: 0 });
  assert.deepEqual(Object.keys(r.pos).sort(), ['BCH', 'TRX', 'UNI']);
  const buys = r.trades.filter(t => t.side === 'buy');
  for (const b of buys) assert.ok(Math.abs(b.usd - 1000 / 3) < 0.01 || b.usd < 1000 / 3);
});

test('momentum goes to cash when Bitcoin is below its 200-day average', () => {
  const d = market(400, (c, i) => c === 'BTC' ? (i < 250 ? 100 * 1.004 ** i : 100 * 1.004 ** 250 * 0.985 ** (i - 250)) : 10 * 1.004 ** i);
  const r = simulate(botById('momentum'), d, { start: 0 });
  assert.equal(Object.keys(r.pos).length, 0);
  assert.ok(r.trades.some(t => t.why === 'market_down'));
});

test('safety stop sells a coin that falls 25% below its buy price', () => {
  // all coins rise; at day 230 SOL (one of the strongest) halves in a day
  const speed = Object.fromEntries(UNIVERSE.map((c, k) => [c, 1 + 0.0004 * (c === 'SOL' ? 30 : k + 1)]));
  const d = market(240, (c, i) => 10 * speed[c] ** i * (c === 'SOL' && i >= 230 ? 0.5 : 1));
  const r = simulate(botById('momentum'), d, { start: 0 });
  const stop = r.trades.find(t => t.why === 'stop');
  assert.ok(stop && stop.c === 'SOL');
  assert.equal(stop.day, d.dates[230]);
});

test('no peeking at the future: decisions only change when past prices change', () => {
  const R = rng(7);
  const walk = {}; for (const c of UNIVERSE) { let p = 50; walk[c] = Array.from({ length: 700 }, () => (p *= 1 + (R() - 0.48) * 0.06)); }
  const full = market(700, (c, i) => walk[c][i]);
  const cut = market(500, (c, i) => walk[c][i]);
  for (const bot of BOTS) {
    const a = simulate(bot, full, { start: 0, end: 499 }).trades;
    const b = simulate(bot, cut, { start: 0 }).trades;
    assert.deepEqual(a, b, bot.id);
  }
});

test('fees are charged and money is never created', () => {
  const d = market(300, () => 100); // flat prices
  for (const bot of BOTS) {
    const r = simulate(bot, d, { start: 0 });
    assert.ok(r.eq.at(-1) <= 1000 + 1e-9, bot.id);
    if (r.trades.length) assert.ok(r.eq.at(-1) < 1000, bot.id + ' paid fees');
  }
  const h = holdBTC(d);
  assert.ok(Math.abs(h.at(-1) - 1000 * (1 - FEE)) < 1e-9);
});

test('step-by-step scales in gradually', () => {
  const d = market(700, (c, i) => i < 300 ? 200 * 0.998 ** i : 200 * 0.998 ** 300 * 1.004 ** (i - 300));
  const r = simulate(botById('steps'), d, { start: 0 });
  const btcBuys = r.trades.filter(t => t.c === 'BTC' && t.side === 'buy');
  assert.ok(btcBuys.length >= 2, 'more than one step in');
  assert.ok(r.cash < 50, 'fully in at the end of a long rise');
});

test('long term holds and rebalances monthly, never goes to cash', () => {
  const R = rng(3);
  let p = 100, q = 100;
  const b = [], e = []; for (let i = 0; i < 800; i++) { b.push(p *= 1 + (R() - 0.5) * 0.05); e.push(q *= 1 + (R() - 0.5) * 0.08); }
  const d = makeData(Array.from({ length: 800 }, (_, i) => 18628 + i), { BTC: b, ETH: e });
  const r = simulate(botById('longterm'), d, { start: 0 });
  assert.ok(r.pos.BTC && r.pos.ETH);
  const w = r.pos.BTC.q * b.at(-1) / r.eq.at(-1);
  assert.ok(w > 0.55 && w < 0.85, 'stays near 70/30: ' + w);
});

test('stats and yearly', () => {
  const s = stats([100, 120, 60, 90]);
  assert.equal(s.worst, -0.5);
  assert.ok(Math.abs(s.ret + 0.1) < 1e-12);
  const d0 = Math.floor(Date.UTC(2023, 11, 30) / DAY);
  const y = yearly([d0, d0 + 1, d0 + 2, d0 + 3], [100, 110, 121, 133.1]);
  assert.equal(y.length, 2);
  assert.ok(Math.abs(y[0].ret - 0.1) < 1e-9 && Math.abs(y[1].ret - 0.21) < 1e-9);
});

test('practice wallet: pending before its first close, replays afterwards, values at live price', () => {
  const d = market(300, (c, i) => 10 * 1.003 ** i);
  const last = d.dates.at(-1);
  const p = runWallet({ bot: 'momentum', startDay: last + 1, cash: 1000 }, d);
  assert.ok(p.pending && p.value === 1000 && p.nextAt === (last + 2) * DAY);
  const w = runWallet({ bot: 'momentum', startDay: last - 20, cash: 1000 }, d);
  assert.ok(!w.pending && w.holdings.length === 3);
  const live = Object.fromEntries(UNIVERSE.map(c => [c, d.px[c].at(-1) * 2]));
  const w2 = runWallet({ bot: 'momentum', startDay: last - 20, cash: 1000 }, d, live);
  assert.ok(w2.value > w.value * 1.9);
  assert.ok(w.nextAt > (last + 1) * DAY - 1 && w.nextAt <= (last + 8) * DAY);
});

test('random markets: every bot stays solvent and sensible over 5 years', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const R = rng(seed), walk = {};
    for (const c of UNIVERSE) { let p = 20 + R() * 100; const drift = (R() - 0.5) * 0.004; walk[c] = Array.from({ length: 1800 }, () => (p *= 1 + drift + (R() - 0.5) * 0.08)); }
    const d = market(1800, (c, i) => walk[c][i]);
    for (const bot of BOTS) {
      const r = simulate(bot, d, { start: 0 });
      assert.ok(r.cash >= -1e-6, bot.id + ' cash');
      assert.ok(r.eq.every(v => Number.isFinite(v) && v >= 0), bot.id + ' finite');
      assert.ok(Object.keys(r.pos).length <= 3, bot.id + ' positions');
    }
  }
});

test('explain matches what the bot actually buys', () => {
  const R = rng(5), walk = {};
  for (const c of UNIVERSE) { let p = 50; walk[c] = Array.from({ length: 600 }, () => (p *= 1 + (R() - 0.47) * 0.05)); }
  const d = market(600, (c, i) => walk[c][i]);
  for (const bot of BOTS) {
    const e = explain(bot, d);
    const r = simulate(bot, d, { start: d.dates.length - 1 });
    const bought = r.trades.map(t => t.c).sort(), picked = e.coins.filter(c => c.w > 0).map(c => c.c).sort();
    assert.deepEqual(bought, picked, bot.id);
    assert.equal(e.coins.length, bot.coins.length);
  }
});

test('trade stats: wins and losses per sell', () => {
  const s = tradeStats([
    { c: 'A', side: 'buy', usd: 100, q: 10 }, { c: 'A', side: 'sell', usd: 150, q: 10 },
    { c: 'B', side: 'buy', usd: 100, q: 10 }, { c: 'B', side: 'sell', usd: 40, q: 5 }, { c: 'B', side: 'sell', usd: 60, q: 5 },
  ]);
  assert.equal(s.wins, 2); assert.equal(s.losses, 1);
  assert.ok(Math.abs(s.best.pct - 0.5) < 1e-9);
  assert.ok(Math.abs(s.last.pnl - 10) < 1e-9);
});

test('checks are recorded and open positions are reported', () => {
  const d = market(300, (c, i) => 10 * 1.003 ** i);
  const r = simulate(botById('momentum'), d, { start: 0 });
  assert.equal(r.checks.length, Math.floor(299 / 7) + 1);
  assert.deepEqual(r.checks.at(-1).picks.sort(), Object.keys(r.pos).sort());
  const s = tradeStats(r.trades);
  assert.deepEqual(s.open.map(o => o.c).sort(), Object.keys(r.pos).sort());
  for (const o of s.open) assert.ok(Math.abs(o.q - r.pos[o.c].q) < 1e-9);
});

console.log(`\n${n} tests passed`);
