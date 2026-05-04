let currentUser     = null;
let clientId        = null;
let lineChart       = null;
let lastRefreshedAt = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = Auth.requireClient();
  if (!currentUser) return;

  clientId = currentUser.clientid || currentUser.clientId;

  showLoading('Loading your dashboard…');
  try {
    await DB.initForClient(clientId);
  } catch (e) {
    hideLoading();
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;color:#ef4444;font-size:14px;">Failed to load data — check your connection and reload.</div>`;
    return;
  }
  hideLoading();

  document.getElementById('client-av').textContent       = currentUser.name[0].toUpperCase();
  document.getElementById('client-name-s').textContent   = currentUser.name;
  document.getElementById('welcome-heading').textContent = `Welcome back, ${currentUser.name.split(' ')[0]}`;
  document.getElementById('hero-greeting').textContent   = `${currentUser.name.split(' ')[0]}'s Performance`;

  lastRefreshedAt = new Date();
  updateSyncLabel();
  render();
  bindNav();

  document.getElementById('deals-search').addEventListener('input', applyFilters);
  document.getElementById('deals-status').addEventListener('change', applyFilters);

  setInterval(doRefresh, 30000);
  setInterval(updateSyncLabel, 10000);
});

// ── NAVIGATION ────────────────────────────────────────────────
const TAB_META = {
  overview: { title: 'Overview',  sub: 'Here\'s how your business is performing' },
  deals:    { title: 'My Deals',  sub: 'All deals on your account' },
};

function bindNav() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(el =>
    el.addEventListener('click', () => switchTab(el.dataset.tab)));
}

function switchTab(tab) {
  document.querySelectorAll('.nav-link[data-tab]').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
  ['overview', 'deals'].forEach(t =>
    document.getElementById('panel-' + t).style.display = t === tab ? 'block' : 'none');
  const m = TAB_META[tab] || {};
  document.getElementById('welcome-heading').textContent = m.title || '';
  document.getElementById('welcome-sub').textContent     = m.sub   || '';
  if (tab === 'deals') renderDealsTable(DealHelper.forClient(clientId));
}

