// app.js — the screens. No frameworks: plain HTML strings, one render() for everything.
import { BOTS, botById, simulate, holdBTC, stats, yearly, runWallet, explain, tradeStats, DAY, UNIVERSE } from './engine.js';
import { loadMarket, candles, ticker, TF, klinesRange, liveStream } from './data.js';
import { LIVE, newLiveState, liveStep, liveExplain, liveWatch, liveEnter } from './live.js';
import { STR } from './i18n.js';

const COIN = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', NEAR: 'NEAR', UNI: 'Uniswap', TRX: 'TRON', BCH: 'Bitcoin Cash' };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, def) { try { return JSON.parse(localStorage.getItem('vela:' + k)) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('vela:' + k, JSON.stringify(v)); } catch { } },
};

const S = {
  tab: 'home', view: null, coin: null, picking: false, livePts: {},
  set: { lang: (navigator.language || 'es').startsWith('es') ? 'es' : 'en', theme: 'terminal', size: 1, onboarded: false, ...store.get('settings', {}) },
  wallets: store.get('wallets', []),
  manual: store.get('manual', null), desk: {}, cnd: {}, tick: {}, trade: null, cndReq: null, lbars: {}, liveAt: 0, liveBusy: false,
  mk: null, loading: false, error: null,
  test: { bot: 'momentum', period: 1095 },
  setup: { bot: null, amt: 1000, start: 30 },
  confirm: null,
};
const T = () => STR[S.set.lang];
const loc = () => (S.set.lang === 'es' ? 'es-ES' : 'en-US');
const saveSet = () => store.set('settings', S.set);
const saveWallets = () => store.set('wallets', S.wallets);

