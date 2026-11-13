// ربط مباشر بـ Meta و TikTok و Snapchat (OAuth + API)
// بيرجع نفس شكل الداتا اللي صفحة الداشبورد مستنياها
import crypto from 'node:crypto';

const BASE = (process.env.PUBLIC_URL || 'https://audit.mahmoudbedier.com').replace(/\/$/, '');
const META_V = 'v21.0';
const env = k => (process.env[k] || '').trim();

export const PLATFORMS = {
  meta: {
    label: 'Meta', configured: () => !!(env('META_APP_ID') && env('META_APP_SECRET')),
    authUrl: state => `https://www.facebook.com/${META_V}/dialog/oauth?` + new URLSearchParams({
      client_id: env('META_APP_ID'), redirect_uri: cb('meta'), state, scope: 'ads_read,business_management', response_type: 'code' }),
  },
  tiktok: {
    label: 'TikTok', configured: () => !!(env('TIKTOK_APP_ID') && env('TIKTOK_APP_SECRET')),
    authUrl: state => `https://business-api.tiktok.com/portal/auth?` + new URLSearchParams({
      app_id: env('TIKTOK_APP_ID'), state, redirect_uri: cb('tiktok') }),
  },
  snapchat: {
    label: 'Snapchat', configured: () => !!(env('SNAP_CLIENT_ID') && env('SNAP_CLIENT_SECRET')),
    authUrl: state => `https://accounts.snapchat.com/login/oauth2/authorize?` + new URLSearchParams({
      client_id: env('SNAP_CLIENT_ID'), redirect_uri: cb('snapchat'), response_type: 'code', scope: 'snapchat-marketing-api', state }),
  },
};
export const cb = p => `${BASE}/api/oauth/${p}/callback`;

class PErr extends Error { constructor(code, message) { super(message); this.code = code; } }

async function j(url, opts = {}) {
  let r, t;
  for (let i = 0; i < 3; i++) {
    try { r = await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) }); t = await r.text(); }
    catch (e) { if (i === 2) throw new PErr('tool_error', 'المنصة مش بترد: ' + e.message); await sleep(1500 * (i + 1)); continue; }
    if (r.status === 429 || r.status >= 500) { if (i < 2) { await sleep(2000 * (i + 1)); continue; } }
    break;
  }
  let body; try { body = JSON.parse(t); } catch { body = { raw: t.slice(0, 300) }; }
  return { status: r.status, body };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const form = o => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });

// ---------- OAuth: تبديل الكود بتوكن ----------
export async function exchange(p, q) {
  if (p === 'meta') {
    const code = q.get('code'); if (!code) throw new PErr('denied', q.get('error_description') || 'الربط اتلغى');
    let { body } = await j(`https://graph.facebook.com/${META_V}/oauth/access_token?` + new URLSearchParams({
      client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), redirect_uri: cb('meta'), code }));
    if (!body.access_token) throw new PErr('tool_error', body.error?.message || 'Meta رفض الربط');
    const long = await j(`https://graph.facebook.com/${META_V}/oauth/access_token?` + new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), fb_exchange_token: body.access_token }));
    const tok = long.body.access_token ? long.body : body;
    const me = (await j(`https://graph.facebook.com/${META_V}/me?fields=name&access_token=${encodeURIComponent(tok.access_token)}`)).body;
    return { access_token: tok.access_token, expires_at: tok.expires_in ? Date.now() + tok.expires_in * 1000 : null, name: me.name || '' };
  }
  if (p === 'tiktok') {
    const code = q.get('auth_code') || q.get('code'); if (!code) throw new PErr('denied', 'الربط اتلغى');
    const { body } = await j('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: env('TIKTOK_APP_ID'), secret: env('TIKTOK_APP_SECRET'), auth_code: code }) });
    if (body.code !== 0 || !body.data?.access_token) throw new PErr('tool_error', body.message || 'TikTok رفض الربط');
    return { access_token: body.data.access_token, expires_at: null, name: `${(body.data.advertiser_ids || []).length} حساب` };
  }
  if (p === 'snapchat') {
    const code = q.get('code'); if (!code) throw new PErr('denied', q.get('error_description') || 'الربط اتلغى');
    const { body } = await j('https://accounts.snapchat.com/login/oauth2/access_token', form({
      grant_type: 'authorization_code', code, redirect_uri: cb('snapchat'), client_id: env('SNAP_CLIENT_ID'), client_secret: env('SNAP_CLIENT_SECRET') }));
    if (!body.access_token) throw new PErr('tool_error', body.error_description || 'Snapchat رفض الربط');
    const me = (await j('https://adsapi.snapchat.com/v1/me', { headers: { Authorization: 'Bearer ' + body.access_token } })).body;
    return { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: Date.now() + (body.expires_in || 1800) * 1000, name: me.me?.display_name || me.me?.email || '' };
  }
}