// ── AUTO REFRESH ──────────────────────────────────────────────
async function doRefresh() {
  const btn = document.getElementById('client-sync-btn');
  if (btn) btn.classList.add('spinning');
  try {
    await DB.refreshDeals();
    lastRefreshedAt = new Date();
    render();
    updateSyncLabel();
  } catch (_) {
    // silent
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function updateSyncLabel() {
  const el = document.getElementById('last-updated');
  if (!el || !lastRefreshedAt) return;
  const secs = Math.round((Date.now() - lastRefreshedAt) / 1000);
  if (secs < 15) el.textContent = 'Synced just now';
  else if (secs < 60) el.textContent = `Synced ${secs}s ago`;
  else el.textContent = `Synced ${Math.round(secs / 60)}m ago`;
}

// ── MAIN RENDER ───────────────────────────────────────────────
function render() {
  const deals = DealHelper.forClient(clientId);
  const s     = DealHelper.stats(deals);

  countUp('hero-revenue',  s.revenueGenerated, true);
  countUp('hero-pipeline', s.revenuePipeline,  true);
  document.getElementById('hero-winrate').textContent = s.winRate + '%';

  document.getElementById('meta-total').textContent = s.totalDeals;
  document.getElementById('meta-month').textContent = s.closedThisMonth;

  renderGoalBar(deals);
  renderBreakdown(s);
  renderSparkCards(deals);

  // only re-render deals table if that panel is currently visible
  if (document.getElementById('panel-deals').style.display !== 'none') {
    renderDealsTable(deals);
  }
}

// ── GOAL BAR ──────────────────────────────────────────────────
function renderGoalBar(deals) {
  const client = DB.getClients().find(c => c.id === clientId);
  const goal   = +(client?.[currentGoalKey()] || 0);

  const monthRev = deals
    .filter(d => d.status === 'closed' && isThisMonth(dealDate(d)))
    .reduce((sum, d) => sum + d.value, 0);

  const fill       = document.getElementById('goal-bar-fill');
  const pctEl      = document.getElementById('goal-bar-pct');
  const remaining  = document.getElementById('goal-bar-remaining');
  const current    = document.getElementById('goal-bar-current');
  const targetEl   = document.getElementById('goal-bar-target');
  const targetWrap = document.getElementById('goal-bar-target-wrap');
  const subtitle   = document.getElementById('goal-bar-subtitle');

  current.textContent = formatCurrency(monthRev);
  const monthLabel = document.getElementById('goal-bar-month-label');
  if (monthLabel) monthLabel.textContent = currentMonthShort() + ' Revenue  ';

  if (!goal) {
    fill.style.width         = '0%';
    fill.style.background    = '#F97316';
    pctEl.textContent        = 'No goal set';
    remaining.textContent    = '';
    targetWrap.style.display = 'none';
    subtitle.textContent     = 'No revenue goal set — admin can set one from the Clients tab';
    return;
  }

  const pct       = Math.min(Math.round(monthRev / goal * 100), 100);
  const fillColor = pct >= 100 ? '#22C55E' : pct >= 50 ? '#F97316' : '#EF4444';

  fill.style.width         = pct + '%';
  fill.style.background    = fillColor;
  pctEl.textContent        = pct + '%';
  targetEl.textContent     = formatCurrency(goal);
  targetWrap.style.display = '';
  subtitle.textContent     = `${currentMonthShort()} revenue vs goal`;
  remaining.textContent    = pct >= 100 ? 'Goal reached!' : `${formatCurrency(goal - monthRev)} remaining`;
}

// ── BREAKDOWN BARS ────────────────────────────────────────────
function renderBreakdown(s) {
  const el    = document.getElementById('breakdown-bars');
  const total = s.totalDeals || 1;
  if (!s.totalDeals) {
    el.innerHTML = `<p style="font-size:13px;color:var(--text-3);">No deals yet.</p>`;
    return;
  }
  el.innerHTML = [
    { label: 'Closed',   val: s.closedDeals,   cls: 'emerald', color: 'var(--emerald)' },
    { label: 'Pipeline', val: s.pipelineDeals,  cls: 'amber',   color: 'var(--amber)' },
    { label: 'Lost',     val: s.lostDeals,      cls: '',        color: 'var(--text-3)' },
  ].map(row => `
    <div class="prog-wrap">
      <div class="prog-label">
        <span class="pl-name">${row.label}</span>
        <span class="pl-val" style="color:${row.color}">${row.val} deal${row.val !== 1 ? 's' : ''}</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill ${row.cls}" style="width:${Math.round(row.val / total * 100)}%"></div>
      </div>
    </div>
  `).join('');
}

// ── SPARK CARDS ───────────────────────────────────────────────
function renderSparkCards(deals) {
  const now = new Date();
  const nowYr = now.getFullYear();
  const nowMo = now.getMonth();

  const curRev = [], prvRev = [], labels = [];
  for (let i = 5; i >= 0; i--) {
    const moOffset = nowMo - i;
    const yr  = nowYr + Math.floor(moOffset / 12);
    const mo  = ((moOffset % 12) + 12) % 12;
    const pyYr = yr - 1;
    labels.push(new Date(2000, mo, 1).toLocaleString('default', { month: 'short' }));
    const cur = deals.filter(d => d.status === 'closed' && sameMonth(dealDate(d), yr, mo));
    const prv = deals.filter(d => d.status === 'closed' && sameMonth(dealDate(d), pyYr, mo));
    curRev.push(cur.reduce((s, d) => s + (+d.value || 0), 0));
    prvRev.push(prv.reduce((s, d) => s + (+d.value || 0), 0));
  }

  const totRev  = curRev.reduce((s, v) => s + v, 0);
  const prevRev = prvRev.reduce((s, v) => s + v, 0);
  const s       = DealHelper.stats(deals);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('spark-rev-val',    formatCurrency(totRev));
  set('spark-rev-start',  labels[0]);
  set('spark-pipe-val',   formatCurrency(s.revenuePipeline));
  set('spark-closed-val', s.closedDeals);
  set('spark-win-val',    s.winRate + '%');

  const badge = document.getElementById('spark-rev-badge');
  const prev  = document.getElementById('spark-rev-prev');
  if (badge) {
    if (totRev === 0 && prevRev === 0) {
      badge.className = 'spark-badge spark-badge-neutral'; badge.textContent = '—';
    } else {
      const diff = totRev - prevRev;
      const pct  = prevRev === 0 ? 100 : Math.round(Math.abs(diff) / prevRev * 100);
      badge.className = 'spark-badge ' + (diff >= 0 ? 'spark-badge-up' : 'spark-badge-down');
      badge.textContent = diff >= 0 ? `↑ ${pct}%` : `↓ ${pct}%`;
    }
  }
  if (prev) prev.textContent = 'vs prev year';

  const canvas = document.getElementById('spark-rev-chart');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { data: curRev, borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.12)', tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2.5, spanGaps: true },
        { data: prvRev, borderColor: 'rgba(82,82,91,0.5)', backgroundColor: 'transparent', tension: 0.4, fill: false, pointRadius: 0, borderWidth: 1.5, spanGaps: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index', intersect: false,
          callbacks: { label: ctx => (ctx.datasetIndex === 0 ? 'This year: ' : 'Prev year: ') + formatCurrency(ctx.raw || 0) }
        }
      },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
      layout: { padding: { top: 8, bottom: 0 } }
    }
  });
}