// ---------- formatting ----------
const money = v => {
  const whole = Math.abs(v) >= 1000 || Number.isInteger(v);
  return new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', useGrouping: 'always', maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 }).format(v);
};
const num1 = v => new Intl.NumberFormat(loc(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
const pctTxt = r => (r >= 0 ? '+' : '−') + num1(Math.abs(r * 100)) + '%';
const chg = r => r == null ? '—' : `<span class="chg ${r >= 0 ? 'up' : 'down'}"><span aria-hidden="true">${r >= 0 ? '▲' : '▼'}</span> ${pctTxt(r)}</span>`;
const dayDate = (day, o = { day: 'numeric', month: 'short', year: 'numeric' }) => new Date(day * DAY).toLocaleDateString(loc(), { timeZone: 'UTC', ...o });
const when = ms => new Date(ms).toLocaleString(loc(), { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);

// ---------- small pieces ----------
const avatar = (b, big) => `<span class="av${big ? ' big' : ''}" style="--h:${b.hue}" aria-hidden="true">${b.icon}</span>`;
const botName = b => (b.kind === 'live' ? T().live.name : T().bots[b.id].name);
const LIVE_BOT = { id: 'live', kind: 'live', icon: '⚡', hue: 48, risk: 5, stop: LIVE.stop, pick: 1, coins: LIVE.coins, every: 0 };
const getBot = id => (id === 'live' ? LIVE_BOT : botById(id));
const riskMeter = b => `<div class="risk" aria-label="${T().risk}: ${T().riskWords[b.risk]}">
  <span class="bars" aria-hidden="true">${[1, 2, 3, 4, 5].map(k => `<i class="${k <= b.risk ? 'on' : ''}" style="--k:${k}"></i>`).join('')}</span>
  <span>${T().risk}: <b>${T().riskWords[b.risk]}</b></span></div>`;
const chips = (group, items, cur, label) => `<div class="chips" role="group" aria-label="${esc(label)}">${items.map(([v, txt]) =>
  `<button class="chip" data-act="${group}" data-v="${v}" data-k="${group}-${v}" aria-pressed="${String(v) === String(cur)}">${txt}</button>`).join('')}</div>`;

function chart(lines, label, h = 150) {
  const W = 320, pts = lines.map(l => {
    const v = l.v, step = Math.max(1, Math.ceil(v.length / 160)), out = [];
    for (let i = 0; i < v.length; i += step) out.push(v[i]);
    if (out[out.length - 1] !== v[v.length - 1]) out.push(v[v.length - 1]);
    return out;
  });
  const all = pts.flat(), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const xy = arr => arr.map((v, i) => [(i / Math.max(1, arr.length - 1)) * W, 6 + (1 - (v - lo) / span) * (h - 12)]);
  const path = arr => xy(arr).map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  const main = path(pts[0]);
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <path class="area" d="${main}L${W} ${h}L0 ${h}Z"/>
    ${pts.slice(1).map((p, k) => `<path class="line ${lines[k + 1].cls}" d="${path(p)}" vector-effect="non-scaling-stroke"/>`).join('')}
    <path class="line ${lines[0].cls}" d="${main}" vector-effect="non-scaling-stroke"/></svg>`;
}

// ---------- data ----------
const memo = new Map();
function cached(key, fn) { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); }
function walletView(w) {
  if (w.bot === 'live') return liveView(w);
  const r = cached(`w|${w.id}|${S.mk.at}`, () => runWallet(w, S.mk.d, S.mk.live));
  if (r.pending || !r.holdings?.length) return r;
  let value = r.cash;
  const holdings = r.holdings.map(h => { const q = h.value / h.now, now = S.tick[h.c]?.p ?? h.now; value += q * now; return { ...h, now, value: q * now, gain: now / h.entry - 1 }; });
  return { ...r, holdings, value, eq: [...r.eq.slice(0, -1), value] };
}

// ---------- ⚡ Live bot: runs on 15-minute candles, catches up whenever the app opens ----------
const lastBar = c => { const b = S.lbars[c]; return b && b.length ? b[b.length - 1] : null; };
function liveView(w) {
  const st = w.st, o = st.pos;
  const px = o ? (S.tick[o.c]?.p ?? lastBar(o.c)?.c ?? o.entry) : 0;
  const value = st.cash + (o ? o.q * px : 0);
  const trades = st.trades.map(x => ({ ...x, day: Math.floor(x.ts / DAY) }));
  return {
    bot: LIVE_BOT, pending: false, live: true, value, cash: st.cash, trades, checks: [],
    holdings: o ? [{ c: o.c, value: o.q * px, gain: px / o.entry - 1, entry: o.entry, now: px }] : [],
    eq: [...st.eq.map(x => x[1]), value], nextAt: (Math.floor(Date.now() / LIVE.ms) + 1) * LIVE.ms + 5e3, start: null,
  };
}
async function ensureBars(from) {
  await Promise.all(LIVE.coins.map(async c => {
    const have = S.lbars[c];
    let rows;
    if (have && have.length && have[0].t <= from) {
      const fresh = await klinesRange(c, '15m', LIVE.ms, have[have.length - 1].t + LIVE.ms);
      rows = have.concat(fresh.filter(x => x.t > have[have.length - 1].t));
    } else rows = await klinesRange(c, '15m', LIVE.ms, from);
    S.lbars[c] = rows.slice(-4000);
  }));
}
async function runLive(quiet) {
  const ws = S.wallets.filter(w => w.bot === 'live');
  if (!ws.length || S.liveBusy) return;
  S.liveBusy = true;
  try {
    const warm = (LIVE.avg + LIVE.look + 8) * LIVE.ms;
    for (const w of ws) if (!w.st) w.st = newLiveState(w.cash, w.startTs);
    const from = Math.min(...ws.map(w => w.st.last)) - warm;
    await ensureBars(from);
    const fresh = [];
    for (const w of ws) {
      const before = w.st.trades.length;
      liveStep(w.st, S.lbars);
      if (!quiet) fresh.push(...w.st.trades.slice(before).filter(x => x.ts > Date.now() - 20 * 60e3));
    }
    saveWallets();
    S.liveAt = Date.now();
    for (const x of fresh) toast(fill(T().live.toast[x.side], { b: T().live.name, c: x.c, p: price(x.p), pnl: x.pnl == null ? '' : signed(x.pnl) }));
    render();
  } catch { }
  S.liveBusy = false;
}
function toast(msg) {
  const el = $('#toast'); if (!el) return;
  const n = document.createElement('p'); n.className = 'notif';
  n.innerHTML = `<span class="logo-e" aria-hidden="true">E</span><span><b>EME Bot</b> <small>${T().home.notif}</small><br>${esc(msg.replace(/^⚡\s*/, ''))}</span>`;
  el.append(n); announce(msg);
  setTimeout(() => n.remove(), 6000);
}
setInterval(() => { if (S.mk && Math.floor(Date.now() / LIVE.ms) !== Math.floor((S.liveAt || 0) / LIVE.ms)) runLive(); }, 30e3);

// ---------- real time: every price, every second ----------
const ALL_COINS = [...new Set([...UNIVERSE, ...LIVE.coins])];
let stopStream = null, uiQueued = false, lastEnter = 0, lastChartPt = 0, lastCandlePaint = 0;
function startStream() {
  if (stopStream) return;
  stopStream = liveStream(ALL_COINS, ticks => {
    for (const c in ticks) S.tick[c] = { ...ticks[c], prev: S.tick[c]?.p, at: Date.now() };
    onLiveTick();
  });
}
function notifyTrade(x) {
  toast(fill(T().live.toast[x.side], { b: T().live.name, c: x.c, p: price(x.p), pnl: x.pnl == null ? '' : signed(x.pnl) }));
}
function onLiveTick() {
  const now = Date.now(), px = {};
  for (const c in S.tick) px[c] = S.tick[c].p;
  let changed = false;
  const slot = Math.floor(now / LIVE.ms) * LIVE.ms, entryCheck = now - lastEnter > 60e3;
  for (const w of S.wallets) {
    if (w.bot !== 'live' || !w.st || S.liveBusy) continue;
    if (w.st.last < slot - 2 * LIVE.ms) continue; // still catching up on missed candles
    if (w.st.watchFrom == null || now - (w.st.watchTo || 0) > 120e3) w.st.watchFrom = now;
    const out = liveWatch(w.st, px, now);
    if (out) { changed = true; notifyTrade(out); }
    if (entryCheck && S.lbars.BTC?.length) { const inn = liveEnter(w.st, S.lbars, px, now); if (inn) { changed = true; notifyTrade(inn); } }
  }
  if (entryCheck) lastEnter = now;
  if (changed) { saveWallets(); render(); return; }
  if (now - (S.savedWatch || 0) > 30e3) { S.savedWatch = now; saveWallets(); }
  if (!uiQueued) { uiQueued = true; setTimeout(() => { uiQueued = false; paintLive(); }, 350); }
}
function sparkPath(c) {
  const d = S.mk?.d, s = d?.px[c]; if (!s) return '';
  const vals = s.slice(-30).filter(x => x != null); const p = livePx(c); if (p) vals.push(p);
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, k) => `${(k / (vals.length - 1) * 100).toFixed(1)},${(4 + (1 - (v - lo) / span) * 32).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline class="${vals[vals.length - 1] >= vals[0] ? 'up' : 'down'}" points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
}
function flash(el, up) { el.classList.remove('fu', 'fd'); void el.offsetWidth; el.classList.add(up ? 'fu' : 'fd'); }
function rollTo(el, v) {
  const from = el._v ?? v; el._v = v;
  if (Math.abs(from - v) < 0.005) { el.textContent = money(v); return; }
  flash(el, v >= from);
  const t0 = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450;
  const step = t => { const k = dur ? Math.min(1, (t - t0) / dur) : 1; el.textContent = money(from + (v - from) * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function paintLive() {
  if (document.hidden) return;
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-px]')) {
    const t = S.tick[el.dataset.px]; if (!t) continue;
    const txt = price(t.p); if (el.textContent !== txt) { el.textContent = txt; flash(el, t.p >= (t.prev ?? t.p)); }
  }
  for (const el of document.querySelectorAll('[data-chg]')) { const t = S.tick[el.dataset.chg]; if (t) el.innerHTML = chg(t.chg); }
  for (const el of document.querySelectorAll('[data-wv]')) {
    const id = el.dataset.wv, w = S.wallets.find(x => x.id === id);
    const v = id === 'manual' ? (S.manual ? manualValue(S.manual) : null) : w && S.mk ? walletView(w).value : null;
    if (v != null) rollTo(el, v);
  }
  for (const el of document.querySelectorAll('[data-pos]')) {
    const c = el.dataset.pos, pos = S.manual && manualBook(S.manual)[c], p = livePx(c);
    if (pos && p) { const val = pos.q * p, pl = val - pos.cost; el.querySelector('[data-pv]').textContent = money(val); const pe = el.querySelector('[data-pl]'); pe.textContent = signed(pl) + ' · ' + pctTxt(pl / pos.cost); pe.className = 'mono ' + (pl >= 0 ? 'up-t' : 'down-t'); }
  }
  for (const el of document.querySelectorAll('[data-spark]')) el.innerHTML = sparkPath(el.dataset.spark);
  // Home chart grows while you watch
  const hc = document.querySelector('[data-hchart]');
  if (hc && now - lastChartPt > 3000) {
    lastChartPt = now;
    const w = homeWallet();
    if (w && S.mk) { const v = walletView(w); (S.livePts[w.id] ||= []).push([now, v.value]); if (S.livePts[w.id].length > 2500) S.livePts[w.id].shift(); hc.outerHTML = homeChart(w, v); }
  }
  // the newest candle moves with the live price
  if (S.cnd.rows && (S.view || S.coin) && now - lastCandlePaint > 1000) {
    const c = S.desk.coin, t = S.tick[c], rows = S.cnd.rows;
    if (t && rows.length > 1) {
      const ms = rows[1].t - rows[0].t, last = rows[rows.length - 1];
      if (now < last.t + ms) { last.c = t.p; last.h = Math.max(last.h, t.p); last.l = Math.min(last.l, t.p); }
      else rows.push({ t: last.t + ms, o: last.c, h: t.p, l: t.p, c: t.p, v: 0 });
      lastCandlePaint = now; paintChart();
    }
  }
  const tp = document.querySelector('[data-ts-px]');
  if (tp && S.trade) { const p = livePx(S.trade.coin); if (p) { tp.textContent = price(p); const q = document.querySelector('.ts-q'); if (q) q.textContent = '≈ ' + qty((+S.trade.amt || 0) / p) + ' ' + S.trade.coin; } }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) paintLive(); });

async function refresh(manual) {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    S.mk = await loadMarket();
    memo.clear();
    runLive(true);
    announce(S.mk.stale ? T().offline : manual ? T().updated : '');
  } catch (e) {
    S.error = T().loadError;
    announce(S.error);
  }
  S.loading = false; render();
}
function announce(msg) { if (msg) { const el = $('#live'); el.textContent = ''; setTimeout(() => (el.textContent = msg), 50); } }

// ---------- screens ----------
function statusBox() {
  if (S.error && !S.mk) return `<div class="card note bad"><p>${S.error}</p><button class="btn" data-act="refresh" data-k="retry">${T().retry}</button></div>`;
  if (!S.mk) return `<div class="card note" aria-busy="true"><div class="spinner" aria-hidden="true"></div><p><b>${T().loading}</b></p><p class="muted">${T().loadingFirst}</p></div>`;
  if (S.mk.stale) return `<p class="banner">${T().offline}</p>`;
  return '';
}

function practice() {
  const t = T();
  if (!S.wallets.length && !S.manual) return `<p class="lead">${t.practiceNote}</p>
    <div class="card empty"><div class="empty-art" aria-hidden="true">⛵</div><h2>${t.emptyTitle}</h2><p>${t.emptyText}</p>
    <button class="btn primary" data-act="tab" data-v="bots" data-k="go-bots">${t.emptyBtn}</button></div>`;
  const box = statusBox();
  if (!S.mk) return box;
  const views = S.wallets.map(w => [w, walletView(w)]);
  const mv = S.manual ? manualValue(S.manual) : 0;
  const total = views.reduce((a, [, v]) => a + v.value, 0) + mv, base = S.wallets.reduce((a, w) => a + w.cash, 0) + (S.manual ? S.manual.start : 0);
  return `${box}<section class="card hero" aria-label="${t.total}">
      <p class="muted">${t.total} · ${t.practiceNote}</p>
      <p class="big">${money(total)}</p>
      <p>${chg(total / base - 1)} <span class="muted">${t.sinceStart}</span></p>
    </section>
    <ul class="list">${views.map(([w, v]) => {
      const b = v.bot, hold = v.pending ? `${t.waiting}: ${when(v.nextAt)}`
        : v.holdings.length ? `${t.holds}: ${v.holdings.map(h => h.c).join(', ')}` : t.inCash;
      return `<li><button class="card wallet" data-act="open" data-v="${w.id}" data-k="open-${w.id}">
        ${avatar(b)}<span class="wl-main"><span class="wl-name">${botName(b)}</span><span class="muted">${esc(hold)}</span></span>
        <span class="wl-val"><span class="wl-money" data-wv="${w.id}">${money(v.value)}</span>${chg(v.value / w.cash - 1)}</span>
      </button></li>`;
    }).join('')}${S.manual ? `<li><button class="card wallet" data-act="manual" data-k="open-manual"><span class="av" style="--h:200" aria-hidden="true">🧑</span>
        <span class="wl-main"><span class="wl-name">${t.desk.you}</span><span class="muted">${t.desk.youLine}</span></span>
        <span class="wl-val"><span class="wl-money" data-wv="manual">${money(mv)}</span>${chg(mv / S.manual.start - 1)}</span></button></li>` : ''}</ul>
    <div class="actions"><button class="btn ghost" data-act="tab" data-v="bots" data-k="add-bot">+ ${t.addBot}</button>
    ${S.manual ? '' : `<button class="btn ghost" data-act="manual" data-k="go-manual">🧑 ${t.desk.you}</button>`}</div>`;
}

function countdown(ms) {
  let m = Math.max(0, Math.round((ms - Date.now()) / 60e3));
  const dd = Math.floor(m / 1440); m -= dd * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  return (dd ? dd + 'd ' : '') + (dd || h ? h + 'h ' : '') + m + 'm';
}
setInterval(() => { for (const el of document.querySelectorAll('[data-until]')) el.textContent = countdown(+el.dataset.until); }, 30e3);

// ---------- the desk: chart · analysis + trades · agents chat ----------
const FEE = 0.001;
const BLOB = {
  vela: ['#F4F5F7', 'M20 3c9 0 16 7 16 16s-6 18-16 18S4 28 4 19 11 3 20 3z'],
  scanner: ['#19C9A5', 'M20 2l15 9v18l-15 9-15-9V11z'],
  analyst: ['#FF4747', 'M20 3l17 17-17 17L3 20z'],
  sizer: ['#9AA3B5', 'M8 4h24a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z'],
  fills: ['#9B7CFF', 'M12 6h16a8 8 0 0 1 8 8v12a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8z'],
  risk: ['#FF7A1A', 'M20 4c9.4 0 15 6.6 15 15.5S29.4 36 20 36 5 28.4 5 19.5 10.6 4 20 4z'],
  market: ['#FF5FA8', 'M20 3c6 7 14 13 14 21a14 14 0 0 1-28 0C6 16 14 10 20 3z'],
};
let BID = 0;
const mix = (hex, to, k) => { const n = parseInt(hex.slice(1), 16), m = parseInt(to.slice(1), 16), c = i => Math.round(((n >> i) & 255) * (1 - k) + ((m >> i) & 255) * k); return `rgb(${c(16)},${c(8)},${c(0)})`; };
// Agent characters: a glossy body, a soft highlight and eyes that blink now and then.
const blob = k => {
  const [c, d] = BLOB[k], id = 'bl' + (++BID), delay = ((BID * 1.7) % 5).toFixed(1);
  return `<svg class="blob" viewBox="0 0 40 40" aria-hidden="true" style="--d:${delay}s"><defs>
    <radialGradient id="${id}" cx="35%" cy="28%" r="80%"><stop offset="0" stop-color="${mix(c, '#ffffff', .45)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${mix(c, '#000000', .35)}"/></radialGradient>
    <clipPath id="${id}c"><path d="${d}"/></clipPath></defs>
    <path d="${d}" fill="url(#${id})"/>
    <ellipse cx="14" cy="11" rx="7" ry="4" fill="#fff" opacity=".32" clip-path="url(#${id}c)"/>
    <g class="eyes"><ellipse cx="15" cy="20" rx="3.6" ry="4.4" fill="#fff"/><ellipse cx="25" cy="20" rx="3.6" ry="4.4" fill="#fff"/>
    <circle cx="15.9" cy="21" r="2" fill="#0B0D12"/><circle cx="25.9" cy="21" r="2" fill="#0B0D12"/><circle cx="16.6" cy="20.1" r=".7" fill="#fff"/><circle cx="26.6" cy="20.1" r=".7" fill="#fff"/></g></svg>`;
};
const price = p => new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', useGrouping: 'always', minimumFractionDigits: p < 1 ? 4 : 2, maximumFractionDigits: p < 1 ? 5 : p < 100 ? 3 : 2 }).format(p);
const qty = q => new Intl.NumberFormat(loc(), { maximumSignificantDigits: 5 }).format(q);
const signed = v => (v >= 0 ? '+' : '−') + money(Math.abs(v));

// Your own practice wallet (you trade by hand, next to the bots).
function manual() { return S.manual; }
function ensureManual() { if (!S.manual) { S.manual = { cash: 10000, start: 10000, fills: [], created: Date.now() }; store.set('manual', S.manual); } return S.manual; }
function manualBook(m) {
  const pos = {};
  for (const f of m.fills) { const p = pos[f.c] || (pos[f.c] = { q: 0, cost: 0 }); if (f.side === 'buy') { p.q += f.q; p.cost += f.usd; } else { const sh = p.q ? f.q / p.q : 1; p.cost -= p.cost * sh; p.q -= f.q; if (p.q < 1e-12) { p.q = 0; p.cost = 0; } } }
  return pos;
}
const livePx = c => S.tick[c]?.p ?? S.mk?.live?.[c] ?? null;
function manualValue(m) { const pos = manualBook(m); let v = m.cash; for (const c in pos) v += pos[c].q * (livePx(c) || 0); return v; }

function deskState(id, firstCoin, tf = '1M') {
  if (S.desk.id !== id) S.desk = { id, coin: firstCoin, tf, pane: 0, seen: false, auto: true };
  else if (S.desk.auto && S.desk.coin !== firstCoin) S.desk.coin = firstCoin; // follow the bot until you pick a coin yourself
  return S.desk;
}

function liveE() {
  const x = liveExplain(S.lbars);
  return { ...x, day: Math.floor((x.t || Date.now()) / DAY), coins: x.coins.map(c => ({ ...c, ret30: c.r, up200: c.up, up2050: c.r1 == null ? null : c.r1 > 0 })) };
}
function deskScreen(id) {
  const t = T(), dk = t.desk;
  if (!S.mk) return statusBox();
  const isManual = id === 'manual';
  const w = isManual ? null : S.wallets.find(x => x.id === id);
  if (!isManual && !w) { S.view = null; return practice(); }
  const m = isManual ? ensureManual() : null;
  const v = isManual ? null : walletView(w);
  const b = isManual ? botById('momentum') : v.bot;
  const e = b.kind === 'live' ? liveE() : cached(`e|${b.id}|${S.mk.at}`, () => explain(b, S.mk.d));
  const first = v?.holdings?.[0]?.c || e.coins.find(c => c.w)?.c || e.coins[0]?.c || 'BTC';
  const st = deskState(id, first, b.kind === 'live' ? '1D' : '1M');
  const coins = e.coins.length ? e.coins.map(c => c.c) : (b.coins || ['BTC']);
  if (!coins.includes(st.coin) && !S.mk.d.px[st.coin]) st.coin = first;
  const name = isManual ? dk.you : botName(b), icon = isManual ? '🧑' : b.icon;
  const next = v ? `<span class="dm-next mono" title="${t.term.nextIn}"><span class="sr">${t.term.nextIn}</span><span aria-hidden="true">⏱</span> <b data-until="${v.nextAt}">${countdown(v.nextAt)}</b></span>` : '';

  return `<div class="dm">
    <div class="dm-bar"><button class="dm-back" data-act="back" data-k="back" aria-label="${t.back}">‹</button>
      <p class="dm-title"><span aria-hidden="true">${icon}</span> <b>${esc(name)}</b> <span class="dm-live mono"><i class="dot${v?.pending ? ' wait' : ''}" aria-hidden="true"></i>${dk.live}</span></p>${next}</div>
    <div class="frame"><div class="track" data-track>
      <section class="pane" data-pane="0" aria-label="${dk.panes[0]}">${chartPane(st, b, v, m, coins)}</section>
      <section class="pane" data-pane="1" aria-label="${dk.panes[1]}">${analysisPane(st, b, e, v, w, m)}</section>
      <section class="pane" data-pane="2" aria-label="${dk.panes[2]}">${chatPane(b, v, w, m)}</section>
    </div></div>
    <div class="dots" role="tablist" aria-label="${dk.panes.join(', ')}">${dk.panes.map((p, k) =>
      `<button role="tab" data-act="pane" data-v="${k}" data-k="pane-${k}" aria-selected="${st.pane === k}" aria-label="${p}"><i></i><span>${p}</span></button>`).join('')}</div>
  </div>`;
}

function chartPane(st, b, v, m, coins) {
  const dk = T().desk, c = st.coin, tk = S.tick[c], p = livePx(c);
  const botHold = v?.holdings?.find(h => h.c === c);
  const mine = manualBook(m || S.manual || { fills: [] })[c];
  const key = `${c}|${st.tf}`;
  return `<div class="cc-head">${coinAv(c, false, true)}
      <div class="cc-name"><b>${c} <span aria-hidden="true">≡</span></b><span>${COIN[c] || c}</span></div>
      <div class="cc-px"><b class="mono" data-px="${c}">${p ? price(p) : '—'}</b><span data-chg="${c}">${tk ? chg(tk.chg) : ''}</span></div></div>
    <div class="coin-pick" role="group" aria-label="${T().ag.radar}">${coins.map(x => `<button class="cp${x === c ? ' on' : ''}" data-act="coin" data-v="${x}" data-k="coin-${x}" aria-pressed="${x === c}">${x}</button>`).join('')}</div>
    <div class="candles" data-candles>${S.cnd.key === key && S.cnd.rows ? drawCandles(S.cnd.rows, st, v) : `<p class="muted mono cc-load">${S.cnd.err === key ? dk.chartError : dk.loadingChart}</p>`}</div>
    <div class="tf" role="group" aria-label="Timeframe"><span class="livedot mono"><i class="dot" aria-hidden="true"></i>${dk.live}</span>${Object.keys(TF).map(k =>
      `<button data-act="tf" data-v="${k}" data-k="tf-${k}" aria-pressed="${st.tf === k}">${k}</button>`).join('')}</div>
    <div class="ypos">
      <div><p class="lbl mono">◆ ${dk.botPos}</p>${botHold ? `<p class="yp-v"><b>${money(botHold.value)}</b><span class="${botHold.gain >= 0 ? 'up-t' : 'down-t'} mono">${signed(botHold.value - botHold.value / (1 + botHold.gain))}<br>${pctTxt(botHold.gain)}</span></p>` : `<p class="muted small">${fill(dk.noBotPos, { c })}</p>`}</div>
      <div><p class="lbl mono">◇ ${dk.yourPos}</p>${mine && mine.q > 0 && p ? `<p class="yp-v"><b>${money(mine.q * p)}</b><span class="${mine.q * p >= mine.cost ? 'up-t' : 'down-t'} mono">${signed(mine.q * p - mine.cost)}<br>${qty(mine.q)} ${c}</span></p>` : `<p class="muted small">${fill(dk.noYourPos, { c })}</p>`}</div>
    </div>
    <dl class="stats24 mono" data-live-hilo>${hilo(tk)}</dl>
    <p class="warn"><span aria-hidden="true">⚠</span> ${dk.warn}</p>
    <div class="bs"><button class="b-sell" data-act="trade" data-v="sell" data-k="t-sell">${dk.sell}</button><button class="b-buy" data-act="trade" data-v="buy" data-k="t-buy">${dk.buy}</button></div>`;
}
const hilo = tk => { const dk = T().desk; return tk ? `<div><dt>${dk.hi}</dt><dd>${price(tk.hi)}</dd></div><div><dt>${dk.lo}</dt><dd>${price(tk.lo)}</dd></div><div><dt>${dk.vol}</dt><dd>$${new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(tk.vol)}</dd></div>` : ''; };

function drawCandles(rows, st, v, o = {}) {
  const W = 340, H = o.vol ? 230 : 190, P = 6, VH = o.vol ? 34 : 0, lo = Math.min(...rows.map(r => r.l)), hi = Math.max(...rows.map(r => r.h)), span = hi - lo || 1;
  const n = rows.length, bw = W / n, y = p => P + (1 - (p - lo) / span) * (H - 2 * P - VH);
  const vmax = Math.max(...rows.map(r => r.v || 0)) || 1;
  const last = rows[n - 1].c, ms = rows.length > 1 ? rows[1].t - rows[0].t : DAY;
  const marks = [];
  const add = (ts, p, side) => { const k = Math.floor((ts - rows[0].t) / ms); if (k >= 0 && k < n) marks.push({ x: k * bw + bw / 2, y: y(Math.min(hi, Math.max(lo, p))), side }); };
  if (v) for (const x of v.trades) if (x.c === st.coin) add(x.ts ? x.ts - 1 : (x.day + 1) * DAY - 1, x.p, x.side);
  if (S.manual) for (const f of S.manual.fills) if (f.c === st.coin) add(f.ts, f.p, f.side);
  return `<svg viewBox="0 0 ${W} ${H}" class="cndl" role="img" aria-label="${esc(`$${st.coin} ${st.tf}: ${price(rows[0].o)} → ${price(last)}`)}">
    ${rows.map((r, k) => { const x = k * bw, up = r.c >= r.o, top = y(Math.max(r.o, r.c)), h = Math.max(1, Math.abs(y(r.o) - y(r.c)));
      return `<g class="${up ? 'cu' : 'cd'}"><line x1="${(x + bw / 2).toFixed(1)}" x2="${(x + bw / 2).toFixed(1)}" y1="${y(r.h).toFixed(1)}" y2="${y(r.l).toFixed(1)}"/><rect x="${(x + bw * 0.15).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}"/></g>`; }).join('')}
    ${o.vol ? rows.map((r, k) => `<rect class="vb ${r.c >= r.o ? 'cu' : 'cd'}" x="${(k * bw + bw * 0.15).toFixed(1)}" y="${(H - (r.v || 0) / vmax * (VH - 4)).toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${((r.v || 0) / vmax * (VH - 4)).toFixed(1)}"/>`).join('') : ''}
    <line class="lastline" x1="0" x2="${W}" y1="${y(last).toFixed(1)}" y2="${y(last).toFixed(1)}"/>
    ${o.hold ? `<line class="riskline" x1="0" x2="${W}" y1="${y(Math.max(lo, o.hold.entry * (1 + o.stop))).toFixed(1)}" y2="${y(Math.max(lo, o.hold.entry * (1 + o.stop))).toFixed(1)}"/><text class="risklbl" x="4" y="${(y(Math.max(lo, o.hold.entry * (1 + o.stop))) - 4).toFixed(1)}">${T().coin.riskLine} ${pctTxt(o.stop)}</text>` : ''}
    ${marks.map((k, j) => `<g class="mk ${k.side}"><circle cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="6"/><text x="${k.x.toFixed(1)}" y="${(k.y + 3.5).toFixed(1)}" text-anchor="middle">${k.side === 'buy' ? 'B' : 'S'}</text>${o.vol && k.side === 'buy' && j === marks.map(m => m.side).lastIndexOf('buy') ? `<g class="xlbl"><rect x="${Math.min(W - 66, Math.max(0, k.x - 33)).toFixed(1)}" y="${(k.y + 10).toFixed(1)}" width="66" height="14" rx="7"/><text x="${(Math.min(W - 66, Math.max(0, k.x - 33)) + 33).toFixed(1)}" y="${(k.y + 20).toFixed(1)}" text-anchor="middle">${T().coin.execBuy}</text></g>` : ''}</g>`).join('')}
  </svg><span class="lastlbl mono" style="top:${(y(last) / H * 100).toFixed(1)}%">${price(last)}</span>`;
}

function analysisPane(st, b, e, v, w, m) {
 const t = T(), dk0 = t.desk, c = e.coins.find(x => x.c === st.coin);
  const dk = b.kind === 'live' ? { ...dk0, chkBtc: t.live.chk.btc, chk200: t.live.chk.avg, chk2050: t.live.chk.hour, chkMom: t.live.chk.move, chkTop: t.live.chk.top } : dk0;
  const row = (label, val, ok) => `<li><span>${label}</span><b class="mono ${ok == null ? '' : ok ? 'pass' : 'fail'}">${val}</b></li>`;
  let checks = '';
  if (c) {
    const held = v?.holdings?.some(h => h.c === c.c);
    const verdict = held ? 'held' : c.w ? 'pick' : c.trend && (!b.pick || e.btcUp) ? 'watch' : 'skip';
    checks = `<ul class="checks">
      ${b.pick ? row(dk.chkBtc, e.btcUp ? 'PASS' : 'FAIL', e.btcUp) : ''}
      ${c.up200 == null ? '' : row(dk.chk200, c.up200 ? 'PASS' : 'FAIL', c.up200)}
      ${b.pick && c.up2050 != null ? row(dk.chk2050, c.up2050 ? 'PASS' : 'FAIL', c.up2050) : ''}
      ${b.id === 'steps' ? row(dk.chkSignals, `${c.score}/3`, c.score >= 2) : ''}
      ${row(dk.chkMom, c.ret30 == null ? '—' : `${pctTxt(c.ret30)} · #${c.rank}`, c.ret30 == null ? null : c.ret30 > 0)}
      ${b.pick ? row(fill(dk.chkTop, { n: b.pick }), c.w ? 'PASS' : 'FAIL', !!c.w) : ''}
      ${b.stop ? row(dk.chkStop, `${pctTxt(b.stop)} · ${price(c.p * (1 + b.stop))}`, null) : ''}
    </ul><p class="verdict mono v-${verdict}">${dk.verdict[verdict]}</p>`;
  } else checks = `<p class="muted small">—</p>`;
  const key = `${st.coin}|${st.tf}`;
  const mini = S.cnd.key === key && S.cnd.rows ? `<div class="mini" data-mini>${drawCandles(S.cnd.rows.slice(-90), st, v).replace('<svg ', '<svg preserveAspectRatio="none" ')}</div>` : '<div class="mini" data-mini></div>';
  const anaHead = `<div class="ph mono"><b>${st.coin} · ${dk.analysis}</b><span class="red">${fill(dk.scanned, { n: e.coins.length }).toUpperCase()}</span></div>${mini}${m ? `<p class="lbl-xs mono">${fill(dk.view, { b: botName(b) })}</p>` : ''}`;

  let desk;
  if (m) {
    const val = manualValue(m), rows = [...m.fills].reverse();
    desk = `<div class="ph mono"><b>${dk.yourTrades}</b></div><p class="lbl mono">${dk.bank} · ${fill(dk.startedWith, { usd: money(m.start) })}</p>
      <p class="bank mono ${val >= m.start ? 'up-t' : 'down-t'}" data-manual-val>${money(val)}</p>
      ${rows.length ? `<ol class="dtrades mono">${rows.map((f, k) => `<li><span class="dn">#${rows.length - k}</span><span>${f.side === 'buy' ? dk.buy : dk.sell} <b>$${f.c}</b><br><span class="muted">${qty(f.q)} @ ${price(f.p)}</span></span><span class="r">${money(f.usd)}<br><span class="muted">${new Date(f.ts).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span></li>`).join('')}</ol>` : `<p class="muted small">${dk.noDeskTrades}</p>`}`;
  } else {
    const ts = tradeStats(v.trades), d = S.mk.d;
    const hrs = (a, z) => Math.max(0, Math.round((z - a) / 36e5));
    const openRows = ts.open.map(o => { const h = v.holdings.find(x => x.c === o.c), now = h ? h.now : o.entry; return { c: o.c, entry: o.entry, exit: now, pnl: o.q * now - o.cost, days: o.since != null ? d.dates[d.dates.length - 1] - o.since : 0, hours: o.sinceTs ? hrs(o.sinceTs, Date.now()) : null, open: true }; });
    const closed = ts.sells.map(s => ({ c: s.c, entry: s.entry, exit: s.p, pnl: s.pnl, days: s.since != null ? s.day - s.since : 0, hours: s.sinceTs ? hrs(s.sinceTs, s.ts) : null, open: false }));
    const all = [...openRows, ...closed.reverse()];
    const dayN = Math.max(1, Math.floor((Date.now() - (w.startTs ?? w.startDay * DAY)) / DAY) + 1);
    desk = `<div class="ph mono"><b>${dk.deskT}</b><span class="red">${fill(dk.dayN, { n: dayN })}</span></div><p class="lbl mono">${dk.bank} · ${fill(dk.startedWith, { usd: money(w.cash) })}</p>
      <p class="bank mono ${v.value >= w.cash ? 'up-t' : 'down-t'}" data-wv="${w.id}">${money(v.value)}</p>
      <p class="lbl-xs mono">${fill(dk.tradesLine, { n: v.trades.length, g: ts.wins, r: ts.losses, w: ts.worst ? signed(ts.worst.pnl) : '—' })}</p>
      ${all.length ? `<ol class="dtrades mono">${all.map((x, k) => `<li><span class="dn">#${all.length - k}</span>
        <span><b>$${x.c}</b> ${price(x.entry)} → ${price(x.exit)}<br><span class="muted">${x.hours != null ? fill(t.live.inHours, { n: x.hours }) : fill(dk.inDays, { n: x.days })} · <span class="${x.open ? 'st-open' : ''}">${x.open ? dk.open : dk.closed}</span></span></span>
        <span class="r ${x.pnl >= 0 ? 'up-t' : 'down-t'}">${signed(x.pnl)}</span></li>`).join('')}</ol>` : `<p class="muted small">${dk.noDeskTrades}</p>`}`;
  }
  return `<div class="ana">${anaHead}${checks}</div><div class="dsk">${desk}</div>
    ${w ? `<button class="rm" data-act="remove" data-v="${w.id}" data-k="remove">${t.stopBot}</button>` : ''}`;
}

function chatMessages(b, v, w, m) {
  const ch = T().chat, msgs = [], say = (who, text) => msgs.push({ who, text });
  if (m) {
    if (!m.fills.length) say('vela', ch.youEmpty);
    let lastDay = null;
    for (const f of [...m.fills].reverse()) {
      const day = Math.floor(f.ts / DAY);
      if (day !== lastDay) { msgs.push({ sep: day }); lastDay = day; }
      say('fills', fill(f.side === 'buy' ? ch.youBuy : ch.youSell, { q: qty(f.q), c: f.c, p: price(f.p) }));
    }
    return msgs;
  }
  if (v.pending) { say('vela', fill(ch.waitFirst, { usd: money(w.cash), t: when(v.nextAt) })); return msgs; }
  if (v.live) return liveChat(b, v, w);
  const d = S.mk.d, rows = tradeStats(v.trades).rows, checks = v.checks.slice(-8);
  const from = checks.length ? checks[0].day : Infinity;
  const byDay = new Map();
  for (const x of rows) if (x.day >= from) (byDay.get(x.day) || byDay.set(x.day, []).get(x.day)).push(x);
  const ck = new Map(checks.map(c => [c.day, c]));
  const days = [...new Set([...ck.keys(), ...byDay.keys()])].sort((a, z) => a - z);
  const groups = [];
  let prevPicks = null;
  for (const day of days) {
    const g = [{ sep: day }], put = (who, text) => g.push({ who, text });
    const c = ck.get(day), tr = byDay.get(day) || [];
    const quiet = c && !tr.length && prevPicks !== null && prevPicks === c.picks.join();
    if (c) {
      const e = cached(`e|${b.id}|${S.mk.at}|${c.i}`, () => explain(b, d, c.i));
      put('scanner', fill(ch.scan, { n: e.coins.length, a: e.coins.filter(x => x.trend).length }));
      if (!quiet) {
        if (b.pick) put('market', fill(e.btcUp ? ch.btcUp : ch.btcDown, { d: pctTxt(e.btc / e.btcAvg - 1) }));
        const top = e.coins.filter(x => x.w > 0)[0];
        put('analyst', top && top.ret30 != null ? fill(ch.lead, { c: top.c, r: pctTxt(top.ret30) }) : ch.nothing);
      }
      prevPicks = c.picks.join();
    }
    for (const x of tr.filter(x => x.side === 'sell')) {
      if (x.why === 'stop') put('risk', fill(ch.stopHit, { s: pctTxt(b.stop), c: x.c }));
      else put('analyst', fill(ch.why, { c: x.c, why: T().why[x.why] || '' }));
      put('vela', fill(ch.sell, { c: x.c }));
      put('fills', fill(ch.closed, { pnl: signed(x.pnl), c: x.c }));
    }
    for (const x of tr.filter(x => x.side === 'buy')) {
      put('vela', fill(ch.buy, { c: x.c }));
      put('sizer', fill(ch.size, { usd: money(x.usd), c: x.c }));
      put('fills', fill(ch.filled, { p: price(x.p), fee: money(x.usd * FEE) }));
      if (b.stop) put('risk', fill(ch.armed, { s: pctTxt(b.stop), p: price(x.p * (1 + b.stop)) }));
    }
    if (c && !tr.length) put('vela', c.picks.length ? ch.hold : ch.cash);
    groups.push(g);
  }
  return groups.reverse().flat().slice(0, 70); // newest day first
}

function liveChat(b, v, w) {
  const ch = T().chat, lc = T().live.chat, out = [];
  const e = liveE(), g0 = [{ sep: 'now' }], put0 = (who, text, ts) => g0.push({ who, text, ts });
  if (e.coins.length) {
    put0('scanner', fill(lc.scan, { n: e.coins.length, a: e.coins.filter(x => x.trend).length }));
    if (e.btcAvg) put0('market', fill(e.btcUp ? lc.btcUp : lc.btcDown, { d: pctTxt(e.btc / e.btcAvg - 1) }));
    const top = e.coins.filter(x => x.r != null).sort((a, z) => z.r - a.r)[0];
    if (top) put0('analyst', fill(lc.strongest, { c: top.c, r: pctTxt(top.r) }));
    const h = v.holdings[0];
    put0('vela', h ? fill(lc.holding, { c: h.c, g: pctTxt(h.gain) }) : lc.waiting);
  }
  out.push(g0);
  const rows = tradeStats(v.trades).rows.slice(-40);
  let g = null, day = null;
  for (const x of rows) {
    const d = Math.floor(x.ts / DAY);
    if (d !== day) { g = [{ sep: d }]; out.splice(1, 0, g); day = d; }
    const put = (who, text) => g.push({ who, text, ts: x.ts });
    if (x.side === 'buy') {
      put('scanner', fill(lc.strongest, { c: x.c, r: pctTxt(x.move ?? 0) }));
      put('vela', fill(ch.buy, { c: x.c }));
      put('sizer', fill(ch.size, { usd: money(x.usd), c: x.c }));
      put('fills', fill(ch.filled, { p: price(x.p), fee: money(x.usd * FEE) }));
      put('risk', fill(ch.armed, { s: pctTxt(LIVE.stop), p: price(x.p * (1 + LIVE.stop)) }));
    } else {
      put(x.why === 'live_stop' || x.why === 'live_profit' ? 'risk' : 'analyst', fill(ch.why, { c: x.c, why: T().why[x.why] || '' }));
      put('vela', fill(ch.sell, { c: x.c }));
      put('fills', fill(ch.closed, { pnl: signed(x.pnl), c: x.c }));
    }
  }
  // newest first inside each day too, so the latest move is at the top
  return out.flatMap((grp, k) => k === 0 ? grp : [grp[0], ...groupByTrade(grp.slice(1)).reverse().flat()]).slice(0, 80);
}
function groupByTrade(msgs) { const gs = []; for (const m of msgs) { const last = gs[gs.length - 1]; if (last && last[0].ts === m.ts) last.push(m); else gs.push([m]); } return gs; }

function chatPane(b, v, w, m) {
  const t = T(), names = t.chat.names, msgs = chatMessages(b, v, w, m);
  const animate = !S.desk.seen; S.desk.seen = true;
  const nAnim = Math.min(6, msgs.length);
  if (w && !v.pending) msgs.push({ who: 'vela', text: fill(t.chat.intro, { usd: money(w.cash), s: b.stop ? pctTxt(b.stop) : '—', n: b.kind === 'live' ? 98 : b.pick ? Math.round(100 / b.pick) : 100 }) });
  return `<ol class="chat" aria-live="off">${msgs.map((x, k) => x.sep != null
      ? `<li class="sep mono">${x.sep === 'now' ? `<span class="now">${t.live.chat.now}</span>` : dayDate(x.sep, { weekday: 'short', day: 'numeric', month: 'short' })}</li>`
      : `<li class="msg${animate && k <= nAnim ? ' pop' : ''}" style="--i:${k}">${blob(x.who)}<div><b>${names[x.who]}${x.ts ? ` <time class="mono">${new Date(x.ts).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}</time>` : ''}</b><p>${esc(x.text)}</p></div></li>`).join('')}</ol>`;
}

function tradeDialog() {
  const tr = S.trade;
  if (!tr) return '';
  const dk = T().desk, tt = dk.trade, p = livePx(tr.coin), m = ensureManual(), pos = manualBook(m)[tr.coin];
  const base = tr.side === 'buy' ? m.cash : (pos ? pos.q * p : 0), amt = +tr.amt || 0;
  return `<form method="dialog" class="sheet tsheet">
    <div class="ts-top">${coinAv(tr.coin, false, true)}<div><h2 id="trade-title">${tt.title[tr.side]} $${tr.coin}</h2><p class="muted mono" data-ts-px>${p ? price(p) : '—'}</p></div>
      <button class="x" data-act="tclose" data-k="tclose" aria-label="${tt.close}">✕</button></div>
    <p class="ts-amt mono" aria-live="polite">${money(amt)}</p>
    <p class="muted mono ts-q">≈ ${p ? qty(amt / p) : 0} ${tr.coin}</p>
    <div class="pct">${[10, 25, 50, 100].map(k => `<button data-act="tpct" data-v="${k}" data-k="tpct-${k}">${k === 100 ? 'Max' : k + '%'}</button>`).join('')}</div>
    <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'].map(k => `<button data-act="tkey" data-v="${k}" data-k="tkey-${k}" ${k === 'del' ? 'aria-label="⌫"' : ''}>${k === 'del' ? '⌫' : k}</button>`).join('')}</div>
    <div class="ts-foot mono"><span>${tr.side === 'buy' ? fill(tt.avail, { usd: money(base) }) : fill(tt.have, { usd: money(base) })}</span><span>${tt.fee}</span></div>
    ${tr.msg ? `<p class="ts-msg" role="alert">${tr.msg}</p>` : ''}
    <label class="slide ${tr.side}"><input type="range" min="0" max="100" value="0" data-slide aria-label="${tt.slide[tr.side]}"><span>${tt.slide[tr.side]}</span></label>
  </form>`;
}

function doTrade() {
  const tr = S.trade, tt = T().desk.trade, m = ensureManual(), p = livePx(tr.coin), amt = +tr.amt || 0;
  const pos = manualBook(m)[tr.coin], base = tr.side === 'buy' ? m.cash : (pos ? pos.q * p : 0);
  if (!amt || !p) { tr.msg = tt.zero; return false; }
  if (amt > base + 1e-6) { tr.msg = tt.tooMuch; return false; }
  let q;
  if (tr.side === 'buy') { q = amt * (1 - FEE) / p; m.cash -= amt; m.fills.push({ c: tr.coin, side: 'buy', q, p, usd: amt, ts: Date.now() }); }
  else { q = Math.min(pos.q, amt / p); if (pos.q - q < 1e-9 || amt >= base - 1e-6) q = pos.q; const usd = q * p * (1 - FEE); m.cash += usd; m.fills.push({ c: tr.coin, side: 'sell', q, p, usd, ts: Date.now() }); }
  store.set('manual', m);
  announce(fill(tt.done[tr.side], { q: qty(q), c: tr.coin, p: price(p) }));
  S.trade = null; memo.clear();
  return true;
}

// Live chart + price while the desk is open.
async function loadCandles() {
  const st = S.desk; if ((!S.view && !S.coin) || !st.coin) return;
  const key = `${st.coin}|${st.tf}`;
  try {
    const rows = await candles(st.coin, st.tf);
    S.cnd = { key, rows };
  } catch { S.cnd = { key: null, rows: null, err: key }; }
  paintChart();
}
function paintChart() {
  const el = document.querySelector('[data-candles]'), st = S.desk;
  if (!el) return;
  const key = `${st.coin}|${st.tf}`;
  const w = S.wallets.find(x => x.id === (S.coin ? S.coin.wid : S.view)) || (S.coin ? homeWallet() : null);
  const wv = w ? walletView(w) : null;
  const opts = S.coin && wv ? { vol: true, hold: wv.holdings.find(h => h.c === st.coin), stop: wv.bot.stop ?? LIVE.stop, b: wv.bot } : {};
  el.innerHTML = S.cnd.key === key && S.cnd.rows ? drawCandles(S.cnd.rows, st, wv, opts) : `<p class="muted mono cc-load">${S.cnd.err === key ? T().desk.chartError : T().desk.loadingChart}</p>`;
  const mini = document.querySelector('[data-mini]');
  if (mini && S.cnd.key === key && S.cnd.rows) mini.innerHTML = drawCandles(S.cnd.rows.slice(-90), st, wv).replace('<svg ', '<svg preserveAspectRatio="none" ');
}
async function pollTick() {
  const c = S.desk.coin; if ((!S.view && !S.coin) || !c || document.hidden) return;
  try {
    S.tick[c] = await ticker(c);
    const tk = S.tick[c], p = document.querySelector('[data-live-p]'), ch = document.querySelector('[data-live-c]'), hl = document.querySelector('[data-live-hilo]');
    if (p) p.textContent = price(tk.p);
    if (ch) ch.innerHTML = chg(tk.chg);
    if (hl) hl.innerHTML = hilo(tk);
    const g2 = document.querySelector('[data-live-hilo2]'); if (g2) g2.innerHTML = coinGrid(tk, +g2.dataset.n || 0);
    const mv = document.querySelector('[data-manual-val]'); if (mv && S.manual) mv.textContent = money(manualValue(S.manual));
    const lw = S.wallets.find(x => x.id === S.view && x.bot === 'live'), wv = document.querySelector('[data-wallet-val]');
    if (lw && wv) wv.textContent = money(liveView(lw).value);
  } catch { }
}
setInterval(pollTick, 10e3);
setInterval(() => { if (S.view) loadCandles(); }, 60e3);

// ---------- Home (like the 3rd video): big balance, live chart, agents carousel, activity ----------
const HUES = { BTC: 32, ETH: 230, SOL: 280, BNB: 45, XRP: 210, ADA: 220, DOGE: 42, AVAX: 0, LINK: 220, DOT: 330, LTC: 210, NEAR: 160, UNI: 320, TRX: 355, BCH: 120 };
const LOGO = c => `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${c.toLowerCase()}.svg`;
const coinAv = (c, small, big) => `<span class="cav${small ? ' sm' : ''}${big ? ' lg' : ''}" style="--h:${HUES[c] ?? 200}" aria-hidden="true"><b>${c[0]}</b><img src="${LOGO(c)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
const RANGES = { LIVE: 2 * 36e5, '1H': 36e5, '4H': 4 * 36e5, '1D': DAY, '1W': 7 * DAY, ALL: Infinity };

function homeWallet() {
  const ws = S.wallets;
  return ws.find(w => w.id === S.set.home) || ws.find(w => w.bot === 'live') || ws[0] || null;
}
function walletSeries(w, v) {
  const now = Date.now();
  let pts;
  if (w.bot === 'live') pts = w.st.eq.map(([t, x]) => [t, x]);
  else if (v.pending || v.start == null) pts = [[w.created || now - 36e5, w.cash]];
  else pts = v.eq.slice(0, -1).map((x, k) => [(S.mk.d.dates[v.start + k] + 1) * DAY, x]);
  if (!pts.length || pts[0][1] !== w.cash) pts.unshift([(w.startTs ?? (w.startDay != null ? w.startDay * DAY : now - DAY)), w.cash]);
  for (const p of S.livePts[w.id] || []) if (p[0] > pts[pts.length - 1][0]) pts.push(p);
  pts.push([now, v.value]);
  return pts;
}

// Smooth line (monotone cubic) in a 0..100 box; returns path + point mapper.
function smoothChart(pts, range) {
  const t1 = pts[pts.length - 1][0], t0 = range === Infinity ? pts[0][0] : t1 - range;
  let sel = pts.filter(p => p[0] >= t0);
  const before = pts.filter(p => p[0] < t0).pop();
  if (before) sel.unshift([t0, before[1]]);
  if (sel.length < 2) sel = [[t0, sel[0]?.[1] ?? pts[0][1]], ...sel];
  if (sel.length === 1) sel.push([t1, sel[0][1]]);
  const step = Math.max(1, Math.ceil(sel.length / 240)), s2 = sel.filter((_, k) => k % step === 0 || k === sel.length - 1);
  const vs = s2.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || Math.max(1, hi * 0.01);
  const ta = s2[0][0], tb = s2[s2.length - 1][0] || ta + 1;
  const X = t => ((t - ta) / ((tb - ta) || 1)) * 100, Y = x => 8 + (1 - (x - lo) / span) * 80;
  const P = s2.map(p => [X(p[0]), Y(p[1])]);
  let d = `M${P[0][0].toFixed(2)} ${P[0][1].toFixed(2)}`;
  for (let i = 1; i < P.length; i++) {
    const [x0, y0] = P[i - 1], [x1, y1] = P[i], cx = (x1 - x0) / 3;
    d += `C${(x0 + cx).toFixed(2)} ${y0.toFixed(2)} ${(x1 - cx).toFixed(2)} ${y1.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return { d, X, Y, first: s2[0][1], last: s2[s2.length - 1][1], end: P[P.length - 1], ta, tb, lo, hi };
}

const homeTf = w => S.set.homeTf || (w && w.bot === 'live' ? 'LIVE' : 'ALL');
function homeChart(w, v) {
  const tf = homeTf(w), pts = walletSeries(w, v), g = smoothChart(pts, RANGES[tf]);
  const up = g.last >= g.first, ts = tradeStats(v.trades).sells.filter(s => (s.ts ?? (s.day + 1) * DAY) >= g.ta).slice(-3);
  const marks = ts.map(s => {
    const t = s.ts ?? (s.day + 1) * DAY, near = pts.reduce((a, p) => Math.abs(p[0] - t) < Math.abs(a[0] - t) ? p : a, pts[0]);
    const xx = Math.min(97, Math.max(3, g.X(t)));
    return `<span class="cmark ${s.pnl >= 0 ? 'g' : 'r'}${xx > 70 ? ' rt' : xx < 30 ? ' lt' : ''}" style="left:${xx.toFixed(1)}%;top:${g.Y(near[1]).toFixed(1)}%"><i></i><b class="mono">${pctTxt(s.pct)} · ${signed(s.pnl)}</b></span>`;
  }).join('');
  return `<div class="hchart ${up ? 'up' : 'down'}${S.drawChart ? ' draw' : ''}" data-hchart>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="${esc(`${money(g.first)} → ${money(g.last)}`)}"><path d="${g.d}" pathLength="1" vector-effect="non-scaling-stroke"/></svg>
      <span class="cend" style="left:${g.end[0].toFixed(1)}%;top:${g.end[1].toFixed(1)}%"></span>${marks}</div>`;
}

function agentCards(w, v) {
  const t = T(), a = t.home.ag, names = t.chat.names, b = v.bot;
  const e = b.kind === 'live' ? liveE() : cached(`e|${b.id}|${S.mk.at}`, () => explain(b, S.mk.d));
  const byMove = e.coins.filter(c => c.ret30 != null).sort((x, z) => z.ret30 - x.ret30);
  const top = byMove[0], worst = byMove[byMove.length - 1];
  const checks = top ? [b.pick ? e.btcUp : true, top.up200 ?? top.trend, top.up2050 ?? true, (top.ret30 ?? 0) > 0] : [];
  const score = checks.length ? Math.round(checks.filter(Boolean).length / checks.length * 100) : 0;
  const ts = tradeStats(v.trades), lastBuy = [...v.trades].reverse().find(x => x.side === 'buy'), lastSell = ts.last, hold = v.holdings[0];
  const stop = b.stop ?? -0.25, card = (k, who, dot, body) => `<li class="agc"><div class="agc-h">${blob(k)}<div><b>${names[k]}</b><span><i class="${dot}"></i>${who}</span></div></div>${body}</li>`;
  const cards = [
    card('scanner', fill(a.scanner, { n: e.coins.length }), 'g', `<ul class="agc-l mono">${[byMove[0], byMove[1]].filter(Boolean).map(c => `<li><span>${c.c}</span><b class="up-t">${pctTxt(c.ret30)}</b></li>`).join('')}${worst && worst !== top ? `<li><span>${worst.c}</span><b class="down-t">${pctTxt(worst.ret30)}</b></li>` : ''}</ul>`),
    card('analyst', a.analyst, 'y', top ? `<div class="ring" style="--p:${score}"><b class="mono">${score}</b></div><p class="agc-c">${coinAv(top.c, true)} <b>${top.c}</b><br><span>${score >= 75 ? a.passed : a.scoring}</span></p>` : ''),
    card('fills', fill(a.executor, { n: v.trades.length }), 'p', lastBuy ? `<p class="agc-c">${coinAv(lastBuy.c, true)} <b>${lastBuy.c}</b><br><span class="mono">${money(lastBuy.usd)} · ${b.kind === 'live' ? fill(t.home.ofStack, { n: 98 }) : fill(t.home.at, { p: price(lastBuy.p) })}</span></p>
      <p class="agc-bar ${hold ? 'on' : ''}">${hold ? '✓ ' + a.filled : a.waiting}</p>` : `<p class="agc-bar">${a.waiting}</p>`),
    card('risk', hold ? a.risk : a.riskIdle, hold ? 'o' : 'x', `<p class="agc-c">${hold ? fill(a.stopAt, { c: hold.c, p: price(hold.entry * (1 + stop)) }) : lastSell ? fill(a.trailed, { c: lastSell.c, p: signed(lastSell.pnl) }) : a.noExit}</p>
      <p class="chips2 mono"><span class="r">${fill(a.stopChip, { s: pctTxt(stop) })}</span>${b.kind === 'live' ? `<span class="g">${fill(a.trailChip, { s: '+' + Math.round(LIVE.trailAt * 100) + '%' })}</span>` : ''}</p>`),
    card('market', a.market, e.btcUp ? 'g' : 'r', `<p class="agc-big mono ${e.btcUp ? 'up-t' : 'down-t'}">${e.btcAvg ? pctTxt(e.btc / e.btcAvg - 1) : '—'}</p><p class="agc-c">BTC ${e.btc ? price(e.btc) : ''}</p>`),
    card('sizer', fill(a.sizer, { n: b.kind === 'live' ? 98 : b.pick ? Math.round(100 / b.pick) : 100 }), 'b', `<p class="agc-big mono">${money(v.cash)}</p><p class="agc-c">${t.cash}</p>`),
    card('vela', a.boss, 'g', `<p class="agc-c">${hold ? fill(a.bossHold, { c: hold.c }) + ' ' + chg(hold.gain) : a.bossWait}</p>`),
  ];
  return cards;
}

function actRows(trades, opts = {}) {
  const t = T(), h = t.home, names = t.chat.names;
  const rows = [...trades].reverse().slice(0, opts.limit || 200);
  if (!rows.length) return `<p class="muted small hm-empty">${h.noActivity}</p>`;
  return `<ul class="act">${rows.map(x => {
    const stop = x.why === 'stop' || x.why === 'live_stop', who = x.side === 'buy' ? 'fills' : (stop || x.why === 'live_profit') ? 'risk' : 'analyst';
    const verb = x.side === 'buy' ? h.verb.buy : stop ? h.verb.stop : h.verb.sell;
    const when = x.ts ? new Date(x.ts).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }) + (Date.now() - x.ts > DAY ? ' · ' + new Date(x.ts).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) : '') : dayDate(x.day, { day: 'numeric', month: 'short' });
    const why = x.side === 'buy' ? '' : stop ? fill(h.stopShort, { s: pctTxt(x.bot?.stop ?? LIVE.stop) }) + ' · ' : x.why === 'live_profit' ? h.trailShort + ' · ' : h.exitShort + ' · ';
    const right = x.side === 'buy'
      ? `<b class="mono">${money(x.usd)}</b><span class="mono">${x.live ? fill(h.ofStack, { n: 98 }) : fill(h.at, { p: price(x.p) })}</span>`
      : `<b class="mono ${x.pnl >= 0 ? 'up-t' : 'down-t'}">${signed(x.pnl)}</b><span class="mono ${x.pnl >= 0 ? 'up-t' : 'down-t'}">${pctTxt(x.pct)}</span>`;
    return `<li><button class="act-r" data-act="coinpage" data-v="${x.c}|${x.wid || ''}" data-k="act-${x.c}-${x.ts || x.day}-${x.side}">
      <span class="act-av">${coinAv(x.c)}<span class="act-badge">${blob(who)}</span></span>
      <span class="act-m"><b>${verb} ${x.c}</b><span>${opts.botName ? esc(opts.botName(x)) + ' · ' : ''}${names[who]} · ${why}${when}</span></span>
      <span class="act-v">${right}</span></button></li>`;
  }).join('')}</ul>`;
}
// trades with P/L, the wallet id and whether the bot is the live one
function tradesOf(w, v) {
  const rows = tradeStats(v.trades).rows;
  return rows.map(x => ({ ...x, wid: w.id, live: w.bot === 'live', bot: v.bot }));
}

function homeScreen() {
  const t = T(), h = t.home;
  const w = homeWallet();
  if (!w) return `<header class="hm-top"><p class="brand"><span class="logo-e" aria-hidden="true">E</span> EME Bots</p></header>
    <section class="hm-bal"><p class="hm-big up">${money(0)}</p><p class="hm-sub muted">${h.emptyText}</p></section>
    <div class="hm-empty-c"><h1 tabindex="-1">${h.emptyBig}</h1>
    <button class="btn primary wide" data-act="quicklive" data-k="quicklive">${h.startLive}</button>
    <button class="btn ghost wide" data-act="tab" data-v="bots" data-k="see-bots">${h.seeBots}</button></div>`;
  if (!S.mk) return `<header class="hm-top"><p class="brand"><span class="logo-e" aria-hidden="true">E</span> EME Bots</p></header>${statusBox()}`;
  const v = walletView(w), b = v.bot, gain = v.value - w.cash, up = gain >= 0;
  const cards = agentCards(w, v);
  maybeConfetti(w, v);
  return `<header class="hm-top">
      <button class="hm-bot" data-act="pickbot" data-k="pickbot" aria-haspopup="dialog"><span class="logo-e" aria-hidden="true">E</span><b>${esc(botName(b))}</b><span aria-hidden="true">›</span></button>
      <button class="hm-ico" data-act="open" data-v="${w.id}" data-k="hm-desk" aria-label="${h.desk}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16"/></svg></button>
    </header>
    <section class="hm-bal" aria-live="off">
      <h1 class="sr" tabindex="-1">${t.titles.home}</h1>
      <p class="hm-big ${up ? 'up' : 'down'}" data-wv="${w.id}">${money(v.value)}</p>
      <p class="hm-sub"><span class="chg ${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${money(Math.abs(gain))} (${num1(Math.abs(gain / w.cash * 100))}%)</span>
        <span class="xpill mono ${up ? '' : 'down'}">${(v.value / w.cash).toFixed(2)}x</span>${v.live ? '' : ` <span class="muted small">· ${t.term.paper}</span>`}</p>
    </section>
    ${homeChart(w, v)}
    <div class="hm-tf" role="group" aria-label="Range">${Object.keys(RANGES).map(k => `<button data-act="htf" data-v="${k}" data-k="htf-${k}" aria-pressed="${homeTf(w) === k}">${k === 'LIVE' ? '<i class="dot" aria-hidden="true"></i>LIVE' : k}</button>`).join('')}</div>
    <section class="hm-sec"><div class="hm-h"><h2>${h.agents}</h2><span class="muted">${fill(h.running, { n: cards.length })}</span></div>
      <ul class="ag-track" data-agtrack>${cards.join('')}</ul>
      <div class="ag-dots" aria-hidden="true">${cards.map((_, k) => `<i class="${k ? '' : 'on'}"></i>`).join('')}</div></section>
    <section class="hm-sec"><div class="hm-h"><h2>${h.activity}</h2><button class="link" data-act="tab" data-v="activity" data-k="see-all">${h.seeAll}</button></div>
      ${actRows(tradesOf(w, v), { limit: 12 })}</section>`;
}

function activityScreen() {
  if (!S.mk) return statusBox();
  const key = x => x.ts ?? (x.day + 1) * DAY - 1;
  const all = S.wallets.flatMap(w => { const v = walletView(w); return tradesOf(w, v).map(x => ({ ...x, botLabel: botName(v.bot) })); })
    .sort((a, z) => key(a) - key(z));
  return actRows(all, { botName: x => x.botLabel });
}

function botsTab() {
  const t = T(), h = t.home;
  return `${S.wallets.length || S.manual ? `<h2 class="sec">${h.yourBots}</h2>${practice()}` : ''}
    <h2 class="sec">${h.addBots}</h2>${botsScreen()}
    <button class="btn ghost wide" data-act="tab" data-v="test" data-k="go-test">⏱ ${h.timeMachine}</button>`;
}

function pickDialog() {
  if (!S.picking) return '';
  const t = T();
  return `<form method="dialog" class="sheet"><h2 id="pick-title">${t.home.pick}</h2>
    <ul class="list">${S.wallets.map(w => { const v = walletView(w); return `<li><button class="card wallet" data-act="sethome" data-v="${w.id}" data-k="sh-${w.id}">${avatar(v.bot)}
      <span class="wl-main"><span class="wl-name">${esc(botName(v.bot))}</span><span class="muted">${money(w.cash)} · ${w.bot === 'live' ? '' : ''}${dayDate(Math.floor((w.startTs ?? w.startDay * DAY) / DAY), { day: 'numeric', month: 'short' })}</span></span>
      <span class="wl-val"><span class="wl-money" data-wv="${w.id}">${money(v.value)}</span>${chg(v.value / w.cash - 1)}</span></button></li>`; }).join('')}</ul>
    <div class="actions"><button class="btn primary" data-act="tab" data-v="bots" data-k="pick-add">+ ${t.addBot}</button><button class="btn ghost" data-act="close" data-k="pick-close">${t.cancel}</button></div></form>`;
}

// Confetti when a bot makes a new high in profit (once per new high, not more than every few minutes).
function maybeConfetti(w, v) {
  const hi = w.hi ?? w.cash;
  if (v.value > w.cash && v.value > hi * 1.002) {
    w.hi = v.value; saveWallets();
    if (Date.now() - (S.confettiAt || 0) > 5 * 60e3 && hi > w.cash * 0.999 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      S.confettiAt = Date.now();
      setTimeout(confetti, 300);
    }
  }
}
function confetti() {
  const box = document.createElement('div'); box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
  const cols = ['#22D47E', '#FFC24B', '#FF5FA8', '#4FD8FF', '#9B7CFF', '#FFFFFF'];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('i');
    p.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * .6}s;animation-duration:${1.8 + Math.random() * 1.4}s;--r:${Math.random() * 720 - 360}deg;--x:${Math.random() * 80 - 40}px`;
    box.append(p);
  }
  document.body.append(box); setTimeout(() => box.remove(), 4000);
}

// ---------- coin page (like the video): price, candles + volume, position, risk ----------
function coinScreen() {
  const t = T(), cc = t.coin, c = S.coin.c, isPaper = S.coin.wid === 'manual';
  const w = isPaper ? null : S.wallets.find(x => x.id === S.coin.wid) || homeWallet();
  const v = w && S.mk ? walletView(w) : null, b = v?.bot;
  const mine = isPaper && S.manual ? manualBook(S.manual)[c] : null;
  const st = deskState('coin:' + c, c, w?.bot === 'live' ? '1D' : '1M');
  st.coin = c; st.auto = false;
  const tk = S.tick[c], p = livePx(c), hold = v?.holdings?.find(x => x.c === c);
  const key = `${c}|${st.tf}`, n = v ? v.trades.filter(x => x.c === c).length : 0;
  const big = hold ? hold.gain : tk?.chg;
  const stop = b?.stop ?? LIVE.stop;
  const paperCard = isPaper ? `<section class="cp-card"><span class="cp-ic">${blob('fills')}</span><div><b>${t.desk.yourPos}</b><span>${mine && mine.q > 0 ? `${qty(mine.q)} ${c} · ${price(mine.cost / mine.q)}` : fill(t.desk.noYourPos, { c })}</span></div>
      ${mine && mine.q > 0 && p ? `<div class="r" data-pos="${c}"><b class="mono" data-pv>${money(mine.q * p)}</b><span data-pl class="mono ${mine.q * p >= mine.cost ? 'up-t' : 'down-t'}">${signed(mine.q * p - mine.cost)}</span></div>` : ''}</section>
      <p class="muted small cp-cash">${fill(t.paper.cashLine, { usd: money(S.manual ? S.manual.cash : 0) })}</p>` : '';
  return `<div class="cp-top"><button class="cp-back" data-act="coinback" data-k="coinback"><span aria-hidden="true">‹</span> ${isPaper ? t.tabs.trade : cc.back}</button><span aria-hidden="true" class="star">☆</span></div>
    <div class="cp-id">${coinAv(c)}<div><h1 tabindex="-1">${COIN[c] || c}</h1><p class="muted">${c} · ${fill(cc.exchange, { c })}</p></div></div>
    <p class="cp-price" data-px="${c}">${p ? price(p) : '—'}</p>
    <p class="cp-chg"><span ${hold ? '' : `data-chg="${c}"`}>${big == null ? '' : chg(big)}</span> <span class="muted">${hold ? cc.sinceEntry : cc.today}</span></p>
    <div class="candles cp-c" data-candles>${S.cnd.key === key && S.cnd.rows ? drawCandles(S.cnd.rows, st, v, { vol: true, hold, stop, b }) : `<p class="muted mono cc-load">${S.cnd.err === key ? t.desk.chartError : t.desk.loadingChart}</p>`}</div>
    <div class="hm-tf" role="group" aria-label="Timeframe">${Object.keys(TF).map(k => `<button data-act="tf" data-v="${k}" data-k="tf-${k}" aria-pressed="${st.tf === k}">${k}</button>`).join('')}</div>
    <dl class="cp-grid mono" data-live-hilo2 data-n="${n}">${coinGrid(tk, n)}</dl>
    ${paperCard}${isPaper ? '' : `<section class="cp-card"><span class="cp-ic">${blob('vela')}</span><div><b>${cc.position}</b><span>${hold ? `${qty(hold.value / hold.now)} ${c} · ${t.desk.trade ? '' : ''}${price(hold.entry)}` : fill(cc.noPos, { c })}</span></div>
      ${hold ? `<div class="r"><b class="mono">${money(hold.value)}</b><span class="mono ${hold.gain >= 0 ? 'up-t' : 'down-t'}">${signed(hold.value - hold.value / (1 + hold.gain))}</span></div>` : ''}</section>`}
    ${b ? `<section class="cp-card"><span class="cp-ic">${blob('risk')}</span><div><b>${b.kind === 'live' ? cc.riskTrail : cc.riskStop}</b><span>${b.kind === 'live' ? fill(cc.riskTrailTxt, { t: '2,5%'.replace(',', loc() === 'es-ES' ? ',' : '.'), a: '+5%' }) : fill(cc.riskStopTxt, { p: hold ? price(hold.entry * (1 + stop)) : '—', s: pctTxt(stop) })}</span></div>
      ${hold ? `<div class="r mono"><span class="down-t">${price(hold.entry * (1 + stop))}</span></div>` : ''}</section>` : ''}
    <div class="bs cp-bs"><button class="b-sell" data-act="trade" data-v="sell" data-k="t-sell">${t.desk.sell}</button><button class="b-buy" data-act="trade" data-v="buy" data-k="t-buy">${t.desk.buy}</button></div>
    ${isPaper ? '' : `<p class="muted small cp-cash">${t.paper.botNote}</p>`}`;
}

// ---------- paper trading: buy and sell any coin yourself at the live price ----------
function tradeScreen() {
  const t = T(), pt = t.paper, m = ensureManual(), book = manualBook(m), val = manualValue(m), gain = val - m.start;
  const pos = Object.entries(book).filter(([, x]) => x.q > 0);
  const coins = UNIVERSE;
  return `<header class="hm-top"><p class="brand"><span class="logo-e" aria-hidden="true">E</span> ${pt.title}</p>
      <button class="hm-ico txt" data-act="paperreset" data-k="paperreset">${pt.reset}</button></header>
    <section class="hm-bal"><h1 class="sr" tabindex="-1">${pt.title}</h1>
      <p class="hm-big ${gain >= 0 ? 'up' : 'down'}" data-wv="manual">${money(val)}</p>
      <p class="hm-sub"><span class="chg ${gain >= 0 ? 'up' : 'down'}"><span aria-hidden="true">${gain >= 0 ? '▲' : '▼'}</span> ${money(Math.abs(gain))} (${num1(Math.abs(gain / m.start * 100))}%)</span>
        <span class="muted small">· ${fill(pt.cashLine, { usd: money(m.cash) })}</span></p></section>
    <section class="hm-sec"><div class="hm-h"><h2>${pt.positions}</h2></div>
      ${pos.length ? `<ul class="act">${pos.map(([c, x]) => { const p = livePx(c) || 0, v2 = x.q * p, pl = v2 - x.cost; return `<li><button class="act-r" data-act="coinpage" data-v="${c}|manual" data-k="pos-${c}">
        <span class="act-av">${coinAv(c)}</span><span class="act-m"><b>${COIN[c] || c}</b><span class="mono">${qty(x.q)} ${c} · ${price(x.cost / x.q)}</span></span>
        <span class="act-v" data-pos="${c}"><b class="mono" data-pv>${money(v2)}</b><span data-pl class="mono ${pl >= 0 ? 'up-t' : 'down-t'}">${signed(pl)} · ${pctTxt(pl / x.cost)}</span></span></button></li>`; }).join('')}</ul>`
        : `<p class="muted small hm-empty">${pt.noPos}</p>`}</section>
    <section class="hm-sec"><div class="hm-h"><h2>${pt.markets}</h2><span class="livetag mono"><i class="dot" aria-hidden="true"></i>LIVE</span></div>
      <ul class="act mkts">${coins.map(c => { const tk = S.tick[c], p = livePx(c); return `<li><button class="act-r" data-act="coinpage" data-v="${c}|manual" data-k="mk-${c}">
        <span class="act-av">${coinAv(c)}</span><span class="act-m"><b>${COIN[c] || c}</b><span class="mono">${c}</span></span>
        <span class="spark" data-spark="${c}">${sparkPath(c)}</span>
        <span class="act-v"><b class="mono" data-px="${c}">${p ? price(p) : '—'}</b><span data-chg="${c}">${tk ? chg(tk.chg) : ''}</span></span></button></li>`; }).join('')}</ul></section>
    <p class="muted small">${pt.note}</p>`;
}
const coinGrid = (tk, n) => { const cc = T().coin; return tk ? `<div><dt>${cc.vol}</dt><dd>$${new Intl.NumberFormat(loc(), { notation: 'compact', maximumFractionDigits: 1 }).format(tk.vol)}</dd></div><div><dt>${cc.hi}</dt><dd>${price(tk.hi)}</dd></div><div><dt>${cc.lo}</dt><dd>${price(tk.lo)}</dd></div><div><dt>${cc.botTrades}</dt><dd>${n}</dd></div>` : ''; };

async function pollHome() {
  if (document.hidden || S.view || S.coin || S.tab !== 'home') return;
  const w = homeWallet(); if (!w || !S.mk) return;
  const v = walletView(w), c = v.holdings[0]?.c;
  if (c) { try { S.tick[c] = await ticker(c); } catch { } }
  const v2 = walletView(w);
  (S.livePts[w.id] ||= []).push([Date.now(), v2.value]);
  if (S.livePts[w.id].length > 800) S.livePts[w.id].shift();
  const big = document.querySelector('.hm-big'), ch = document.querySelector('[data-hchart]');
  if (big) big.textContent = money(v2.value);
  if (ch) ch.outerHTML = homeChart(w, v2);
}


function botsScreen() {
  const t = T();
  const L = t.live, lb = LIVE_BOT;
  const liveCard = `<li class="card bot live-card" style="--h:${lb.hue}">
      <div class="row">${avatar(lb, true)}<div><h2>${L.name}</h2><span class="badge">${L.tag}</span></div></div>
      <p>${L.line}</p>${riskMeter(lb)}
      <p class="muted">${L.checks} · ${T().gloss[1][0]} ${pctTxt(LIVE.stop)}</p>
      <dl class="gb"><div><dt>👍 ${t.goodWhen}</dt><dd>${L.good}</dd></div><div><dt>👎 ${t.badWhen}</dt><dd>${L.bad}</dd></div></dl>
      <p class="small live-past">🧪 ${L.past}</p>
      <div class="actions"><button class="btn primary" data-act="setup" data-v="live" data-k="setup-live">${t.practiceBtn}</button></div></li>`;
  return `<p class="lead">${t.riskNote}</p><ul class="list">${liveCard}${BOTS.map(b => {
    const s = t.bots[b.id];
    return `<li class="card bot" style="--h:${b.hue}">
      <div class="row">${avatar(b, true)}<div><h2>${s.name}</h2>${b.flagship ? `<span class="badge">${t.flagship}</span>` : ''}</div></div>
      <p>${s.line}</p>
      ${riskMeter(b)}
      <p class="muted">${t.checks[b.every]}${b.stop ? ` · ${T().gloss[1][0]} ${pctTxt(b.stop)}` : ''}</p>
      <dl class="gb"><div><dt>👍 ${t.goodWhen}</dt><dd>${s.good}</dd></div><div><dt>👎 ${t.badWhen}</dt><dd>${s.bad}</dd></div></dl>
      <div class="actions">
        <button class="btn primary" data-act="setup" data-v="${b.id}" data-k="setup-${b.id}">${t.practiceBtn}</button>
        <button class="btn ghost" data-act="testbot" data-v="${b.id}" data-k="testbot-${b.id}">${t.testBtn}</button>
      </div></li>`;
  }).join('')}</ul>`;
}

function backtest(botId, period) {
  return cached(`t|${botId}|${period}|${S.mk.at}`, () => {
    const d = S.mk.d, last = d.dates.length - 1, start = Math.max(200, period ? last - period : 0);
    const r = simulate(botById(botId), d, { start, cash: 1000 });
    return { r, s: stats(r.eq), hold: holdBTC(d, { start, cash: 1000 }), years: yearly(d.dates, r.eq, start), start };
  });
}

function testScreen() {
  const t = T(), box = statusBox();
  const head = `<p class="lead">${t.testIntro}</p>
    ${chips('tbot', BOTS.map(b => [b.id, `<span aria-hidden="true">${b.icon}</span> ${t.bots[b.id].name}`]), S.test.bot, t.tabs.bots)}
    <p class="label">${t.period}</p>
    ${chips('tper', [365, 730, 1095, 1825, 0].map(p => [p, t.periods[p]]), S.test.period, t.period)}`;
  if (!S.mk) return head + box;
  const { r, s, hold, years, start } = backtest(S.test.bot, S.test.period), b = botById(S.test.bot);
  const hs = stats(hold);
  const others = BOTS.map(x => [x, backtest(x.id, S.test.period).s]).sort((a, c) => c[1].end - a[1].end);
  return `${head}${box}
    <section class="card hero" aria-live="polite">
      <p class="muted">${dayDate(S.mk.d.dates[start])} → ${t.wouldBe}</p>
      <p class="big">${money(s.end)}</p>
      <p>${chg(s.ret)} · <span class="muted">${t.vsHold}:</span> <b>${money(hs.end)}</b> ${chg(hs.ret)}</p>
      ${chart([{ v: r.eq, cls: 'main' }, { v: hold, cls: 'ref' }], `${botName(b)} ${money(s.end)}, Bitcoin ${money(hs.end)}`, 170)}
      <p class="legend"><span class="key main"></span>${botName(b)} <span class="key ref"></span>Bitcoin</p>
    </section>
    <section class="stats">
      <div class="card stat"><span class="muted">${t.worstDrop}</span><b class="down-t">${pctTxt(s.worst)}</b><small class="muted">${t.worstDropHint}</small></div>
      <div class="card stat"><span class="muted">${t.perYear}</span><b>${s.perYear == null ? '—' : pctTxt(s.perYear)}</b><small class="muted">Bitcoin: ${hs.perYear == null ? '—' : pctTxt(hs.perYear)}</small></div>
      <div class="card stat"><span class="muted">${t.trades}</span><b>${r.trades.length}</b><small class="muted">${t.checks[b.every]}</small></div>
    </section>
    <section class="card"><h3>${t.yearByYear}</h3><ul class="rows years">${years.map((y, _, all) => `<li><span>${y.year}${y.partial ? ` <span class="muted">(${t.partial})</span>` : ''}</span>
      <span class="bar-wrap" aria-hidden="true"><span class="bar ${y.ret >= 0 ? 'up' : 'down'}" style="--w:${Math.max(2, Math.abs(y.ret) / Math.max(...all.map(a => Math.abs(a.ret))) * 100)}%"></span></span><span class="r">${chg(y.ret)}</span></li>`).join('')}</ul></section>
    <section class="card"><h3>${t.compareAll}</h3><ul class="rows">${others.map(([x, st]) => `<li>
      <button class="linkrow" data-act="tbot" data-v="${x.id}" data-k="cmp-${x.id}" aria-current="${x.id === S.test.bot}">${avatar(x)} <b>${botName(x)}</b></button>
      <span class="r">${money(st.end)}<br><span class="muted">${t.worstDrop} ${pctTxt(st.worst)}</span></span></li>`).join('')}
      <li><span class="linkrow"><span class="av" aria-hidden="true" style="--h:40">₿</span> <b>${t.vsHold}</b></span><span class="r">${money(hs.end)}<br><span class="muted">${t.worstDrop} ${pctTxt(hs.worst)}</span></span></li></ul></section>
    <p class="muted small">${t.pastNote}</p>`;
}

function settingsScreen() {
  const t = T();
  return `<section class="card"><h3 id="l-lang">${t.language}</h3>${chips('lang', [['es', 'Español'], ['en', 'English']], S.set.lang, t.language)}
      <h3>${t.theme}</h3>${chips('theme', ['terminal', 'auto', 'light', 'dark'].map(k => [k, t.themes[k]]), S.set.theme, t.theme)}
      <h3>${t.textSize}</h3>${chips('size', [1, 1.15, 1.3].map(k => [k, t.sizes[k]]), S.set.size, t.textSize)}</section>
    <section class="card real"><h3>🔒 ${t.realTitle} <span class="badge">${t.soon}</span></h3><p>${t.realText}</p></section>
    <section class="card"><h3>${t.glossary}</h3>${t.gloss.map(([k, v]) => `<details><summary>${k}</summary><p>${v}</p></details>`).join('')}</section>
    <section class="card"><h3>${t.about}</h3><p>${t.aboutText}</p>
      <div class="actions"><button class="btn ghost" data-act="refresh" data-v="1" data-k="refresh">${t.refresh}</button>
      <button class="btn danger" data-act="reset" data-k="reset">${t.reset}</button></div>
      ${S.mk ? `<p class="muted small">${t.updated}: ${new Date(S.mk.at).toLocaleString(loc())}</p>` : ''}</section>`;
}

function onboarding() {
  const t = T();
  return `<div class="onb">
    ${chips('lang', [['es', 'Español'], ['en', 'English']], S.set.lang, t.language)}
    <div class="logo" aria-hidden="true"><span class="logo-e big">E</span></div>
    <h1 tabindex="-1">${t.onbTitle}</h1><p class="lead">${t.tagline}</p>
    <ul class="onb-list">${t.onb.map(([i, h, p]) => `<li><span class="onb-i" aria-hidden="true">${i}</span><div><h2>${h}</h2><p>${p}</p></div></li>`).join('')}</ul>
    <button class="btn primary wide" data-act="onboarded" data-k="onb">${t.onbBtn}</button></div>`;
}

function setupDialog() {
  const t = T(), b = getBot(S.setup.bot);
  if (!b) return '';
  const amt = S.setup.amt, st = S.setup.start;
  if (b.kind === 'live') {
    return `<form method="dialog" class="sheet">
    <div class="row">${avatar(b, true)}<div><p class="muted">${t.setupTitle}</p><h2 id="setup-title">${botName(b)}</h2></div></div>
    <p class="label">${t.amount}</p>${chips('amt', [100, 500, 1000, 10000].map(v => [v, money(v)]), amt, t.amount)}
    <p class="muted">${t.live.nowHint}</p>
    <div class="actions"><button class="btn primary" value="ok" data-act="create" data-k="create">${t.startBtn}</button>
    <button class="btn ghost" value="cancel" data-act="close" data-k="cancel">${t.cancel}</button></div></form>`;
  }
  return `<form method="dialog" class="sheet">
    <div class="row">${avatar(b, true)}<div><p class="muted">${t.setupTitle}</p><h2 id="setup-title">${botName(b)}</h2></div></div>
    <p class="label">${t.amount}</p>${chips('amt', [100, 500, 1000, 10000].map(v => [v, money(v)]), amt, t.amount)}
    <p class="muted">${fill(t.tonightHint, { t: nextCloseText() })} ${t.home.pastTip}</p>
    <div class="actions"><button class="btn primary" value="ok" data-act="create" data-k="create">${t.startBtn}</button>
    <button class="btn ghost" value="cancel" data-act="close" data-k="cancel">${t.cancel}</button></div></form>`;
}
function nextCloseText() {
  const now = Date.now();
  return when((Math.floor(now / DAY) + 1) * DAY);
}

function confirmDialog() {
  const t = T(), c = S.confirm;
  if (!c) return '';
  return `<form method="dialog" class="sheet"><h2 id="confirm-title">${c.text}</h2>
    <div class="actions"><button class="btn danger" data-act="confirm-yes" data-k="cy">${c.yes || t.yes}</button>
    <button class="btn ghost" data-act="close" data-k="cn">${t.no}</button></div></form>`;
}

// ---------- render ----------
function render(focusTop) {
  S.drawChart = !!focusTop;
  const t = T(), html = document.documentElement;
  html.lang = S.set.lang;
  html.dataset.theme = S.set.theme;
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.content = S.set.theme === 'terminal' ? '#050B08' : m.media.includes('dark') ? '#0E1013' : '#F6F4EF');
  html.style.fontSize = (S.set.size * 100) + '%';
  const k = document.activeElement?.dataset?.k;
  const keepScroll = S.view && S.view === S.lastView ? [...document.querySelectorAll('[data-track] > .pane')].map(p => p.scrollTop) : null;
  S.lastView = S.view;
  document.body.classList.toggle('deskmode', !!S.view);

  if (!S.set.onboarded) {
    $('#app').innerHTML = onboarding();
    $('#tabs').hidden = true;
  } else {
    $('#tabs').hidden = !!S.view;
    const noHead = S.view || S.coin || S.tab === 'home' || S.tab === 'trade';
    const title = noHead ? '' : `<header class="top"><p class="brand"><span class="logo-e" aria-hidden="true">E</span> EME Bots</p><h1 tabindex="-1">${t.titles[S.tab]}</h1></header>`;
    const body = S.coin ? coinScreen() : S.view ? deskScreen(S.view) : { home: homeScreen, trade: tradeScreen, practice, bots: botsTab, activity: activityScreen, test: testScreen, settings: settingsScreen }[S.tab]();
    $('#app').innerHTML = title + `<div class="content">${body}</div>`;
    $('#app').classList.toggle('wide', !!S.view);
    const agt = document.querySelector('[data-agtrack]');
    if (agt) agt.addEventListener('scroll', () => {
      const k = Math.round(agt.scrollLeft / (agt.scrollWidth - agt.clientWidth || 1) * (agt.children.length - 1));
      document.querySelectorAll('.ag-dots i').forEach((d, j) => d.classList.toggle('on', j === k));
    }, { passive: true });
    const track = document.querySelector('[data-track]');
    if (track) {
      if (keepScroll) track.querySelectorAll(':scope > .pane').forEach((p, i) => (p.scrollTop = keepScroll[i] || 0));
      const pane = track.children[S.desk.pane || 0];
      if (pane && track.scrollWidth > track.clientWidth) track.scrollLeft = pane.offsetLeft - (track.clientWidth - pane.clientWidth) / 2;
      track.addEventListener('scroll', () => {
        const kids = [...track.children], mid = track.scrollLeft + track.clientWidth / 2;
        const i = kids.reduce((best, el, j) => Math.abs(el.offsetLeft + el.clientWidth / 2 - mid) < Math.abs(kids[best].offsetLeft + kids[best].clientWidth / 2 - mid) ? j : best, 0);
        if (i !== S.desk.pane) { S.desk.pane = i; document.querySelectorAll('.dots [role=tab]').forEach((b, j) => b.setAttribute('aria-selected', j === i)); }
      }, { passive: true });
    }
    const cur = ['test', 'practice'].includes(S.tab) ? 'bots' : S.tab;
    $('#tabs').innerHTML = ['home', 'trade', 'bots', 'activity', 'settings'].map(id =>
      `<button data-act="tab" data-v="${id}" data-k="tab-${id}" ${cur === id ? 'aria-current="page"' : ''}>${ICON[id]}<span>${t.tabs[id]}</span></button>`).join('');
    $('#app').classList.toggle('home', !S.view && !S.coin && (S.tab === 'home' || S.tab === 'trade'));
  }
  const setup = $('#setup'), conf = $('#confirm'), trd = $('#trade'), pick = $('#pick');
  setup.innerHTML = setupDialog(); conf.innerHTML = confirmDialog(); trd.innerHTML = tradeDialog(); pick.innerHTML = pickDialog();
  if (S.picking && !pick.open) pick.showModal();
  if (!S.picking && pick.open) pick.close();
  if (S.trade && !trd.open) trd.showModal();
  if (!S.trade && trd.open) trd.close();
  if ((S.view || S.coin) && S.mk && S.desk.coin) {
    const key = `${S.desk.coin}|${S.desk.tf}`;
    if (S.cndReq !== key) { S.cndReq = key; loadCandles(); pollTick(); }
  } else S.cndReq = null;
  if (S.setup.bot && !setup.open) setup.showModal();
  if (!S.setup.bot && setup.open) setup.close();
  if (S.confirm && !conf.open) conf.showModal();
  if (!S.confirm && conf.open) conf.close();

  S.drawChart = false;
  if (focusTop && !matchMedia('(prefers-reduced-motion: reduce)').matches) { const a = $('#app'); a.classList.remove('enter'); void a.offsetWidth; a.classList.add('enter'); }
  const again = k && document.querySelector(`[data-k="${k}"]`);
  if (focusTop) (document.querySelector('#app h1, #app h2, #app .back'))?.focus?.();
  else if (again) again.focus();
}

const ICON = {
  home: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/></svg>',
  trade: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/></svg>',
  activity: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
  practice: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/></svg>',
  bots: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>',
  test: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  settings: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};

// ---------- actions ----------
const ACT = {
  htf(v) { S.set.homeTf = v; saveSet(); render(); },
  pickbot() { S.picking = true; render(); },
  sethome(v) { S.set.home = v; S.set.homeTf = null; saveSet(); S.picking = false; render(true); },
  quicklive() {
    const w = { id: Math.random().toString(36).slice(2, 9), bot: 'live', cash: 1000, startTs: Date.now(), created: Date.now() };
    w.st = newLiveState(w.cash, w.startTs); S.wallets.push(w); saveWallets(); S.set.home = w.id; S.set.homeTf = null; saveSet(); S.liveAt = 0; render(true); runLive(true);
  },
  coinpage(v) { const [c, wid] = v.split('|'); S.coin = { c, wid }; render(true); scrollTo(0, 0); },
  coinback() { if (S.coin?.wid === 'manual') S.tab = 'trade'; S.coin = null; render(true); },
  paperreset() { S.confirm = { text: T().paper.resetConfirm, yes: T().paper.reset, run: () => { S.manual = { cash: 10000, start: 10000, fills: [], created: Date.now() }; store.set('manual', S.manual); } }; render(); },
  tab(v) { S.tab = v; S.view = null; S.coin = null; S.picking = false; render(true); scrollTo(0, 0); },
  open(v) { S.view = v; render(true); scrollTo(0, 0); },
  back() { S.view = null; render(true); },
  setup(v) { S.setup.bot = v; render(); },
  close() { S.setup.bot = null; S.confirm = null; S.picking = false; render(); },
  amt(v) { S.setup.amt = +v; render(); },
  start(v) { S.setup.start = +v; render(); },
  create() {
    const today = Math.floor(Date.now() / DAY); // the day whose close is next
    const isLive = S.setup.bot === 'live';  // every bot starts now, on live prices
    const w = isLive
      ? { id: Math.random().toString(36).slice(2, 9), bot: 'live', cash: S.setup.amt, startTs: Date.now(), created: Date.now() }
      : { id: Math.random().toString(36).slice(2, 9), bot: S.setup.bot, cash: S.setup.amt, startDay: today, created: Date.now() };
    if (isLive) w.st = newLiveState(w.cash, w.startTs);
    S.wallets.push(w); saveWallets();
    S.setup.bot = null; S.tab = 'home'; S.view = null; S.coin = null; S.set.home = w.id; S.set.homeTf = null; saveSet(); render(true); scrollTo(0, 0);
    if (isLive) { S.liveAt = 0; runLive(true); }
  },
  pane(v) {
    S.desk.pane = +v;
    const track = document.querySelector('[data-track]'), pane = track?.children[+v];
    if (pane) track.scrollTo({ left: pane.offsetLeft - (track.clientWidth - pane.clientWidth) / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    document.querySelectorAll('.dots [role=tab]').forEach((b, j) => b.setAttribute('aria-selected', j === +v));
  },
  coin(v) { S.desk.coin = v; S.desk.auto = false; render(); },
  tf(v) { S.desk.tf = v; render(); },
  trade(v) { ensureManual(); S.trade = { side: v, coin: S.desk.coin, amt: '0' }; render(); },
  tclose() { S.trade = null; render(); },
  tpct(v) {
    const tr = S.trade, m = ensureManual(), p = livePx(tr.coin), pos = manualBook(m)[tr.coin];
    const base = tr.side === 'buy' ? m.cash : (pos && p ? pos.q * p : 0);
    tr.amt = String(Math.floor(base * +v / 100 * 100) / 100); tr.msg = ''; render();
  },
  tkey(k) {
    const tr = S.trade; let a = tr.amt === '0' ? '' : tr.amt;
    if (k === 'del') a = a.slice(0, -1);
    else if (k === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
    else if (!/\.\d\d$/.test(a) && a.length < 9) a += k;
    tr.amt = a || '0'; tr.msg = ''; render();
  },
  manual() { ensureManual(); S.view = 'manual'; render(true); scrollTo(0, 0); },
  testbot(v) { S.test.bot = v; S.tab = 'test'; S.view = null; render(true); scrollTo(0, 0); },
  tbot(v) { S.test.bot = v; render(); },
  tper(v) { S.test.period = +v; render(); },
  lang(v) { S.set.lang = v; saveSet(); render(); },
  theme(v) { S.set.theme = v; saveSet(); render(); },
  size(v) { S.set.size = +v; saveSet(); render(); },
  onboarded() { S.set.onboarded = true; saveSet(); render(true); },
  refresh(v) { refresh(!!v); },
  remove(v) { S.confirm = { text: T().stopConfirm, run: () => { S.wallets = S.wallets.filter(w => w.id !== v); saveWallets(); S.view = null; } }; render(); },
  reset() { S.confirm = { text: T().resetConfirm, yes: T().reset, run: () => { S.wallets = []; saveWallets(); S.manual = null; store.set('manual', null); } }; render(); },
  'confirm-yes'() { const c = S.confirm; S.confirm = null; c?.run(); render(true); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  ACT[el.dataset.act]?.(el.dataset.v);
});
for (const id of ['#setup', '#confirm', '#pick']) $(id).addEventListener('cancel', e => { e.preventDefault(); ACT.close(); });
$('#trade').addEventListener('cancel', e => { e.preventDefault(); ACT.tclose(); });
document.addEventListener('input', e => {
  if (!e.target.matches('[data-slide]') || +e.target.value < 96) return;
  e.target.value = 0;
  doTrade(); render();
});
document.addEventListener('change', e => { if (e.target.matches('[data-slide]')) e.target.value = 0; });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.mk && Date.now() - S.mk.at > 5 * 60e3) refresh();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());

render(true);
refresh().then(startStream);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
