// App state, permissions, month math, MCP helpers shared by all views.
import { div, daysIn, todayISO, toast } from "./lib.js";

export const state = {
  db: null, user: null, mcp: null, uid: null, me: null, canWrite: false,
  clients: [], cid: null, daily: [], store: [], edits: [], targets: {}, lastSeen: null,
  month: null, monthTouched: false, range: null, syncing: false, names: {}, view: "overview", unsubs: [], loadedClients: false, found: {}
};
// Filled by main.js to avoid circular imports.
export const hooks = { renderAll() {}, selectClient() {} };

export const client = () => state.clients.find(c => c.id === state.cid) || null;
export const cur = () => client()?.currency || "SAR";
export const nameOf = id => id === state.uid ? "أنت" : (state.names[id] || "زميل");
export const isAdmin = () => state.me?.role === "admin";
export const isNewEdit = e => e.authorId !== state.uid && state.lastSeen && (e.createdAt || e.at) > state.lastSeen;

export function guard() {
  if (!state.db || !state.canWrite) { toast("لا يمكن الحفظ: تحتاج إلى صلاحية تعديل.", "bad"); return false; }
  return true;
}
export async function safe(p, ok) {
  try { await p; if (ok) toast(ok, "good"); return true; }
  catch (e) { toast(e && e.code === "quota_exceeded" ? "المساحة ممتلئة: احذف بعض البيانات القديمة." : (e?.message && e.message.length < 80 ? e.message : "تعذّر الحفظ، حاول مرة أخرى."), "bad"); return false; }
}

// ---------- month math ----------
export function monthsAvailable() {
  const set = new Set([todayISO().slice(0, 7)]);
  for (const r of state.daily) if (r.date) set.add(r.date.slice(0, 7));
  for (const r of state.store) if (r.date) set.add(r.date.slice(0, 7));
  for (const k of Object.keys(state.targets)) set.add(k);
  if (state.month) set.add(state.month);
  return [...set].sort().reverse();
}
export function latestDataMonth() { const ds = state.daily.map(r => r.date).filter(Boolean).sort(); return ds.length ? ds[ds.length - 1].slice(0, 7) : todayISO().slice(0, 7); }
export const monthData = ym => rangeData(ym + "-01", ym + "-31");
// Totals for any date range (inclusive). byDay holds per-day platform totals for charts.
export function rangeData(from, to) {
  const inR = r => r.date && r.date >= from && r.date <= to;
  const rows = state.daily.filter(inR);
  const store = state.store.filter(inR);
  const dates = [...new Set([...rows.map(r => r.date), ...store.map(r => r.date)])].sort();
  const byPlat = {};
  for (const r of rows) { const b = byPlat[r.platform] || (byPlat[r.platform] = { spend: 0, sales: 0, orders: 0, visits: 0 }); b.spend += +r.spend || 0; b.sales += +r.sales || 0; b.orders += +r.orders || 0; b.visits += +r.visits || 0; }
  const tot = { spend: 0, sales: 0, orders: 0, visits: 0 };
  for (const b of Object.values(byPlat)) { tot.spend += b.spend; tot.sales += b.sales; tot.orders += b.orders; tot.visits += b.visits; }
  const storeTot = { sales: 0, orders: 0, days: store.length };
  for (const s of store) { storeTot.sales += +s.sales || 0; storeTot.orders += +s.orders || 0; }
  const storeDays = new Set(store.map(s => s.date));
  const spendOnStoreDays = rows.filter(r => storeDays.has(r.date)).reduce((a, r) => a + (+r.spend || 0), 0);
  const byDay = {};
  for (const r of rows) { const d = byDay[r.date] || (byDay[r.date] = { spend: 0, sales: 0, orders: 0, plat: {} }); d.spend += +r.spend || 0; d.sales += +r.sales || 0; d.orders += +r.orders || 0; const pp = d.plat[r.platform] || (d.plat[r.platform] = { spend: 0, sales: 0 }); pp.spend += +r.spend || 0; pp.sales += +r.sales || 0; }
  return { rows, store, dates, byPlat, byDay, tot, storeTot, spendOnStoreDays, lastDate: dates[dates.length - 1] || null };
}
export function basisNumbers(md, t) {
  const basis = t?.basis || "platform";
  if (basis === "store" && md.storeTot.days > 0) return { basis: "store", sales: md.storeTot.sales, orders: md.storeTot.orders, roas: div(md.storeTot.sales, md.spendOnStoreDays), aov: div(md.storeTot.sales, md.storeTot.orders) };
  return { basis: "platform", sales: md.tot.sales, orders: md.tot.orders, roas: div(md.tot.sales, md.tot.spend), aov: div(md.tot.sales, md.tot.orders), fellBack: basis === "store" };
}
export function elapsedDays(ym, md) {
  const today = todayISO();
  if (md.lastDate) return Number(md.lastDate.slice(8, 10));
  if (today.startsWith(ym)) return Math.max(Number(today.slice(8, 10)) - 1, 0);
  return today > ym ? daysIn(ym) : 0;
}

// ---------- platform calls ----------
export async function callMcp(server, tool, input, opts) {
  try { return await state.mcp.callTool(server, tool, input, opts); }
  catch (e) {
    if (e && e.retryable) { await new Promise(r => setTimeout(r, Math.min(e.retryAfterMs || 1500 + Math.random() * 1500, 8000))); return await state.mcp.callTool(server, tool, input, opts); }
    throw e;
  }
}
export function mcpErrorText(e, server) {
  const code = e?.code || "";
  if (code === "server_not_connected") return `${server} غير مربوط. اربطه من صفحة ربط المنصات.`;
  if (code === "needs_reauth") return `صلاحية ربط ${server} انتهت. اضغط "إعادة الربط".`;
  if (code === "not_configured") return `ربط ${server} يحتاج إلى App ID من صفحة ربط المنصات.`;
  if (code === "forbidden") return e.message;
  if (code === "tool_error") return "أعادت المنصة خطأ: " + (e.message || "").slice(0, 200);
  if (code === "server_unavailable") return `سيرفر ${server} لا يستجيب حاليًا. حاول مرة أخرى بعد دقيقة.`;
  return `حدث خطأ (${code || "unknown"}).`;
}
