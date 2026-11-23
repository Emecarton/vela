// app.js — the screens. No frameworks: plain HTML strings, one render() for everything.
import { BOTS, botById, simulate, holdBTC, stats, yearly, runWallet, explain, tradeStats, DAY } from './engine.js';
import { loadMarket, candles, ticker, TF, klinesRange } from './data.js';
import { LIVE, newLiveState, liveStep, liveExplain } from './live.js';
import { STR } from './i18n.js';

const COIN = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', BNB: 'BNB', XRP: 'XRP', ADA: 'Cardano', DOGE: 'Dogecoin', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', NEAR: 'NEAR', UNI: 'Uniswap', TRX: 'TRON', BCH: 'Bitcoin Cash' };
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, def) { try { return JSON.parse(localStorage.getItem('vela:' + k)) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('vela:' + k, JSON.stringify(v)); } catch { } },
};

const S = {
  tab: 'practice', view: null,
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
  return cached(`w|${w.id}|${S.mk.at}`, () => runWallet(w, S.mk.d, S.mk.live));
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
  const n = document.createElement('p'); n.textContent = msg; el.append(n); announce(msg);
  setTimeout(() => n.remove(), 6000);
}
setInterval(() => { if (S.mk && Math.floor(Date.now() / LIVE.ms) !== Math.floor((S.liveAt || 0) / LIVE.ms)) runLive(); }, 30e3);

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
        <span class="wl-val"><span class="wl-money">${money(v.value)}</span>${chg(v.value / w.cash - 1)}</span>
      </button></li>`;
    }).join('')}${S.manual ? `<li><button class="card wallet" data-act="manual" data-k="open-manual"><span class="av" style="--h:200" aria-hidden="true">🧑</span>
        <span class="wl-main"><span class="wl-name">${t.desk.you}</span><span class="muted">${t.desk.youLine}</span></span>
        <span class="wl-val"><span class="wl-money">${money(mv)}</span>${chg(mv / S.manual.start - 1)}</span></button></li>` : ''}</ul>
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
const blob = k => { const [c, d] = BLOB[k]; return `<svg class="blob" viewBox="0 0 40 40" aria-hidden="true"><path d="${d}" fill="${c}"/>
  <ellipse cx="15" cy="20" rx="3.4" ry="4.2" fill="#fff"/><ellipse cx="25" cy="20" rx="3.4" ry="4.2" fill="#fff"/>
  <circle cx="15.8" cy="21" r="1.9" fill="#0B0D12"/><circle cx="25.8" cy="21" r="1.9" fill="#0B0D12"/></svg>`; };
const price = p => new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', useGrouping: 'always', minimumFractionDigits: p < 1 ? 4 : 2, maximumFractionDigits: p < 1 ? 5 : p < 100 ? 3 : 2 }).format(p);
const qty = q => new Intl.NumberFormat(loc(), { maximumSignificantDigits: 5 }).format(q);
const signed = v => (v >= 0 ? '+' : '−') + money(Math.abs(v));

// Your own practice wallet (you trade by hand, next to the bots).
function manual() { return S.manual; }
function ensureManual() { if (!S.manual) { S.manual = { cash: 1000, start: 1000, fills: [], created: Date.now() }; store.set('manual', S.manual); } return S.manual; }
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

  const head = isManual
    ? `<header class="panel t-head"><div class="t-top"><span class="av" style="--h:200" aria-hidden="true">🧑</span><div class="t-id"><p class="t-name">${dk.you}</p><p class="run mono">${dk.youLine}</p></div>
        <span class="paper mono">${t.term.paper}</span></div>
        <div class="t-nums"><div><p class="lbl mono">${t.term.balance}</p><p class="t-big mono" data-manual-val>${money(manualValue(m))}</p><p>${chg(manualValue(m) / m.start - 1)}</p></div>
        <div class="t-wl mono"><p><b>${m.fills.length}</b> ${t.term.trades}</p></div></div></header>`
    : `<header class="panel t-head"><div class="t-top">${avatar(b)}<div class="t-id"><p class="t-name">VELA <span class="hl">DESK</span> <span class="ver">· ${esc(botName(b))}</span></p>
        <p class="run mono"><i class="dot${v.pending ? ' wait' : ''}" aria-hidden="true"></i>${v.pending ? t.term.waitingFirst : t.term.running} · ${v.live ? t.live.every + ' · ' : ''}${t.term.nextIn} <b data-until="${v.nextAt}">${countdown(v.nextAt)}</b></p></div>
        <span class="paper mono">${t.term.paper}</span></div>
        <div class="t-nums"><div><p class="lbl mono">${t.term.balance}</p><p class="t-big mono" data-wallet-val>${money(v.value)}</p><p>${chg(v.value / w.cash - 1)}</p></div>
        <div class="t-wl mono"><p><b>${v.trades.length}</b> ${t.term.trades}</p></div></div></header>`;

  const seg = `<div class="seg" role="tablist" aria-label="${dk.panes.join(', ')}">${dk.panes.map((p, k) =>
    `<button role="tab" data-act="pane" data-v="${k}" data-k="pane-${k}" aria-selected="${st.pane === k}">${p}</button>`).join('')}</div>`;

  return `<button class="back" data-act="back" data-k="back"><span aria-hidden="true">‹</span> ${t.back}</button>${head}${seg}
    <div class="desk" data-active="${st.pane}">
      <section class="pane" data-pane="0" aria-label="${dk.panes[0]}">${chartPane(st, b, v, m, coins)}</section>
      <section class="pane" data-pane="1" aria-label="${dk.panes[1]}">${analysisPane(st, b, e, v, w, m)}</section>
      <section class="pane" data-pane="2" aria-label="${dk.panes[2]}">${chatPane(b, v, w, m)}</section>
    </div>
    ${isManual ? '' : `<button class="btn danger wide" data-act="remove" data-v="${w.id}" data-k="remove">${t.stopBot}</button>`}`;
}

function chartPane(st, b, v, m, coins) {
  const dk = T().desk, c = st.coin, tk = S.tick[c], p = livePx(c);
  const botHold = v?.holdings?.find(h => h.c === c);
  const mine = manualBook(m || S.manual || { fills: [] })[c];
  const key = `${c}|${st.tf}`;
  return `<div class="cc-head"><span class="coin-av" aria-hidden="true">${c.slice(0, 1)}</span>
      <div class="cc-name"><b>$${c}</b><span>${COIN[c] || c}</span></div>
      <div class="cc-px"><b class="mono" data-live-p>${p ? price(p) : '—'}</b><span data-live-c>${tk ? chg(tk.chg) : ''}</span></div></div>
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

