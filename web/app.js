/* 智选股 —— 前端逻辑（无框架） */

const API_BASE = location.origin;

const LS_WATCH = 'zxg_watch_v1';
const LS_POS = 'zxg_pos_v1';

const state = {
  view: 'recommend',
  lastList: 'recommend',
  watch: loadJSON(LS_WATCH, []),
  positions: loadJSON(LS_POS, []),
  quotes: {},
  rec: [],
  detail: { secid: null, name: '', klt: 101, data: null, loading: false, token: 0, intraday: null },
  hover: -1,
  modal: { secid: null, name: '', code: '', price: null },
  analysisCache: {},
  rtPoll: { timer: null, running: false },
};

/* ----------------------------- 基础工具 ----------------------------- */

function loadJSON(key, def) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : def;
  } catch (e) {
    return def;
  }
}

function saveWatch() { localStorage.setItem(LS_WATCH, JSON.stringify(state.watch)); }
function savePositions() { localStorage.setItem(LS_POS, JSON.stringify(state.positions)); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtPrice(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(d);
}

function fmtPct(v, d = 2) {
  if (v == null || isNaN(v)) return '—';
  return (v > 0 ? '+' : '') + Number(v).toFixed(d) + '%';
}

function fmtAmount(v) {
  if (v == null || isNaN(v) || !v) return '—';
  if (v >= 1e12) return (v / 1e12).toFixed(2) + '万亿';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(0) + '万';
  return Number(v).toFixed(0);
}

function fmtPnl(v) {
  if (v == null || isNaN(v)) return '—';
  const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
  return sign + fmtAmount(Math.abs(v));
}

function fmtVol(v) {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿手';
  if (v >= 1e4) return (v / 1e4).toFixed(2) + '万手';
  return Number(v).toFixed(0) + '手';
}

function clsPct(v) {
  if (v == null || isNaN(v) || v === 0) return 'flat';
  return v > 0 ? 'up' : 'down';
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

async function api(path, params) {
  let url = API_BASE + path;
  if (params) url += '?' + new URLSearchParams(params).toString();
  const resp = await fetch(url);
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  if (!resp.ok) throw new Error((data && data.error) || ('请求失败 ' + resp.status));
  return data;
}

/* ----------------------------- 视图切换 ----------------------------- */

function setView(view) {
  if (view !== 'detail') state.lastList = view;
  state.view = view;
  const names = ['recommend', 'watch', 'positions', 'detail'];
  names.forEach(n => {
    const el = document.getElementById('view-' + n);
    if (el) el.classList.toggle('hidden', n !== view);
  });
  const activeTab = view === 'detail' ? state.lastList : view;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.view === activeTab);
  });
  if (view === 'watch') loadWatch();
  if (view === 'positions') loadPositions();
  if (view === 'recommend' && !state.rec.length) loadRecommend();
}

/* ----------------------------- 指数 / 时钟 ----------------------------- */

async function loadMarket() {
  try {
    const d = await api('/api/market');
    const box = document.getElementById('indices');
    box.innerHTML = d.indices.map(q => `
      <div class="index-chip">
        <div class="ic-name">${esc(q.name)}</div>
        <div class="ic-price ${clsPct(q.pct)}">${fmtPrice(q.price, 2)}
          <span class="ic-pct">${fmtPct(q.pct)}</span>
        </div>
      </div>`).join('');
  } catch (e) {
    document.getElementById('indices').innerHTML =
      '<div class="index-chip"><div class="ic-name">指数行情</div><div class="ic-price">加载失败</div></div>';
  }
}

function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

/* ----------------------------- 搜索 ----------------------------- */

function bindSearch(inputId, dropId, onPick, withAdd) {
  const input = document.getElementById(inputId);
  const drop = document.getElementById(dropId);
  if (!input || !drop) return;

  const hide = () => drop.classList.add('hidden');
  let timer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) { hide(); return; }
    timer = setTimeout(async () => {
      try {
        const d = await api('/api/search', { q });
        if (!d.items || !d.items.length) {
          drop.innerHTML = '<div class="search-item"><span class="si-name">没有匹配的 A 股</span></div>';
        } else {
          drop.innerHTML = d.items.map(it => `
            <div class="search-item" data-secid="${esc(it.secid)}" data-code="${esc(it.code)}" data-name="${esc(it.name)}">
              <span class="si-name">${esc(it.name)}</span>
              <span class="si-code">${esc(it.code)}</span>
              <span class="si-type">${esc(it.type || '')}</span>
              ${withAdd ? '<button class="si-add" data-add="1">+自选</button>' : ''}
            </div>`).join('');
        }
        drop.classList.remove('hidden');
      } catch (e) {
        drop.innerHTML = `<div class="search-item"><span class="si-name">搜索失败：${esc(e.message)}</span></div>`;
        drop.classList.remove('hidden');
      }
    }, 260);
  });

  drop.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-add]');
    const row = ev.target.closest('.search-item[data-secid]');
    if (!row) return;
    const item = { secid: row.dataset.secid, code: row.dataset.code, name: row.dataset.name };
    if (btn) {
      ev.stopPropagation();
      addWatch(item.secid, item.code, item.name);
      hide();
      return;
    }
    hide();
    input.value = '';
    onPick(item);
  });

  document.addEventListener('click', ev => {
    if (!drop.contains(ev.target) && ev.target !== input) hide();
  });
}

/* ----------------------------- 自选 ----------------------------- */

function addWatch(secid, code, name) {
  if (!secid) return;
  if (state.watch.some(w => w.secid === secid)) {
    toast('已在自选：' + name);
    return;
  }
  state.watch.unshift({ secid, code, name });
  saveWatch();
  updateCounts();
  toast('已加入自选：' + name);
  if (state.view === 'watch') loadWatch();
}

function removeWatch(secid) {
  state.watch = state.watch.filter(w => w.secid !== secid);
  saveWatch();
  updateCounts();
  if (state.view === 'watch') loadWatch();
  syncWatchButton();
}

function updateCounts() {
  document.getElementById('watchCount').textContent = state.watch.length;
  document.getElementById('posCount').textContent = state.positions.length;
}

