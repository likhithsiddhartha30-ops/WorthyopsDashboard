// ── REPLACE THIS WITH YOUR DEPLOYED WEB APP URL ──────────────
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwYgSsmjB8Id2f8Q5wcWqsyvVlCmIYJLgojimniIKxWpwcpiN8O--FLORmBB8HxpPnp/exec';

// ── API LAYER ─────────────────────────────────────────────────
const API = {
  req(params) {
    return new Promise((resolve, reject) => {
      const cb     = '_gs_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer  = setTimeout(() => {
        delete window[cb]; script.remove();
        reject(new Error('Request timed out'));
      }, 15000);
      window[cb] = data => {
        clearTimeout(timer); delete window[cb]; script.remove();
        resolve(data);
      };
      script.src = SCRIPT_URL + '?' + new URLSearchParams({ ...params, callback: cb });
      script.onerror = () => { clearTimeout(timer); delete window[cb]; reject(new Error('Script load failed')); };
      document.head.appendChild(script);
    });
  },
  getUsers()                         { return this.req({ action: 'getUsers' }); },
  getClients()                       { return this.req({ action: 'getClients' }); },
  getDeals(clientName)               { return this.req({ action: 'getDeals', clientName }); },
  addClient(p)                       { return this.req({ action: 'addClient',    payload: JSON.stringify(p) }); },
  addDeals(clientName, deals)        { return this.req({ action: 'addDeals',     payload: JSON.stringify({ clientName, deals }) }); },
  deleteClient(clientName, clientId) { return this.req({ action: 'deleteClient', payload: JSON.stringify({ clientName, clientId }) }); },
  deleteDeal(clientName, dealId)     { return this.req({ action: 'deleteDeal',   payload: JSON.stringify({ clientName, dealId }) }); },
  setGoal(clientId, goal)            { return this.req({ action: 'setGoal',      payload: JSON.stringify({ clientId, goal, month: currentMonthShort() }) }); },
};

// ── DB ────────────────────────────────────────────────────────
const DB = {
  _users:   [],
  _clients: [],
  _deals:   [],  // flat array; each deal has clientId attached

  // Login page — only needs users
  async initUsers() {
    const u     = await API.getUsers();
    this._users = Array.isArray(u) ? u.map(normalizeUser) : [];
  },

  // Admin page — loads everything
  async init() {
    const [u, c] = await Promise.all([API.getUsers(), API.getClients()]);
    this._users   = Array.isArray(u) ? u.map(normalizeUser) : [];
    this._clients = Array.isArray(c) ? c.map(normalizeKeys) : [];
    const groups  = await Promise.all(
      this._clients.map(cl =>
        API.getDeals(cl.name).then(rows =>
          (Array.isArray(rows) ? rows : []).map(d => normalizeDeal(d, cl.id))
        )
      )
    );
    this._deals = groups.flat();
  },

  // Client page — loads users + one client's deals
  async initForClient(clientId) {
    const [u, c] = await Promise.all([API.getUsers(), API.getClients()]);
    this._users   = Array.isArray(u) ? u.map(normalizeUser) : [];
    this._clients = Array.isArray(c) ? c.map(normalizeKeys) : [];
    const client  = this._clients.find(cl => cl.id === clientId);
    if (!client) return;
    const rows  = await API.getDeals(client.name);
    this._deals = (Array.isArray(rows) ? rows : []).map(d => normalizeDeal(d, clientId));
  },

  getUsers()   { return this._users; },
  getClients() { return this._clients; },
  getDeals()   { return this._deals; },

  async refreshDeals() {
    const c = await API.getClients();
    if (Array.isArray(c)) this._clients = c.map(normalizeKeys);
    if (!this._clients.length) return;
    const groups = await Promise.all(
      this._clients.map(cl =>
        API.getDeals(cl.name).then(rows =>
          (Array.isArray(rows) ? rows : []).map(d => normalizeDeal(d, cl.id))
        )
      )
    );
    this._deals = groups.flat();
  },

  async addClient(name, email, password) {
    const id     = uid();
    const userId = uid();
    await API.addClient({ id, name, email, password, userId });
    this._clients.push({ id, name, email });
    this._users.push({ id: userId, name, email, password, role: 'client', clientId: id });
    return id;
  },

  async deleteClient(clientId) {
    const cl = this._clients.find(c => c.id === clientId);
    if (!cl) return;
    await API.deleteClient(cl.name, clientId);
    this._clients = this._clients.filter(c => c.id !== clientId);
    this._users   = this._users.filter(u => u.clientId !== clientId);
    this._deals   = this._deals.filter(d => d.clientId !== clientId);
  },

  async addDeals(clientId, deals) {
    const cl = this._clients.find(c => c.id === clientId);
    if (!cl) throw new Error('Client not found');
    await API.addDeals(cl.name, deals);
    deals.forEach(d => this._deals.push({ ...d, clientId, value: +d.value || 0 }));
  },

  async setClientGoal(clientId, goal) {
    // Optimistic update — reflect in UI immediately
    const cl      = this._clients.find(c => c.id === clientId);
    const prevGoal = cl ? cl[currentGoalKey()] : undefined;
    if (cl) cl[currentGoalKey()] = goal;

    try {
      const res = await API.setGoal(clientId, goal);
      if (res && res.error) throw new Error(res.error);
    } catch (e) {
      // Revert local state on API failure
      if (cl) cl[currentGoalKey()] = prevGoal;
      throw e;
    }
  },

  async deleteDeal(dealId) {
    const deal = this._deals.find(d => d.id === dealId);
    const cl   = deal && this._clients.find(c => c.id === deal.clientId);
    if (!deal || !cl) return;
    await API.deleteDeal(cl.name, dealId);
    this._deals = this._deals.filter(d => d.id !== dealId);
  },
};