function drawCandles(rows, st, v) {
  const W = 340, H = 190, P = 6, lo = Math.min(...rows.map(r => r.l)), hi = Math.max(...rows.map(r => r.h)), span = hi - lo || 1;
  const n = rows.length, bw = W / n, y = p => P + (1 - (p - lo) / span) * (H - 2 * P);
  const last = rows[n - 1].c, ms = rows.length > 1 ? rows[1].t - rows[0].t : DAY;
  const marks = [];
  const add = (ts, p, side) => { const k = Math.floor((ts - rows[0].t) / ms); if (k >= 0 && k < n) marks.push({ x: k * bw + bw / 2, y: y(Math.min(hi, Math.max(lo, p))), side }); };
  if (v) for (const x of v.trades) if (x.c === st.coin) add(x.ts ? x.ts - 1 : (x.day + 1) * DAY - 1, x.p, x.side);
  if (S.manual) for (const f of S.manual.fills) if (f.c === st.coin) add(f.ts, f.p, f.side);
  return `<svg viewBox="0 0 ${W} ${H}" class="cndl" role="img" aria-label="${esc(`$${st.coin} ${st.tf}: ${price(rows[0].o)} → ${price(last)}`)}">
    ${rows.map((r, k) => { const x = k * bw, up = r.c >= r.o, top = y(Math.max(r.o, r.c)), h = Math.max(1, Math.abs(y(r.o) - y(r.c)));
      return `<g class="${up ? 'cu' : 'cd'}"><line x1="${(x + bw / 2).toFixed(1)}" x2="${(x + bw / 2).toFixed(1)}" y1="${y(r.h).toFixed(1)}" y2="${y(r.l).toFixed(1)}"/><rect x="${(x + bw * 0.15).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}"/></g>`; }).join('')}
    <line class="lastline" x1="0" x2="${W}" y1="${y(last).toFixed(1)}" y2="${y(last).toFixed(1)}"/>
    ${marks.map(k => `<g class="mk ${k.side}"><circle cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="6"/><text x="${k.x.toFixed(1)}" y="${(k.y + 3.5).toFixed(1)}" text-anchor="middle">${k.side === 'buy' ? 'B' : 'S'}</text></g>`).join('')}
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
  const anaHead = `<h3 class="t-h mono">$${st.coin} · ${dk.analysis} <span class="muted">· ${fill(dk.scanned, { n: e.coins.length })}</span></h3>${m ? `<p class="lbl-xs mono">${fill(dk.view, { b: botName(b) })}</p>` : ''}`;

  let desk;
  if (m) {
    const val = manualValue(m), rows = [...m.fills].reverse();
    desk = `<h3 class="t-h mono">${dk.yourTrades}</h3><p class="lbl mono">${dk.bank} · ${fill(dk.startedWith, { usd: money(m.start) })}</p>
      <p class="bank mono ${val >= m.start ? 'up-t' : 'down-t'}">${money(val)}</p>
      ${rows.length ? `<ol class="dtrades mono">${rows.map((f, k) => `<li><span class="dn">#${rows.length - k}</span><span>${f.side === 'buy' ? dk.buy : dk.sell} <b>$${f.c}</b><br><span class="muted">${qty(f.q)} @ ${price(f.p)}</span></span><span class="r">${money(f.usd)}<br><span class="muted">${new Date(f.ts).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span></li>`).join('')}</ol>` : `<p class="muted small">${dk.noDeskTrades}</p>`}`;
  } else {
    const ts = tradeStats(v.trades), d = S.mk.d;
    const hrs = (a, z) => Math.max(0, Math.round((z - a) / 36e5));
    const openRows = ts.open.map(o => { const h = v.holdings.find(x => x.c === o.c), now = h ? h.now : o.entry; return { c: o.c, entry: o.entry, exit: now, pnl: o.q * now - o.cost, days: o.since != null ? d.dates[d.dates.length - 1] - o.since : 0, hours: o.sinceTs ? hrs(o.sinceTs, Date.now()) : null, open: true }; });
    const closed = ts.sells.map(s => ({ c: s.c, entry: s.entry, exit: s.p, pnl: s.pnl, days: s.since != null ? s.day - s.since : 0, hours: s.sinceTs ? hrs(s.sinceTs, s.ts) : null, open: false }));
    const all = [...openRows, ...closed.reverse()];
    desk = `<h3 class="t-h mono">${dk.deskT}</h3><p class="lbl mono">${dk.bank} · ${fill(dk.startedWith, { usd: money(w.cash) })}</p>
      <p class="bank mono ${v.value >= w.cash ? 'up-t' : 'down-t'}">${money(v.value)}</p>
      <p class="lbl-xs mono">${fill(dk.tradesLine, { n: v.trades.length, g: ts.wins, r: ts.losses, w: ts.worst ? signed(ts.worst.pnl) : '—' })}</p>
      ${v.eq.length > 2 ? chart([{ v: v.eq, cls: 'main' }], `${money(w.cash)} → ${money(v.value)}`, 70) : ''}
      ${all.length ? `<ol class="dtrades mono">${all.map((x, k) => `<li><span class="dn">#${all.length - k}</span>
        <span><b>$${x.c}</b> ${price(x.entry)} → ${price(x.exit)}<br><span class="muted">${x.hours != null ? fill(t.live.inHours, { n: x.hours }) : fill(dk.inDays, { n: x.days })} · <span class="${x.open ? 'st-open' : ''}">${x.open ? dk.open : dk.closed}</span></span></span>
        <span class="r ${x.pnl >= 0 ? 'up-t' : 'down-t'}">${signed(x.pnl)}</span></li>`).join('')}</ol>` : `<p class="muted small">${dk.noDeskTrades}</p>`}`;
  }
  return `<div class="ana">${anaHead}${checks}</div><div class="dsk">${desk}</div>`;
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
  return `<h3 class="t-h mono">${t.desk.agentsT} <span class="muted">· ${t.desk.live}</span><i class="dot" aria-hidden="true"></i></h3>
    <ol class="chat" aria-live="off">${msgs.map((x, k) => x.sep != null
      ? `<li class="sep mono">${x.sep === 'now' ? `<span class="now">${t.live.chat.now}</span>` : dayDate(x.sep, { weekday: 'short', day: 'numeric', month: 'short' })}</li>`
      : `<li class="msg${animate && k <= nAnim ? ' pop' : ''}" style="--i:${k}">${blob(x.who)}<div><b>${names[x.who]}${x.ts ? ` <time class="mono">${new Date(x.ts).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}</time>` : ''}</b><p>${esc(x.text)}</p></div></li>`).join('')}</ol>`;
}

