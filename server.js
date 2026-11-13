import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
// AUDIT_USERS = "mahmoud:Mahmoud:pass1,ahmed:Ahmed:pass2"  (id:الاسم:الباسورد)
const USERS = Object.fromEntries((process.env.AUDIT_USERS || 'admin:Admin:admin').split(',').map(u => {
  const [id, name, ...pw] = u.trim().split(':'); return [id, { id, name, pw: pw.join(':') }];
}));

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'audit.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS docs_col ON docs(col);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);
INSERT OR IGNORE INTO meta VALUES ('version', 0);`);
const bump = () => db.prepare(`UPDATE meta SET v = v + 1 WHERE k='version'`).run();
const version = () => db.prepare(`SELECT v FROM meta WHERE k='version'`).get().v;
const split = p => { const s = String(p).replace(/^\/+|\/+$/g, '').split('/'); return [s.slice(0, -1).join('/'), s.at(-1)]; };

// sessions: signed cookie
const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const unsign = c => { if (!c) return null; const i = c.lastIndexOf('.'); const v = c.slice(0, i);
  return c.length && crypto.timingSafeEqual(Buffer.from(sign(v)), Buffer.from(c)) ? v : null; };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x[0]));
const sessionUser = req => { try { const v = unsign(cookies(req).audit_s); if (!v) return null; const [id, exp] = v.split('|');
  return +exp > Date.now() && USERS[id] ? USERS[id] : null; } catch { return null; } };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const q = url.searchParams;
  try {
    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = await body(req); const u = USERS[String(username || '').trim().toLowerCase()];
      if (!u || !u.pw || !crypto.timingSafeEqual(crypto.createHash('sha256').update(u.pw).digest(), crypto.createHash('sha256').update(String(password || '')).digest()))
        return send(res, 401, { error: 'اسم المستخدم أو الباسورد غلط' });
      const exp = Date.now() + 30 * 864e5;
      return send(res, 200, { ok: true }, { 'Set-Cookie': `audit_s=${encodeURIComponent(sign(u.id + '|' + exp))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` });
    }
    if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'audit_s=; Path=/; Max-Age=0' });
    if (p === '/healthz') return send(res, 200, { ok: true });

    if (p.startsWith('/api/')) {
      const me = sessionUser(req); if (!me) return send(res, 401, { error: 'login required' });
      if (p === '/api/me') return send(res, 200, { id: me.id, name: me.name });
      if (p === '/api/profiles') return send(res, 200, Object.fromEntries(Object.values(USERS).map(u => [u.id, { name: u.name }])));
      if (p === '/api/version') return send(res, 200, { v: version() });
      if (p === '/api/doc') {
        const dpath = q.get('path'); if (!dpath) return send(res, 400, { error: 'path' });
        const [col, id] = split(dpath); const key = col + '/' + id;
        if (req.method === 'GET') { const r = db.prepare('SELECT data FROM docs WHERE path=?').get(key); return send(res, 200, r ? { exists: true, data: JSON.parse(r.data) } : { exists: false }); }
        if (req.method === 'PUT') { const { data, merge } = await body(req); let d = data || {};
          if (merge) { const r = db.prepare('SELECT data FROM docs WHERE path=?').get(key); if (!r) return send(res, 404, { error: 'not found' }); d = { ...JSON.parse(r.data), ...d }; }
          db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data').run(key, col, id, JSON.stringify(d)); bump(); return send(res, 200, { ok: true }); }
        if (req.method === 'DELETE') { db.prepare('DELETE FROM docs WHERE path=?').run(key); bump(); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/add' && req.method === 'POST') { const { col, data } = await body(req); const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?)').run(col + '/' + id, col, id, JSON.stringify(data || {})); bump(); return send(res, 200, { id }); }
      if (p === '/api/query') {
        const col = q.get('col'); let rows = db.prepare('SELECT id,data FROM docs WHERE col=?').all(col).map(r => ({ id: r.id, data: JSON.parse(r.data) }));
        for (const w of q.getAll('where')) { const [f, v] = JSON.parse(w); rows = rows.filter(r => r.data[f] === v); }
        const ob = q.get('orderBy'); if (ob) { const dir = q.get('dir') === 'desc' ? -1 : 1; rows.sort((a, b) => (a.data[ob] > b.data[ob] ? 1 : a.data[ob] < b.data[ob] ? -1 : 0) * dir); }
        const lim = +q.get('limit'); if (lim) rows = rows.slice(0, lim);
        return send(res, 200, { v: version(), docs: rows });
      }
      return send(res, 404, { error: 'not found' });
    }

    // static
    let f = p === '/' ? '/index.html' : p;
    if (!sessionUser(req) && (f === '/index.html')) { res.writeHead(302, { Location: '/login.html' }); return res.end(); }
    const file = path.join(process.cwd(), 'public', path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(process.cwd(), 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
});
server.listen(PORT, () => console.log('audit listening on ' + PORT));
