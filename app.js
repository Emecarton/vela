// app.js — the screens. No frameworks: plain HTML strings, one render() for everything.
import { BOTS, botById, simulate, holdBTC, stats, yearly, runWallet, DAY } from './engine.js';
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
  set: { lang: (navigator.language || 'es').startsWith('es') ? 'es' : 'en', theme: 'auto', size: 1, onboarded: false, ...store.get('settings', {}) },
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
  const t = T(), w = S.wallets.find(x => x.id === id);
  if (!w) { S.view = null; return practice(); }
  if (!S.mk) return statusBox();
  const v = walletView(w), b = v.bot;
  const trades = [...v.trades].reverse().slice(0, 60);
  return `<button class="back" data-act="back" data-k="back"><span aria-hidden="true">‹</span> ${t.back}</button>
    <section class="card hero">
      <div class="row">${avatar(b, true)}<div><h2>${botName(b)}</h2><p class="muted">${t.started} ${dayDate(w.startDay)} · ${money(w.cash)}</p></div></div>
      <p class="big">${money(v.value)}</p>
      <p>${chg(v.value / w.cash - 1)} <span class="muted">${t.sinceStart}</span></p>
      ${v.eq.length > 2 ? chart([{ v: v.eq, cls: 'main' }], `${botName(b)}: ${money(w.cash)} → ${money(v.value)}`) : ''}
      <p class="muted">${v.pending ? t.waiting : t.nextCheck}: <b>${when(v.nextAt)}</b></p>
    </section>
    <section class="card"><h3>${t.holdings}</h3><ul class="rows">
      ${(v.holdings || []).map(h => `<li><span><b>${h.c}</b> <span class="muted">${COIN[h.c] || ''}</span></span><span class="r">${money(h.value)}<br>${chg(h.gain)}</span></li>`).join('')}
      <li><span><b>${t.cash}</b></span><span class="r">${money(v.cash)}</span></li></ul></section>
    <section class="card"><h3>${t.history}</h3>
      ${trades.length ? `<ul class="rows trades">${trades.map(x => `<li><span><b>${x.side === 'buy' ? t.bought : t.sold} ${x.c}</b><br><span class="muted">${t.why[x.why] || ''}</span></span>
        <span class="r">${money(x.usd)}<br><span class="muted">${dayDate(x.day, { day: 'numeric', month: 'short' })}</span></span></li>`).join('')}</ul>` : `<p class="muted">${t.noTrades}</p>`}
    </section>
    <button class="btn danger wide" data-act="remove" data-v="${w.id}" data-k="remove">${t.stopBot}</button>`;
}

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
      <h3>${t.theme}</h3>${chips('theme', ['auto', 'light', 'dark'].map(k => [k, t.themes[k]]), S.set.theme, t.theme)}
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
