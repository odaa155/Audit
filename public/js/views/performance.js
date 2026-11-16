// Performance: month totals per platform, daily breakdown, manual entry / paste, sync from platform APIs.
import { $, el, icon, fmt0, fmt2, pct, div, pad, daysIn, addDays, todayISO, dayLabel, monthLabel, timeAgo, platChip, PLATFORMS, PMAP, ALIASES, MONTHS_EN, fillPlatSelect, openDialog, closeDialog, toast, emptyState } from "../lib.js";
import { state, hooks, client, cur, nameOf, guard, safe, monthData, callMcp, mcpErrorText } from "../store.js";

const COLS = [["Spent", "n"], ["Sales", "n"], ["Orders", "n"], ["ROAS", "n"], ["CPA %", "n"], ["AOV", "n"], ["الزيارات", "n"], ["التحويل", "n"]];
const metricCells = (spend, sales, orders, visits, hasVisits = true) => [fmt0(spend), fmt0(sales), fmt0(orders), sales && spend ? fmt2(sales / spend) : "-", sales ? pct(div(spend, sales)) : "-", orders ? fmt2(div(sales, orders)) : "-", hasVisits && visits ? fmt0(visits) : "-", hasVisits && visits ? pct(div(orders, visits)) : "-"];
const dailyPath = (cid, date, platform) => `daily/${cid}_${date}_${platform}`;

export function init() {
  fillPlatSelect($("dPlat"));
  $("dDate").value = todayISO(); $("sDate").value = todayISO();
  $("openEntry").addEventListener("click", () => { setEntryTab("plat"); openDialog("entryDlg"); });
  $("openPaste").addEventListener("click", () => { $("pasteMsg").textContent = ""; openDialog("pasteDlg"); });
  for (const b of document.querySelectorAll("#entryTabs button")) b.addEventListener("click", () => setEntryTab(b.dataset.tab));
  $("saveDaily").addEventListener("click", saveDaily);
  $("delDaily").addEventListener("click", delDaily);
  $("saveStore").addEventListener("click", saveStore);
  $("doPaste").addEventListener("click", doPaste);
  $("syncBtn").addEventListener("click", sync);
  $("closeSync").addEventListener("click", () => $("syncBox").classList.add("hidden"));
}