function tradeDialog() {
  const tr = S.trade;
  if (!tr) return '';
  const dk = T().desk, tt = dk.trade, p = livePx(tr.coin), m = ensureManual(), pos = manualBook(m)[tr.coin];
  const base = tr.side === 'buy' ? m.cash : (pos ? pos.q * p : 0), amt = +tr.amt || 0;
  return `<form method="dialog" class="sheet tsheet">
    <div class="ts-top"><span class="coin-av" aria-hidden="true">${tr.coin[0]}</span><div><h2 id="trade-title">${tt.title[tr.side]} $${tr.coin}</h2><p class="muted mono">${p ? price(p) : '—'}</p></div>
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
  const st = S.desk; if (!S.view || !st.coin) return;
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
  const w = S.wallets.find(x => x.id === S.view);
  el.innerHTML = S.cnd.key === key && S.cnd.rows ? drawCandles(S.cnd.rows, st, w ? walletView(w) : null) : `<p class="muted mono cc-load">${S.cnd.err === key ? T().desk.chartError : T().desk.loadingChart}</p>`;
}
async function pollTick() {
  const c = S.desk.coin; if (!S.view || !c || document.hidden) return;
  try {
    S.tick[c] = await ticker(c);
    const tk = S.tick[c], p = document.querySelector('[data-live-p]'), ch = document.querySelector('[data-live-c]'), hl = document.querySelector('[data-live-hilo]');
    if (p) p.textContent = price(tk.p);
    if (ch) ch.innerHTML = chg(tk.chg);
    if (hl) hl.innerHTML = hilo(tk);
    const mv = document.querySelector('[data-manual-val]'); if (mv && S.manual) mv.textContent = money(manualValue(S.manual));
    const lw = S.wallets.find(x => x.id === S.view && x.bot === 'live'), wv = document.querySelector('[data-wallet-val]');
    if (lw && wv) wv.textContent = money(liveView(lw).value);
  } catch { }
}
setInterval(pollTick, 10e3);
setInterval(() => { if (S.view) loadCandles(); }, 60e3);

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
    <div class="logo" aria-hidden="true">⛵</div>
    <h1 tabindex="-1">${t.onbTitle}</h1><p class="lead">${t.tagline}</p>
    <ul class="onb-list">${t.onb.map(([i, h, p]) => `<li><span class="onb-i" aria-hidden="true">${i}</span><div><h2>${h}</h2><p>${p}</p></div></li>`).join('')}</ul>
    <button class="btn primary wide" data-act="onboarded" data-k="onb">${t.onbBtn}</button></div>`;
}