async function loadWatch() {
  const body = document.getElementById('watchBody');
  const empty = document.getElementById('watchEmpty');
  updateCounts();
  if (!state.watch.length) {
    body.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  try {
    const d = await api('/api/quotes', { secids: state.watch.map(w => w.secid).join(',') });
    const map = {};
    (d.quotes || []).forEach(q => { map[q.secid] = q; });

    body.innerHTML = state.watch.map(w => {
      const q = map[w.secid];
      if (!q) {
        return `<tr>
          <td><div class="cell-stock" data-secid="${esc(w.secid)}"><span class="cs-name">${esc(w.name)}</span><span class="cs-code">${esc(w.code)}</span></div></td>
          <td class="num" colspan="4" style="color:#8ea0b8">行情获取失败</td>
          <td class="num"><div class="row-actions">
            <button class="btn small ghost" data-act="unwatch" data-secid="${esc(w.secid)}">移除</button>
          </div></td></tr>`;
      }
      const pctCls = q.stale ? 'flat' : clsPct(q.pct);
      return `<tr>
        <td>
          <div class="cell-stock" data-secid="${esc(w.secid)}" data-name="${esc(w.name)}">
            <span class="cs-name">${esc(w.name)}</span>
            <span class="cs-code">${esc(q.code || w.code)}</span>
          </div>
        </td>
        <td class="num"><b>${fmtPrice(q.price)}</b>${q.stale ? '<span class="badge-stale">昨收</span>' : ''}</td>
        <td class="num ${pctCls}">${q.stale ? '—' : fmtPct(q.pct)}</td>
        <td class="num">${fmtPrice(q.prevClose)}</td>
        <td class="num">${fmtAmount(q.amount)}</td>
        <td class="num">
          <div class="row-actions">
            <button class="btn small" data-act="detail" data-secid="${esc(w.secid)}" data-name="${esc(w.name)}">走势</button>
            <button class="btn small ghost" data-act="buy" data-secid="${esc(w.secid)}" data-name="${esc(w.name)}" data-price="${q.price || ''}">买入</button>
            <button class="btn small ghost" data-act="unwatch" data-secid="${esc(w.secid)}">移除</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6"><div class="error-box">行情加载失败：${esc(e.message)}</div></td></tr>`;
  }
}

/* ----------------------------- 荐股 ----------------------------- */

async function loadRecommend(force) {
  const grid = document.getElementById('recGrid');
  if (!state.rec.length) {
    grid.innerHTML = '<div class="loading-card skeleton"></div><div class="loading-card skeleton"></div><div class="loading-card skeleton"></div>';
  }
  document.getElementById('scanInfo').textContent = '扫描中…';
  try {
    const d = await api('/api/recommend', { limit: 10 });
    state.rec = d.items || [];
    document.getElementById('scanInfo').textContent =
      `候选池 ${d.scanned} 只 · 命中前 ${state.rec.length} 只 · ${new Date(d.time * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`;
    renderRecommend();
  } catch (e) {
    document.getElementById('scanInfo').textContent = '';
    grid.innerHTML = `<div class="error-box">荐股计算失败：${esc(e.message)}　<button class="btn small" onclick="loadRecommend(true)">重试</button></div>`;
  }
}

function ringColor(score) {
  if (score >= 85) return '#f5b942';
  if (score >= 70) return '#4d8dff';
  return '#8ea0b8';
}

function sparkSVG(vals) {
  if (!vals || vals.length < 2) return '';
  const w = 300, h = 44, pad = 4;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const range = hi - lo || 1;
  const pts = vals.map((v, i) => {
    const x = pad + i / (vals.length - 1) * (w - pad * 2);
    const y = h - pad - (v - lo) / range * (h - pad * 2);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const up = vals[vals.length - 1] >= vals[0];
  const color = up ? '#f6465d' : '#25c08b';
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

function renderRecommend() {
  const grid = document.getElementById('recGrid');
  if (!state.rec.length) {
    grid.innerHTML = '<div class="error-box">当前候选池没有达到 58 分的标的，可稍后重试或切换行情时段。</div>';
    return;
  }
  grid.innerHTML = state.rec.map(it => {
    const buyTxt = it.buyZone ? `${fmtPrice(it.buyZone[0])} ~ ${fmtPrice(it.buyZone[1])}` : '不建议买入';
    const reasons = (it.reasons || []).map(r => `<span><b>✓</b>${esc(r)}</span>`).join('') +
      (it.risks || []).slice(0, 1).map(r => `<span class="warn"><b>!</b>${esc(r)}</span>`).join('');
    return `<article class="card" data-secid="${esc(it.secid)}">
      <div class="card-top">
        <div>
          <div class="stock-name">${esc(it.name)}<span class="code">${esc(it.code)}</span></div>
          <div class="sub">${esc(it.industry || '—')} · 现价 ${fmtPrice(it.price)}
            ${it.stale ? '<span class="badge-stale">昨收</span>' : ''}
            <span class="${clsPct(it.pct)}" style="margin-left:6px">${fmtPct(it.pct)}</span>
          </div>
        </div>
        <div class="score-ring" style="--score:${it.score};--ring:${ringColor(it.score)}">
          <div class="score-inner"><b>${it.score}</b><em>分</em></div>
        </div>
      </div>
      <div class="tags">
        <span class="tag gold">${esc(it.grade)}</span>
        ${(it.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
      </div>
      <div class="spark">${sparkSVG(it.spark)}</div>
      <div class="chg-row">
        <span>5 日 <b class="${clsPct(it.chg5)}">${fmtPct(it.chg5)}</b></span>
        <span>20 日 <b class="${clsPct(it.chg20)}">${fmtPct(it.chg20)}</b></span>
        <span>盈亏比 <b>${it.rr || '—'}</b></span>
      </div>
      <div class="plan-grid">
        <div><label>买入区间</label><b>${buyTxt}</b></div>
        <div><label>止损位</label><b class="down">${fmtPrice(it.stop)}</b></div>
        <div><label>目标位</label><b class="up">${fmtPrice(it.target1)}</b></div>
      </div>
      <p class="summary">${esc(it.action)} · ${esc(it.summary)}</p>
      <div class="reason-list">${reasons}</div>
      <div class="card-actions">
        <button class="btn small" data-act="detail" data-secid="${esc(it.secid)}" data-name="${esc(it.name)}">查看走势</button>
        <button class="btn small ghost" data-act="watch" data-secid="${esc(it.secid)}" data-code="${esc(it.code)}" data-name="${esc(it.name)}">+ 自选</button>
        <button class="btn small ghost" data-act="buy" data-secid="${esc(it.secid)}" data-name="${esc(it.name)}" data-price="${it.price}">记录买入</button>
      </div>
    </article>`;
  }).join('');
}

/* ----------------------------- 持仓 ----------------------------- */

function adviceFor(plan, price) {
  if (!plan) return { cls: 'adv-hold', tag: '分析中', text: '—' };
  if (price != null && price < plan.stop) {
    return { cls: 'adv-stop', tag: '止损', text: `现价低于止损位 ${fmtPrice(plan.stop)}` };
  }
  if (plan.trendCode === 'bear') {
    return { cls: 'adv-stop', tag: '减仓', text: '空头趋势，反弹减仓' };
  }
  if (plan.buyZone && price != null && price >= plan.buyZone[0] && price <= plan.buyZone[1]) {
    return { cls: 'adv-buy', tag: '可加仓', text: `回踩买区 ${fmtPrice(plan.buyZone[0])}~${fmtPrice(plan.buyZone[1])}` };
  }
  if (price != null && price >= plan.target1) {
    return { cls: 'adv-reduce', tag: '止盈', text: `已达目标位 ${fmtPrice(plan.target1)}` };
  }
  return { cls: 'adv-hold', tag: '持有', text: plan.action };
}

async function loadPositions() {
  const body = document.getElementById('posBody');
  const empty = document.getElementById('posEmpty');
  const summary = document.getElementById('posSummary');
  updateCounts();

  if (!state.positions.length) {
    body.innerHTML = '';
    summary.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const secids = [...new Set(state.positions.map(p => p.secid))];
  summary.innerHTML = '<div class="stat-card skeleton" style="height:84px"></div>'.repeat(4);

  let quoteMap = {};
  try {
    const d = await api('/api/quotes', { secids: secids.join(',') });
    (d.quotes || []).forEach(q => { quoteMap[q.secid] = q; });
  } catch (e) { /* 行情失败时退回上次缓存 */ }

  const planMap = {};
  const metaMap = {};
  const targets = secids.slice(0, 12);
  const settled = await Promise.allSettled(targets.map(s => api('/api/analyze', { secid: s, klt: 101 })));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value && r.value.plan) {
      planMap[targets[i]] = r.value.plan;
      metaMap[targets[i]] = r.value.meta;
    }
  });

  let totalCost = 0, totalValue = 0, dayPnl = 0;
  const rows = state.positions.map((p, idx) => {
    const q = quoteMap[p.secid] || {};
    const plan = planMap[p.secid];
    const meta = metaMap[p.secid];
    const price = q.price != null ? q.price : (meta ? meta.price : p.cost);
    const cost = p.cost, qty = p.qty;
    const value = (price != null ? price : cost) * qty;
    totalCost += cost * qty;
    totalValue += value;
    if (price != null && q.prevClose != null) dayPnl += (price - q.prevClose) * qty;

    const pnl = price != null ? (price - cost) * qty : null;
    const pnlPct = price != null ? (price / cost - 1) * 100 : null;
    const advice = adviceFor(plan, price);
    const trendTxt = plan ? `${plan.trend} · ${plan.score}分` : '—';

    return `<tr>
      <td>
        <div class="cell-stock" data-secid="${esc(p.secid)}" data-name="${esc(p.name)}">
          <span class="cs-name">${esc(p.name)}</span>
          <span class="cs-code">${esc(p.code)}${p.date ? ' · 买入 ' + esc(p.date) : ''}</span>
        </div>
      </td>
      <td class="num">
        <b>${fmtPrice(cost)}</b>
        <span style="color:#8ea0b8"> / ${fmtPrice(price)}</span>
      </td>
      <td class="num">${qty}</td>
      <td class="num">
        <b class="${clsPct(pnl)}">${pnl == null ? '—' : (pnl > 0 ? '+' : '') + pnl.toFixed(2)}</b>
        <div class="${clsPct(pnlPct)}" style="font-size:11px">${fmtPct(pnlPct)}</div>
      </td>
      <td>${esc(trendTxt)}</td>
      <td>
        <span class="advice ${advice.cls}">${esc(advice.tag)}</span>
        <div style="font-size:11px;color:#8ea0b8;margin-top:4px">${esc(advice.text)}</div>
        ${plan ? `<div style="font-size:11px;color:#8ea0b8">止损 ${fmtPrice(plan.stop)} · 目标 ${fmtPrice(plan.target1)}</div>` : ''}
      </td>
      <td class="num">
        <div class="row-actions">
          <button class="btn small" data-act="detail" data-secid="${esc(p.secid)}" data-name="${esc(p.name)}">走势</button>
          <button class="btn small ghost" data-act="delpos" data-idx="${idx}">删除</button>
        </div>
      </td>
    </tr>`;
  });

  const pnl = totalValue - totalCost;
  const pnlPct = totalCost ? pnl / totalCost * 100 : 0;
  summary.innerHTML = `
    <div class="stat-card"><label>持仓市值</label><b>¥ ${fmtAmount(totalValue)}</b></div>
    <div class="stat-card"><label>浮动盈亏</label><b class="${clsPct(pnl)}">${fmtPnl(pnl)}</b><small class="${clsPct(pnlPct)}">${fmtPct(pnlPct)}</small></div>
    <div class="stat-card"><label>今日盈亏</label><b class="${clsPct(dayPnl)}">${fmtPnl(dayPnl)}</b></div>
    <div class="stat-card"><label>持仓标的</label><b>${state.positions.length}</b><small>笔 · ${secids.length} 只</small></div>`;

  body.innerHTML = rows.join('');
}

/* ----------------------------- 个股详情 ----------------------------- */

async function openDetail(secid, name) {
  stopRtPoll();
  state.detail.secid = secid;
  state.detail.name = name || '';
  state.detail.data = null;
  state.detail.intraday = null;
  state.detail.klt = 101;  // 默认日 K（分时 tab 仍是 klt=0）
  state.hover = -1;
  setView('detail');
  document.getElementById('kltTabs').querySelectorAll('.chart-tab').forEach(t =>
    t.classList.toggle('is-active', t.dataset.klt === '101'));
  document.getElementById('chartLegend').classList.remove('hidden');
  document.getElementById('intradayLegend').classList.add('hidden');
  document.getElementById('rtDot').classList.add('off');
  document.getElementById('detailTitle').innerHTML =
    `<span class="dt-name">${esc(name || '加载中…')}</span><span class="dt-code">${esc(secid.split('.')[1] || '')}</span>`;
  document.getElementById('planBox').innerHTML = '<div class="skeleton h180"></div>';
  document.getElementById('reasonBox').innerHTML = '';
  document.getElementById('signalBox').innerHTML = '';
  document.getElementById('chartEmpty').classList.remove('hidden');
  document.getElementById('chartEmpty').textContent = '加载日 K 线…';
  clearCanvas();

  // 先加载日 K 分析（右侧计划），同时按当前 tab 类型加载对应图表
  try {
    await loadDetailData();
  } catch (e) {
    // loadDetailData 内部已处理错误提示
  }
}

async function loadDetailData() {
  const { secid, klt } = state.detail;
  if (!secid) return;

  // 分时模式：先确保有基础分析数据（右侧计划用日 K），再拉分时
  if (klt === 0) {
    stopRtPoll();
    // 如果还没有日 K 分析，先加载日 K（用于右侧计划和昨收参考价）
    if (!state.detail.data || !state.detail.data.plan) {
      await loadAnalysis(secid, 101);
    }
    await loadIntraday();
    return;
  }

  stopRtPoll();
  await loadAnalysis(secid, klt);
}

async function loadAnalysis(secid, klt) {
  const token = ++state.detail.token;
  const key = secid + ':' + klt;
  const cached = state.analysisCache[key];
  let data = cached && Date.now() - cached.t < 45000 ? cached.v : null;

  if (!data) {
    try {
      data = await api('/api/analyze', { secid, klt });
      state.analysisCache[key] = { t: Date.now(), v: data };
    } catch (e) {
      if (token !== state.detail.token) return;
      document.getElementById('chartEmpty').classList.remove('hidden');
      document.getElementById('chartEmpty').textContent = '分析失败：' + e.message;
      document.getElementById('planBox').innerHTML =
        `<div class="error-box">分析失败：${esc(e.message)}</div>`;
      return;
    }
  }
  if (token !== state.detail.token) return;

  state.detail.data = data;
  state.detail.name = data.meta.name;
  document.getElementById('chartEmpty').classList.add('hidden');
  renderDetailHeader(data);
  renderPlan(data.plan);
  renderReason(data.plan);
  renderSignals(data.signals);
  syncWatchButton();
  drawChart();
}

async function loadIntraday() {
  const { secid } = state.detail;
  if (!secid) return;
  const token = ++state.detail.token;
  const planData = state.detail.data;  // 日 K 分析，用于昨收价参考

  document.getElementById('chartLegend').classList.add('hidden');
  document.getElementById('intradayLegend').classList.remove('hidden');

  const run = async () => {
    try {
      const d = await api('/api/intraday', { secid });
      if (token !== state.detail.token || state.detail.klt !== 0) return;
      state.detail.intraday = d;
      if (planData && planData.quote && planData.quote.prevClose && !d.preClose) {
        d.preClose = planData.quote.prevClose;
      }
      document.getElementById('chartEmpty').classList.add('hidden');
      renderDetailHeaderFromIntraday(d, planData);
      drawChart();
      // 决定是否继续轮询
      if (isTradingHours()) {
        document.getElementById('rtDot').classList.remove('off');
        scheduleNextPoll();
      } else {
        document.getElementById('rtDot').classList.add('off');
        toast('非交易时段，已使用最近快照');
      }
    } catch (e) {
      if (token !== state.detail.token) return;
      document.getElementById('chartEmpty').classList.remove('hidden');
      document.getElementById('chartEmpty').textContent = '分时加载失败：' + e.message;
    }
  };
  await run();
}

function renderDetailHeaderFromIntraday(d, planData) {
  const rows = d.rows || [];
  const last = rows[rows.length - 1];
  const prevClose = d.preClose || (planData && planData.quote && planData.quote.prevClose) || last.price;
  const price = last ? last.price : (planData && planData.quote && planData.quote.price);
  const pct = prevClose && price ? (price / prevClose - 1) * 100 : null;
  const cumAmount = last ? last.cumAmount : (planData && planData.quote && planData.quote.amount);
  const cumVol = last ? last.cumVolume : null;
  const code = d.code || (planData && planData.meta ? planData.meta.code : state.detail.secid.split('.')[1]);
  const name = d.name || (planData && planData.meta ? planData.meta.name : state.detail.name);
  const highP = rows.length ? Math.max(...rows.map(r => r.price)) : price;
  const lowP = rows.length ? Math.min(...rows.map(r => r.price)) : price;
  document.getElementById('detailTitle').innerHTML = `
    <span class="dt-name">${esc(name)}</span>
    <span class="dt-code">${esc(code)} · 分时</span>
    <span class="dt-price ${clsPct(pct)}">${fmtPrice(price)}</span>
    <span class="dt-chg ${clsPct(pct)}">${fmtPct(pct)}</span>
    <div class="dt-meta">
      <span>均价 ${fmtPrice(last ? last.avg : null)}</span>
      <span>最高 ${fmtPrice(highP)}</span>
      <span>最低 ${fmtPrice(lowP)}</span>
      <span>昨收 ${fmtPrice(prevClose)}</span>
      <span>成交额 ${fmtAmount(cumAmount)}</span>
      <span>成交量 ${cumVol ? fmtVol(cumVol) : '—'}</span>
    </div>`;
}

function renderDetailHeader(d) {
  const q = d.quote || {};
  const m = d.meta || {};
  const pct = m.pct != null ? m.pct : q.pct;
  document.getElementById('detailTitle').innerHTML = `
    <span class="dt-name">${esc(m.name)}</span>
    <span class="dt-code">${esc(m.code)} · ${esc(m.lastDate)}${q.stale ? ' 收盘' : ''}</span>
    <span class="dt-price ${clsPct(pct)}">${fmtPrice(m.price)}</span>
    <span class="dt-chg ${clsPct(pct)}">${fmtPct(pct)}</span>
    <div class="dt-meta">
      <span>今开 ${fmtPrice(q.open)}</span>
      <span>最高 ${fmtPrice(q.high)}</span>
      <span>最低 ${fmtPrice(q.low)}</span>
      <span>成交额 ${fmtAmount(q.amount)}</span>
      <span>换手 ${q.turnover == null ? '—' : fmtPct(q.turnover).replace('+', '')}</span>
      <span>流通市值 ${fmtAmount(q.floatMcap)}</span>
      <span>PE ${q.pe == null ? '—' : q.pe.toFixed(1)}</span>
      <span>PB ${q.pb == null ? '—' : q.pb.toFixed(2)}</span>
    </div>`;
}

function renderPlan(plan) {
  const actionCls = plan.actionCode === 'avoid' ? 'stop' : (plan.actionCode === 'range' ? 'avoid' : '');
  const ring = ringColor(plan.score);
  const support = (plan.support || []).map((v, i) =>
    `<div class="level-row"><span>支撑 ${i + 1}</span><b>${fmtPrice(v)}</b></div>`).join('');
  const resistance = (plan.resistance || []).map((v, i) =>
    `<div class="level-row"><span>压力 ${i + 1}</span><b>${fmtPrice(v)}</b></div>`).join('');

  document.getElementById('planBox').innerHTML = `
    <div class="plan-head">
      <div class="plan-score">
        <span class="num" style="color:${ring}">${plan.score}</span>
        <span class="lbl">技术面评分<br>满分 100</span>
      </div>
      <span class="trend-badge ${esc(plan.trendCode)}">${esc(plan.trend)}</span>
    </div>
    <div class="action-line ${actionCls}">${esc(plan.action)}</div>
    <div class="plan-table">
      <div class="plan-row"><span class="k">买入区间</span><span class="v">${plan.buyZone ? fmtPrice(plan.buyZone[0]) + ' ~ ' + fmtPrice(plan.buyZone[1]) : '不建议买入'}</span></div>
      <div class="plan-row"><span class="k">止损位</span><span class="v down">${fmtPrice(plan.stop)}</span></div>
      <div class="plan-row"><span class="k">目标位 1</span><span class="v up">${fmtPrice(plan.target1)}</span></div>
      <div class="plan-row"><span class="k">目标位 2</span><span class="v up">${fmtPrice(plan.target2)}</span></div>
      <div class="plan-row"><span class="k">盈亏比</span><span class="v">${plan.rr || '—'}</span></div>
      <div class="plan-row"><span class="k">ATR 波动率</span><span class="v">${plan.atrPct}%</span></div>
    </div>
    <div class="levels" style="margin-top:12px">
      ${support}${resistance}
    </div>
    <p class="summary" style="margin-top:12px">${esc(plan.summary)}</p>`;
}

function renderReason(plan) {
  const box = document.getElementById('reasonBox');
  const pos = (plan.reasons || []).map(r => `<span><b>✓</b>${esc(r)}</span>`).join('');
  const neg = (plan.risks || []).map(r => `<span class="warn"><b>!</b>${esc(r)}</span>`).join('');
  if (!pos && !neg) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = `<h3 class="side-title">信号依据</h3><div class="reason-list">${pos}${neg}</div>`;
}

function renderSignals(signals) {
  const box = document.getElementById('signalBox');
  const list = (signals || []).slice(-8).reverse();
  if (!list.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = '';
  box.innerHTML = `<h3 class="side-title">历史 B / S 点 <em>最近 8 个</em></h3>
    <div class="sig-list">
      ${list.map(s => `<div class="sig-row">
        <span class="sig-badge ${s.type}">${s.type}</span>
        <span class="sig-date">${esc(s.d)}</span>
        <span class="sig-reason">${esc(s.reason)}</span>
        <span class="sig-price">${fmtPrice(s.price)}</span>
      </div>`).join('')}
    </div>`;
}

function syncWatchButton() {
  const btn = document.getElementById('watchToggle');
  if (!btn) return;
  const inList = state.watch.some(w => w.secid === state.detail.secid);
  btn.textContent = inList ? '★ 已自选' : '☆ 加自选';
  btn.dataset.in = inList ? '1' : '0';
}

/* ----------------------------- K 线绘制 ----------------------------- */

const CHART_COLORS = {
  up: '#f6465d', down: '#25c08b', grid: 'rgba(255,255,255,.055)',
  text: '#8ea0b8', ma5: '#e8edf5', ma10: '#f5b942', ma20: '#4d8dff',
  ma60: '#b06bff', accent: '#4d8dff', gold: '#f5b942', warn: '#ff7a59',
};
let chartGeom = null;

function clearCanvas() {
  const cv = document.getElementById('chart');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
}

function isTradingHours() {
  const d = new Date();
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  const h = d.getHours(), m = d.getMinutes();
  const t = h * 60 + m;
  // 09:30-11:30 = 570-690, 13:00-15:00 = 780-900
  return (t >= 570 && t <= 690) || (t >= 780 && t <= 900);
}

function scheduleNextPoll() {
  stopRtPoll();
  if (!isTradingHours()) return;
  state.rtPoll.running = true;
  state.rtPoll.timer = setTimeout(async () => {
    if (state.view !== 'detail' || state.detail.klt !== 0 || !state.detail.secid) {
      state.rtPoll.running = false; return;
    }
    try {
      const d = await api('/api/intraday', { secid: state.detail.secid });
      state.detail.intraday = d;
      if (state.detail.data && state.detail.data.quote && state.detail.data.quote.prevClose && !d.preClose) {
        d.preClose = state.detail.data.quote.prevClose;
      }
      renderDetailHeaderFromIntraday(d, state.detail.data);
      drawChart();
      scheduleNextPoll();
    } catch (e) {
      // 失败退避 10 秒
      state.rtPoll.timer = setTimeout(scheduleNextPoll, 10000);
    }
  }, 5000);
}

function stopRtPoll() {
  if (state.rtPoll.timer) { clearTimeout(state.rtPoll.timer); state.rtPoll.timer = null; }
  state.rtPoll.running = false;
}

function drawIntraday() {
  const cv = document.getElementById('chart');
  const wrap = document.getElementById('chartWrap');
  if (!cv || !wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;

  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const data = state.detail.intraday;
  const rows = (data && data.rows) || [];
  if (!rows.length) {
    document.getElementById('chartEmpty').classList.remove('hidden');
    document.getElementById('chartEmpty').textContent = '今日暂无分时数据';
    return;
  }
  document.getElementById('chartEmpty').classList.add('hidden');

  const padL = 8, padR = 62, padT = 12, padB = 22;
  const plotW = W - padL - padR;
  const priceH = (H - padT - padB) * 0.72;
  const volTop = padT + priceH + 10;
  const volH = H - padB - volTop - 2;

  // 用昨收价做上下对称；如果没昨收，用第一根 price
  const prevClose = data.preClose || rows[0].price;
  let lo = Infinity, hi = -Infinity, maxVol = 0;
  rows.forEach(r => {
    lo = Math.min(lo, r.price); hi = Math.max(hi, r.price);
    maxVol = Math.max(maxVol, r.volume || 0);
  });
  // 基于昨收价的上下区间，上下对称 8%
  const baseRange = Math.max(prevClose * 0.08, hi - prevClose, prevClose - lo);
  lo = Math.min(lo, prevClose - baseRange);
  hi = Math.max(hi, prevClose + baseRange);

  const n = rows.length;
  const xOf = i => padL + i / Math.max(1, n - 1) * plotW;
  const yOf = p => padT + (hi - p) / (hi - lo) * priceH;

  // 横向网格 + 价格
  ctx.strokeStyle = CHART_COLORS.grid; ctx.lineWidth = 1;
  ctx.font = '10px "PingFang SC", sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = padT + priceH * i / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    const price = hi - (hi - lo) * i / 4;
    const pct = ((price / prevClose) - 1) * 100;
    ctx.fillStyle = pct >= 0 ? '#f6465d' : '#25c08b';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(price) + ' ' + fmtPct(pct).replace('+', ''), padL + plotW + 6, y + 3.5);
  }

  // 昨收参考线
  const y0 = yOf(prevClose);
  ctx.strokeStyle = 'rgba(142,160,184,.5)';
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + plotW, y0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#8ea0b8'; ctx.textAlign = 'right';
  ctx.fillText('昨收 ' + fmtPrice(prevClose), padL + plotW - 4, y0 - 3);

  // 午休分割
  const lunchIdx = rows.findIndex(r => r.time === '13:00' || (r.t && r.t.includes('13:00')));
  if (lunchIdx > 0) {
    const x = xOf(lunchIdx);
    ctx.strokeStyle = 'rgba(142,160,184,.25)'; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + priceH); ctx.stroke();
    ctx.setLineDash([]);
  }

  // 成交量柱
  const bw = Math.max(2, plotW / n * 0.7);
  rows.forEach((r, i) => {
    if (i === 0) return;
    const up = r.price >= rows[i - 1].price;
    const h = (r.volume || 0) / maxVol * volH;
    ctx.fillStyle = up ? 'rgba(246,70,93,.55)' : 'rgba(37,192,139,.5)';
    ctx.fillRect(xOf(i) - bw / 2, volTop + volH - h, bw, h);
  });

  // 价格填充
  const points = rows.map((r, i) => [xOf(i), yOf(r.price)]);
  if (points.length >= 2) {
    const grad = ctx.createLinearGradient(0, padT, 0, padT + priceH);
    grad.addColorStop(0, 'rgba(77,141,255,.28)');
    grad.addColorStop(1, 'rgba(77,141,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0][0], padT + priceH);
    points.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(points[points.length - 1][0], padT + priceH);
    ctx.closePath(); ctx.fill();

    // 价格线
    const lastPrice = rows[n - 1].price;
    const lineColor = lastPrice >= prevClose ? '#f6465d' : '#25c08b';
    ctx.strokeStyle = lineColor; ctx.lineWidth = 1.8;
    ctx.beginPath();
    points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    // 最后一点高亮
    const lx = points[n - 1][0], ly = points[n - 1][1];
    ctx.fillStyle = lineColor;
    ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  // 均价线
  const avgPts = rows.map((r, i) => r.avg != null ? [xOf(i), yOf(r.avg)] : null);
  ctx.strokeStyle = '#f5b942'; ctx.lineWidth = 1.3;
  ctx.beginPath(); let started = false;
  avgPts.forEach(pt => {
    if (!pt) { started = false; return; }
    if (!started) { ctx.moveTo(pt[0], pt[1]); started = true; } else ctx.lineTo(pt[0], pt[1]);
  });
  ctx.stroke();

  // 日期/时段标签
  ctx.fillStyle = '#8ea0b8'; ctx.font = '10px "PingFang SC", sans-serif'; ctx.textAlign = 'center';
  const labels = ['09:30', '10:30', '11:30', '13:00', '14:00', '15:00'];
  // 映射 label 到 rows 索引
  const idxOf = t => rows.findIndex(r => r.time === t);
  labels.forEach(t => {
    const i = idxOf(t);
    if (i > 0) {
      ctx.fillText(t, xOf(i), H - 8);
    }
  });
  // 如果没找到，强制在首尾/午休处加
  if (lunchIdx > 0) {
    ctx.fillText('13:00', xOf(lunchIdx), H - 8);
  }
  if (n > 0) {
    ctx.fillText(rows[0].time, xOf(0), H - 8);
    ctx.fillText(rows[n - 1].time, xOf(n - 1), H - 8);
  }

  // 十字光标提示
  if (state.hover >= 0 && state.hover < n) {
    const i = state.hover;
    const x = xOf(i);
    const y = yOf(rows[i].price);
    ctx.strokeStyle = 'rgba(200,215,235,.3)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + priceH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(233,239,248,.95)';
    ctx.fillRect(padL + plotW + 4, y - 8, 54, 16);
    ctx.fillStyle = '#0b1017'; ctx.font = '10px "PingFang SC", sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(rows[i].price), padL + plotW + 8, y + 3.5);
  }

  // 保存几何给 hover
  chartGeom = { padL, padR, padT, padB, plotW, priceH, volTop, volH, start: 0, count: n, bw: plotW / Math.max(1, n - 1), W, H, hi, lo, intraday: true };
}

function drawChart() {
  // 分发：分时 vs K 线
  if (state.detail.klt === 0) return drawIntraday();

  const cv = document.getElementById('chart');
  const wrap = document.getElementById('chartWrap');
  if (!cv || !wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return;

  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';

  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const data = state.detail.data;
  if (!data) { chartGeom = null; return; }

  const s = data.series;
  const plan = data.plan;
  const n = s.date.length;
  const padL = 8, padR = 74, padT = 10, padB = 22;
  const plotW = W - padL - padR;
  const priceH = (H - padT - padB) * 0.74;
  const volTop = padT + priceH + 12;
  const volH = H - padB - volTop - 2;

  const maxBars = Math.max(50, Math.floor(plotW / 4.4));
  const start = Math.max(0, n - maxBars);
  const count = n - start;
  const bw = plotW / count;

  let lo = Infinity, hi = -Infinity;
  for (let i = start; i < n; i++) {
    lo = Math.min(lo, s.l[i]);
    hi = Math.max(hi, s.h[i]);
  }
  ['ma5', 'ma10', 'ma20', 'ma60'].forEach(k => {
    for (let i = start; i < n; i++) {
      const v = s[k][i];
      if (v == null) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  });
  const close = s.c[n - 1];
  const extras = [plan.stop, plan.target1,
    plan.buyZone ? plan.buyZone[0] : null, plan.buyZone ? plan.buyZone[1] : null];
  extras.forEach(v => {
    if (v && v > close * 0.85 && v < close * 1.15) {
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  });
  const pad = (hi - lo) * 0.06 || close * 0.02;
  lo -= pad; hi += pad;

  const xOf = i => padL + (i - start) * bw + bw / 2;
  const yOf = p => padT + (hi - p) / (hi - lo) * priceH;

  // 横向网格
  ctx.strokeStyle = CHART_COLORS.grid;
  ctx.lineWidth = 1;
  ctx.font = '10px "PingFang SC", sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = padT + priceH * i / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    const price = hi - (hi - lo) * i / 4;
    ctx.fillStyle = CHART_COLORS.text;
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(price), padL + plotW + 7, y + 3.5);
  }

  // 成交量区域分割
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.beginPath();
  ctx.moveTo(padL, volTop - 5);
  ctx.lineTo(padL + plotW, volTop - 5);
  ctx.stroke();

  // 买区色带
  if (plan.buyZone) {
    const y1 = yOf(plan.buyZone[1]);
    const y2 = yOf(plan.buyZone[0]);
    ctx.fillStyle = 'rgba(77,141,255,.09)';
    ctx.fillRect(padL, y1, plotW, Math.max(1, y2 - y1));
    ctx.strokeStyle = 'rgba(77,141,255,.28)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(padL, y1, plotW, Math.max(1, y2 - y1));
    ctx.setLineDash([]);
  }

  // 关键价位
  const drawLevel = (price, color, label) => {
    if (!price || price > hi || price < lo) return;
    const y = yOf(price);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label + ' ' + fmtPrice(price), padL + plotW + 6, y + 3.5);
  };
  drawLevel(plan.stop, CHART_COLORS.down, '止损');
  drawLevel(plan.target1, CHART_COLORS.gold, '目标');
  drawLevel(plan.support && plan.support[0], 'rgba(142,160,184,.5)', '支撑');
  drawLevel(plan.resistance && plan.resistance[0], 'rgba(142,160,184,.5)', '压力');

  // 蜡烛
  const bodyW = Math.max(2, Math.min(bw * 0.66, 9));
  for (let i = start; i < n; i++) {
    const x = xOf(i);
    const up = s.c[i] >= s.o[i];
    const color = up ? CHART_COLORS.up : CHART_COLORS.down;
    const yOpen = yOf(s.o[i]);
    const yClose = yOf(s.c[i]);
    const yHigh = yOf(s.h[i]);
    const yLow = yOf(s.l[i]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, Math.min(yOpen, yClose));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, yLow);
    ctx.lineTo(x, Math.max(yOpen, yClose));
    ctx.stroke();
    ctx.fillStyle = color;
    const top = Math.min(yOpen, yClose);
    const hgt = Math.max(1.2, Math.abs(yClose - yOpen));
    ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
  }

  // 均线
  const drawMA = (key, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let i = start; i < n; i++) {
      const v = s[key][i];
      if (v == null) { started = false; continue; }
      const x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  drawMA('ma5', CHART_COLORS.ma5);
  drawMA('ma10', CHART_COLORS.ma10);
  drawMA('ma20', CHART_COLORS.ma20);
  drawMA('ma60', CHART_COLORS.ma60);

  // 成交量
  let volMax = 0;
  for (let i = start; i < n; i++) volMax = Math.max(volMax, s.v[i]);
  volMax = volMax || 1;
  const volBw = Math.max(1.5, bodyW);
  for (let i = start; i < n; i++) {
    const x = xOf(i);
    const up = s.c[i] >= s.o[i];
    const hgt = Math.max(1, s.v[i] / volMax * volH);
    ctx.fillStyle = up ? 'rgba(246,70,93,.45)' : 'rgba(37,192,139,.4)';
    ctx.fillRect(x - volBw / 2, volTop + volH - hgt, volBw, hgt);
  }
  // 量能均线
  ctx.strokeStyle = 'rgba(245,185,66,.65)';
  ctx.beginPath();
  let startedVol = false;
  for (let i = start; i < n; i++) {
    const v = s.vma5[i];
    if (v == null) { startedVol = false; continue; }
    const x = xOf(i);
    const y = volTop + volH - Math.min(v / volMax, 1) * volH;
    if (!startedVol) { ctx.moveTo(x, y); startedVol = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // B / S 标记
  (data.signals || []).forEach(sig => {
    const i = sig.i;
    if (i < start || i >= n) return;
    const x = xOf(i);
    const isBuy = sig.type === 'B';
    const baseY = isBuy ? yOf(s.l[i]) + 13 : yOf(s.h[i]) - 13;
    const y = Math.max(padT + 9, Math.min(padT + priceH - 9, baseY));
    const r = 8.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isBuy ? 'rgba(246,70,93,.9)' : 'rgba(37,192,139,.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sig.type, x, y + 0.5);
  });
  ctx.textBaseline = 'alphabetic';

  // 日期刻度
  const tickCount = Math.min(5, count);
  ctx.fillStyle = CHART_COLORS.text;
  ctx.font = '10px "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  for (let k = 0; k < tickCount; k++) {
    const i = start + Math.round((count - 1) * k / Math.max(1, tickCount - 1));
    const label = s.date[i].replace(/ .*/, '').slice(5);
    const x = Math.max(padL + 14, Math.min(padL + plotW - 14, xOf(i)));
    ctx.fillText(label, x, H - 8);
  }

  // 十字光标
  if (state.hover >= start && state.hover < n) {
    const i = state.hover;
    const x = xOf(i);
    const y = yOf(s.c[i]);
    ctx.strokeStyle = 'rgba(200,215,235,.35)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, H - padB);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(233,239,248,.95)';
    ctx.fillRect(padL + plotW + 4, y - 8, 54, 16);
    ctx.fillStyle = '#0b1017';
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(s.c[i]), padL + plotW + 8, y + 3.5);
  }

  chartGeom = { padL, padR, padT, padB, plotW, priceH, volTop, volH, start, count, bw, W, H, hi, lo };
}

function bindChartHover() {
  const cv = document.getElementById('chart');
  const wrap = document.getElementById('chartWrap');
  const tip = document.getElementById('chartTip');

  const indexAt = clientX => {
    if (!chartGeom) return -1;
    const rect = cv.getBoundingClientRect();
    const x = clientX - rect.left;
    const g = chartGeom;
    if (x < g.padL || x > g.padL + g.plotW) return -1;
    const i = g.start + Math.floor((x - g.padL) / g.bw);
    return Math.max(g.start, Math.min(g.start + g.count - 1, i));
  };

  cv.addEventListener('mousemove', ev => {
    const g = chartGeom;
    if (!g) return;
    const i = indexAt(ev.clientX);
    if (i < 0) { hideTip(); state.hover = -1; drawChart(); return; }
    if (i !== state.hover) { state.hover = i; drawChart(); }

    let html;
    if (g.intraday) {
      const d = state.detail.intraday;
      const row = d.rows[i];
      const prev = i > 0 ? d.rows[i - 1].price : d.preClose || row.price;
      const chg = prev ? (row.price / prev - 1) * 100 : 0;
      const cumPct = d.preClose ? (row.price / d.preClose - 1) * 100 : 0;
      html = `<b>${esc(row.t)}</b><br>
        价格 <b class="${clsPct(chg)}">${fmtPrice(row.price)}</b>（${fmtPct(chg)}）<br>
        均价 ${fmtPrice(row.avg)}　涨跌 ${fmtPct(cumPct)}<br>
        单笔量 ${fmtVol(row.volume)}　累计量 ${fmtVol(row.cumVolume)}<br>
        累计额 ${fmtAmount(row.cumAmount)}`;
    } else {
      const data = state.detail.data;
      if (!data) { hideTip(); return; }
      const s = data.series;
      const prev = i > 0 ? s.c[i - 1] : s.o[i];
      const chg = prev ? (s.c[i] / prev - 1) * 100 : 0;
      html = `<b>${esc(s.date[i])}</b><br>
        开 ${fmtPrice(s.o[i])}　高 ${fmtPrice(s.h[i])}<br>
        低 ${fmtPrice(s.l[i])}　收 <b class="${clsPct(chg)}">${fmtPrice(s.c[i])}</b>（${fmtPct(chg)}）<br>
        量 ${fmtVol(s.v[i])}　MA5 ${fmtPrice(s.ma5[i])}<br>
        MA20 ${fmtPrice(s.ma20[i])}　RSI ${s.rsi[i] == null ? '—' : s.rsi[i].toFixed(1)}`;
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const rect = wrap.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const left = x > rect.width - 210 ? x - 196 : x + 16;
    tip.style.left = Math.max(6, left) + 'px';
    tip.style.top = '14px';
  });

  cv.addEventListener('mouseleave', () => {
    state.hover = -1;
    hideTip();
    drawChart();
  });

  function hideTip() {
    tip.classList.add('hidden');
  }
}

/* ----------------------------- 弹窗：记录买入 ----------------------------- */

function openModal(secid, info) {
  const modal = document.getElementById('modal');
  state.modal = { secid: null, name: '', code: '', price: null };
  document.getElementById('modalSearch').value = '';
  document.getElementById('modalSearchDrop').classList.add('hidden');
  document.getElementById('mCost').value = '';
  document.getElementById('mQty').value = 100;

  if (secid) {
    fillModalStock({
      secid,
      code: info && info.code ? info.code : secid.split('.')[1],
      name: info && info.name ? info.name : '',
      price: info && info.price != null ? info.price : null,
    });
  } else {
    renderModalStock();
  }
  modal.classList.remove('hidden');
  if (!secid) setTimeout(() => document.getElementById('modalSearch').focus(), 50);
}

function fillModalStock(stock) {
  if (!stock || !stock.secid) return;
  state.modal = {
    secid: stock.secid,
    code: stock.code || stock.secid.split('.')[1],
    name: stock.name || '',
    price: stock.price != null ? Number(stock.price) : null,
  };
  renderModalStock();
  const cost = document.getElementById('mCost');
  if (!cost.value && state.modal.price != null) cost.value = Number(state.modal.price).toFixed(2);
}

function renderModalStock() {
  const box = document.getElementById('modalStock');
  const m = state.modal;
  if (!m.secid) {
    box.classList.remove('has');
    box.textContent = '请先搜索并选择一只股票';
    return;
  }
  box.classList.add('has');
  box.innerHTML = `<b>${esc(m.name || m.code)}</b> <span style="color:#8ea0b8">${esc(m.code)}</span>
    ${m.price != null ? `<span style="float:right;color:#8ea0b8">现价 ${fmtPrice(m.price)}</span>` : ''}`;
}

function confirmBuy() {
  const m = state.modal;
  if (!m.secid) { toast('请先选择股票'); return; }
  const cost = parseFloat(document.getElementById('mCost').value);
  const qty = parseInt(document.getElementById('mQty').value, 10);
  if (!(cost > 0)) { toast('请输入有效买入价'); return; }
  if (!(qty > 0)) { toast('请输入有效数量'); return; }

  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  state.positions.unshift({
    secid: m.secid,
    code: m.code,
    name: m.name || m.code,
    cost,
    qty,
    date,
  });
  savePositions();
  updateCounts();
  document.getElementById('modal').classList.add('hidden');
  toast(`已记录买入 ${m.name || m.code} ${qty} 股 @ ${cost}`);
  setView('positions');
}

/* ----------------------------- 事件绑定 ----------------------------- */

function bindEvents() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadMarket();
    loadRecommend(true);
    if (state.view === 'watch') loadWatch();
    if (state.view === 'positions') loadPositions();
    if (state.view === 'detail') loadDetailData();
    toast('已刷新');
  });
  document.getElementById('recRefresh').addEventListener('click', () => loadRecommend(true));
  document.getElementById('watchRefresh').addEventListener('click', loadWatch);
  document.getElementById('posRefresh').addEventListener('click', loadPositions);
  document.getElementById('addPosBtn').addEventListener('click', () => openModal(null));

  // 荐股卡片
  document.getElementById('recGrid').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-act]');
    const card = ev.target.closest('.card');
    if (!card) return;
    const secid = card.dataset.secid;
    if (!btn) {
      const nameEl = card.querySelector('.stock-name');
      const name = nameEl ? (nameEl.childNodes[0].textContent || '').trim() : '';
      openDetail(secid, name);
      return;
    }
    handleAction(btn, secid);
  });

  // 自选 / 持仓 / 详情 通用操作
  document.body.addEventListener('click', ev => {
    const btn = ev.target.closest('[data-act]');
    if (btn && !btn.closest('#recGrid')) {
      handleAction(btn, null);
      return;
    }
    const cell = ev.target.closest('.cell-stock');
    if (cell && cell.dataset.secid) {
      openDetail(cell.dataset.secid, cell.dataset.name || '');
    }
  });

  document.getElementById('backBtn').addEventListener('click', () => {
    setView(state.lastList || 'recommend');
  });

  document.getElementById('watchToggle').addEventListener('click', () => {
    const { secid, name, data } = state.detail;
    if (!secid) return;
    if (state.watch.some(w => w.secid === secid)) {
      removeWatch(secid);
      toast('已移出自选');
    } else {
      const code = data && data.meta ? data.meta.code : secid.split('.')[1];
      addWatch(secid, code, data && data.meta ? data.meta.name : name);
    }
    syncWatchButton();
  });

  document.getElementById('buyBtn').addEventListener('click', () => {
    const { secid, data } = state.detail;
    if (!secid) return;
    openModal(secid, {
      code: data && data.meta ? data.meta.code : secid.split('.')[1],
      name: data && data.meta ? data.meta.name : state.detail.name,
      price: data && data.quote ? data.quote.price : null,
    });
  });

  document.getElementById('kltTabs').addEventListener('click', ev => {
    const btn = ev.target.closest('[data-klt]');
    if (!btn) return;
    const klt = parseInt(btn.dataset.klt, 10);
    if (klt === state.detail.klt) return;
    state.detail.klt = klt;
    state.hover = -1;
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.toggle('is-active', t.dataset.klt === String(klt)));
    // 切换 legend
    const isIntraday = klt === 0;
    document.getElementById('chartLegend').classList.toggle('hidden', isIntraday);
    document.getElementById('intradayLegend').classList.toggle('hidden', !isIntraday);
    document.getElementById('chartEmpty').classList.remove('hidden');
    document.getElementById('chartEmpty').textContent = isIntraday ? '加载分时中…' : '加载 K 线中…';
    loadDetailData();
  });

  // 弹窗
  document.getElementById('modalCancel').addEventListener('click', () => {
    document.getElementById('modal').classList.add('hidden');
  });
  document.getElementById('modal').addEventListener('click', ev => {
    if (ev.target.id === 'modal') document.getElementById('modal').classList.add('hidden');
  });
  document.getElementById('modalOk').addEventListener('click', confirmBuy);
  document.getElementById('mCost').addEventListener('keydown', ev => {
    if (ev.key === 'Enter') confirmBuy();
  });
}

