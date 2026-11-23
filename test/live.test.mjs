// node test/live.test.mjs — the ⚡ Live bot on made-up 15-minute candles.
import assert from 'node:assert/strict';
import { LIVE, newLiveState, liveStep, liveExplain } from '../live.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };
const T0 = Date.UTC(2026, 10, 1), MS = LIVE.ms;
function mk(len, f) {
  const bars = {};
  for (const c of LIVE.coins) {
    bars[c] = [];
    let prev = f(c, 0);
    for (let k = 0; k < len; k++) { const p = f(c, k); bars[c].push({ t: T0 + k * MS, o: prev, h: Math.max(prev, p) * 1.001, l: Math.min(prev, p) * 0.999, c: p }); prev = p; }
  }
  return bars;
}
const slice = (bars, upto) => Object.fromEntries(Object.entries(bars).map(([c, b]) => [c, b.filter(x => x.t <= upto)]));

test('buys the strongest coin when Bitcoin is above its 24h average', () => {
  const bars = mk(200, (c, k) => 100 * (1 + (c === 'SOL' ? 0.002 : 0.0005)) ** k);
  const st = liveStep(newLiveState(1000, T0 + 120 * MS), bars);
  assert.equal(st.trades[0].side, 'buy'); assert.equal(st.trades[0].c, 'SOL');
  assert.ok(st.trades[0].ts >= T0 + 120 * MS);
});

test('safety stop sells at −3% (or the open if it gapped lower)', () => {
  const bars = mk(200, (c, k) => 100 * (1 + (c === 'SOL' ? 0.002 : 0.0005)) ** k * (c === 'SOL' && k >= 150 ? 0.9 : 1));
  const st = liveStep(newLiveState(1000, T0 + 120 * MS), bars);
  const s = st.trades.find(t => t.why === 'live_stop');
  assert.ok(s && s.c === 'SOL');
  assert.ok(s.pnl < 0);
});

test('trailing profit: sells after giving back 1.5% from the top once +3% up', () => {
  const bars = mk(260, (c, k) => c === 'SOL' ? (k < 160 ? 100 * 1.002 ** k : 100 * 1.002 ** 160 * 0.996 ** (k - 160)) : 100 * 1.0004 ** k);
  const st = liveStep(newLiveState(1000, T0 + 120 * MS), bars);
  const s = st.trades.find(t => t.why === 'live_profit');
  assert.ok(s, JSON.stringify(st.trades.map(t => t.why)));
  assert.ok(s.pnl > 0);
});

test('no buying while Bitcoin is under its 24h average', () => {
  const bars = mk(200, (c, k) => c === 'BTC' ? 100 * 0.999 ** k : 100 * 1.003 ** k);
  const st = liveStep(newLiveState(1000, T0 + 120 * MS), bars);
  assert.equal(st.trades.length, 0);
});

test('catching up in pieces gives exactly the same result as one long run', () => {
  let seed = 9; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const walk = {}; for (const c of LIVE.coins) { let p = 50; walk[c] = Array.from({ length: 900 }, () => (p *= 1 + (R() - 0.495) * 0.012)); }
  const bars = mk(900, (c, k) => walk[c][k]);
  const one = liveStep(newLiveState(1000, T0 + 100 * MS), bars);
  let st = newLiveState(1000, T0 + 100 * MS);
  for (const cut of [300, 301, 450, 700, 899]) st = liveStep(st, slice(bars, T0 + cut * MS));
  assert.deepEqual(st.trades, one.trades);
  assert.ok(Math.abs(st.cash - one.cash) < 1e-9);
  assert.ok(one.trades.length > 4, 'traded: ' + one.trades.length);
  assert.ok(one.cash > 0);
});

test('explain picks the same coin the bot buys', () => {
  const bars = mk(200, (c, k) => 100 * (1 + (c === 'AVAX' ? 0.002 : 0.0005)) ** k);
  const e = liveExplain(bars);
  assert.equal(e.coins[0].c, 'AVAX'); assert.equal(e.coins[0].w, 1); assert.ok(e.btcUp);
});

console.log(`\n${n} tests passed`);