function setupDialog() {
  const t = T(), b = getBot(S.setup.bot);
  if (!b) return '';
  const amt = S.setup.amt, st = S.setup.start;
  if (b.kind === 'live') {
    const ls = [0, 1, 3, 7].includes(st) ? st : 1;
    return `<form method="dialog" class="sheet">
    <div class="row">${avatar(b, true)}<div><p class="muted">${t.setupTitle}</p><h2 id="setup-title">${botName(b)}</h2></div></div>
    <p class="label">${t.amount}</p>${chips('amt', [100, 500, 1000, 10000].map(v => [v, money(v)]), amt, t.amount)}
    <p class="label">${t.startWhen}</p>${chips('start', [0, 1, 3, 7].map(v => [v, t.live.startOpts[v]]), ls, t.startWhen)}
    <p class="muted">${ls ? t.live.pastHint : t.live.nowHint}</p>
    <div class="actions"><button class="btn primary" value="ok" data-act="create" data-k="create">${t.startBtn}</button>
    <button class="btn ghost" value="cancel" data-act="close" data-k="cancel">${t.cancel}</button></div></form>`;
  }
  return `<form method="dialog" class="sheet">
    <div class="row">${avatar(b, true)}<div><p class="muted">${t.setupTitle}</p><h2 id="setup-title">${botName(b)}</h2></div></div>
    <p class="label">${t.amount}</p>${chips('amt', [100, 500, 1000, 10000].map(v => [v, money(v)]), amt, t.amount)}
    <p class="label">${t.startWhen}</p>${chips('start', [0, 30, 90, 180].map(v => [v, t.startOpts[v]]), st, t.startWhen)}
    <p class="muted">${st ? t.startHint : fill(t.tonightHint, { t: nextCloseText() })}</p>
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
  const t = T(), html = document.documentElement;
  html.lang = S.set.lang;
  html.dataset.theme = S.set.theme;
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.content = S.set.theme === 'terminal' ? '#050B08' : m.media.includes('dark') ? '#0E1013' : '#F6F4EF');
  html.style.fontSize = (S.set.size * 100) + '%';
  const k = document.activeElement?.dataset?.k;

  if (!S.set.onboarded) {
    $('#app').innerHTML = onboarding();
    $('#tabs').hidden = true;
  } else {
    $('#tabs').hidden = false;
    const title = S.view ? '' : `<header class="top"><p class="brand"><span aria-hidden="true">⛵</span> Vela</p><h1 tabindex="-1">${t.titles[S.tab]}</h1></header>`;
    const body = S.view ? deskScreen(S.view) : { practice, bots: botsScreen, test: testScreen, settings: settingsScreen }[S.tab]();
    $('#app').innerHTML = title + `<div class="content">${body}</div>`;
    $('#app').classList.toggle('wide', !!S.view);
    $('#tabs').innerHTML = ['practice', 'bots', 'test', 'settings'].map(id =>
      `<button data-act="tab" data-v="${id}" data-k="tab-${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${ICON[id]}<span>${t.tabs[id]}</span></button>`).join('');
  }
  const setup = $('#setup'), conf = $('#confirm'), trd = $('#trade');
  setup.innerHTML = setupDialog(); conf.innerHTML = confirmDialog(); trd.innerHTML = tradeDialog();
  if (S.trade && !trd.open) trd.showModal();
  if (!S.trade && trd.open) trd.close();
  if (S.view && S.mk && S.desk.coin) {
    const key = `${S.desk.coin}|${S.desk.tf}`;
    if (S.cndReq !== key) { S.cndReq = key; loadCandles(); pollTick(); }
  } else S.cndReq = null;
  if (S.setup.bot && !setup.open) setup.showModal();
  if (!S.setup.bot && setup.open) setup.close();
  if (S.confirm && !conf.open) conf.showModal();
  if (!S.confirm && conf.open) conf.close();

  const again = k && document.querySelector(`[data-k="${k}"]`);
  if (focusTop) (document.querySelector('#app h1, #app h2, #app .back'))?.focus?.();
  else if (again) again.focus();
}