// ── DEAL HELPERS ──────────────────────────────────────────────
const DealHelper = {
  forClient(clientId) {
    return DB.getDeals().filter(d => d.clientId === clientId);
  },

  stats(deals) {
    const closed   = deals.filter(d => d.status === 'closed');
    const pipeline = deals.filter(d => d.status === 'pipeline');
    const lost     = deals.filter(d => d.status === 'lost');
    return {
      totalDeals:       deals.length,
      closedDeals:      closed.length,
      pipelineDeals:    pipeline.length,
      revenueGenerated: closed.reduce((s, d) => s + (+d.value || 0), 0),
      revenuePipeline:  pipeline.reduce((s, d) => s + (+d.value || 0), 0),
      revenueTotal:     deals.reduce((s, d) => s + (+d.value || 0), 0),
      lostDeals:        lost.length,
      closedThisMonth:  closed.filter(d => isThisMonth(dealDate(d))).length,
      winRate: deals.length
        ? Math.round((closed.length / ((closed.length + lost.length) || 1)) * 100)
        : 0
    };
  },

  monthlyRevenue(deals) {
    const now          = new Date();
    const nowMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Collect all valid deal dates to derive the axis range
    const allDates = deals.map(d => parseDate(dealDate(d))).filter(Boolean);

    let startDate, endDate;

    if (allDates.length) {
      const minTs = Math.min(...allDates.map(d => d.getTime()));
      const maxTs = Math.max(...allDates.map(d => d.getTime()));

      // Start: snap earliest deal date to its month, cap at 12 months back
      const cap      = new Date(now.getFullYear(), now.getMonth() - 12, 1);
      const minMonth = new Date(new Date(minTs).getFullYear(), new Date(minTs).getMonth(), 1);
      startDate      = new Date(Math.max(minMonth.getTime(), cap.getTime()));

      // End: snap latest deal date to its month (may be a future pipeline month)
      const maxMonth = new Date(new Date(maxTs).getFullYear(), new Date(maxTs).getMonth(), 1);
      endDate        = new Date(Math.max(maxMonth.getTime(), nowMonthStart.getTime()));
    } else {
      // No deals yet — show a sensible default window
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      endDate   = new Date(now.getFullYear(), now.getMonth() + 3, 1);
    }

    // Walk month-by-month from startDate → endDate
    const months = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const isFuture = cursor > nowMonthStart;
      const yr       = cursor.getFullYear();
      const label    = yr === now.getFullYear()
        ? cursor.toLocaleString('default', { month: 'short' })
        : cursor.toLocaleString('default', { month: 'short' }) + " '" + String(yr).slice(2);
      months.push({ label, year: yr, month: cursor.getMonth(), future: isFuture });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return months.map(m => ({
      label:    m.label,
      future:   m.future,
      // null for future months so the closed-revenue line stops cleanly at today
      closed:   m.future ? null : deals
        .filter(d => d.status === 'closed' && sameMonth(dealDate(d), m.year, m.month))
        .reduce((s, d) => s + (+d.value || 0), 0),
      pipeline: deals
        .filter(d => d.status === 'pipeline' && sameMonth(dealDate(d), m.year, m.month))
        .reduce((s, d) => s + (+d.value || 0), 0),
    }));
  }
};

// Returns the best available date string for a deal (close date → addedAt fallback)
function dealDate(d) {
  return d.date || d.addedat || d.addedAt || '';
}

