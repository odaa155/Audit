import { syncEdits } from './edits-sync.js';
// جلب الأرقام اليومية من Meta وTikTok وSnapchat على الخادم وتخزينها في جدول daily
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const val = x => x == null ? 0 : (typeof x === 'object' ? (+(x.value ?? 0) || 0) : (+x || 0));
function tzOffset(tz, iso) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date(iso + 'T12:00:00Z'));
    const v = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT'; return v === 'GMT' ? '+00:00' : v.replace('GMT', '');
  } catch { return '+03:00'; }
}

async function fetchMeta(call, acc, since, until) {
  const pl = await call('ads_get_ad_entities', { ad_account_id: acc.accountId, time_range: { since, until } });
  return (pl.ad_entities || []).filter(e => e.date_start).map(e => ({ date: e.date_start, spend: val(e.amount_spent), sales: val(e.omni_purchase_values), orders: val(e.omni_purchase), visits: val(e.landing_page_view) }));
}
async function fetchTikTok(call, acc, since, until) {
  const out = []; let s = since;
  while (s <= until) {
    let e = addDays(s, 29); if (e > until) e = until;
    const pl = await call('report_integrated_get', { advertiser_id: acc.accountId, report_type: 'BASIC', data_level: 'AUCTION_ADVERTISER', dimensions: ['advertiser_id', 'stat_time_day'], metrics: ['spend', 'complete_payment', 'complete_payment_roas', 'total_landing_page_view'], start_date: s, end_date: e, page_size: 100 });
    if (pl.code && pl.code !== 0) throw Object.assign(new Error(pl.message || 'TikTok error'), { code: 'tool_error' });
    for (const r of pl?.data?.list || []) { const m = r.metrics || {}, sp = +m.spend || 0; out.push({ date: (r.dimensions?.stat_time_day || '').slice(0, 10), spend: sp, sales: sp * (+m.complete_payment_roas || 0), orders: +m.complete_payment || 0, visits: +m.total_landing_page_view || 0 }); }
    s = addDays(e, 1);
  }
  return out;
}
async function fetchSnap(call, acc, since, until) {
  const tz = acc.timezone || 'Asia/Riyadh', endDay = addDays(until, 1);
  const pl = await call('snap_ads_get_ad_account_stats', { ad_account_id: acc.accountId, granularity: 'DAY', fields: ['spend', 'conversion_purchases', 'conversion_purchases_value', 'swipes'], start_time: `${since}T00:00:00${tzOffset(tz, since)}`, end_time: `${endDay}T00:00:00${tzOffset(tz, endDay)}`, breakdown: 'campaign', omit_empty: true, swipe_up_attribution_window: '28_DAY', view_attribution_window: '1_DAY' });
  const byDate = {};
  // بدون breakdown حساب Snapchat يرجع الصرف فقط، لذا نجمع على مستوى الحملات
  for (const t of pl.timeseries_stats || []) for (const camp of t.timeseries_stat?.breakdown_stats?.campaign || []) for (const row of camp.timeseries || []) {
    const st = row.stats || {}; const date = String(row.start_time || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const b = byDate[date] || (byDate[date] = { date, spend: 0, sales: 0, orders: 0, visits: 0 });
    b.spend += (+st.spend || 0) / 1e6; b.sales += (+st.conversion_purchases_value || 0) / 1e6; b.orders += +st.conversion_purchases || 0; b.visits += +st.swipes || 0;
  }
  return Object.values(byDate);
}
const FETCH = { meta: fetchMeta, tiktok: fetchTikTok, snapchat: fetchSnap };

// يجلب شهرًا كاملًا لعميل واحد ويكتب الأيام المتغيرة فقط
export async function syncClient({ db, P, connStore, bump, clientId, month, by = 'system' }) {
  const row = db.prepare('SELECT data FROM docs WHERE path=?').get('clients/' + clientId);
  if (!row) throw new Error('client not found');
  const client = JSON.parse(row.data);
  const today = isoOf(new Date());
  const since = `${month}-01`; let until = `${month}-${pad(daysIn(month))}`; if (until > today) until = today;
  if (since > today) return { results: [], writes: 0 };
  const accs = (client.accounts || []).filter(a => a.via === 'api' && FETCH[a.platform]);
  const agg = {}, results = [];
  for (const a of accs) {
    const call = async (tool, input) => P.callTool(tool, input, connStore, () => true);
    try {
      const rows = await FETCH[a.platform](call, a, since, until);
      const fx = +a.fx || 1; let spend = 0;
      for (const r of rows) {
        if (!r.date || !r.date.startsWith(month)) continue;
        const k = r.date + '|' + a.platform; const b = agg[k] || (agg[k] = { date: r.date, platform: a.platform, spend: 0, sales: 0, orders: 0, visits: 0 });
        b.spend += r.spend * fx; b.sales += r.sales * fx; b.orders += r.orders; b.visits += r.visits; spend += r.spend * fx;
      }
      results.push({ platform: a.platform, accountId: a.accountId, name: a.name, ok: true, spend, days: rows.length });
    } catch (e) {
      results.push({ platform: a.platform, accountId: a.accountId, name: a.name, ok: false, code: e.code || 'tool_error', message: e.message });
    }
  }
  const r2 = x => Math.round(x * 100) / 100; let writes = 0;
  const okPlats = new Set(results.filter(r => r.ok).map(r => r.platform));
  for (const b of Object.values(agg)) {
    if (!okPlats.has(b.platform)) continue;
    const id = `${clientId}_${b.date}_${b.platform}`, key = 'daily/' + id;
    const ex = db.prepare('SELECT data FROM docs WHERE path=?').get(key); const old = ex ? JSON.parse(ex.data) : null;
    const data = { clientId, date: b.date, platform: b.platform, spend: r2(b.spend), sales: r2(b.sales), orders: Math.round(b.orders), visits: Math.round(b.visits) || null, source: 'api', syncedAt: new Date().toISOString(), updatedBy: by };
    if (old && old.source === 'api' && r2(+old.spend) === data.spend && r2(+old.sales) === data.sales && +old.orders === data.orders && (old.visits || null) === data.visits) continue;
    if (!old && !data.spend && !data.sales && !data.orders) continue;
    db.prepare('INSERT INTO docs(path,col,id,data) VALUES(?,?,?,?) ON CONFLICT(path) DO UPDATE SET data=excluded.data').run(key, 'daily', id, JSON.stringify(data)); writes++;
  }
  const fresh = JSON.parse(db.prepare('SELECT data FROM docs WHERE path=?').get('clients/' + clientId).data);
  fresh.lastSync = { at: new Date().toISOString(), by, month, ok: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length };
  db.prepare('UPDATE docs SET data=? WHERE path=?').run(JSON.stringify(fresh), 'clients/' + clientId);
  bump();
  let edits = null;
  try { edits = await syncEdits({ db, P, connStore, bump, clientId }); } catch (e) { console.error('edits sync', clientId, e.message); }
  return { results, writes, edits };
}

// تحديث تلقائي لكل العملاء: الشهر الحالي، والشهر السابق في أول 3 أيام
export function startAutoSync(ctx, everyMs = 3 * 3600e3) {
  let running = false;
  const run = async () => {
    if (running) return; running = true;
    try {
      const now = new Date(), cur = isoOf(now).slice(0, 7);
      const months = [cur]; if (now.getDate() <= 3) months.push(isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7));
      for (const r of ctx.db.prepare('SELECT id,data FROM docs WHERE col=?').all('clients')) {
        if (!(JSON.parse(r.data).accounts || []).some(a => a.via === 'api')) continue;
        for (const m of months) {
          try { const o = await syncClient({ ...ctx, clientId: r.id, month: m }); console.log('autosync', r.id, m, 'writes', o.writes); }
          catch (e) { console.error('autosync', r.id, m, e.message); }
        }
      }
    } finally { running = false; }
  };
  setTimeout(run, 60e3); setInterval(run, everyMs);
}