function handleAction(btn, fallbackSecid) {
  const act = btn.dataset.act;
  const secid = btn.dataset.secid || fallbackSecid;
  const name = btn.dataset.name || '';
  if (act === 'detail') {
    openDetail(secid, name);
  } else if (act === 'watch') {
    addWatch(secid, btn.dataset.code || secid.split('.')[1], name);
  } else if (act === 'unwatch') {
    removeWatch(secid);
  } else if (act === 'buy') {
    const price = btn.dataset.price ? parseFloat(btn.dataset.price) : null;
    openModal(secid, { code: secid.split('.')[1], name, price });
  } else if (act === 'delpos') {
    const idx = parseInt(btn.dataset.idx, 10);
    const p = state.positions[idx];
    if (!p) return;
    if (confirm(`删除持仓记录：${p.name} ${p.qty} 股？`)) {
      state.positions.splice(idx, 1);
      savePositions();
      updateCounts();
      loadPositions();
      toast('已删除持仓记录');
    }
  }
}

async function pickFromModalSearch(item) {
  try {
    const d = await api('/api/quotes', { secids: item.secid });
    const q = d.quotes && d.quotes[0];
    fillModalStock({
      secid: item.secid,
      code: item.code,
      name: item.name,
      price: q ? q.price : null,
    });
  } catch (e) {
    fillModalStock({ secid: item.secid, code: item.code, name: item.name, price: null });
  }
}

/* ----------------------------- 启动 ----------------------------- */

function init() {
  bindEvents();
  bindSearch('searchInput', 'searchDrop', item => openDetail(item.secid, item.name), true);
  bindSearch('modalSearch', 'modalSearchDrop', item => pickFromModalSearch(item), false);
  bindChartHover();
  updateCounts();
  startClock();
  loadMarket();
  loadRecommend();
  setInterval(() => {
    if (state.view === 'watch') loadWatch();
  }, 30000);
  setInterval(() => {
    if (state.view === 'positions') loadPositions();
  }, 60000);
  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (state.view === 'detail') drawChart();
    }, 150);
  });

  // PWA Service Worker 注册（生产环境 HTTPS 才生效）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('已有新版本可用，刷新即可更新');
            }
          });
        });
      }).catch(err => console.warn('SW 注册失败（可能非 HTTPS）', err));
    });
  }

  // 离线提示
  window.addEventListener('online', () => toast('网络已恢复'));
  window.addEventListener('offline', () => toast('已离线：仅可用缓存的自选和持仓'));
}

document.addEventListener('DOMContentLoaded', init);
