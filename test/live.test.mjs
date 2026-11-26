// node test/live.test.mjs — the ⚡ Live bot on made-up 15-minute candles.
import assert from 'node:assert/strict';
import { LIVE, newLiveState, liveStep, liveExplain, liveWatch, liveEnter } from '../live.js';

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

test('safety stop sells at −5% (or the open if it gapped lower)', () => {
  const bars = mk(200, (c, k) => 100 * (1 + (c === 'SOL' ? 0.002 : 0.0005)) ** k * (c === 'SOL' && k >= 135 ? 0.85 : 1));
  const st = liveStep(newLiveState(1000, T0 + 120 * MS), bars);
  const s = st.trades.find(t => t.why === 'live_stop');
  assert.ok(s && s.c === 'SOL');
  assert.ok(s.pnl < 0);
});

test('trailing profit: sells after giving back 2.5% from the top once +5% up', () => {
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

test('live watching: buys on the live price, stops out the moment −5% is hit', () => {
  const bars = mk(200, (c, k) => 100 * (1 + (c === 'SOL' ? 0.002 : 0.0005)) ** k);
  const st = newLiveState(1000, T0 + 199 * MS); st.last = bars.BTC.at(-1).t;
  const px = Object.fromEntries(Object.entries(bars).map(([c, b]) => [c, b.at(-1).c]));
  const now = T0 + 200 * MS + 60e3;
  const buy = liveEnter(st, bars, px, now);
  assert.ok(buy && buy.c === 'SOL' && st.pos);
  assert.equal(liveWatch(st, { SOL: px.SOL * 0.97 }, now + 1000), null);
  const out = liveWatch(st, { SOL: px.SOL * 0.949 }, now + 2000);
  assert.ok(out && out.why === 'live_stop' && out.pnl < 0 && !st.pos);
});

test('live watching: profit lock after +5%, then −2.5% from the top', () => {
  const st = newLiveState(1000, T0); st.cash = 0;
  st.pos = { c: 'ETH', q: 10, entry: 100, peak: 100, bars: 0, cost: 1000, since: T0 };
  liveWatch(st, { ETH: 108 }, T0 + 1);
  assert.ok(st.pos);
  const out = liveWatch(st, { ETH: 105.2 }, T0 + 2);
  assert.ok(out && out.why === 'live_profit' && out.pnl > 0);
});

test('candles the app watched live are not double-counted', () => {
  const bars = mk(200, (c, k) => 100 * (1 + (c === 'SOL' ? 0.002 : 0.0005)) ** k);
  const st = newLiveState(1000, T0 + 120 * MS);
  st.watchFrom = T0 + 120 * MS; st.watchTo = T0 + 200 * MS;
  liveStep(st, bars);
  assert.equal(st.trades.length, 0, 'entries in watched candles came from the live loop, not the replay');
});

console.log(`\n${n} tests passed`);
