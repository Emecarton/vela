// data.js — daily prices from Binance's free public market data. No account, no key, no cost.
// Prices are kept on the phone, so after the first load only the newest day is downloaded.
import { UNIVERSE, DAY, makeData } from './engine.js';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const SINCE = Math.floor(Date.UTC(2019, 0, 1) / DAY);
const KEY = c => 'vela:px:' + c;

async function klines(coin, fromDay) {
  let err;
  for (const h of HOSTS) {
    try {
      const r = await fetch(`${h}/api/v3/klines?symbol=${coin}USDT&interval=1d&limit=1000&startTime=${fromDay * DAY}`);
      if (r.ok) return await r.json();
      err = new Error('HTTP ' + r.status);
    } catch (e) { err = e; }
  }
  throw err;
}

function load(coin) {
  try { return JSON.parse(localStorage.getItem(KEY(coin))) || null; } catch { return null; }
}
function save(coin, h) {
  try { localStorage.setItem(KEY(coin), JSON.stringify({ d0: h.d0, c: h.c })); } catch { /* storage full: still works, just slower */ }
}

// One coin: closed daily candles { d0: firstDay, c: [closes] } plus today's live price.
async function coinHistory(coin) {
  const h = load(coin) || { d0: null, c: [] };
  let from = h.d0 == null ? SINCE : h.d0 + h.c.length, live = null;
  for (let guard = 0; guard < 10; guard++) {
    const rows = await klines(coin, from);
    if (!rows.length) break;
    const now = Date.now();
    for (const r of rows) {
      const day = Math.round(r[0] / DAY), close = +r[4];
      if (r[6] >= now) { live = close; continue; }          // candle still open: today's price, not history
      if (h.d0 == null) h.d0 = day;
      const idx = day - h.d0;
      if (idx < h.c.length) continue;
      while (h.c.length < idx) h.c.push(h.c[h.c.length - 1]); // fill a missing day with the day before
      h.c.push(close);
    }
    if (rows.length < 1000) break;
    from = Math.round(rows[rows.length - 1][0] / DAY) + 1;
  }
  if (h.c.length) save(coin, h);
  if (live == null && h.c.length) live = h.c[h.c.length - 1];
  return { ...h, live };
}

// All coins lined up on Bitcoin's calendar. Returns { d, live, stale } where stale means "offline, using saved prices".
export async function loadMarket() {
  let stale = false;
  const all = await Promise.all(UNIVERSE.map(c => coinHistory(c).catch(() => {
    stale = true;
    const h = load(c);
    return h ? { ...h, live: h.c[h.c.length - 1] } : null;
  })));
  const btc = all[0];
  if (!btc || !btc.c.length) throw new Error('no-prices');
  const dates = btc.c.map((_, i) => btc.d0 + i), series = {}, live = {};
  UNIVERSE.forEach((coin, k) => {
    const h = all[k];
    if (!h || !h.c.length) return;
    let lastSeen = null;
    series[coin] = dates.map(day => {
      const i = day - h.d0;
      if (i < 0) return null;
      if (i < h.c.length) return (lastSeen = h.c[i]);
      return lastSeen;
    });
    live[coin] = h.live;
  });
  return { d: makeData(dates, series), live, stale, at: Date.now() };
}