const ICON = {
  practice: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/></svg>',
  bots: '<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/></svg>',
  test: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  settings: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};

// ---------- actions ----------
const ACT = {
  tab(v) { S.tab = v; S.view = null; render(true); scrollTo(0, 0); },
  open(v) { S.view = v; render(true); scrollTo(0, 0); },
  back() { S.view = null; render(true); },
  setup(v) { S.setup.bot = v; render(); },
  close() { S.setup.bot = null; S.confirm = null; render(); },
  amt(v) { S.setup.amt = +v; render(); },
  start(v) { S.setup.start = +v; render(); },
  create() {
    const today = Math.floor(Date.now() / DAY); // the day whose close is next
    const isLive = S.setup.bot === 'live', ls = [0, 1, 3, 7].includes(S.setup.start) ? S.setup.start : 1;
    const w = isLive
      ? { id: Math.random().toString(36).slice(2, 9), bot: 'live', cash: S.setup.amt, startTs: Date.now() - ls * DAY, created: Date.now() }
      : { id: Math.random().toString(36).slice(2, 9), bot: S.setup.bot, cash: S.setup.amt, startDay: today - S.setup.start, created: Date.now() };
    if (isLive) w.st = newLiveState(w.cash, w.startTs);
    S.wallets.push(w); saveWallets();
    S.setup.bot = null; S.tab = 'practice'; S.view = w.id; render(true); scrollTo(0, 0);
    if (isLive) { S.liveAt = 0; runLive(true); }
  },
  pane(v) { S.desk.pane = +v; render(); },
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
for (const id of ['#setup', '#confirm']) $(id).addEventListener('cancel', e => { e.preventDefault(); ACT.close(); });
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
refresh();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