// ---------- توكن صالح (مع تجديد Snapchat) ----------
export async function token(p, store) {
  const c = store.get(p);
  if (!c) throw new PErr('server_not_connected', 'not connected');
  if (p === 'snapchat' && (!c.expires_at || Date.now() > c.expires_at - 120000)) {
    const { body } = await j('https://accounts.snapchat.com/login/oauth2/access_token', form({
      grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: env('SNAP_CLIENT_ID'), client_secret: env('SNAP_CLIENT_SECRET') }));
    if (!body.access_token) throw new PErr('needs_reauth', 'Snapchat token expired');
    const n = { ...c, access_token: body.access_token, refresh_token: body.refresh_token || c.refresh_token, expires_at: Date.now() + (body.expires_in || 1800) * 1000 };
    store.set(p, n); return n.access_token;
  }
  if (p === 'meta' && c.expires_at && Date.now() > c.expires_at) throw new PErr('needs_reauth', 'Meta token expired');
  return c.access_token;
}

// ---------- Meta ----------
async function metaGet(tok, url) {
  const { body } = await j(url + (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(tok));
  if (body.error) {
    if (body.error.code === 190) throw new PErr('needs_reauth', body.error.message);
    throw new PErr('tool_error', body.error.message);
  }
  return body;
}
const META_STATUS = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED' };
async function metaAccounts(tok) {
  const out = []; let url = `https://graph.facebook.com/${META_V}/me/adaccounts?fields=account_id,name,currency,account_status,timezone_name&limit=100`;
  for (let g = 0; url && g < 30; g++) {
    const b = await metaGet(tok, url);
    for (const a of b.data || []) out.push({ ad_account_id: a.id, ad_account_name: a.name, currency: a.currency,
      account_status: META_STATUS[a.account_status] || String(a.account_status), is_queryable: a.account_status === 1, is_ads_mcp_enabled: true });
    url = b.paging?.next ? b.paging.next.replace(/access_token=[^&]+&?/, '') : null;
  }
  return { ad_accounts: out };
}
const firstOf = (arr, types) => { for (const t of types) { const v = (arr || []).find(a => a.action_type === t); if (v) return +v.value || 0; } return 0; };
async function metaInsights(tok, input) {
  const tr = typeof input.time_range === 'string' ? JSON.parse(input.time_range) : input.time_range;
  const id = String(input.ad_account_id).startsWith('act_') ? input.ad_account_id : 'act_' + input.ad_account_id;
  let url = `https://graph.facebook.com/${META_V}/${id}/insights?` + new URLSearchParams({
    level: 'account', time_increment: '1', time_range: JSON.stringify(tr), fields: 'spend,actions,action_values', limit: '100' });
  const rows = [];
  for (let g = 0; url && g < 20; g++) {
    const b = await metaGet(tok, url);
    for (const r of b.data || []) {
      const purchaseTypes = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
      rows.push({ date_start: r.date_start, amount_spent: +r.spend || 0,
        omni_purchase: firstOf(r.actions, purchaseTypes), omni_purchase_values: firstOf(r.action_values, purchaseTypes),
        landing_page_view: firstOf(r.actions, ['omni_landing_page_view', 'landing_page_view']) });
    }
    url = b.paging?.next ? b.paging.next.replace(/access_token=[^&]+&?/, '') : null;
  }
  return { ad_entities: rows, pagination: {} };
}

// ---------- TikTok ----------
async function tt(tok, path, params) {
  const { body } = await j(`https://business-api.tiktok.com/open_api/v1.3/${path}?` + new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]))),
    { headers: { 'Access-Token': tok } });
  if (body.code === 40105 || body.code === 40104) throw new PErr('needs_reauth', body.message);
  return body;
}
async function ttAdvertisers(tok) {
  const b = await tt(tok, 'oauth2/advertiser/get/', { app_id: env('TIKTOK_APP_ID'), secret: env('TIKTOK_APP_SECRET') });
  if (b.code !== 0) throw new PErr('tool_error', b.message);
  const list = b.data?.list || [];
  // نجيب العملة والحالة
  const ids = list.map(a => String(a.advertiser_id));
  for (let i = 0; i < ids.length; i += 100) {
    const info = await tt(tok, 'advertiser/info/', { advertiser_ids: ids.slice(i, i + 100), fields: ['advertiser_id', 'currency', 'timezone', 'status'] });
    for (const x of info.data?.list || []) { const a = list.find(z => String(z.advertiser_id) === String(x.advertiser_id)); if (a) Object.assign(a, { currency: x.currency, timezone: x.timezone, status: x.status }); }
  }
  return { code: 0, data: { list } };
}

