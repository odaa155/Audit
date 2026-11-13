// يوفّر نفس واجهة claude.use("db"|"user"|"mcp") اللي الصفحة متبنية عليها، لكن على سيرفر audit
(function () {
  async function api(url, opts = {}) {
    const r = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('login required'); }
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
    return r.json();
  }
  const watchers = new Set(); let lastV = -1;
  async function poll() {
    try { const { v } = await api('/api/version'); if (v !== lastV) { lastV = v; for (const w of [...watchers]) w(); } } catch (_) {}
    setTimeout(poll, document.hidden ? 15000 : 3000);
  }
  function snap(docs) { return { docs: docs.map(d => ({ id: d.id, data: () => d.data, exists: true })), metadata: { fromCache: false }, size: docs.length, empty: !docs.length }; }
  function query(col, where = [], orderBy = null, dir = 'asc', limit = 0) {
    const run = async () => { const p = new URLSearchParams({ col }); where.forEach(w => p.append('where', JSON.stringify(w)));
      if (orderBy) { p.set('orderBy', orderBy); p.set('dir', dir); } if (limit) p.set('limit', limit); return (await api('/api/query?' + p)).docs; };
    return {
      where: (f, op, v) => query(col, [...where, [f, v]], orderBy, dir, limit),
      orderBy: (f, d = 'asc') => query(col, where, f, d, limit),
      limit: n => query(col, where, orderBy, dir, n),
      get: async () => snap(await run()),
      add: async data => { const { id } = await api('/api/add', { method: 'POST', body: JSON.stringify({ col, data }) }); kick(); return { id }; },
      onSnapshot(cb, err) { let alive = true; const w = async () => { try { const d = await run(); if (alive) cb(snap(d)); } catch (e) { if (alive && err) err(e); } };
        watchers.add(w); w(); return () => { alive = false; watchers.delete(w); }; }
    };
  }
  function kick() { lastV = -1; api('/api/version').then(({ v }) => { lastV = v; watchers.forEach(w => w()); }).catch(() => {}); }
  const db = {
    collection: col => query(col),
    doc: p => ({
      get: async () => { const r = await api('/api/doc?path=' + encodeURIComponent(p)); return { exists: r.exists, id: p.split('/').pop(), data: () => r.data }; },
      set: async data => { await api('/api/doc?path=' + encodeURIComponent(p), { method: 'PUT', body: JSON.stringify({ data }) }); kick(); },
      update: async data => { await api('/api/doc?path=' + encodeURIComponent(p), { method: 'PUT', body: JSON.stringify({ data, merge: true }) }); kick(); },
      delete: async () => { await api('/api/doc?path=' + encodeURIComponent(p), { method: 'DELETE' }); kick(); }
    })
  };
  let meP = null; const me = () => meP || (meP = api('/api/me'));
  const user = { id: async () => (await me()).id, me: async () => me(), can: async () => true, profiles: async () => api('/api/profiles') };
  const mcp = { async callTool(server, tool, input) {
    const r = await api('/api/mcp', { method: 'POST', body: JSON.stringify({ server, tool, input }) });
    if (r.error) { const e = new Error(r.error.message); e.code = r.error.code; throw e; }
    return { payload: r.payload };
  } };
  window.auditConn = {};
  window.auditConnReady = api('/api/connections').then(c => { window.auditConn = c; return c; }).catch(() => ({}));
  window.claude = { use: async name => name === 'db' ? db : name === 'user' ? user : name === 'mcp' ? (await window.auditConnReady, mcp) : null };
  me().then(u => { if (u.role === 'admin') { const run = () => { const l = document.getElementById('usersLink'), l2 = document.getElementById('settingsLink'); if (l) { l.style.display = ''; if (l2) l2.style.display = ''; } else setTimeout(run, 200); }; run(); } }).catch(() => {});
  poll();
})();
