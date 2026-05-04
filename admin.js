let currentUser      = null;
let revenueChart     = null;
let selectedClientId = null;
let refreshTimer     = null;
let lastRefreshedAt  = null;

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = Auth.requireAdmin();
  if (!currentUser) return;

  showLoading('Loading dashboard…');
  try {
    await DB.init();
  } catch (e) {
    hideLoading();
    document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;color:#ef4444;font-size:14px;">Failed to load data — check your connection and reload.</div>`;
    return;
  }
  hideLoading();

  document.getElementById('admin-name').textContent = currentUser.name;
  document.getElementById('admin-av').textContent   = currentUser.name[0].toUpperCase();

  lastRefreshedAt = new Date();
  renderOverview();
  bindNav();
  bindDealFilters();
  bindUpload();
  startAutoRefresh();
});

// ── AUTO REFRESH ──────────────────────────────────────────────
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(doRefresh, 30000);
  setInterval(updateRefreshLabel, 10000);
}

async function doRefresh() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.classList.add('spinning');
  try {
    await DB.refreshDeals();
    lastRefreshedAt = new Date();
    renderOverview();
    renderClients();
    updateRefreshLabel();
  } catch (_) {
    // silent — keep showing stale data
  } finally {
    if (btn) btn.classList.remove('spinning');
  }
}

function updateRefreshLabel() {
  const el = document.getElementById('refresh-label');
  if (!el || !lastRefreshedAt) return;
  const secs = Math.round((Date.now() - lastRefreshedAt) / 1000);
  if (secs < 15) el.textContent = 'Synced just now';
  else if (secs < 60) el.textContent = `Synced ${secs}s ago`;
  else el.textContent = `Synced ${Math.round(secs / 60)}m ago`;
}

// ── NAVIGATION ────────────────────────────────────────────────
const TAB_META = {
  overview: { title: 'Overview',  sub: 'All clients at a glance' },
  clients:  { title: 'Clients',   sub: 'Manage client accounts' },
  deals:    { title: 'All Deals', sub: 'Every deal across all clients' },
};

function bindNav() {
  document.querySelectorAll('.nav-link[data-tab]').forEach(el =>
    el.addEventListener('click', () => switchTab(el.dataset.tab)));
  document.getElementById('client-search').addEventListener('input', e => renderClients(e.target.value));
}

function switchTab(tab) {
  document.querySelectorAll('.nav-link[data-tab]').forEach(el =>
    el.classList.toggle('active', el.dataset.tab === tab));
  ['overview', 'clients', 'deals'].forEach(t => {
    document.getElementById('panel-' + t).style.display = t === tab ? 'block' : 'none';
  });
  const m = TAB_META[tab] || {};
  document.getElementById('page-title').textContent = m.title || '';
  document.getElementById('page-sub').textContent   = m.sub   || '';
  if (tab === 'overview') renderOverview();
  if (tab === 'clients')  renderClients();
  if (tab === 'deals')    renderAllDeals();
}

// ── OVERVIEW ──────────────────────────────────────────────────
function renderOverview() {
  const clients  = DB.getClients();
  const allDeals = DB.getDeals();
  const s        = DealHelper.stats(allDeals);

  countUp('hero-revenue',  s.revenueTotal,     true);
  countUp('hero-pipeline', s.revenuePipeline,  true);
  document.getElementById('hero-clients').textContent = clients.length;

  renderSparkCards(allDeals, clients.length);
  renderTopClients(clients, allDeals);
  renderRecentDeals(allDeals, clients);
}