// ---------- Snapchat ----------
async function snap(tok, path, params) {
  const { status, body } = await j('https://adsapi.snapchat.com/v1' + path + (params ? '?' + new URLSearchParams(params) : ''), { headers: { Authorization: 'Bearer ' + tok } });
  if (status === 401) throw new PErr('needs_reauth', 'Snapchat');
  if (status >= 400 || body.request_status === 'ERROR') throw new PErr('tool_error', body.debug_message || body.display_message || ('Snapchat ' + status));
  return body;
}
async function snapAccounts(tok, input) {
  if (input.account_relationship === 'shared') return { adaccounts: [] };
  const orgs = await snap(tok, '/me/organizations', { with_ad_accounts: 'true' });
  const adaccounts = [];
  for (const o of orgs.organizations || []) for (const a of o.organization?.ad_accounts || [])
    adaccounts.push({ adaccount: { id: a.id, name: a.name + (orgs.organizations.length > 1 ? ` (${o.organization.name})` : ''), currency: a.currency, timezone: a.timezone, status: a.status } });
  return { adaccounts };
}
async function snapStats(tok, input) {
  const p = { granularity: input.granularity || 'DAY', fields: (input.fields || []).join(','), start_time: input.start_time, end_time: input.end_time,
    swipe_up_attribution_window: input.swipe_up_attribution_window || '28_DAY', view_attribution_window: input.view_attribution_window || '1_DAY' };
  if (input.breakdown) p.breakdown = input.breakdown;
  if (input.omit_empty) p.omit_empty = 'true';
  const b = await snap(tok, `/adaccounts/${encodeURIComponent(input.ad_account_id)}/stats`, p);
  return { timeseries_stats: b.timeseries_stats || [] };
}

// ---------- نفس أسماء الأدوات اللي الصفحة بتستخدمها ----------
const TOOLS = {
  ads_get_ad_accounts:        { p: 'meta',     run: (t) => metaAccounts(t) },
  ads_get_ad_entities:        { p: 'meta',     run: (t, i) => metaInsights(t, i), account: i => String(i.ad_account_id) },
  auth_advertiser_get:        { p: 'tiktok',   run: (t) => ttAdvertisers(t) },
  report_integrated_get:      { p: 'tiktok',   run: (t, i) => tt(t, 'report/integrated/get/', i), account: i => String(i.advertiser_id) },
  snap_ads_get_my_ad_accounts:{ p: 'snapchat', run: (t, i) => snapAccounts(t, i) },
  snap_ads_get_ad_account_stats:{ p: 'snapchat', run: (t, i) => snapStats(t, i), account: i => String(i.ad_account_id) },
};
export async function callTool(tool, input, store, canUseAccount) {
  const def = TOOLS[tool]; if (!def) throw new PErr('tool_error', 'unknown tool');
  if (!PLATFORMS[def.p].configured()) throw new PErr('not_configured', 'not configured');
  if (def.account && !canUseAccount(def.p, def.account(input))) throw new PErr('forbidden', 'الحساب ده مش تبع عميل مسموحلك بيه');
  const tok = await token(def.p, store);
  return await def.run(tok, input || {});
}
export const newState = () => crypto.randomBytes(16).toString('hex');
