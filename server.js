import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as P from './platforms.js';

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'audit.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS docs_col ON docs(col);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);
INSERT OR IGNORE INTO meta VALUES ('version', 0);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS connections (platform TEXT PRIMARY KEY, data TEXT NOT NULL, by TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, pw TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'buyer', clients TEXT NOT NULL DEFAULT '[]', created TEXT);`);
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
const checkPw = (pw, stored) => { const [salt, h] = stored.split(':'); const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(String(pw), salt, 32); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const getUser = id => { const u = db.prepare('SELECT * FROM users WHERE id=?').get(id); return u ? { ...u, clients: JSON.parse(u.clients) } : null; };
const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
const connStore = {
  get: p => { const r = db.prepare('SELECT data FROM connections WHERE platform=?').get(p); return r ? JSON.parse(r.data) : null; },
  set: (p, d, by) => db.prepare('INSERT INTO connections(platform,data,by,at) VALUES(?,?,?,?) ON CONFLICT(platform) DO UPDATE SET data=excluded.data, by=COALESCE(excluded.by,connections.by), at=COALESCE(excluded.at,connections.at)').run(p, JSON.stringify(d), by || null, by ? new Date().toISOString() : null),
};
const oauthStates = new Map();
const SETTING_KEYS = { META_APP_ID: 0, META_APP_SECRET: 1, TIKTOK_APP_ID: 0, TIKTOK_APP_SECRET: 1, SNAP_CLIENT_ID: 0, SNAP_CLIENT_SECRET: 1 };
const getSetting = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
P.setConfigSource(getSetting);
const pub = u => ({ id: u.id, name: u.name, role: u.role, clients: u.clients });
const bump = () => db.prepare(`UPDATE meta SET v = v + 1 WHERE k='version'`).run();
const version = () => db.prepare(`SELECT v FROM meta WHERE k='version'`).get().v;
const split = p => { const s = String(p).replace(/^\/+|\/+$/g, '').split('/'); return [s.slice(0, -1).join('/'), s.at(-1)]; };

// sessions: signed cookie
const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const unsign = c => { if (!c) return null; const i = c.lastIndexOf('.'); const v = c.slice(0, i);
  return c.length && crypto.timingSafeEqual(Buffer.from(sign(v)), Buffer.from(c)) ? v : null; };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=').map(decodeURIComponent)).filter(x => x[0]));
const sessionUser = req => { try { const v = unsign(cookies(req).audit_s); if (!v) return null; const [id, exp] = v.split('|');
  return +exp > Date.now() ? getUser(id) : null; } catch { return null; } };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname; const q = url.searchParams;
  try {
    if (p === '/api/setup' && req.method === 'GET') return send(res, 200, { needsSetup: userCount() === 0 });
    if ((p === '/api/login' || p === '/api/setup') && req.method === 'POST') {
      const { username, password, name } = await body(req); const id = String(username || '').trim().toLowerCase();
      if (p === '/api/setup') {
        if (userCount() > 0) return send(res, 403, { error: 'already set up' });
        if (!/^[a-z0-9._-]{2,30}$/.test(id) || String(password || '').length < 6) return send(res, 400, { error: 'اليوزر إنجليزي من غير مسافات، والباسورد 6 حروف على الأقل' });
        db.prepare('INSERT INTO users(id,name,pw,role,clients,created) VALUES(?,?,?,?,?,?)').run(id, name || id, hashPw(password), 'admin', '[]', new Date().toISOString());
      }
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!u || !checkPw(password || '', u.pw)) return send(res, 401, { error: 'اسم المستخدم أو الباسورد غلط' });
      const exp = Date.now() + 30 * 864e5;
      return send(res, 200, { ok: true }, { 'Set-Cookie': `audit_s=${encodeURIComponent(sign(u.id + '|' + exp))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` });
    }
    if (p === '/api/logout') { res.writeHead(302, { Location: '/login.html', 'Set-Cookie': 'audit_s=; Path=/; Max-Age=0' }); return res.end(); }
    if (p === '/healthz') return send(res, 200, { ok: true });

    if (p.startsWith('/api/')) {
      const me = sessionUser(req); if (!me) return send(res, 401, { error: 'login required' });
      if (p === '/api/me') return send(res, 200, pub(me));
      if (p === '/api/profiles') return send(res, 200, Object.fromEntries(db.prepare('SELECT id,name FROM users').all().map(u => [u.id, { name: u.name }])));
      if (p === '/api/users') {
        if (me.role !== 'admin') return send(res, 403, { error: 'admins only' });
        if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM users ORDER BY created').all().map(u => pub({ ...u, clients: JSON.parse(u.clients) })));
        const b = await body(req); const id = String(b.id || '').trim().toLowerCase();
        if (req.method === 'POST') {
          if (!/^[a-z0-9._-]{2,30}$/.test(id)) return send(res, 400, { error: 'اليوزر لازم يكون إنجليزي من غير مسافات' });
          if (getUser(id)) return send(res, 400, { error: 'اليوزر ده موجود' });
          if (String(b.password || '').length < 6) return send(res, 400, { error: 'الباسورد 6 حروف على الأقل' });
          db.prepare('INSERT INTO users(id,name,pw,role,clients,created) VALUES(?,?,?,?,?,?)').run(id, b.name || id, hashPw(b.password), b.role === 'admin' ? 'admin' : 'buyer', JSON.stringify(b.clients || []), new Date().toISOString());
          return send(res, 200, { ok: true });
        }
        const u = getUser(id); if (!u) return send(res, 404, { error: 'not found' });
        if (req.method === 'PUT') {
          if (id === me.id && b.role && b.role !== 'admin') return send(res, 400, { error: 'مينفعش تشيل الأدمن من نفسك' });
          db.prepare('UPDATE users SET name=?, role=?, clients=? WHERE id=?').run(b.name ?? u.name, b.role ? (b.role === 'admin' ? 'admin' : 'buyer') : u.role, JSON.stringify(b.clients ?? u.clients), id);
          if (b.password) { if (String(b.password).length < 6) return send(res, 400, { error: 'الباسورد 6 حروف على الأقل' }); db.prepare('UPDATE users SET pw=? WHERE id=?').run(hashPw(b.password), id); }
          bump(); return send(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') { if (id === me.id) return send(res, 400, { error: 'مينفعش تمسح نفسك' }); db.prepare('DELETE FROM users WHERE id=?').run(id); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/settings') {
        if (me.role !== 'admin') return send(res, 403, { error: 'admins only' });
        if (req.method === 'GET') return send(res, 200, { keys: Object.fromEntries(Object.entries(SETTING_KEYS).map(([k, secret]) => { const v = getSetting(k) || '';
          return [k, secret ? { set: !!v, value: v ? '••••••••' + v.slice(-4) : '' } : { set: !!v, value: v }]; })),
          redirects: { meta: P.cb('meta'), tiktok: P.cb('tiktok'), snapchat: P.cb('snapchat') } });
        if (req.method === 'PUT') { const b = await body(req);
          for (const [k, v] of Object.entries(b || {})) { if (!(k in SETTING_KEYS) || typeof v !== 'string') continue; const t = v.trim(); if (!t) continue;
            db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, t); }
          return send(res, 200, { ok: true }); }
        if (req.method === 'DELETE') { const plat = { meta: ['META_APP_ID', 'META_APP_SECRET'], tiktok: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'], snapchat: ['SNAP_CLIENT_ID', 'SNAP_CLIENT_SECRET'] }[q.get('platform')];
          if (!plat) return send(res, 400, { error: 'platform' }); for (const k of plat) db.prepare('DELETE FROM settings WHERE k=?').run(k);
          db.prepare('DELETE FROM connections WHERE platform=?').run(q.get('platform')); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/connections') {
        return send(res, 200, Object.fromEntries(Object.entries(P.PLATFORMS).map(([k, v]) => { const c = connStore.get(k);
          return [k, { configured: v.configured(), connected: !!c, name: c?.name || '', expired: !!(c && k === 'meta' && c.expires_at && Date.now() > c.expires_at), expiresAt: c?.expires_at || null, isAdmin: me.role === 'admin' }]; })));
      }
      const mConnect = p.match(/^\/api\/connect\/(meta|tiktok|snapchat)$/);
      if (mConnect) {
        if (me.role !== 'admin') return send(res, 403, { error: 'الربط للأدمن بس' });
        const plat = P.PLATFORMS[mConnect[1]]; if (!plat.configured()) return send(res, 400, { error: 'App ID مش متحط في السيرفر' });
        const st = P.newState(); oauthStates.set(st, { p: mConnect[1], u: me.id, exp: Date.now() + 15 * 60000 });
        res.writeHead(302, { Location: plat.authUrl(st) }); return res.end();
      }
      const mCb = p.match(/^\/api\/oauth\/(meta|tiktok|snapchat)\/callback$/);
      if (mCb) {
        const st = oauthStates.get(q.get('state')); oauthStates.delete(q.get('state'));
        const back = (ok, msg) => { res.writeHead(302, { Location: '/#accounts?' + new URLSearchParams({ conn: mCb[1], ok: ok ? '1' : '0', msg: msg || '' }) }); res.end(); };
        if (!st || st.p !== mCb[1] || st.exp < Date.now() || st.u !== me.id) return back(false, 'انتهت مهلة الربط، جرب تاني');
        try { const data = await P.exchange(mCb[1], q); connStore.set(mCb[1], data, me.id); return back(true); }
        catch (e) { console.error('oauth', mCb[1], e.message); return back(false, e.message); }
      }
      if (p === '/api/mcp' && req.method === 'POST') {
        const { tool, input } = await body(req);
        const isAdm = me.role === 'admin'; const allowedC = new Set(me.clients);
        const norm = x => String(x).replace(/^act_/, '');
        const canUseAccount = (plat, acc) => isAdm || db.prepare('SELECT id,data FROM docs WHERE col=?').all('clients')
          .some(r => allowedC.has(r.id) && (JSON.parse(r.data).accounts || []).some(a => a.platform === plat && norm(a.accountId) === norm(acc)));
        try { return send(res, 200, { payload: await P.callTool(tool, input, connStore, canUseAccount) }); }
        catch (e) { console.error('mcp', tool, e.code, e.message); return send(res, 200, { error: { code: e.code || 'tool_error', message: e.message } }); }
      }
      // صلاحيات: الميديا بايرز يشوف ويعدل العملاء المتعينين له بس
      const isAdmin = me.role === 'admin'; const allowed = new Set(me.clients);
      const docClient = (col, id, data) => col === 'clients' ? id : (data && data.clientId) || null;
      const canSee = (col, id, data) => isAdmin || col.startsWith('data/users/') || allowed.has(docClient(col, id, data));
      if (p === '/api/version') return send(res, 200, { v: version() });
      if (p === '/api/doc') {
        const dpath = q.get('path'); if (!dpath) return send(res, 400, { error: 'path' });
        const [col, id] = split(dpath); const key = col + '/' + id;
        const cur = db.prepare('SELECT data FROM docs WHERE path=?').get(key); const curData = cur ? JSON.parse(cur.data) : null;
        if (cur && !canSee(col, id, curData)) return send(res, 403, { error: 'مش مسموحلك' });
        if (col === 'data/users/' + me.id || col.startsWith('data/users/')) { if (col !== 'data/users/' + me.id) return send(res, 403, { error: 'مش مسموحلك' }); }
        if (req.method === 'GET') return send(res, 200, cur ? { exists: true, data: curData } : { exists: false });
        if (req.method !== 'GET' && col === 'clients' && !cur && !isAdmin) return send(res, 403, { error: 'إضافة العملاء للأدمن بس' });
        if (req.method === 'DELETE' && col === 'clients' && !isAdmin) return send(res, 403, { error: 'حذف العملاء للأدمن بس' });
        if (req.method === 'PUT') { const { data, merge } = await body(req); let d = data || {};
          if (!canSee(col, id, { ...(curData || {}), ...d })) return send(res, 403, { error: 'مش مسموحلك' });
          if (merge) { const r = db.prepare('SELECT data FROM docs WHERE path=?').get(key); if (!r) return send(res, 404, { error: 'not found' }); d = { ...JSON.parse(r.data), ...d }; }
          db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data').run(key, col, id, JSON.stringify(d)); bump(); return send(res, 200, { ok: true }); }
        if (req.method === 'DELETE') { db.prepare('DELETE FROM docs WHERE path=?').run(key); bump(); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/add' && req.method === 'POST') { const { col, data } = await body(req); if (!canSee(col, null, data)) return send(res, 403, { error: 'مش مسموحلك' }); const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
        db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?)').run(col + '/' + id, col, id, JSON.stringify(data || {})); bump(); return send(res, 200, { id }); }
      if (p === '/api/query') {
        const col = q.get('col'); let rows = db.prepare('SELECT id,data FROM docs WHERE col=?').all(col).map(r => ({ id: r.id, data: JSON.parse(r.data) })).filter(r => canSee(col, r.id, r.data));
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
