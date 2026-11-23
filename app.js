// app.js — the screens. No frameworks: plain HTML strings, one render() for everything.
import { BOTS, botById, simulate, holdBTC, stats, yearly, runWallet, explain, tradeStats, DAY } from './engine.js';
import { loadMarket } from './data.js';
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
const botName = b => T().bots[b.id].name;
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
function walletView(w) { return cached(`w|${w.id}|${S.mk.at}`, () => runWallet(w, S.mk.d, S.mk.live)); }

async function refresh(manual) {
  if (S.loading) return;
  S.loading = true; S.error = null; render();
  try {
    S.mk = await loadMarket();
    memo.clear();
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
  if (!S.wallets.length) return `<p class="lead">${t.practiceNote}</p>
    <div class="card empty"><div class="empty-art" aria-hidden="true">⛵</div><h2>${t.emptyTitle}</h2><p>${t.emptyText}</p>
    <button class="btn primary" data-act="tab" data-v="bots" data-k="go-bots">${t.emptyBtn}</button></div>`;
  const box = statusBox();
  if (!S.mk) return box;
  const views = S.wallets.map(w => [w, walletView(w)]);
  const total = views.reduce((a, [, v]) => a + v.value, 0), base = S.wallets.reduce((a, w) => a + w.cash, 0);
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
    }).join('')}</ul>
    <button class="btn ghost wide" data-act="tab" data-v="bots" data-k="add-bot">+ ${t.addBot}</button>`;
}

function walletDetail(id) {
  const t = T(), tt = t.term, w = S.wallets.find(x => x.id === id);
  if (!w) { S.view = null; return practice(); }
  if (!S.mk) return statusBox();
  const v = walletView(w), b = v.bot, d = S.mk.d;
  const e = cached(`e|${b.id}|${S.mk.at}`, () => explain(b, d));
  const ts = tradeStats(v.trades);
  const picks = e.coins.filter(c => c.w > 0), nBlocked = e.coins.filter(c => !c.trend).length;
  const blockedAll = b.pick && !e.btcUp;
  const startDay = v.start != null ? d.dates[v.start] : w.startDay;
  const dm = day => dayDate(day, { day: '2-digit', month: '2-digit' });
  const ag = agents(b, e, v);

  const head = `<header class="panel t-head">
      <div class="t-top">${avatar(b)}<div class="t-id"><p class="t-name">VELA <span class="hl">TERMINAL</span> <span class="ver">· ${esc(botName(b))}</span></p>
        <p class="run mono"><i class="dot${v.pending ? ' wait' : ''}" aria-hidden="true"></i>${v.pending ? tt.waitingFirst : tt.running} · ${tt.nextIn} <b data-until="${v.nextAt}">${countdown(v.nextAt)}</b></p></div>
        <span class="paper mono">${tt.paper}</span></div>
      <div class="t-nums"><div><p class="lbl mono">${tt.balance}</p><p class="t-big mono">${money(v.value)}</p><p>${chg(v.value / w.cash - 1)}</p></div>
        <div class="t-wl mono"><p><b>${v.trades.length}</b> ${tt.trades}</p><p><b class="up-t">${ts.wins}</b> / <b class="down-t">${ts.losses}</b></p></div></div>
    </header>`;

  const tok = [...picks, ...e.coins.filter(c => !c.w)].slice(0, 4);
  const tx = k => 12 + k * (316 / Math.max(1, tok.length)) + (316 / Math.max(1, tok.length) - 74) / 2;
  const flow = `<section class="panel flow" aria-label="${tt.flow}">
      <h3 class="t-h mono">${tt.flow}</h3>
      <svg viewBox="0 0 340 214" class="flow-svg" role="img" aria-label="${esc(`${tt.checked.replace('{n}', e.coins.length)}. ${tt.blockedNode}: ${blockedAll ? e.coins.length : nBlocked}. ${tt.pickNode}: ${picks.map(p => p.c).join(', ') || '—'}`)}">
        <defs><radialGradient id="g-core"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>
        ${tok.map((c, k) => { const cls = c.w ? 'pick' : c.trend && !blockedAll ? 'ok' : 'out', x = tx(k);
          return `<path class="wire ${cls}" d="M${x + 37} 46 C${x + 37} 90 170 80 170 104"/>
          <g class="tok ${cls}"><rect x="${x}" y="6" width="74" height="40" rx="9"/><text x="${x + 37}" y="23" text-anchor="middle" class="t1">$${c.c}</text>
          <text x="${x + 37}" y="38" text-anchor="middle" class="t2">${c.ret30 == null ? '—' : pctTxt(c.ret30)}</text></g>`; }).join('')}
        <path class="wire out" d="M136 142 L74 142"/><path class="wire pick" d="M204 142 L266 142"/>
        <circle cx="170" cy="142" r="62" fill="url(#g-core)" class="halo"/>
        <circle cx="170" cy="142" r="34" class="core"/><text x="170" y="152" text-anchor="middle" class="core-i">⛵</text>
        <text x="170" y="196" text-anchor="middle" class="lbl-s">${tt.core}</text><text x="170" y="209" text-anchor="middle" class="lbl-xs">${tt.checked.replace('{n}', e.coins.length)}</text>
        <g class="node out"><circle cx="48" cy="142" r="24"/><path d="M48 130 L60 151 L36 151 Z" class="tri"/><text x="48" y="186" text-anchor="middle" class="lbl-s">${tt.blockedNode}</text><text x="48" y="199" text-anchor="middle" class="lbl-xs">${blockedAll ? e.coins.length : nBlocked}</text></g>
        <g class="node pick"><circle cx="292" cy="142" r="24"/><circle cx="292" cy="142" r="13" class="ring"/><circle cx="292" cy="142" r="4" class="ring-dot"/>
          <text x="292" y="186" text-anchor="middle" class="lbl-s">${picks.length ? tt.pickNode : tt.cashNode}</text><text x="292" y="199" text-anchor="middle" class="lbl-xs">${picks.map(p => p.c).join(' ') || '$'}</text></g>
      </svg>
      <ul class="coins mono" aria-label="${t.ag.radar}">${e.coins.map(c => `<li class="${c.w ? 'pick' : c.trend && !blockedAll ? 'ok' : 'out'}"><b>${c.c}</b> ${c.ret30 == null ? '' : pctTxt(c.ret30)}</li>`).join('')}</ul>
    </section>`;

  const stat = (label, val, sub, cls = '') => `<div class="panel tstat"><p class="lbl mono">${label}</p><p class="tv mono ${cls}">${val}</p><p class="lbl-xs mono">${sub}</p></div>`;
  const stats4 = `<section class="tstats">
      ${stat(tt.blocked, blockedAll ? e.coins.length : nBlocked, tt.blockedSub.replace('{n}', e.coins.length), 'down-t')}
      ${stat(tt.best, ts.best ? pctTxt(ts.best.pct) : '—', ts.best ? '$' + ts.best.c : '', ts.best && ts.best.pct >= 0 ? 'up-t' : 'down-t')}
      ${stat(tt.winRate, ts.sells.length ? Math.round(ts.wins / ts.sells.length * 100) + '%' : '—', `${ts.wins}W / ${ts.losses}L`)}
      ${stat(tt.lastSell, ts.last ? (ts.last.pnl >= 0 ? '+' : '−') + money(Math.abs(ts.last.pnl)) : '—', ts.last ? '$' + ts.last.c : '', ts.last ? (ts.last.pnl >= 0 ? 'up-t' : 'down-t') : '')}
    </section>`;

  const agentsBox = `<section class="panel"><h3 class="t-h mono">${tt.agents} <span class="muted">· ${tt.agentsN.replace('{n}', ag.length)}</span></h3>
      <ul class="agents">${ag.map(a => `<li class="agent k-${a.k}${a.you ? ' you' : ''}"><span class="ai" aria-hidden="true">${a.ic}</span>
        <span class="an"><b class="mono">${a.name}</b><span class="mono">${esc(a.sub)}</span></span><span class="tag mono">${a.tag}</span></li>`).join('')}</ul></section>`;

  const lastWhy = c => [...v.trades].reverse().find(x => x.c === c && x.side === 'buy')?.why;
  const pos = `<section class="panel"><h3 class="t-h mono">${tt.position}</h3>${(v.holdings || []).length ? (v.holdings || []).map(h => `<div class="pos">
      <div class="pos-h"><b class="mono">$${h.c}</b> <span class="muted">${COIN[h.c] || ''}</span> <span class="tag mono k-green">${tt.open}</span><span class="pos-g">${chg(h.gain)}</span></div>
      <dl class="pos-g4 mono"><div><dt>${tt.entry}</dt><dd>${money(h.entry)}</dd></div><div><dt>${tt.now}</dt><dd>${money(h.now)}</dd></div><div><dt>${tt.size}</dt><dd>${money(h.value)}</dd></div></dl>
      <p class="lbl-xs mono">${tt.reason}: ${t.why[lastWhy(h.c)] || '—'}</p></div>`).join('')
    : `<p class="mono cashwhy">${tt.cashWhy} <b>${v.pending ? t.waiting + ' ' + when(v.nextAt) : t.why[e.out] || '—'}</b></p>`}
      <p class="lbl-xs mono">${t.cash}: ${money(v.cash)}</p></section>`;

  const eq = v.eq.length > 2 ? `<section class="panel"><h3 class="t-h mono">${tt.equity}</h3>
      ${chart([{ v: v.eq, cls: 'main' }], `${money(w.cash)} → ${money(v.value)}`, 120)}
      <div class="eq-row mono"><span>${tt.start} ${dayDate(startDay, { day: 'numeric', month: 'short' })}<br><b>${money(w.cash)}</b></span><span class="r">${tt.now}<br><b>${money(v.value)}</b></span></div></section>` : '';

  const rows = [...ts.rows].reverse().slice(0, 40);
  const log = `<section class="panel log"><h3 class="t-h mono"><span class="hl">$</span> ${tt.log} <span class="muted">· ${tt.lines.replace('{n}', v.trades.length)}</span></h3>
      ${rows.length ? `<ul class="mono">${rows.map(x => { const kind = x.why === 'stop' ? 'stop' : x.side;
        return `<li><span class="ts">${dm(x.day)}</span><span class="side ${kind}">${tt[kind]}</span><b>$${x.c}</b><span class="amt ${x.pnl == null ? '' : x.pnl >= 0 ? 'up-t' : 'down-t'}">${x.pnl == null ? money(x.usd) : (x.pnl >= 0 ? '+' : '−') + money(Math.abs(x.pnl))}</span>
        <span class="rs">${t.why[x.why] || ''}</span></li>`; }).join('')}</ul>` : `<p class="mono muted">${tt.emptyLog}</p>`}</section>`;

  return `<div class="term"><button class="back" data-act="back" data-k="back"><span aria-hidden="true">‹</span> ${t.back}</button>
    ${head}${flow}${stats4}${agentsBox}${pos}${eq}${log}
    <button class="btn danger wide" data-act="remove" data-v="${w.id}" data-k="remove">${t.stopBot}</button></div>`;
}

function agents(b, e, v) {
  const a = T().ag, A = [], nTrend = e.coins.filter(c => c.trend).length;
  A.push({ ic: '📡', name: a.radar, sub: fill(a.radarSub, { n: e.coins.length, d: dayDate(e.day, { day: 'numeric', month: 'short' }) }), tag: 'SCAN', k: 'cyan' });
  if (b.pick) {
    const picks = e.coins.filter(c => c.w > 0);
    A.push({ ic: '🧭', name: a.btc, sub: `BTC ${money(e.btc)} · ${a.avg} ${money(e.btcAvg)}`, tag: e.btcUp ? 'PASS' : 'BLOCK', k: e.btcUp ? 'green' : 'red' });
    A.push({ ic: '📈', name: a.filter, sub: fill(a.filterSub, { a: nTrend, n: e.coins.length }), tag: 'FILTER', k: 'amber' });
    A.push({ ic: '🏆', name: a.ranker, sub: picks.length ? picks.map(c => `${c.c} ${pctTxt(c.ret30)}`).join(' · ') : a.rankerNone, tag: picks.length ? 'RANK' : 'IDLE', k: 'purple' });
    A.push({ ic: '⚖️', name: a.sizer, sub: fill(a.sizerEq, { n: b.pick }), tag: 'SIZE', k: 'blue' });
    A.push({ ic: '🛡️', name: a.stop, sub: fill(a.stopSub, { s: pctTxt(b.stop), a: (v.holdings || []).length, n: v.trades.filter(x => x.why === 'stop').length }), tag: 'ARMED', k: 'red' });
  } else if (b.id === 'longterm') {
    A.push({ ic: '🌳', name: a.holder, sub: 'BTC 70% · ETH 30%', tag: 'HOLD', k: 'green' });
    A.push({ ic: '⚖️', name: a.rebal, sub: a.rebalSub, tag: 'MONTHLY', k: 'blue' });
  } else {
    for (const c of e.coins) {
      const good = b.id === 'steps' ? c.score >= 2 : c.trend;
      A.push({ ic: c.c === 'BTC' ? '₿' : 'Ξ', name: `${a.trend} ${c.c}`, sub: b.id === 'steps' ? fill(a.stepsSub, { s: c.score }) : `${money(c.p)} · ${a.avg} ${money(c.avg200)}`, tag: b.id === 'steps' ? `${c.score}/3` : c.trend ? 'PASS' : 'BLOCK', k: good ? 'green' : 'red' });
    }
    A.push({ ic: '⚖️', name: a.sizer, sub: b.id === 'steps' ? a.sizerSteps : 'BTC 60% · ETH 40%', tag: 'SIZE', k: 'blue' });
  }
  A.push({ ic: '📓', name: a.journal, sub: fill(a.journalSub, { n: v.trades.length }), tag: 'WRITE', k: 'grey' });
  A.push({ ic: '😴', name: a.you, sub: fill(a.youSub, { t: when(v.nextAt) }), tag: 'ASLEEP', k: 'grey', you: true });
  return A;
}

function countdown(ms) {
  let m = Math.max(0, Math.round((ms - Date.now()) / 60e3));
  const dd = Math.floor(m / 1440); m -= dd * 1440;
  const h = Math.floor(m / 60); m -= h * 60;
  return (dd ? dd + 'd ' : '') + (dd || h ? h + 'h ' : '') + m + 'm';
}
setInterval(() => { for (const el of document.querySelectorAll('[data-until]')) el.textContent = countdown(+el.dataset.until); }, 30e3);

function botsScreen() {
  const t = T();
  return `<p class="lead">${t.riskNote}</p><ul class="list">${BOTS.map(b => {
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
  const t = T(), b = botById(S.setup.bot);
  if (!b) return '';
  const amt = S.setup.amt, st = S.setup.start;
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
    const body = S.view ? walletDetail(S.view) : { practice, bots: botsScreen, test: testScreen, settings: settingsScreen }[S.tab]();
    $('#app').innerHTML = title + `<div class="content">${body}</div>`;
    $('#tabs').innerHTML = ['practice', 'bots', 'test', 'settings'].map(id =>
      `<button data-act="tab" data-v="${id}" data-k="tab-${id}" ${S.tab === id ? 'aria-current="page"' : ''}>${ICON[id]}<span>${t.tabs[id]}</span></button>`).join('');
  }
  const setup = $('#setup'), conf = $('#confirm');
  setup.innerHTML = setupDialog(); conf.innerHTML = confirmDialog();
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
    const w = { id: Math.random().toString(36).slice(2, 9), bot: S.setup.bot, cash: S.setup.amt, startDay: today - S.setup.start, created: Date.now() };
    S.wallets.push(w); saveWallets();
    S.setup.bot = null; S.tab = 'practice'; S.view = w.id; render(true); scrollTo(0, 0);
  },
  testbot(v) { S.test.bot = v; S.tab = 'test'; S.view = null; render(true); scrollTo(0, 0); },
  tbot(v) { S.test.bot = v; render(); },
  tper(v) { S.test.period = +v; render(); },
  lang(v) { S.set.lang = v; saveSet(); render(); },
  theme(v) { S.set.theme = v; saveSet(); render(); },
  size(v) { S.set.size = +v; saveSet(); render(); },
  onboarded() { S.set.onboarded = true; saveSet(); render(true); },
  refresh(v) { refresh(!!v); },
  remove(v) { S.confirm = { text: T().stopConfirm, run: () => { S.wallets = S.wallets.filter(w => w.id !== v); saveWallets(); S.view = null; } }; render(); },
  reset() { S.confirm = { text: T().resetConfirm, yes: T().reset, run: () => { S.wallets = []; saveWallets(); } }; render(); },
  'confirm-yes'() { const c = S.confirm; S.confirm = null; c?.run(); render(true); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  ACT[el.dataset.act]?.(el.dataset.v);
});
for (const id of ['#setup', '#confirm']) $(id).addEventListener('cancel', e => { e.preventDefault(); ACT.close(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.mk && Date.now() - S.mk.at > 5 * 60e3) refresh();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());

render(true);
refresh();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
