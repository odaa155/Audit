// استيراد التعديلات تلقائيًا من سجلات النشاط في Meta وSnapchat إلى سجل التعديلات
import crypto from 'node:crypto';

const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const v = x => (x && typeof x === 'object' && 'value' in x) ? x.value : x;
function localTime(iso, tz = 'Asia/Riyadh') {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  } catch { return String(iso).slice(0, 19); }
}
const classify = s => {
  s = String(s || '').toLowerCase();
  if (/budget|spend_cap|spend cap/.test(s)) return 'Budget';
  if (/bid|cost_cap|cost cap/.test(s)) return 'Bid / Cost cap';
  if (/status|paused|run_status|activ|delet|archiv/.test(s)) return 'Status (On/Off)';
  if (/target|audience|age|gender|geo|location/.test(s)) return 'Targeting';
  if (/creative|image|video|headline|copy|link/.test(s)) return 'Creative';
  if (/optimi|conversion|event|goal/.test(s)) return 'Optimization event';
  if (/placement|position/.test(s)) return 'Placement';
  if (/schedul|start_time|end_time|date/.test(s)) return 'Schedule';
  if (/creat|added|launch/.test(s)) return 'New launch';
  return 'Other';
};
const LEVEL = { CAMPAIGN: 'Campaign', AD_SET: 'Ad set / Ad group', ADSET: 'Ad set / Ad group', AD_SQUAD: 'Ad set / Ad group', AD: 'Ad', ACCOUNT: 'Account', AD_ACCOUNT: 'Account', CREATIVE: 'Ad' };

// ---------- Meta ----------
function metaVal(x, key, top) {
  if (x == null) return '';
  if (typeof x === 'object') {
    const inner = x[key] ?? x.value;
    if (x.type === 'payment_amount' && inner != null && inner !== '') return `${(+inner / 100).toLocaleString('en-US')} ${x.currency || ''}${x.additional_value ? ' ' + x.additional_value : ''}`.trim();
    if (inner != null && typeof inner !== 'object') return String(inner);
    return JSON.stringify(x).slice(0, 120);
  }
  if (top?.type === 'payment_amount' && isFinite(+x)) return `${(+x / 100).toLocaleString('en-US')} ${top.currency || ''}`.trim();
  return String(x);
}
async function metaEdits(P, store, acc, since) {
  const id = String(acc.accountId).startsWith('act_') ? acc.accountId : 'act_' + acc.accountId;
  const rows = await P.metaPaged(store, `${id}/activities`, {
    fields: 'event_type,translated_event_type,event_time,actor_id,actor_name,object_id,object_name,object_type,extra_data,application_name',
    since: String(Math.floor(new Date(since).getTime() / 1000)), until: String(Math.floor(Date.now() / 1000)), limit: '100' }, 10);
  const out = [];
  for (const r of rows) {
    const label = r.translated_event_type || r.event_type || '';
    if (/bill|charge|payment|invoice|funding|receipt/i.test(r.event_type + ' ' + label)) continue;
    let x = {}; try { x = typeof r.extra_data === 'string' ? JSON.parse(r.extra_data) : (r.extra_data || {}); } catch {}
    out.push({
      key: 'meta_' + hash([r.event_time, r.object_id, r.event_type, r.extra_data].join('|')),
      time: r.event_time, platform: 'meta', level: LEVEL[String(r.object_type || '').toUpperCase()] || 'Campaign',
      type: classify(r.event_type + ' ' + label), entity: r.object_name || r.object_id || '',
      before: metaVal(x.old_value, 'old_value', x), after: metaVal(x.new_value, 'new_value', x),
      note: label, authorName: r.actor_name || 'Meta', via: r.application_name || ''
    });
  }
  return out;
}