// ── LINE CHART (legacy — kept for reference) ──────────────────
function renderLineChart(deals) {
  const ctx = document.getElementById('line-chart');
  if (!ctx) return;
  const monthly = DealHelper.monthlyRevenue(deals);
  if (lineChart) lineChart.destroy();

  // Dynamically find the last non-future month index (= current month)
  let currentIdx = -1;
  monthly.forEach((m, i) => { if (!m.future) currentIdx = i; });
  const hasFuture = currentIdx >= 0 && currentIdx < monthly.length - 1;

  // Hollow points for future pipeline months to signal they're projections
  const pipelinePointBg     = monthly.map(m => m.future ? 'transparent' : '#F97316');
  const pipelinePointBorder = monthly.map(m => m.future ? '#F97316'      : '#141414');

  // Plugin: shade future zone + draw "Today" separator
  const todayZone = {
    id: 'todayZone',
    beforeDraw(chart) {
      if (!hasFuture) return;
      const { ctx: c, chartArea: a, scales } = chart;
      const x0 = scales.x.getPixelForValue(currentIdx);
      const x1 = scales.x.getPixelForValue(currentIdx + 1);
      const div = (x0 + x1) / 2;
      c.save();
      c.fillStyle = 'rgba(249,115,22,0.04)';
      c.fillRect(div, a.top, a.right - div, a.bottom - a.top);
      c.restore();
    },
    afterDraw(chart) {
      if (!hasFuture) return;
      const { ctx: c, chartArea: a, scales } = chart;
      const x0 = scales.x.getPixelForValue(currentIdx);
      const x1 = scales.x.getPixelForValue(currentIdx + 1);
      const div = (x0 + x1) / 2;
      c.save();
      c.strokeStyle = 'rgba(249,115,22,0.5)';
      c.lineWidth = 1.5;
      c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(div, a.top); c.lineTo(div, a.bottom); c.stroke();
      c.setLineDash([]);
      c.font = 'bold 10px "Plus Jakarta Sans", sans-serif';
      c.fillStyle = '#FB923C';
      c.textAlign = 'center';
      c.fillText('Today', div, a.top - 6);
      c.restore();
    }
  };

  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: monthly.map(m => m.label),
      datasets: [
        {
          label: 'Closed Revenue',
          data: monthly.map(m => m.closed),
          borderColor: '#22C55E', backgroundColor: 'rgba(34,197,94,0.08)',
          tension: 0.4, fill: true, pointRadius: 4, spanGaps: false,
          pointBackgroundColor: '#22C55E', pointBorderColor: '#141414', pointBorderWidth: 2,
        },
        {
          label: 'Forecast (Pipeline)',
          data: monthly.map(m => m.pipeline),
          borderColor: '#F97316', backgroundColor: 'rgba(249,115,22,0.07)',
          tension: 0.4, fill: true, pointRadius: 4,
          pointBackgroundColor: pipelinePointBg,
          pointBorderColor: pipelinePointBorder, pointBorderWidth: 2,
          borderDash: [5, 3],
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 16 } },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#71717A', font: { size: 11, family: 'Plus Jakarta Sans' }, boxWidth: 8, padding: 14 }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw || 0)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => formatCurrency(v), font: { size: 11, family: 'Plus Jakarta Sans' }, color: '#52525B' },
          grid: { color: '#1F1F1F' }, border: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, family: 'Plus Jakarta Sans' }, color: '#52525B', maxRotation: 0 },
          border: { display: false }
        }
      }
    },
    plugins: [todayZone]
  });
}

// ── DEALS TABLE ───────────────────────────────────────────────
function applyFilters() {
  const search = document.getElementById('deals-search').value.toLowerCase();
  const status = document.getElementById('deals-status').value;
  renderDealsTable(DealHelper.forClient(clientId), status, search);
}

function renderDealsTable(deals, status = '', search = '') {
  let rows = [...deals];
  if (status) rows = rows.filter(d => d.status === status);
  if (search) rows = rows.filter(d =>
    d.name.toLowerCase().includes(search) ||
    (d.contact || '').toLowerCase().includes(search));
  rows.sort((a, b) => new Date(b.addedat || b.addedAt || 0) - new Date(a.addedat || a.addedAt || 0));

  const el = document.getElementById('deals-body');
  if (!rows.length) {
    el.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:44px;color:var(--text-3);font-size:13px;">No deals found</td></tr>`;
    return;
  }
  el.innerHTML = rows.map(d => `
    <tr>
      <td>
        <div class="fw7">${esc(d.name)}</div>
        ${d.contact ? `<div style="font-size:11px;color:var(--text-3);margin-top:2px;">${esc(d.contact)}</div>` : ''}
      </td>
      <td class="fw7 txt-emerald">${formatCurrency(d.value)}</td>
      <td>${badge(d.status)}</td>
      <td class="txt3">${formatDate(d.date)}</td>
      <td class="txt2" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.notes || '—')}</td>
    </tr>
  `).join('');
}

// ── HELPERS ───────────────────────────────────────────────────
function badge(s) {
  const cls   = { closed: 'badge-closed', pipeline: 'badge-pipeline', lost: 'badge-lost' };
  const label = { closed: 'Closed', pipeline: 'Pipeline', lost: 'Lost' };
  return `<span class="badge ${cls[s] || 'badge-pipeline'}">${label[s] || s}</span>`;
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function countUp(id, target, isCurrency) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 700, start = Date.now();
  function tick() {
    const progress = Math.min((Date.now() - start) / duration, 1);
    const ease     = 1 - Math.pow(1 - progress, 3);
    const current  = Math.round(target * ease);
    el.textContent = isCurrency ? formatCurrency(current) : current;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