function setEntryTab(tab) {
  for (const b of document.querySelectorAll("#entryTabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  $("entryPlat").classList.toggle("hidden", tab !== "plat");
  $("entryStore").classList.toggle("hidden", tab !== "store");
}

export function render() {
  const c = client(), md = monthData(state.month), C = cur();
  $("perfSub").textContent = c ? `${c.name} · ${monthLabel(state.month)} · المبالغ بـ ${C}` : "";
  const ls = c?.lastSync;
  $("lastSync").textContent = ls?.at ? `آخر جلب ${timeAgo(ls.at)} بواسطة ${nameOf(ls.by)}` : "";
  const hasApi = (c?.accounts || []).some(a => a.via === "api");
  $("syncBtn").disabled = !state.mcp || !state.canWrite || !hasApi;
  $("syncBtn").title = !hasApi ? "اربط حسابات المنصات بالعميل أولًا (من صفحة الحسابات والعملاء)" : "";

  // month totals
  const mt = $("monthTbl"); mt.innerHTML = "";
  mt.append(el("thead", {}, el("tr", {}, el("th", {}, "المنصة"), ...COLS.map(([c, k]) => el("th", { class: k }, c)))));
  const mtb = el("tbody");
  const plats = Object.keys(md.byPlat).sort((a, b) => md.byPlat[b].spend - md.byPlat[a].spend);
  for (const k of plats) { const v = md.byPlat[k]; mtb.append(el("tr", {}, el("td", {}, platChip(k)), ...metricCells(v.spend, v.sales, v.orders, v.visits).map(x => el("td", { class: "n" }, x)))); }
  if (plats.length) {
    mtb.append(el("tr", { class: "total" }, el("td", {}, "Total platform"), ...metricCells(md.tot.spend, md.tot.sales, md.tot.orders, md.tot.visits).map(x => el("td", { class: "n" }, x))));
    if (md.storeTot.days) mtb.append(el("tr", { class: "store" }, el("td", {}, `Total Store (${md.storeTot.days} يوم)`), ...metricCells(md.spendOnStoreDays, md.storeTot.sales, md.storeTot.orders, 0, false).map(x => el("td", { class: "n" }, x))));
  } else mtb.append(el("tr", {}, el("td", { colspan: 9, class: "muted-cell" }, `لا توجد أرقام لشهر ${monthLabel(state.month)} بعد. اجلبها من المنصات أو أدخلها يدويًا.`)));
  mt.append(mtb);

  $("monthTotal").innerHTML = "";
  if (plats.length) $("monthTotal").append(el("div", { class: "total-line" }, el("span", {}, "إجمالي الشهر"),
    el("div", { class: "parts" },
      el("span", {}, "صرف ", el("b", { class: "num" }, fmt0(md.tot.spend))),
      el("span", {}, "مبيعات منصات ", el("b", { class: "num" }, fmt0(md.tot.sales))),
      md.storeTot.days ? el("span", {}, "مبيعات متجر ", el("b", { class: "num" }, fmt0(md.storeTot.sales))) : null,
      el("span", {}, C))));

  // daily breakdown
  const dt = $("dailyTbl"); dt.innerHTML = "";
  dt.append(el("thead", {}, el("tr", {}, el("th", {}, "اليوم"), el("th", {}, "المنصة"), ...COLS.map(([c, k]) => el("th", { class: k }, c)))));
  const tb = el("tbody"), order = PLATFORMS.map(p => p.key);
  for (const d of [...md.dates].reverse()) {
    const rows = md.rows.filter(r => r.date === d).sort((a, b) => order.indexOf(a.platform) - order.indexOf(b.platform));
    const s = md.store.find(x => x.date === d);
    const span = rows.length + (rows.length ? 1 : 0) + (s ? 1 : 0);
    let first = true; const dateCell = () => { if (!first) return null; first = false; return el("td", { class: "date", rowspan: span }, dayLabel(d)); };
    let sp = 0, sa = 0, or = 0, vi = 0;
    for (const r of rows) {
      sp += +r.spend || 0; sa += +r.sales || 0; or += +r.orders || 0; vi += +r.visits || 0;
      const tr = el("tr", { class: "click", tabindex: "0", title: r.source === "api" ? "مجلوب من المنصة · اضغط للتعديل" : "اضغط للتعديل" }, dateCell(),
        el("td", {}, platChip(r.platform), r.source === "api" ? el("span", { class: "pill plain", style: "margin-inline-start:6px;padding:0 7px;font-size:11px" }, "API") : null),
        ...metricCells(+r.spend, +r.sales, +r.orders, +r.visits).map(x => el("td", { class: "n" }, x)));
      const load = () => loadDaily(r); tr.addEventListener("click", load); tr.addEventListener("keydown", e => { if (e.key === "Enter") load(); });
      tb.append(tr);
    }
    if (rows.length) tb.append(el("tr", { class: "total" }, dateCell(), el("td", {}, "Total platform"), ...metricCells(sp, sa, or, vi).map(x => el("td", { class: "n" }, x))));
    if (s) {
      const tr = el("tr", { class: "store click", tabindex: "0", title: "اضغط للتعديل" }, dateCell(), el("td", {}, "Total Store"), ...metricCells(sp, +s.sales, +s.orders, 0, false).map(x => el("td", { class: "n" }, x)));
      const load = () => loadStore(s); tr.addEventListener("click", load); tr.addEventListener("keydown", e => { if (e.key === "Enter") load(); }); tb.append(tr);
    }
  }
  if (!md.dates.length) tb.append(el("tr", {}, el("td", { colspan: 10, class: "muted-cell" }, "لا توجد أيام مسجلة في هذا الشهر.")));
  dt.append(tb);
}

function loadDaily(r) {
  setEntryTab("plat");
  $("dDate").value = r.date; $("dPlat").value = r.platform; $("dSpend").value = r.spend ?? ""; $("dSales").value = r.sales ?? ""; $("dOrders").value = r.orders ?? ""; $("dVisits").value = r.visits ?? "";
  openDialog("entryDlg"); setTimeout(() => $("dSpend").focus(), 40);
}
function loadStore(s) {
  setEntryTab("store");
  $("sDate").value = s.date; $("sSales").value = s.sales ?? ""; $("sOrders").value = s.orders ?? "";
  openDialog("entryDlg"); setTimeout(() => $("sSales").focus(), 40);
}

async function saveDaily() {
  const c = client(); if (!c || !guard()) return;
  const date = $("dDate").value, platform = $("dPlat").value; if (!date) { toast("اختر التاريخ", "bad"); return; }
  const data = { clientId: c.id, date, platform, spend: +$("dSpend").value || 0, sales: +$("dSales").value || 0, orders: +$("dOrders").value || 0, visits: $("dVisits").value === "" ? null : +$("dVisits").value, source: "manual", updatedBy: state.uid, updatedAt: new Date().toISOString() };
  if (await safe(state.db.doc(dailyPath(c.id, date, platform)).set(data), "تم الحفظ")) { state.month = date.slice(0, 7); closeDialog("entryDlg"); }
}
async function delDaily() {
  const c = client(); if (!c || !guard()) return; const date = $("dDate").value; if (!date) return;
  if (await safe(state.db.doc(dailyPath(c.id, date, $("dPlat").value)).delete(), "تم حذف السطر")) closeDialog("entryDlg");
}
async function saveStore() {
  const c = client(); if (!c || !guard()) return; const date = $("sDate").value; if (!date) { toast("اختر التاريخ", "bad"); return; }
  if (await safe(state.db.doc(`store/${c.id}_${date}`).set({ clientId: c.id, date, sales: +$("sSales").value || 0, orders: +$("sOrders").value || 0, updatedBy: state.uid, updatedAt: new Date().toISOString() }), "تم الحفظ")) { state.month = date.slice(0, 7); closeDialog("entryDlg"); }
}

function parseDate(s) {
  s = s.trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/); if (m) { const i = MONTHS_EN.findIndex(x => x.toLowerCase() === m[2].toLowerCase()); if (i >= 0) return `${m[3]}-${pad(i + 1)}-${m[1].padStart(2, "0")}`; }
  return null;
}
const numv = s => { if (s == null) return 0; const v = String(s).replace(/[,%\s]/g, ""); return v === "" || v === "-" ? 0 : +v || 0; };
async function doPaste() {
  const c = client(); if (!c || !guard()) return;
  const lines = $("pasteBox").value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) { toast("الصق السطور أولًا", "bad"); return; }
  let ok = 0, bad = 0, lastDate = null; const btn = $("doPaste"); btn.disabled = true; btn.classList.add("loading");
  for (const line of lines) {
    const col = line.split(/\t|,(?=\S)|;/).map(x => x.trim());
    const date = parseDate(col[0] || ""); const pk = (col[1] || "").toLowerCase(); if (!date) { bad++; continue; }
    try {
      if (pk === "store" || pk === "total store") { await state.db.doc(`store/${c.id}_${date}`).set({ clientId: c.id, date, sales: numv(col[3]), orders: numv(col[4]), updatedBy: state.uid, updatedAt: new Date().toISOString() }); ok++; lastDate = date; continue; }
      const platform = ALIASES[pk]; if (!platform) { bad++; continue; }
      await state.db.doc(dailyPath(c.id, date, platform)).set({ clientId: c.id, date, platform, spend: numv(col[2]), sales: numv(col[3]), orders: numv(col[4]), visits: col[5] ? numv(col[5]) : null, source: "manual", updatedBy: state.uid, updatedAt: new Date().toISOString() }); ok++; lastDate = date;
    } catch (_) { bad++; }
  }
  btn.disabled = false; btn.classList.remove("loading");
  $("pasteMsg").textContent = `تم تسجيل ${ok} سطر` + (bad ? ` · ${bad} سطر لم تتم قراءته` : "");
  if (ok) { $("pasteBox").value = ""; toast(`تم تسجيل ${ok} سطر`, "good"); if (lastDate) { state.month = lastDate.slice(0, 7); hooks.renderAll(); } if (!bad) closeDialog("pasteDlg"); }
}

