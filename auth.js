const Auth = {
  getSession() {
    try { return JSON.parse(sessionStorage.getItem('saas_session')); } catch { return null; }
  },
  setSession(user) { sessionStorage.setItem('saas_session', JSON.stringify(user)); },
  clearSession()   { sessionStorage.removeItem('saas_session'); },

  login(email, password) {
    const user = DB.getUsers().find(u =>
      u.email.toLowerCase() === email.toLowerCase() && u.password === password);
    if (!user) return null;
    this.setSession(user);
    return user;
  },

  logout() { this.clearSession(); window.location.href = 'index.html'; },

  requireAdmin() {
    const s = this.getSession();
    if (!s || s.role !== 'admin') { window.location.href = 'index.html'; return null; }
    return s;
  },

  requireClient() {
    const s = this.getSession();
    if (!s || s.role !== 'client') { window.location.href = 'index.html'; return null; }
    return s;
  }
};

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = '') {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.innerHTML = `
    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.3" viewBox="0 0 24 24">
      ${type === 'err'
        ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
        : '<polyline points="20 6 9 17 4 12"/>'}
    </svg>
    <span>${msg}</span>`;
  stack.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── LOADING OVERLAY ───────────────────────────────────────────
function showLoading(msg) {
  if (document.getElementById('db-loading')) return;
  const el = document.createElement('div');
  el.id = 'db-loading';
  el.style.cssText = 'position:fixed;inset:0;background:var(--bg,#f8fafc);display:flex;align-items:center;justify-content:center;z-index:9999;flex-direction:column;gap:14px;';
  el.innerHTML = `
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2.2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
    <div style="width:160px;height:3px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
      <div id="db-prog" style="height:100%;width:30%;background:#6366F1;border-radius:99px;animation:db-slide 1.2s ease-in-out infinite;"></div>
    </div>
    <p style="font-size:13px;color:#64748b;margin:0;font-family:Inter,sans-serif;">${msg || 'Loading data…'}</p>
    <style>#db-prog{animation:db-slide 1.2s ease-in-out infinite}@keyframes db-slide{0%{transform:translateX(-100%)}100%{transform:translateX(600%)}}</style>`;
  document.body.appendChild(el);
}

function hideLoading() {
  const el = document.getElementById('db-loading');
  if (el) el.remove();
}
