// Performance: month totals per platform, daily breakdown, manual entry / paste, sync from platform APIs.
import { $, el, icon, api, fmt0, fmt2, pct, div, pad, daysIn, addDays, todayISO, dayLabel, monthLabel, timeAgo, platChip, PLATFORMS, PMAP, ALIASES, MONTHS_EN, fillPlatSelect, openDialog, closeDialog, toast, emptyState } from "../lib.js";
import { state, hooks, client, cur, nameOf, guard, safe, rangeData, mcpErrorText } from "../store.js";
import { monthsIn, rangeDates, setRange } from "../range.js";

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

const hasApiAcc = c => (c?.accounts || []).some(a => a.via === "api");

export function render() {
  const c = client(), md = rangeData(state.range.from, state.range.to), C = cur();
  $("perfSub").textContent = c ? `${c.name} · ${rangeDates()} · المبالغ بـ ${C}` : "";
  const ls = c?.lastSync;
  $("lastSync").textContent = ls?.at ? `آخر جلب ${timeAgo(ls.at)}${ls.by === "system" ? " (تلقائي)" : " بواسطة " + nameOf(ls.by)}${ls.failed ? ` · تعذّر جلب ${ls.failed} حساب` : ""}` : (hasApiAcc(c) ? "لم يتم جلب الأرقام بعد" : "");
  drawSyncResult();
  const hasApi = hasApiAcc(c);
  $("syncBtn").disabled = !state.mcp || !state.canWrite || !hasApi || !!state.syncing;
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
  } else mtb.append(el("tr", {}, el("td", { colspan: 9, class: "muted-cell" }, `لا توجد أرقام في الفترة ${rangeDates()} بعد. اجلبها من المنصات أو أدخلها يدويًا.`)));
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
  if (await safe(state.db.doc(dailyPath(c.id, date, platform)).set(data), "تم الحفظ")) closeDialog("entryDlg");
}
async function delDaily() {
  const c = client(); if (!c || !guard()) return; const date = $("dDate").value; if (!date) return;
  if (await safe(state.db.doc(dailyPath(c.id, date, $("dPlat").value)).delete(), "تم حذف السطر")) closeDialog("entryDlg");
}
async function saveStore() {
  const c = client(); if (!c || !guard()) return; const date = $("sDate").value; if (!date) { toast("اختر التاريخ", "bad"); return; }
  if (await safe(state.db.doc(`store/${c.id}_${date}`).set({ clientId: c.id, date, sales: +$("sSales").value || 0, orders: +$("sOrders").value || 0, updatedBy: state.uid, updatedAt: new Date().toISOString() }), "تم الحفظ")) closeDialog("entryDlg");
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
  if (ok) { $("pasteBox").value = ""; toast(`تم تسجيل ${ok} سطر`, "good"); if (lastDate && (lastDate < state.range.from || lastDate > state.range.to)) { setRange("m:" + lastDate.slice(0, 7)); hooks.renderAll(); } if (!bad) closeDialog("pasteDlg"); }
}

// ---------- sync from platforms (runs on the server) ----------
const ERR_TEXT = (r) => mcpErrorText({ code: r.code, message: r.message }, PMAP[r.platform]?.label || r.platform);
export async function runSync({ silent = false, months } = {}) {
  const c = client(); if (!c) return null;
  const cm = todayISO().slice(0, 7);
  months = (months || monthsIn(state.range.from, state.range.to)).filter(m => m <= cm);
  if (!months.length) { if (!silent) toast("هذه الفترة لم تبدأ بعد", "bad"); return null; }
  const btn = $("syncBtn"); btn.disabled = true; btn.classList.add("loading");
  setSyncing(true);
  const label = months.map(monthLabel).join(" و");
  if (!silent) { $("syncBox").classList.remove("hidden"); $("syncLog").innerHTML = ""; $("syncTitle").textContent = `جارٍ جلب أرقام ${label}…`; }
  let out = null;
  for (const ym of months) {
    try {
      const o = await api("/api/sync", { method: "POST", body: JSON.stringify({ clientId: c.id, month: ym }) });
      if (!out) out = { results: o.results.map(r => ({ ...r })), writes: o.writes };
      else { out.writes += o.writes; o.results.forEach((r, k) => { const t = out.results[k]; if (!t) return; if (r.ok && t.ok) t.spend += r.spend; else if (!r.ok) Object.assign(t, r); }); }
    } catch (e) { if (!silent) toast(e.message, "bad"); }
  }
  btn.classList.remove("loading"); setSyncing(false);
  if (out) {
    state.syncResult = { cid: c.id, label, ...out };
    if (silent && out.results.some(r => !r.ok)) $("syncBox").classList.remove("hidden");
    drawSyncResult();
    if (!silent) toast(`تم تحديث ${out.writes} سطر`, "good");
  }
  hooks.renderAll();
  return out;
}
function setSyncing(on) { state.syncing = on; const s = $("liveState"); if (s) { s.lastChild.textContent = on ? "جارٍ تحديث الأرقام…" : "تحديث مباشر"; s.classList.toggle("busy", on); } }
function drawSyncResult() {
  const r = state.syncResult; if (!r || r.cid !== state.cid) return;
  const logBox = $("syncLog"); logBox.innerHTML = "";
  $("syncTitle").textContent = r.results.length ? `آخر جلب لأرقام ${r.label}: تم تحديث ${r.writes} سطر` : "لا توجد حسابات مربوطة بالمنصات لهذا العميل";
  for (const x of r.results) logBox.append(el("div", {}, platChip(x.platform), el("span", {}, x.name || x.accountId),
    x.ok ? el("span", { class: "pill good" }, icon("check", "ic sm"), `تم · الصرف ${fmt0(x.spend)} ${cur()}`) : el("span", { class: "pill bad", style: "white-space:normal" }, ERR_TEXT(x))));
  if (r.results.some(x => x.platform === "snapchat")) logBox.append(el("p", { class: "muted small" }, "تُحسب أرقام Snapchat على 28 يومًا للسحب ويوم واحد للمشاهدة، وأرقام Meta حسب إعداد الإسناد في الحساب."));
}
async function sync() { if (!guard()) return; await runSync(); }