// ---------- sync from platforms ----------
function tzOffset(tz, iso) {
  try { const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(iso + "T12:00:00Z")); const v = parts.find(p => p.type === "timeZoneName")?.value || "GMT"; return v === "GMT" ? "+00:00" : v.replace("GMT", ""); } catch (_) { return "+03:00"; }
}
const val = x => x == null ? 0 : (typeof x === "object" ? (+(x.value ?? 0) || 0) : (+x || 0));
async function fetchMeta(acc, since, until) {
  const out = []; let cursor = null, g = 0;
  do {
    const input = { ad_account_id: acc.accountId, level: "ad_account", fields: ["amount_spent", "omni_purchase", "omni_purchase_values", "landing_page_view"], time_range: JSON.stringify({ since, until }), time_increment: "1", include_additional_context: false, reporting_purpose: ["metric_lookup"], advertiser_job: "report_measure_or_look_up" };
    if (cursor) input.cursor = cursor;
    const pl = (await callMcp("Meta Ads", "ads_get_ad_entities", input, { cache: false })).payload || {};
    let ents = pl.ad_entities; if (typeof ents === "string") { try { ents = JSON.parse(ents); } catch (_) { ents = []; } }
    for (const e of ents || []) if (e.date_start) out.push({ date: e.date_start, spend: val(e.amount_spent), sales: val(e.omni_purchase_values), orders: val(e.omni_purchase), visits: val(e.landing_page_view) });
    cursor = pl.pagination?.next_cursor || null; g++;
  } while (cursor && g < 10);
  return out;
}
async function fetchTikTok(acc, since, until) {
  const out = []; let s = since;
  while (s <= until) {
    let e = addDays(s, 29); if (e > until) e = until;
    const pl = (await callMcp("TikTok", "report_integrated_get", { advertiser_id: acc.accountId, report_type: "BASIC", data_level: "AUCTION_ADVERTISER", dimensions: ["advertiser_id", "stat_time_day"], metrics: ["spend", "complete_payment", "complete_payment_roas", "total_landing_page_view"], start_date: s, end_date: e, page_size: 100 }, { cache: false })).payload || {};
    if (pl.code && pl.code !== 0) throw { code: "tool_error", message: pl.message || "TikTok error" };
    for (const r of pl?.data?.list || []) { const m = r.metrics || {}, sp = +m.spend || 0; out.push({ date: (r.dimensions?.stat_time_day || "").slice(0, 10), spend: sp, sales: sp * (+m.complete_payment_roas || 0), orders: +m.complete_payment || 0, visits: +m.total_landing_page_view || 0 }); }
    s = addDays(e, 1);
  }
  return out;
}
async function fetchSnap(acc, since, until) {
  const tz = acc.timezone || "Asia/Riyadh", endDay = addDays(until, 1);
  const base = { ad_account_id: acc.accountId, granularity: "DAY", breakdown: "campaign", fields: ["spend", "conversion_purchases", "conversion_purchases_value", "swipes"], start_time: `${since}T00:00:00${tzOffset(tz, since)}`, end_time: `${endDay}T00:00:00${tzOffset(tz, endDay)}`, swipe_up_attribution_window: "28_DAY", view_attribution_window: "1_DAY", limit: 50, omit_empty: true };
  const byDate = {}; let cursor = null, g = 0;
  do {
    const input = { ...base }; if (cursor) input.cursor = cursor;
    const pl = (await callMcp("snap", "snap_ads_get_ad_account_stats", input, { cache: false })).payload || {};
    const ts = pl.timeseries_stats?.[0]?.timeseries_stat || {};
    for (const camp of ts.breakdown_stats?.campaign || []) for (const row of camp.timeseries || []) {
      const st = row.stats || {};
      const date = String(row.start_time?.value || row.start_time || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const b = byDate[date] || (byDate[date] = { date, spend: 0, sales: 0, orders: 0, visits: 0 });
      b.spend += (+st.spend || 0) / 1e6; b.sales += (+st.conversion_purchases_value || 0) / 1e6; b.orders += +st.conversion_purchases || 0; b.visits += +st.swipes || 0;
    }
    const nl = ts.paging?.next_link; cursor = nl ? (() => { try { return new URL(nl).searchParams.get("cursor"); } catch (_) { return null; } })() : null; g++;
  } while (cursor && g < 20);
  return Object.values(byDate);
}

async function sync() {
  const c = client(); if (!c || !state.mcp || !guard()) return;
  const ym = state.month, today = todayISO();
  const since = `${ym}-01`; let until = `${ym}-${pad(daysIn(ym))}`; if (until > today) until = today;
  if (since > today) { toast("هذا الشهر لم يبدأ بعد", "bad"); return; }
  const accs = (c.accounts || []).filter(a => a.via === "api" && ["meta", "tiktok", "snapchat"].includes(a.platform));

  const logBox = $("syncLog"); logBox.innerHTML = ""; $("syncBox").classList.remove("hidden");
  const btn = $("syncBtn"); btn.disabled = true; btn.classList.add("loading");
  $("syncTitle").textContent = `جارٍ جلب أرقام ${monthLabel(ym)}…`;
  const agg = {};
  for (const a of accs) {
    const state_ = el("span", { class: "pill plain" }, "جارٍ…");
    logBox.append(el("div", {}, platChip(a.platform), el("span", {}, a.name || a.accountId), state_));
    try {
      const rows = a.platform === "meta" ? await fetchMeta(a, since, until) : a.platform === "tiktok" ? await fetchTikTok(a, since, until) : await fetchSnap(a, since, until);
      const fx = +a.fx || 1; let sp = 0;
      for (const r of rows) { if (!r.date || !r.date.startsWith(ym)) continue; const k = r.date + "|" + a.platform; const b = agg[k] || (agg[k] = { date: r.date, platform: a.platform, spend: 0, sales: 0, orders: 0, visits: 0 }); b.spend += r.spend * fx; b.sales += r.sales * fx; b.orders += r.orders; b.visits += r.visits; sp += r.spend * fx; }
      state_.replaceWith(el("span", { class: "pill good" }, icon("check", "ic sm"), `تم · الصرف ${fmt0(sp)} ${cur()}`));
    } catch (e) { state_.replaceWith(el("span", { class: "pill bad", style: "white-space:normal" }, mcpErrorText(e, PMAP[a.platform].label))); }
  }
  let writes = 0;
  for (const b of Object.values(agg)) {
    const id = `${c.id}_${b.date}_${b.platform}`, ex = state.daily.find(r => r.id === id);
    const r2 = x => Math.round(x * 100) / 100;
    const data = { clientId: c.id, date: b.date, platform: b.platform, spend: r2(b.spend), sales: r2(b.sales), orders: Math.round(b.orders), visits: Math.round(b.visits) || null, source: "api", syncedAt: new Date().toISOString(), updatedBy: state.uid };
    if (ex && ex.source === "api" && r2(+ex.spend) === data.spend && r2(+ex.sales) === data.sales && +ex.orders === data.orders && (ex.visits || null) === data.visits) continue;
    if (!ex && !data.spend && !data.sales && !data.orders) continue;
    try { await state.db.doc("daily/" + id).set(data); writes++; } catch (_) {}
  }
  $("syncTitle").textContent = `تم تحديث ${writes} سطر في ${monthLabel(ym)}`;
  logBox.append(el("p", { class: "muted small" }, "تُحسب أرقام Snapchat على 28 يومًا للسحب ويوم واحد للمشاهدة، وأرقام Meta حسب إعداد الإسناد في الحساب."));
  try { await state.db.doc("clients/" + c.id).update({ lastSync: { at: new Date().toISOString(), by: state.uid, month: ym } }); } catch (_) {}
  btn.classList.remove("loading"); hooks.renderAll();
}
