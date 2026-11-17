// تنبيهات تيليجرام: ربط الحسابات بالبوت، فحص قواعد التنبيه بعد كل جلب للأرقام، وملخص يومي.
import crypto from 'node:crypto';

const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '');
const BASE = (process.env.PUBLIC_URL || 'https://audit.mahmoudbedier.com').replace(/\/$/, '');
const TZ = 'Asia/Riyadh';
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const n0 = v => (v == null || !isFinite(v)) ? '-' : Math.round(v).toLocaleString('en-US');
const n2 = v => (v == null || !isFinite(v)) ? '-' : v.toFixed(2);
const pct = v => (v == null || !isFinite(v)) ? '-' : Math.round(v * 100) + '%';
const PL = { meta: 'Meta', tiktok: 'TikTok', snapchat: 'Snapchat', google: 'Google', apple: 'Apple' };
const localNow = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour }; };
const addDays = (iso, k) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export const DEFAULT_RULES = { enabled: true, roasMin: null, roasDays: 3, cpaMax: null, budgetPace: true, targetPace: true, spendStop: true, syncFail: true, daily: false };

export function createTelegram({ db, getSetting, getUser }) {
  db.exec(`CREATE TABLE IF NOT EXISTS tg_links (chat_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, type TEXT, enabled INTEGER NOT NULL DEFAULT 1, created TEXT);
CREATE TABLE IF NOT EXISTS tg_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS alert_state (key TEXT PRIMARY KEY, at TEXT NOT NULL);`);
  const token = () => String(getSetting('TELEGRAM_BOT_TOKEN') || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  let botInfo = null, offset = 0, polling = false;

  async function call(method, body, timeoutMs = 20000) {
    const t = token(); if (!t) throw Object.assign(new Error('لم يتم إعداد بوت تيليجرام'), { code: 'not_configured' });
    const r = await fetch(`${API}/bot${t}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw Object.assign(new Error(j.description || `Telegram ${r.status}`), { code: j.error_code || r.status });
    return j.result;
  }
  async function me() { if (!token()) return null; try { botInfo = await call('getMe'); return botInfo; } catch (e) { botInfo = null; throw e; } }
  async function send(chatId, html) {
    try { await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }); return true; }
    catch (e) {
      console.error('telegram send', chatId, e.message);
      if (e.code === 403 || /blocked|kicked|chat not found|deactivated/i.test(e.message)) db.prepare('UPDATE tg_links SET enabled=0 WHERE chat_id=?').run(String(chatId));
      return false;
    }
  }

  // ---------- linking ----------
  function newCode(userId) {
    db.prepare('DELETE FROM tg_codes WHERE exp<?').run(Date.now());
    const code = crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO tg_codes(code,user_id,exp) VALUES(?,?,?)').run(code, userId, Date.now() + 30 * 60e3);
    return code;
  }
  const links = userId => db.prepare('SELECT chat_id,title,type,enabled,created FROM tg_links WHERE user_id=? ORDER BY created').all(userId);
  async function handleUpdate(u) {
    const m = u.message || u.channel_post; if (!m?.text) return;
    const chat = m.chat, txt = m.text.trim();
    const mt = txt.match(/^(?:\/(?:start|link)(?:@\w+)?\s+)?([a-f0-9]{12})$/i);
    if (mt) {
      const row = db.prepare('SELECT * FROM tg_codes WHERE code=?').get(mt[1].toLowerCase());
      if (!row || row.exp < Date.now()) return send(chat.id, 'رمز الربط غير صالح أو انتهت صلاحيته. افتح التطبيق واضغط "ربط تيليجرام" للحصول على رابط جديد.');
      const user = getUser(row.user_id); if (!user) return;
      const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '';
      db.prepare('INSERT INTO tg_links(chat_id,user_id,title,type,enabled,created) VALUES(?,?,?,?,1,?) ON CONFLICT(chat_id) DO UPDATE SET user_id=excluded.user_id,title=excluded.title,type=excluded.type,enabled=1').run(String(chat.id), user.id, title, chat.type, new Date().toISOString());
      db.prepare('DELETE FROM tg_codes WHERE code=?').run(row.code);
      return send(chat.id, `✅ تم الربط بحساب <b>${esc(user.name)}</b> في audit.\nستصلك هنا تنبيهات ${user.role === 'admin' ? 'كل العملاء' : 'العملاء المعيّنين لك'}.\n\nلإيقاف التنبيهات أرسل /stop`);
    }
    if (/^\/stop(?:@\w+)?$/i.test(txt)) { db.prepare('UPDATE tg_links SET enabled=0 WHERE chat_id=?').run(String(chat.id)); return send(chat.id, 'تم إيقاف التنبيهات في هذه المحادثة. لإعادتها أرسل /resume'); }
    if (/^\/resume(?:@\w+)?$/i.test(txt)) { const r = db.prepare('UPDATE tg_links SET enabled=1 WHERE chat_id=?').run(String(chat.id)); return send(chat.id, r.changes ? 'تمت إعادة تفعيل التنبيهات ✅' : 'هذه المحادثة غير مربوطة بالتطبيق.'); }
    if (/^\/start(?:@\w+)?$/i.test(txt) && chat.type === 'private') return send(chat.id, 'أهلًا 👋 لربط هذه المحادثة، افتح audit واضغط على صورتك ← "ربط تيليجرام".');
  }
  // Receiving updates: webhook when the site is public HTTPS (robust in containers), else long polling.
  // Falls back to polling automatically if Telegram can't deliver to the webhook.
  const diag = { mode: null, lastUpdateAt: null, lastError: null, lastErrorAt: null, webhookUrl: null };
  const setErr = e => { diag.lastError = String(e?.message || e).slice(0, 300); diag.lastErrorAt = new Date().toISOString(); };
  const secret = () => crypto.createHash('sha256').update('audit-tg|' + token()).digest('hex').slice(0, 40);
  const checkSecret = h => !!token() && typeof h === 'string' && h.length === 40 && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(secret()));
  const wantWebhook = () => BASE.startsWith('https://') && process.env.TELEGRAM_POLLING !== '1';
  async function receive(u) { diag.lastUpdateAt = new Date().toISOString(); try { await handleUpdate(u); } catch (e) { console.error('tg update', e.message); setErr(e); } }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let curTok = null, lastCheck = 0, forcePolling = false;
  async function loop() {
    if (polling) return; polling = true;
    let wait = 2000;
    while (true) {
      const t = token();
      if (!t) { diag.mode = null; curTok = null; await sleep(3000); continue; }
      if (t !== curTok) { curTok = t; diag.mode = null; forcePolling = false; offset = 0; }
      try {
        if (!diag.mode) {
          if (wantWebhook() && !forcePolling) {
            const url = `${BASE}/api/telegram/hook`;
            await call('setWebhook', { url, secret_token: secret(), allowed_updates: ['message', 'channel_post'], max_connections: 10 });
            diag.mode = 'webhook'; diag.webhookUrl = url; lastCheck = Date.now(); console.log('telegram: webhook mode', url);
          } else { await call('deleteWebhook', {}); diag.mode = 'polling'; diag.webhookUrl = null; console.log('telegram: polling mode'); }
        }
        if (diag.mode === 'webhook') {
          await sleep(5000);
          if (Date.now() - lastCheck > 60000) {
            lastCheck = Date.now();
            const info = await call('getWebhookInfo', {});
            if (info.url !== diag.webhookUrl) { diag.mode = null; continue; } // replaced elsewhere: set again
            if (info.last_error_date && Date.now() / 1000 - info.last_error_date < 600 && info.pending_update_count > 0) {
              setErr('Telegram لا يستطيع الوصول للموقع: ' + (info.last_error_message || '')); forcePolling = true; diag.mode = null;
            }
          }
          continue;
        }
        const ups = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'channel_post'] }, 35000);
        for (const u of ups) { offset = u.update_id + 1; await receive(u); }
        wait = 2000;
      } catch (e) {
        if (e.code !== 'not_configured') { console.error('tg loop', e.message); setErr(e); }
        if (diag.mode === null && wantWebhook() && !forcePolling) forcePolling = true; // setWebhook failed: use polling
        if (e.code === 409 && diag.mode === 'polling') diag.mode = null; // a webhook was set elsewhere
        await sleep(wait); wait = Math.min(wait * 2, 60000);
      }
    }
  }

  // ---------- recipients ----------
  function chatsForClient(clientId, { adminsOnly = false } = {}) {
    const out = [];
    for (const l of db.prepare('SELECT chat_id,user_id FROM tg_links WHERE enabled=1').all()) {
      const u = getUser(l.user_id); if (!u) continue;
      if (u.role === 'admin' || (!adminsOnly && u.clients.includes(clientId))) out.push(l.chat_id);
    }
    return [...new Set(out)];
  }
  // send once per key within `everyH` hours
  const once = (key, everyH = 20) => {
    const r = db.prepare('SELECT at FROM alert_state WHERE key=?').get(key);
    if (r && Date.now() - new Date(r.at).getTime() < everyH * 3600e3) return false;
    db.prepare('INSERT INTO alert_state(key,at) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at').run(key, new Date().toISOString());
    return true;
  };
  const clear = key => db.prepare('DELETE FROM alert_state WHERE key=?').run(key);

  // ---------- data helpers ----------
  const clientDoc = id => { const r = db.prepare('SELECT data FROM docs WHERE path=?').get('clients/' + id); return r ? JSON.parse(r.data) : null; };
  const rows = (col, clientId) => db.prepare('SELECT data FROM docs WHERE col=?').all(col).map(r => JSON.parse(r.data)).filter(d => d.clientId === clientId);
  function sum(daily, from, to, plat) {
    const t = { spend: 0, sales: 0, orders: 0, days: new Set() };
    for (const r of daily) if (r.date >= from && r.date <= to && (!plat || r.platform === plat)) { t.spend += +r.spend || 0; t.sales += +r.sales || 0; t.orders += +r.orders || 0; t.days.add(r.date); }
    return { ...t, days: t.days.size, roas: t.spend ? t.sales / t.spend : null, cpa: t.orders ? t.spend / t.orders : null };
  }
  const link = (clientId, view = 'overview') => `${BASE}/#${view}?client=${encodeURIComponent(clientId)}`;

  // ---------- rules ----------
  // Returns the list of alert messages for one client (does not send).
  function evaluate(clientId, syncResults = null) {
    const c = clientDoc(clientId); if (!c) return [];
    const R = { ...DEFAULT_RULES, ...(c.alerts || {}) }; if (!R.enabled) return [];
    const { date: today } = localNow(), yday = addDays(today, -1), ym = yday.slice(0, 7);
    const daily = rows('daily', clientId), target = rows('targets', clientId).find(t => t.month === ym);
    const cur = c.currency || 'SAR', name = esc(c.name), out = [];
    const push = (key, everyH, text, opts) => out.push({ key: `${clientId}|${key}`, everyH, text, ...opts });

    // 1) ROAS below threshold over the last N complete days
    const roasMin = R.roasMin ?? (target?.roas ? +(target.roas * 0.8).toFixed(2) : null);
    if (roasMin) {
      const N = Math.min(Math.max(+R.roasDays || 3, 1), 14), s = sum(daily, addDays(yday, -(N - 1)), yday);
      if (s.days >= Math.min(N, 2) && s.spend > 0 && s.roas < roasMin) {
        const worst = Object.keys(PL).map(p => ({ p, ...sum(daily, addDays(yday, -(N - 1)), yday, p) })).filter(x => x.spend > 0).sort((a, b) => (a.roas ?? 0) - (b.roas ?? 0))[0];
        push(`roas|${yday}`, 20, `📉 <b>${name}</b>: ROAS منخفض\n${N === 1 ? 'أمس' : `آخر ${N} أيام`}: <b>${n2(s.roas)}</b> (الحد ${n2(roasMin)})\nالصرف ${n0(s.spend)} ${cur} · المبيعات ${n0(s.sales)} ${cur}${worst ? `\nالأضعف: ${PL[worst.p]} بـ ROAS ${n2(worst.roas)}` : ''}`);
      }
    }
    // 2) CPA above max (yesterday)
    if (R.cpaMax) { const s = sum(daily, yday, yday); if (s.orders && s.cpa > R.cpaMax) push(`cpa|${yday}`, 20, `💸 <b>${name}</b>: تكلفة الطلب أمس <b>${n0(s.cpa)} ${cur}</b> أعلى من الحد (${n0(R.cpaMax)})\n${n0(s.orders)} طلب بصرف ${n0(s.spend)} ${cur}`); }
    if (target) {
      const dim = daysIn(ym), elapsed = +yday.slice(8), pace = elapsed / dim, m = sum(daily, ym + '-01', yday);
      // 3) budget pacing
      if (R.budgetPace && target.budget && elapsed >= 3) {
        const used = m.spend / target.budget;
        if (used > pace * 1.15 && used - pace > 0.05) push(`budget|${ym}|${Math.floor(used * 10)}`, 48, `⚠️ <b>${name}</b>: الصرف أسرع من الميزانية\nتم صرف <b>${pct(used)}</b> من ميزانية الشهر بعد ${pct(pace)} من أيامه\n${n0(m.spend)} من ${n0(target.budget)} ${cur} · المتوقع آخر الشهر ${n0(m.spend / elapsed * dim)} ${cur}`);
      }
      // 4) behind the sales target
      if (R.targetPace && target.sales && elapsed >= 5) {
        const ach = m.sales / target.sales;
        if (ach < pace * 0.85) push(`target|${ym}|${yday.slice(0, 8)}${Math.floor(elapsed / 7)}`, 24 * 6, `🎯 <b>${name}</b>: متأخرون عن الهدف\nالمحقق <b>${pct(ach)}</b> من ${n0(target.sales)} ${cur} بعد ${pct(pace)} من الشهر\nالمطلوب يوميًا لباقي الشهر: <b>${n0((target.sales - m.sales) / Math.max(dim - elapsed, 1))} ${cur}</b>`);
      }
    }
    // 5) spend stopped on a platform (had spend the day before, none yesterday)
    if (R.spendStop) for (const a of (c.accounts || []).filter(a => a.via === 'api')) {
      const before = sum(daily, addDays(yday, -1), addDays(yday, -1), a.platform), y = sum(daily, yday, yday, a.platform);
      if (before.spend > 0 && y.days && y.spend === 0) push(`stop|${a.platform}|${yday}`, 20, `⛔ <b>${name}</b>: توقف الصرف على ${PL[a.platform] || a.platform} أمس\nكان الصرف قبلها ${n0(before.spend)} ${cur}. تأكد من حالة الحساب أو الحملات.`);
    }
    // 6) sync failures (admins only), cleared when the platform recovers
    if (R.syncFail && syncResults) for (const r of syncResults) {
      const key = `sync|${r.platform}|${r.accountId}`;
      if (r.ok) { clear(`${clientId}|${key}`); continue; }
      const why = r.code === 'needs_reauth' ? 'انتهت صلاحية الربط ويحتاج إعادة ربط' : r.code === 'forbidden' ? 'لا توجد صلاحية على الحساب' : (r.message || '').slice(0, 160);
      push(key, 24, `🔌 <b>${name}</b>: تعذّر جلب أرقام ${PL[r.platform] || r.platform}\nالحساب: ${esc(r.name || r.accountId)}\nالسبب: ${esc(why)}`, { adminsOnly: true, view: 'accounts' });
    }
    return out;
  }

  async function runClient(clientId, syncResults) {
    if (!token()) return 0;
    let sent = 0;
    for (const a of evaluate(clientId, syncResults)) {
      const chats = chatsForClient(clientId, { adminsOnly: a.adminsOnly });
      if (!chats.length || !once(a.key, a.everyH)) continue;
      const text = `${a.text}\n\n<a href="${link(clientId, a.view)}">فتح في audit ←</a>`;
      for (const ch of chats) if (await send(ch, text)) sent++;
    }
    return sent;
  }

  // ---------- daily summary (9:00 Riyadh) ----------
  function summaryFor(clientId) {
    const c = clientDoc(clientId); if (!c) return null;
    const { date: today } = localNow(), y = addDays(today, -1), daily = rows('daily', clientId);
    const s = sum(daily, y, y), prev = sum(daily, addDays(y, -7), addDays(y, -7)), cur = c.currency || 'SAR';
    if (!s.days) return null;
    const ch = (a, b) => b ? ` (${a >= b ? '▲' : '▼'} ${Math.abs(Math.round((a - b) / b * 100))}% عن نفس اليوم الأسبوع الماضي)` : '';
    const lines = Object.keys(PL).map(p => ({ p, ...sum(daily, y, y, p) })).filter(x => x.spend > 0).map(x => `• ${PL[x.p]}: صرف ${n0(x.spend)} · ROAS ${n2(x.roas)}`);
    const ym = y.slice(0, 7), t = rows('targets', clientId).find(x => x.month === ym), m = sum(daily, ym + '-01', y);
    return `☀️ <b>ملخص أمس · ${esc(c.name)}</b> (${y})\nالصرف: <b>${n0(s.spend)} ${cur}</b>${ch(s.spend, prev.spend)}\nالمبيعات: <b>${n0(s.sales)} ${cur}</b>${ch(s.sales, prev.sales)}\nROAS: <b>${n2(s.roas)}</b> · الطلبات: ${n0(s.orders)}\n${lines.join('\n')}${t?.sales ? `\n\n🎯 الهدف: ${pct(m.sales / t.sales)} محقق من ${n0(t.sales)} ${cur}` : ''}`;
  }
  async function dailySummaries() {
    if (!token()) return;
    const { date, hour } = localNow(); if (hour < 9) return;
    for (const r of db.prepare('SELECT id,data FROM docs WHERE col=?').all('clients')) {
      const c = JSON.parse(r.data), R = { ...DEFAULT_RULES, ...(c.alerts || {}) };
      if (!R.enabled || !R.daily || !once(`${r.id}|daily|${date}`, 20)) continue;
      const text = summaryFor(r.id); if (!text) continue;
      for (const ch of chatsForClient(r.id)) await send(ch, `${text}\n\n<a href="${link(r.id)}">فتح في audit ←</a>`);
    }
  }

  function start() { loop(); setInterval(() => dailySummaries().catch(e => console.error('tg daily', e.message)), 10 * 60e3); }

  return { receive, checkSecret, diag: () => ({ ...diag }), me, send, newCode, links, runClient, evaluate, summaryFor, chatsForClient, start, botName: () => botInfo?.username || null,
    setEnabled: (userId, chatId, on) => db.prepare('UPDATE tg_links SET enabled=? WHERE chat_id=? AND user_id=?').run(on ? 1 : 0, String(chatId), userId).changes,
    unlink: (userId, chatId) => db.prepare('DELETE FROM tg_links WHERE chat_id=? AND user_id=?').run(String(chatId), userId).changes,
    handleUpdate };
}