function renderSparkCards(deals, clientCount) {
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
  set('spark-rev-val',     formatCurrency(totRev));
  set('spark-rev-start',   labels[0]);
  set('spark-pipe-val',    formatCurrency(s.revenuePipeline));
  set('spark-closed-val',  s.closedDeals);
  set('spark-clients-val', clientCount ?? 0);

  // Also update hero banner
  countUp('hero-revenue',  s.revenueGenerated, true);
  countUp('hero-pipeline', s.revenuePipeline,  true);
  const hc = document.getElementById('hero-clients');
  if (hc) hc.textContent = clientCount ?? 0;

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

function renderRevenueChart(deals) {
  const ctx = document.getElementById('revenue-chart');
  if (!ctx) return;
  const monthly = DealHelper.monthlyRevenue(deals);
  if (revenueChart) revenueChart.destroy();

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

  revenueChart = new Chart(ctx, {
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

function renderTopClients(clients, allDeals) {
  const el = document.getElementById('top-clients');
  if (!clients.length) { el.innerHTML = emptyState('No clients yet'); return; }

  const sorted = clients
    .map(c => ({ ...c, rev: DealHelper.stats(allDeals.filter(d => d.clientId === c.id)).revenueTotal }))
    .sort((a, b) => b.rev - a.rev).slice(0, 6);
  const max = sorted[0]?.rev || 1;

  el.innerHTML = sorted.map(c => `
    <div class="prog-wrap">
      <div class="prog-label">
        <span class="pl-name">${esc(c.name)}</span>
        <span class="pl-val">${formatCurrency(c.rev)}</span>
      </div>
      <div class="prog-track">
        <div class="prog-fill" style="width:${Math.round(c.rev / max * 100)}%"></div>
      </div>
    </div>
  `).join('');
}

function renderRecentDeals(allDeals, clients) {
  const el  = document.getElementById('recent-deals');
  const map = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const recent = [...allDeals].sort((a, b) => new Date(b.addedat || b.addedAt || 0) - new Date(a.addedat || a.addedAt || 0)).slice(0, 8);

  if (!recent.length) {
    el.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px;">No deals yet</td></tr>`;
    return;
  }
  el.innerHTML = recent.map(d => `
    <tr>
      <td class="fw7">${esc(d.name)}</td>
      <td class="txt2">${esc(map[d.clientId] || '—')}</td>
      <td class="fw7 txt-emerald">${formatCurrency(d.value)}</td>
      <td>${badge(d.status)}</td>
      <td class="txt3">${formatDate(d.date)}</td>
    </tr>
  `).join('');
}

// ── CLIENTS ───────────────────────────────────────────────────
function renderClients(filter = '') {
  const clients  = DB.getClients().filter(c =>
    !filter || c.name.toLowerCase().includes(filter.toLowerCase()) ||
               c.email.toLowerCase().includes(filter.toLowerCase()));
  const allDeals = DB.getDeals();
  const el       = document.getElementById('clients-grid');

  if (!clients.length) {
    el.innerHTML = `<div style="grid-column:1/-1">${emptyState('No clients yet. Add your first one!')}</div>`;
    return;
  }

  el.innerHTML = clients.map(c => {
    const s    = DealHelper.stats(allDeals.filter(d => d.clientId === c.id));
    const goal    = +(c[currentGoalKey()] || 0);
    const monthRev = allDeals.filter(d => d.clientId === c.id && d.status === 'closed' && isThisMonth(dealDate(d))).reduce((sum, d) => sum + d.value, 0);
    const goalPct = goal ? Math.min(Math.round(monthRev / goal * 100), 100) : 0;
    const goalHtml = goal
      ? `<div class="cc-goal">
           <div class="cc-goal-label">
             <span>${currentMonthShort()} Goal</span>
             <span>${formatCurrency(monthRev)} <span style="color:var(--text-3)">/ ${formatCurrency(goal)}</span></span>
           </div>
           <div class="prog-track" style="height:6px;margin-top:6px;">
             <div class="prog-fill" style="width:${goalPct}%;background:${goalPct >= 100 ? '#22C55E' : goalPct >= 50 ? '#F97316' : '#EF4444'};"></div>
           </div>
           <div style="font-size:11px;color:var(--text-3);margin-top:4px;text-align:right;">${goalPct}% of goal</div>
         </div>`
      : `<div class="cc-goal cc-goal-empty">No ${currentMonthShort()} goal set</div>`;
    return `
      <div class="client-card">
        <div class="cc-head">
          <div class="cc-av">${c.name[0].toUpperCase()}</div>
          <div>
            <div class="cc-name">${esc(c.name)}</div>
            <div class="cc-email">${esc(c.email)}</div>
          </div>
        </div>
        <div class="cc-stats">
          <div class="mini-stat"><div class="ms-val txt-emerald">${formatCurrency(s.revenueGenerated)}</div><div class="ms-lbl">Revenue</div></div>
          <div class="mini-stat"><div class="ms-val txt-amber">${formatCurrency(s.revenuePipeline)}</div><div class="ms-lbl">Pipeline</div></div>
          <div class="mini-stat"><div class="ms-val">${s.closedDeals}</div><div class="ms-lbl">Closed</div></div>
          <div class="mini-stat"><div class="ms-val">${s.winRate}%</div><div class="ms-lbl">Win Rate</div></div>
        </div>
        ${goalHtml}
        <div class="cc-actions">
          <button class="btn btn-soft btn-sm" onclick="openUpload('${c.id}')">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload CSV
          </button>
          <button class="btn btn-ghost btn-sm" onclick="openGoal('${c.id}')">Set Goal</button>
          <button class="btn btn-ghost btn-sm" onclick="viewDeals('${c.id}')">View Deals</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteClient('${c.id}')">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function viewDeals(clientId) {
  switchTab('deals');
  document.getElementById('deal-client-filter').value = clientId;
  renderAllDeals();
}

// ── ALL DEALS ─────────────────────────────────────────────────
function renderAllDeals() {
  const search   = document.getElementById('deal-search').value.toLowerCase();
  const status   = document.getElementById('deal-status-filter').value;
  const clients  = DB.getClients();
  const map      = Object.fromEntries(clients.map(c => [c.id, c.name]));

  // Always rebuild client dropdown to reflect current client list
  const sel    = document.getElementById('deal-client-filter');
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">All Clients</option>';
  clients.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    sel.appendChild(o);
  });
  sel.value = prevVal;

  const clientId = sel.value;
  let deals = DB.getDeals();
  if (clientId) deals = deals.filter(d => d.clientId === clientId);
  if (status)   deals = deals.filter(d => d.status === status);
  if (search)   deals = deals.filter(d =>
    d.name.toLowerCase().includes(search) ||
    (map[d.clientId] || '').toLowerCase().includes(search));
  deals = [...deals].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));

  const el = document.getElementById('deals-body');
  if (!deals.length) {
    el.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:44px;color:var(--text-3);font-size:13px;">No deals found</td></tr>`;
    return;
  }
  el.innerHTML = deals.map(d => `
    <tr>
      <td class="fw7">${esc(d.name)}</td>
      <td class="txt2">${esc(map[d.clientId] || '—')}</td>
      <td class="fw7 txt-emerald">${formatCurrency(d.value)}</td>
      <td>${badge(d.status)}</td>
      <td class="txt3">${formatDate(d.date)}</td>
      <td>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteDeal('${d.id}')">
          <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </td>
    </tr>
  `).join('');
}

function bindDealFilters() {
  document.getElementById('deal-search').addEventListener('input', renderAllDeals);
  document.getElementById('deal-status-filter').addEventListener('change', renderAllDeals);
  document.getElementById('deal-client-filter').addEventListener('change', renderAllDeals);
}

// ── ADD CLIENT ────────────────────────────────────────────────
function openAddClient()  { document.getElementById('modal-add-client').classList.add('open'); }
function closeAddClient() { document.getElementById('modal-add-client').classList.remove('open'); }

async function saveClient() {
  const name  = document.getElementById('c-name').value.trim();
  const email = document.getElementById('c-email').value.trim();
  const pass  = document.getElementById('c-pass').value.trim();

  if (!name || !email || !pass) { showToast('Please fill in all fields', 'err'); return; }
  if (DB.getUsers().find(u => u.email.toLowerCase() === email.toLowerCase())) {
    showToast('That email already exists', 'err'); return;
  }

  const btn = document.querySelector('#modal-add-client .btn-primary');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    await DB.addClient(name, email, pass);
    closeAddClient();
    ['c-name', 'c-email', 'c-pass'].forEach(id => document.getElementById(id).value = '');
    showToast(`Client "${name}" created`);
    renderOverview();
    renderClients();
  } catch (e) {
    showToast('Failed to create client — try again', 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Client';
  }
}

function closeConfirm() {
  document.getElementById('modal-confirm').classList.remove('open');
}

function showConfirm(title, msg, onOk) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  const btn = document.getElementById('confirm-ok-btn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', async () => {
    closeConfirm();
    await onOk();
  });
  document.getElementById('modal-confirm').classList.add('open');
}

async function deleteClient(clientId) {
  const cl = DB.getClients().find(c => c.id === clientId);
  showConfirm(
    'Delete Client',
    `Delete "${cl?.name || 'this client'}" and all their deals? This cannot be undone.`,
    async () => {
      try {
        await DB.deleteClient(clientId);
        showToast('Client deleted');
        renderClients();
        renderOverview();
      } catch (e) {
        showToast('Failed to delete client', 'err');
      }
    }
  );
}

async function deleteDeal(dealId) {
  const deal = DB.getDeals().find(d => d.id === dealId);
  showConfirm(
    'Delete Deal',
    `Delete "${deal?.name || 'this deal'}"? This cannot be undone.`,
    async () => {
      try {
        await DB.deleteDeal(dealId);
        showToast('Deal deleted');
        renderAllDeals();
        renderOverview();
      } catch (e) {
        showToast('Failed to delete deal', 'err');
      }
    }
  );
}

// ── GOAL ──────────────────────────────────────────────────────
let selectedGoalClientId = null;

function openGoal(clientId) {
  selectedGoalClientId = clientId;
  const c = DB.getClients().find(c => c.id === clientId);
  document.getElementById('goal-client-label').textContent = `${currentMonthShort()} revenue target for ${c?.name || 'client'}`;
  document.getElementById('goal-amount').value = +(c?.[currentGoalKey()] || '');
  document.getElementById('modal-goal').classList.add('open');
}
function closeGoal() { document.getElementById('modal-goal').classList.remove('open'); }

async function saveGoal() {
  const amount = parseFloat(document.getElementById('goal-amount').value) || 0;
  const btn = document.querySelector('#modal-goal .btn-primary');
  btn.disabled = true; btn.textContent = 'Saving…';

  // Close and refresh UI immediately (optimistic — local state already updated in DB.setClientGoal)
  closeGoal();
  renderClients();
  renderOverview();

  try {
    await DB.setClientGoal(selectedGoalClientId, amount);
    showToast('Goal saved');
  } catch (e) {
    showToast('Failed to save goal — check connection', 'err');
    // Local state was reverted inside DB.setClientGoal; re-render to reflect revert
    renderClients();
    renderOverview();
  } finally {
    btn.disabled = false; btn.textContent = 'Save Goal';
  }
}

// ── UPLOAD ────────────────────────────────────────────────────
function openUpload(clientId) {
  selectedClientId = clientId;
  const c = DB.getClients().find(c => c.id === clientId);
  document.getElementById('upload-client-label').textContent = 'Client: ' + (c?.name || '—');
  document.getElementById('upload-result').innerHTML = '';
  document.getElementById('upload-file').value = '';
  document.getElementById('modal-upload').classList.add('open');
}
function closeUpload() { document.getElementById('modal-upload').classList.remove('open'); }

function bindUpload() {
  const zone = document.getElementById('upload-zone');
  const inp  = document.getElementById('upload-file');
  zone.addEventListener('click', () => inp.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f?.name.endsWith('.csv')) processFile(f);
    else showToast('Please drop a .csv file', 'err');
  });
  inp.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
}

function processFile(file) {
  const reader = new FileReader();
  reader.onload = async e => {
    const { deals, errors } = parseCSV(e.target.result);
    const res = document.getElementById('upload-result');

    if (!deals.length) {
      res.innerHTML = `<div style="background:var(--rose-s);color:var(--rose);border-radius:8px;padding:12px 15px;font-size:13px;border-left:3px solid var(--rose);">${errors.join('<br>')}</div>`;
      return;
    }

    res.innerHTML = `<div style="color:var(--text-3);font-size:13px;">Uploading ${deals.length} deal${deals.length !== 1 ? 's' : ''}…</div>`;

    try {
      await DB.addDeals(selectedClientId, deals);
      res.innerHTML = `
        <div class="upload-success">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          ${deals.length} deal${deals.length !== 1 ? 's' : ''} imported successfully
        </div>
        ${errors.length ? `<div style="margin-top:8px;font-size:12px;color:var(--rose);">${errors.join('<br>')}</div>` : ''}
      `;
      showToast(`${deals.length} deals imported`);
      renderOverview();
      renderClients();
    } catch (err) {
      res.innerHTML = `<div style="color:var(--rose);font-size:13px;">Upload failed — please try again.</div>`;
      showToast('Upload failed', 'err');
    }
  };
  reader.readAsText(file);
}

// ── HELPERS ───────────────────────────────────────────────────
function badge(s) {
  const cls   = { closed: 'badge-closed', pipeline: 'badge-pipeline', lost: 'badge-lost' };
  const label = { closed: 'Closed', pipeline: 'Pipeline', lost: 'Lost' };
  return `<span class="badge ${cls[s] || 'badge-pipeline'}">${label[s] || s}</span>`;
}

function emptyState(msg) {
  return `<div class="empty">
    <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10"/>
      <line x1="8" y1="15" x2="16" y2="15"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
    <p>${msg}</p>
  </div>`;
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