// Parses date strings robustly: ISO, DD/MM/YYYY, MM/DD/YYYY, and long GAS strings
function parseDate(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();
  // YYYY-MM-DD (ISO / normalizeDate output)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  // DD/MM/YYYY or DD-MM-YYYY (Indian spreadsheet entry)
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  // Anything else (e.g. long GAS date string like "Sat May 03 2025 ...")
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function isThisMonth(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return false;
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function sameMonth(dateStr, year, month) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return d.getMonth() === month && d.getFullYear() === year;
}

function inPeriod(dateStr, start, end) {
  const d = parseDate(dateStr);
  if (!d) return false;
  return d >= start && d <= end;
}

// ── CSV PARSER ────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { deals: [], errors: ['CSV has no data rows'] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));

  const col = key => {
    const aliases = {
      name:    ['deal_name', 'name', 'title', 'deal'],
      value:   ['value', 'amount', 'revenue', 'deal_value'],
      status:  ['status', 'stage'],
      date:    ['date', 'close_date', 'closed_date', 'deal_date'],
      notes:   ['notes', 'description', 'note'],
      contact: ['contact', 'client_name', 'contact_name']
    };
    for (const a of aliases[key]) { const i = headers.indexOf(a); if (i !== -1) return i; }
    return -1;
  };

  const nameIdx    = col('name'),  valueIdx  = col('value'), statusIdx = col('status');
  const dateIdx    = col('date'),  notesIdx  = col('notes'), contactIdx = col('contact');

  if (nameIdx  === -1) return { deals: [], errors: ['Missing required column: deal_name / name / title'] };
  if (valueIdx === -1) return { deals: [], errors: ['Missing required column: value / amount / revenue'] };

  const deals = [], errors = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols    = splitCSVLine(lines[i]);
    const name    = (cols[nameIdx]   || '').replace(/['"]/g, '').trim();
    const value   = parseFloat((cols[valueIdx] || '').replace(/['"$,]/g, '')) || 0;
    const status  = normalizeStatus((cols[statusIdx] || 'pipeline').replace(/['"]/g, '').trim().toLowerCase());
    const date    = dateIdx    !== -1 ? normalizeDate((cols[dateIdx]   || '').replace(/['"]/g, '').trim()) : '';
    const notes   = notesIdx   !== -1 ? (cols[notesIdx]   || '').replace(/['"]/g, '').trim() : '';
    const contact = contactIdx !== -1 ? (cols[contactIdx] || '').replace(/['"]/g, '').trim() : '';
    if (!name) { errors.push(`Row ${i + 1}: missing deal name`); continue; }
    deals.push({ id: uid(), name, value, status, date, notes, contact, addedAt: new Date().toISOString() });
  }
  return { deals, errors };
}

function splitCSVLine(line) {
  const result = []; let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

function normalizeStatus(s) {
  if (['closed', 'won', 'close', 'completed', 'done', 'closed won', 'close won', 'win', 'winning', 'success', 'paid', 'booked', 'confirmed'].includes(s)) return 'closed';
  if (['lost', 'dead', 'cancelled', 'canceled', 'closed lost', 'lose', 'no', 'rejected', 'declined'].includes(s)) return 'lost';
  return 'pipeline';
}

function normalizeDate(d) {
  if (!d) return '';
  const p = new Date(d);
  return isNaN(p) ? d : p.toISOString().split('T')[0];
}

// ── FORMAT HELPERS ────────────────────────────────────────────
function formatCurrency(n) {
  n = +n || 0;
  if (n >= 10_000_000) return '₹' + +(n / 10_000_000).toFixed(2) + ' Cr';
  if (n >= 100_000)    return '₹' + +(n / 100_000).toFixed(2)    + ' L';
  if (n >= 1_000)      return '₹' + +(n / 1_000).toFixed(2)      + ' K';
  return '₹' + n.toLocaleString('en-IN');
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function uid() {
  return 'id_' + Math.random().toString(36).slice(2, 10);
}

// Returns the short month name for the current month e.g. "May"
function currentMonthShort() {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][new Date().getMonth()];
}
// Returns the normalised object key for this month's goal e.g. "goal(may)"
function currentGoalKey() {
  return 'goal(' + currentMonthShort().toLowerCase() + ')';
}

function normalizeDeal(raw, clientId) {
  const d = normalizeKeys(raw);
  return {
    ...d,
    clientId,
    value:  +d.value || 0,
    status: normalizeStatus((d.status || 'pipeline').toLowerCase().trim()),
  };
}

function normalizeKeys(obj) {
  const out = {};
  for (const k in obj) out[k.toLowerCase()] = obj[k];
  return out;
}

function normalizeUser(obj) {
  const u = normalizeKeys(obj);
  if (u.role) u.role = u.role.toLowerCase().trim();
  return u;
}