// ---------- Snapchat (لا يوجد سجل على مستوى الحساب، فنقرأ سجل الحملات والمجموعات التي تغيّرت) ----------
const SNAP_FIELD = { status: 'الحالة', daily_budget_micro: 'الميزانية اليومية', lifetime_budget_micro: 'الميزانية الإجمالية', lifetime_spend_cap_micro: 'سقف الإنفاق', bid_micro: 'المزايدة', auto_bid: 'المزايدة التلقائية', targeting: 'الاستهداف', name: 'الاسم', start_time: 'تاريخ البدء', end_time: 'تاريخ الانتهاء', optimization_goal: 'هدف التحسين', creative_id: 'الإعلان (Creative)', placement_v2: 'أماكن الظهور' };
const snapFmt = (field, val, cur) => {
  val = v(val); if (val == null) return '';
  if (/_micro$/.test(field) && isFinite(+val)) return `${(+val / 1e6).toLocaleString('en-US')} ${cur || ''}`.trim();
  return typeof val === 'object' ? JSON.stringify(val).slice(0, 120) : String(val);
};
async function snapEdits(P, store, acc, since) {
  const sinceMs = new Date(since).getTime(), out = [];
  const lists = [['campaigns', 'campaign', 'campaigns'], ['adsquads', 'adsquad', 'adsquads']];
  const entities = [];
  for (const [path, one, many] of lists) {
    const b = await P.snapGet(store, `/adaccounts/${encodeURIComponent(acc.accountId)}/${path}`, { limit: '250' });
    for (const w of b[many] || []) { const e = w[one] || w; const up = new Date(v(e.updated_at) || 0).getTime(); if (up >= sinceMs) entities.push({ path, id: e.id, up }); }
  }
  entities.sort((a, b) => b.up - a.up);
  for (const e of entities.slice(0, 60)) {
    let b; try { b = await P.snapGet(store, `/${e.path}/${e.id}/external_changelogs`, { limit: '50' }); } catch { continue; }
    for (const w of b.changelogs || []) {
      const c = w.changelog || w; const at = v(c.event_at) || v(c.created_at); if (!at || new Date(at).getTime() < sinceMs) continue;
      const action = v(c.action), recs = c.update_value_records || {};
      const fields = Object.keys(recs);
      const base = { time: at, platform: 'snapchat', level: LEVEL[c.entity_type] || 'Campaign', entity: v(c.name) || c.entity_id, authorName: v(c.email) || v(c.app_name) || 'Snapchat', note: action === 'CREATED' ? 'تم الإنشاء' : action === 'DELETED' ? 'تم الحذف' : '' };
      if (!fields.length) { out.push({ ...base, key: 'snap_' + hash(c.id), type: action === 'CREATED' ? 'New launch' : classify(action), before: '', after: action || '' }); continue; }
      for (const f of fields) out.push({ ...base, key: 'snap_' + hash(c.id + '|' + f), type: action === 'CREATED' ? 'New launch' : classify(f), before: snapFmt(f, recs[f].before_value, acc.currency), after: snapFmt(f, recs[f].after_value, acc.currency), note: [SNAP_FIELD[f] || f, base.note].filter(Boolean).join(' · ') });
    }
  }
  return out;
}

const FETCH = { meta: metaEdits, snapchat: snapEdits };

// يستورد التعديلات الجديدة لعميل واحد (من آخر استيراد، أو آخر 14 يومًا أول مرة)
export async function syncEdits({ db, P, connStore, bump, clientId }) {
  const row = db.prepare('SELECT data FROM docs WHERE path=?').get('clients/' + clientId); if (!row) return { added: 0, results: [] };
  const client = JSON.parse(row.data);
  const last = client.lastEditSync?.at;
  const since = new Date(last ? new Date(last).getTime() - 86400e3 : Date.now() - 14 * 86400e3).toISOString();
  const results = []; let added = 0;
  for (const acc of (client.accounts || []).filter(a => a.via === 'api' && FETCH[a.platform])) {
    try {
      const items = await FETCH[acc.platform](P, connStore, acc, since);
      for (const it of items) {
        const id = `${clientId}_${it.key}`, path = 'edits/' + id;
        if (db.prepare('SELECT 1 FROM docs WHERE path=?').get(path)) continue;
        const data = { clientId, at: localTime(it.time, acc.timezone || 'Asia/Riyadh'), platform: it.platform, accountId: acc.accountId, level: it.level, type: it.type, entity: it.entity, before: it.before, after: it.after, note: it.note, authorId: null, authorName: it.authorName, source: 'api', createdAt: new Date(it.time).toISOString() };
        db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?)').run(path, 'edits', id, JSON.stringify(data)); added++;
      }
      results.push({ platform: acc.platform, accountId: acc.accountId, ok: true, count: items.length });
    } catch (e) { results.push({ platform: acc.platform, accountId: acc.accountId, ok: false, code: e.code, message: e.message }); }
  }
  const fresh = JSON.parse(db.prepare('SELECT data FROM docs WHERE path=?').get('clients/' + clientId).data);
  // لا نقدّم وقت آخر استيراد إذا فشلت منصة، حتى لا تضيع تعديلاتها
  if (!results.some(r => !r.ok)) fresh.lastEditSync = { at: new Date().toISOString(), added };
  db.prepare('UPDATE docs SET data=? WHERE path=?').run(JSON.stringify(fresh), 'clients/' + clientId);
  bump();
  return { added, results };
}
