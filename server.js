import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as P from './platforms.js';
import { syncClient, startAutoSync } from './sync.js';
import { createTelegram } from './telegram.js';

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
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT, action TEXT NOT NULL, client TEXT, detail TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
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
// سجل النشاط: من فعل ماذا ومتى (يُحتفظ به 180 يومًا)
let auditN = 0;
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const audit = (req, user, action, detail = {}, client = null) => {
  try {
    db.prepare('INSERT INTO audit(at,user,action,client,detail,ip) VALUES(?,?,?,?,?,?)').run(new Date().toISOString(), user || null, action, client, JSON.stringify(detail), req ? ipOf(req) : null);
    if (++auditN % 200 === 0) db.prepare('DELETE FROM audit WHERE at < ?').run(new Date(Date.now() - 180 * 864e5).toISOString());
  } catch (e) { console.error('audit', e.message); }
};
const SETTING_KEYS = { META_APP_ID: 0, META_APP_SECRET: 1, TIKTOK_APP_ID: 0, TIKTOK_APP_SECRET: 1, SNAP_CLIENT_ID: 0, SNAP_CLIENT_SECRET: 1, TELEGRAM_BOT_TOKEN: 1 };
const getSetting = k => { const r = db.prepare('SELECT v FROM settings WHERE k=?').get(k); return r ? r.v : null; };
P.setConfigSource(getSetting);
const tg = createTelegram({ db, getSetting, getUser });
const onSynced = (clientId, month, results) => { if (month === new Date().toISOString().slice(0, 7) || month === new Date(Date.now() - 864e5).toISOString().slice(0, 7)) return tg.runClient(clientId, results).catch(e => console.error('tg alerts', e.message)); };
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

// يسجّل التغييرات المهمة على العملاء والأهداف وحذف البيانات
function auditDoc(req, me, col, id, before, after) {
  const accKey = a => a.platform + ':' + a.accountId;
  if (col === 'clients') {
    if (!before && after) return audit(req, me.id, 'client_add', { name: after.name }, id);
    if (before && !after) return audit(req, me.id, 'client_delete', { name: before.name }, id);
    const b = new Map((before.accounts || []).map(a => [accKey(a), a])), a = new Map((after.accounts || []).map(x => [accKey(x), x]));
    const added = [...a.keys()].filter(k => !b.has(k)).map(k => ({ platform: a.get(k).platform, id: a.get(k).accountId, name: a.get(k).name || '' }));
    const removed = [...b.keys()].filter(k => !a.has(k)).map(k => ({ platform: b.get(k).platform, id: b.get(k).accountId, name: b.get(k).name || '' }));
    if (added.length) audit(req, me.id, 'accounts_link', { client: after.name, accounts: added }, id);
    if (removed.length) audit(req, me.id, 'accounts_unlink', { client: after.name, accounts: removed }, id);
    const ch = {}; if (before.name !== after.name) ch.name = [before.name, after.name]; if (before.currency !== after.currency) ch.currency = [before.currency, after.currency];
    for (const [k, x] of a) { const o = b.get(k); if (o && (+o.fx || 1) !== (+x.fx || 1)) (ch.fx = ch.fx || []).push({ account: x.name || x.accountId, from: +o.fx || 1, to: +x.fx || 1 }); }
    if (Object.keys(ch).length) audit(req, me.id, 'client_update', { client: after.name, ...ch }, id);
    return;
  }
  if (col === 'targets') {
    const t = after || before, cid = t?.clientId;
    if (!after) return audit(req, me.id, 'target_delete', { month: before?.month, sales: before?.sales }, cid);
    const pick = x => x ? { sales: x.sales, budget: x.budget, roas: x.roas, orders: x.orders, basis: x.basis } : null;
    return audit(req, me.id, 'target_set', { month: after.month, before: pick(before), after: pick(after) }, cid);
  }
  if (!after && before && ['edits', 'daily', 'store', 'tasks'].includes(col)) audit(req, me.id, 'data_delete', { col, date: before.date || before.at || null, entity: before.entity || before.title || before.platform || '' }, before.clientId || null);
}

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
        if (!/^[a-z0-9._-]{2,30}$/.test(id) || String(password || '').length < 6) return send(res, 400, { error: 'اليوزر بالإنجليزية وبدون مسافات، وكلمة المرور 6 أحرف على الأقل' });
        db.prepare('INSERT INTO users(id,name,pw,role,clients,created) VALUES(?,?,?,?,?,?)').run(id, name || id, hashPw(password), 'admin', '[]', new Date().toISOString());
        audit(req, id, 'setup');
      }
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!u || !checkPw(password || '', u.pw)) { audit(req, id || null, 'login_failed'); return send(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }); }
      audit(req, u.id, 'login');
      const exp = Date.now() + 30 * 864e5;
      return send(res, 200, { ok: true }, { 'Set-Cookie': `audit_s=${encodeURIComponent(sign(u.id + '|' + exp))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` });
    }
    if (p === '/api/logout') { const lu = sessionUser(req); if (lu) audit(req, lu.id, 'logout'); res.writeHead(302, { Location: '/login.html', 'Set-Cookie': 'audit_s=; Path=/; Max-Age=0' }); return res.end(); }
    if (p === '/healthz') return send(res, 200, { ok: true });

    // Telegram webhook (public; verified with the secret token header)
    if (p === '/api/telegram/hook' && req.method === 'POST') {
      if (!tg.checkSecret(req.headers['x-telegram-bot-api-secret-token'])) return send(res, 403, { error: 'forbidden' });
      const u = await body(req); tg.receive(u); return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/')) {
      const me = sessionUser(req); if (!me) return send(res, 401, { error: 'login required' });
      if (p === '/api/me') return send(res, 200, pub(me));
      if (p === '/api/profiles') return send(res, 200, Object.fromEntries(db.prepare('SELECT id,name FROM users').all().map(u => [u.id, { name: u.name }])));
      if (p === '/api/users') {
        if (me.role !== 'admin') return send(res, 403, { error: 'admins only' });
        if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM users ORDER BY created').all().map(u => pub({ ...u, clients: JSON.parse(u.clients) })));
        const b = await body(req); const id = String(b.id || '').trim().toLowerCase();
        if (req.method === 'POST') {
          if (!/^[a-z0-9._-]{2,30}$/.test(id)) return send(res, 400, { error: 'اليوزر لازم يكون بالإنجليزية وبدون مسافات' });
          if (getUser(id)) return send(res, 400, { error: 'اسم المستخدم مستخدم بالفعل' });
          if (String(b.password || '').length < 6) return send(res, 400, { error: 'كلمة المرور 6 أحرف على الأقل' });
          db.prepare('INSERT INTO users(id,name,pw,role,clients,created) VALUES(?,?,?,?,?,?)').run(id, b.name || id, hashPw(b.password), b.role === 'admin' ? 'admin' : 'buyer', JSON.stringify(b.clients || []), new Date().toISOString());
          audit(req, me.id, 'user_add', { id, role: b.role === 'admin' ? 'admin' : 'buyer', clients: (b.clients || []).length });
          return send(res, 200, { ok: true });
        }
        const u = getUser(id); if (!u) return send(res, 404, { error: 'not found' });
        if (req.method === 'PUT') {
          if (id === me.id && b.role && b.role !== 'admin') return send(res, 400, { error: 'لا يمكنك إزالة صلاحية المدير عن حسابك' });
          db.prepare('UPDATE users SET name=?, role=?, clients=? WHERE id=?').run(b.name ?? u.name, b.role ? (b.role === 'admin' ? 'admin' : 'buyer') : u.role, JSON.stringify(b.clients ?? u.clients), id);
          if (b.password) { if (String(b.password).length < 6) return send(res, 400, { error: 'كلمة المرور 6 أحرف على الأقل' }); db.prepare('UPDATE users SET pw=? WHERE id=?').run(hashPw(b.password), id); }
          const ch = {}; if (b.role && b.role !== u.role) ch.role = [u.role, b.role]; if (b.name && b.name !== u.name) ch.name = [u.name, b.name]; if (b.password) ch.password = true;
          if (b.clients) { const add = b.clients.filter(x => !u.clients.includes(x)), rem = u.clients.filter(x => !b.clients.includes(x)); if (add.length) ch.clientsAdded = add; if (rem.length) ch.clientsRemoved = rem; }
          if (Object.keys(ch).length) audit(req, me.id, 'user_update', { id, ...ch });
          bump(); return send(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') { if (id === me.id) return send(res, 400, { error: 'لا يمكنك حذف حسابك' }); db.prepare('DELETE FROM users WHERE id=?').run(id); audit(req, me.id, 'user_delete', { id, name: u.name }); return send(res, 200, { ok: true }); }
      }
      if (p.startsWith('/api/telegram')) {
        if (p === '/api/telegram' && req.method === 'GET') {
          let bot = null, error = null; try { bot = (await tg.me())?.username || null; } catch (e) { error = e.message; }
          return send(res, 200, { configured: !!getSetting('TELEGRAM_BOT_TOKEN'), bot, error, links: tg.links(me.id), isAdmin: me.role === 'admin', diag: tg.diag() });
        }
        if (p === '/api/telegram/link' && req.method === 'POST') {
          let bot; try { bot = (await tg.me())?.username; } catch (e) { return send(res, 400, { error: 'تعذّر الوصول للبوت: ' + e.message }); }
          if (!bot) return send(res, 400, { error: 'لم يتم إعداد بوت تيليجرام بعد. اطلب من المدير إضافته من صفحة ربط المنصات.' });
          const code = tg.newCode(me.id);
          return send(res, 200, { code, bot, url: `https://t.me/${bot}?start=${code}`, groupUrl: `https://t.me/${bot}?startgroup=${code}` });
        }
        if (p === '/api/telegram/test' && req.method === 'POST') {
          const chats = tg.links(me.id).filter(l => l.enabled); let ok = 0;
          for (const l of chats) if (await tg.send(l.chat_id, `🔔 رسالة تجربة من audit
مرحبًا ${me.name}، التنبيهات تعمل في هذه المحادثة ✅`)) ok++;
          return send(res, 200, { sent: ok, total: chats.length });
        }
        if (p === '/api/telegram/chat') {
          const b = req.method === 'PUT' ? await body(req) : { chat_id: q.get('chat_id') };
          const n = req.method === 'PUT' ? tg.setEnabled(me.id, b.chat_id, !!b.enabled) : req.method === 'DELETE' ? tg.unlink(me.id, b.chat_id) : 0;
          if (req.method === 'DELETE' && n) audit(req, me.id, 'telegram_unlink', { chat: b.chat_id });
          return send(res, n ? 200 : 404, n ? { ok: true } : { error: 'not found' });
        }
        if (p === '/api/telegram/preview' && req.method === 'GET') {
          const cid = q.get('client'); if (me.role !== 'admin' && !me.clients.includes(cid)) return send(res, 403, { error: 'ليس لديك صلاحية' });
          return send(res, 200, { alerts: tg.evaluate(cid).map(a => ({ text: a.text.replace(/<[^>]+>/g, '') })), summary: (tg.summaryFor(cid) || '').replace(/<[^>]+>/g, ''), recipients: tg.chatsForClient(cid).length });
        }
      }
      if (p === '/api/audit') {
        if (me.role !== 'admin') return send(res, 403, { error: 'admins only' });
        const lim = Math.min(+q.get('limit') || 300, 2000), conds = [], args = [];
        if (q.get('user')) { conds.push('user=?'); args.push(q.get('user')); }
        if (q.get('action')) { conds.push('action LIKE ?'); args.push(q.get('action') + '%'); }
        if (q.get('since')) { conds.push('at>=?'); args.push(q.get('since')); }
        const rows = db.prepare(`SELECT * FROM audit ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY id DESC LIMIT ${lim}`).all(...args)
          .map(r => ({ ...r, detail: (() => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } })() }));
        return send(res, 200, { rows });
      }
      if (p === '/api/settings') {
        if (me.role !== 'admin') return send(res, 403, { error: 'admins only' });
        if (req.method === 'GET') return send(res, 200, { keys: Object.fromEntries(Object.entries(SETTING_KEYS).map(([k, secret]) => { const v = getSetting(k) || '';
          return [k, secret ? { set: !!v, value: v ? '••••••••' + v.slice(-4) : '' } : { set: !!v, value: v }]; })),
          redirects: { meta: P.cb('meta'), tiktok: P.cb('tiktok'), snapchat: P.cb('snapchat') } });
        if (req.method === 'PUT') { const b = await body(req);
          for (const [k, v] of Object.entries(b || {})) { if (!(k in SETTING_KEYS) || typeof v !== 'string') continue; const t = v.trim(); if (!t) continue;
            db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, t); }
          audit(req, me.id, 'settings_update', { keys: Object.keys(b || {}).filter(k => k in SETTING_KEYS && String(b[k] || '').trim()) });
          return send(res, 200, { ok: true }); }
        if (req.method === 'DELETE') { const plat = { meta: ['META_APP_ID', 'META_APP_SECRET'], tiktok: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'], snapchat: ['SNAP_CLIENT_ID', 'SNAP_CLIENT_SECRET'], telegram: ['TELEGRAM_BOT_TOKEN'] }[q.get('platform')];
          if (!plat) return send(res, 400, { error: 'platform' }); for (const k of plat) db.prepare('DELETE FROM settings WHERE k=?').run(k);
          db.prepare('DELETE FROM connections WHERE platform=?').run(q.get('platform')); audit(req, me.id, 'settings_clear', { platform: q.get('platform') }); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/connections') {
        return send(res, 200, Object.fromEntries(Object.entries(P.PLATFORMS).map(([k, v]) => { const c = connStore.get(k);
          return [k, { configured: v.configured(), connected: !!c, name: c?.name || '', expired: !!(c && k === 'meta' && c.expires_at && Date.now() > c.expires_at), expiresAt: c?.expires_at || null, isAdmin: me.role === 'admin' }]; })));
      }
      const mConnect = p.match(/^\/api\/connect\/(meta|tiktok|snapchat)$/);
      if (mConnect) {
        if (me.role !== 'admin') return send(res, 403, { error: 'الربط متاح للمدير فقط' });
        const plat = P.PLATFORMS[mConnect[1]]; if (!plat.configured()) return send(res, 400, { error: 'لم يتم إدخال App ID على الخادم' });
        const st = P.newState(); oauthStates.set(st, { p: mConnect[1], u: me.id, exp: Date.now() + 15 * 60000 });
        res.writeHead(302, { Location: plat.authUrl(st) }); return res.end();
      }
      const mCb = p.match(/^\/api\/oauth\/(meta|tiktok|snapchat)\/callback$/);
      if (mCb) {
        const st = oauthStates.get(q.get('state')); oauthStates.delete(q.get('state'));
        const back = (ok, msg) => { res.writeHead(302, { Location: '/#accounts?' + new URLSearchParams({ conn: mCb[1], ok: ok ? '1' : '0', msg: msg || '' }) }); res.end(); };
        if (!st || st.p !== mCb[1] || st.exp < Date.now() || st.u !== me.id) return back(false, 'انتهت مهلة الربط، حاول مرة أخرى');
        try { const data = await P.exchange(mCb[1], q); connStore.set(mCb[1], data, me.id); audit(req, me.id, 'platform_connect', { platform: mCb[1], name: data.name || '' }); return back(true); }
        catch (e) { console.error('oauth', mCb[1], e.message); audit(req, me.id, 'platform_connect_failed', { platform: mCb[1], error: String(e.message).slice(0, 200) }); return back(false, e.message); }
      }
      if (p === '/api/sync' && req.method === 'POST') {
        const { clientId, month } = await body(req);
        if (!clientId || !/^\d{4}-\d{2}$/.test(String(month || ''))) return send(res, 400, { error: 'clientId / month' });
        if (me.role !== 'admin' && !me.clients.includes(clientId)) return send(res, 403, { error: 'ليس لديك صلاحية على هذا العميل' });
        try { return send(res, 200, await syncClient({ db, P, connStore, bump, clientId, month, by: me.id, onSynced })); }
        catch (e) { console.error('sync', clientId, e.message); return send(res, 500, { error: e.message }); }
      }
      if (p === '/api/mcp' && req.method === 'POST') {
        const { tool, input } = await body(req);
        const isAdm = me.role === 'admin'; const allowedC = new Set(me.clients);
        const norm = x => String(x).replace(/^act_/, '');
        const canUseAccount = (plat, acc) => isAdm || db.prepare('SELECT id,data FROM docs WHERE col=?').all('clients')
          .some(r => allowedC.has(r.id) && (JSON.parse(r.data).accounts || []).some(a => a.platform === plat && norm(a.accountId) === norm(acc)));
        try {
          const payload = await P.callTool(tool, input, connStore, canUseAccount);
          // مسؤول الحملات يرى فقط الحسابات المربوطة بالعملاء المعيّنين له
          if (!isAdm && payload) {
            const mine = plat => { const s = new Set(); for (const r of db.prepare('SELECT id,data FROM docs WHERE col=?').all('clients')) if (allowedC.has(r.id)) for (const a of JSON.parse(r.data).accounts || []) if (a.platform === plat) s.add(norm(a.accountId)); return s; };
            if (tool === 'ads_get_ad_accounts') { const m = mine('meta'); payload.ad_accounts = (payload.ad_accounts || []).filter(a => m.has(norm(a.ad_account_id))); }
            if (tool === 'auth_advertiser_get' && payload.data) { const m = mine('tiktok'); payload.data.list = (payload.data.list || []).filter(a => m.has(norm(a.advertiser_id))); }
            if (tool === 'snap_ads_get_my_ad_accounts') { const m = mine('snapchat'); payload.adaccounts = (payload.adaccounts || []).filter(w => m.has(norm((w.adaccount || w).id))); }
          }
          return send(res, 200, { payload });
        }
        catch (e) { console.error('mcp', tool, e.code, e.message); return send(res, 200, { error: { code: e.code || 'tool_error', message: e.message } }); }
      }
      // الصلاحيات: مسؤول الحملات يرى ويعدّل العملاء المعيّنين له فقط
      const isAdmin = me.role === 'admin'; const allowed = new Set(me.clients);
      const docClient = (col, id, data) => col === 'clients' ? id : (data && data.clientId) || null;
      const canSee = (col, id, data) => isAdmin || col.startsWith('data/users/') || allowed.has(docClient(col, id, data));
      if (p === '/api/version') return send(res, 200, { v: version() });
      if (p === '/api/doc') {
        const dpath = q.get('path'); if (!dpath) return send(res, 400, { error: 'path' });
        const [col, id] = split(dpath); const key = col + '/' + id;
        const cur = db.prepare('SELECT data FROM docs WHERE path=?').get(key); const curData = cur ? JSON.parse(cur.data) : null;
        if (cur && !canSee(col, id, curData)) return send(res, 403, { error: 'ليس لديك صلاحية' });
        if (col === 'data/users/' + me.id || col.startsWith('data/users/')) { if (col !== 'data/users/' + me.id) return send(res, 403, { error: 'ليس لديك صلاحية' }); }
        if (req.method === 'GET') return send(res, 200, cur ? { exists: true, data: curData } : { exists: false });
        if (req.method !== 'GET' && col === 'clients' && !cur && !isAdmin) return send(res, 403, { error: 'إضافة العملاء متاحة للمدير فقط' });
        if (req.method === 'DELETE' && col === 'clients' && !isAdmin) return send(res, 403, { error: 'حذف العملاء متاح للمدير فقط' });
        if (req.method === 'PUT') { const { data, merge } = await body(req); let d = data || {};
          if (!canSee(col, id, { ...(curData || {}), ...d })) return send(res, 403, { error: 'ليس لديك صلاحية' });
          if (merge) { const r = db.prepare('SELECT data FROM docs WHERE path=?').get(key); if (!r) return send(res, 404, { error: 'not found' }); d = { ...JSON.parse(r.data), ...d }; }
          if (col === 'clients' && cur && !isAdmin) {
            const keys = x => JSON.stringify((x.accounts || []).map(a => a.platform + ':' + a.accountId).sort());
            if (keys(d) !== keys(curData)) return send(res, 403, { error: 'ربط الحسابات بالعملاء متاح للمدير فقط' });
          }
          db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data').run(key, col, id, JSON.stringify(d)); bump();
          auditDoc(req, me, col, id, curData, d);
          return send(res, 200, { ok: true }); }
        if (req.method === 'DELETE') { db.prepare('DELETE FROM docs WHERE path=?').run(key); bump(); auditDoc(req, me, col, id, curData, null); return send(res, 200, { ok: true }); }
      }
      if (p === '/api/add' && req.method === 'POST') { const { col, data } = await body(req); if (!canSee(col, null, data)) return send(res, 403, { error: 'ليس لديك صلاحية' }); const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
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
if (process.env.AUTO_SYNC !== 'off') startAutoSync({ db, P, connStore, bump, onSynced });
tg.start();
