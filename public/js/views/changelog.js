// Change log: what each media buyer changed on the ad accounts, so teammates see it instantly.
import { $, el, icon, dayLabel, platChip, lsGet, lsSet, nowLocalInput, emptyState, fillPlatSelect, openDialog, closeDialog, confirmDialog, addDays, fmt0, fmt2, div, PMAP } from "../lib.js";
import { openTask } from "./tasks.js";
import { state, client, nameOf, guard, safe, isNewEdit, isSystemEdit } from "../store.js";
const whoKey = e => e.authorId || (e.authorName ? "ext:" + e.authorName : "");
const whoName = e => e.authorId ? nameOf(e.authorId) : (e.authorName || "المنصة");

export const EDIT_TYPES = ["Budget", "Bid / Cost cap", "Status (On/Off)", "Targeting", "Creative", "Optimization event", "Placement", "Schedule", "New launch", "Other"];
const LEVELS = ["Campaign", "Ad set / Ad group", "Ad", "Account", "Catalog / Pixel"];

export function init() {
  fillPlatSelect($("ePlat")); fillPlatSelect($("fPlat"), true);
  for (const l of LEVELS) $("eLevel").append(el("option", {}, l));
  for (const t of EDIT_TYPES) { $("eType").append(el("option", {}, t)); $("fType").append(el("option", { value: t }, t)); }
  $("ePlat").addEventListener("change", renderEditAccSelect);
  ["fPlat", "fWho", "fType"].forEach(id => $(id).addEventListener("change", renderEdits));
  $("fQ").addEventListener("input", renderEdits);
  $("fSys").checked = lsGet("ops.clSys") !== "0";
  $("fSys").addEventListener("change", () => { lsSet("ops.clSys", $("fSys").checked ? "1" : "0"); limit = PAGE; renderEdits(); });
  for (const b of document.querySelectorAll("#clView button")) b.addEventListener("click", () => { view = b.dataset.v; lsSet("ops.clView", view); renderEdits(); });
  for (const id of ["fPlat", "fWho", "fType"]) $(id).addEventListener("change", () => { limit = PAGE; });
  $("openEdit").addEventListener("click", () => { $("eAt").value = nowLocalInput(); renderEditAccSelect(); openDialog("editDlg"); });
  $("editForm").addEventListener("submit", submit);
  $("markSeen").addEventListener("click", markSeen);
}

export function render() { renderEdits(); renderEditAccSelect(); }

export function renderEditAccSelect() {
  const sel = $("eAcc"), p = $("ePlat").value, c = client(); const keep = sel.value;
  sel.innerHTML = ""; sel.append(el("option", { value: "" }, "—"));
  for (const a of (c?.accounts || []).filter(a => a.platform === p)) sel.append(el("option", { value: a.accountId }, a.name || a.accountId));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "";
}

const accName = (p, id) => (client()?.accounts || []).find(a => a.platform === p && a.accountId === id)?.name || id;

export function editCard(e, compact = false) {
  const card = el("article", { class: "edit" + (compact ? " compact" : "") + (isNewEdit(e) ? " is-new" : "") });
  const who = el("span", { class: "who" }, icon("user", "ic sm"), el("span", {}, whoName(e)), el("span", { class: "num" }, compact ? (e.at || "").slice(5, 16).replace("T", " ") : (e.at || "").slice(11, 16)));
  if (!compact && e.authorId === state.uid && state.canWrite) {
    who.append(el("button", { class: "btn-ghost btn-sm icon-btn", type: "button", "aria-label": "حذف التعديل", title: "حذف", onclick: () => deleteEdit(e) }, icon("trash", "ic sm")));
  }
  card.append(el("div", { class: "row1" }, platChip(e.platform),
    e.accountId && !compact ? el("span", { class: "muted small" }, accName(e.platform, e.accountId)) : null,
    el("span", { class: "pill neutral" }, e.type || "Other"),
    !compact && e.level ? el("span", { class: "pill plain" }, e.level) : null,
    e.source === "api" ? el("span", { class: "pill plain", title: "مستورد تلقائيًا من سجل نشاط المنصة" }, icon("refresh", "ic sm"), "تلقائي") : null,
    isNewEdit(e) ? el("span", { class: "pill new" }, "جديد") : null, who));
  card.append(el("div", { class: "entity" }, e.entity || ""));
  card.append(el("div", { class: "change" }, el("span", { class: "before" }, e.before || "-"), el("span", { class: "arrow" }, "←"), el("span", { class: "after" }, e.after || "-")));
  if (e.note && !compact) card.append(el("div", { class: "why" }, icon("message", "ic sm"), e.note));
  if (!compact) {
    const imp = impactRow(e); if (imp) card.append(imp);
    if (state.canWrite) {
      const linked = state.tasks.filter(t => t.editId === e.id);
      who.prepend(linked.length
        ? el("a", { class: "pill plain", href: "#tasks", title: "مهام مرتبطة بهذا التعديل" }, icon("check", "ic sm"), `${linked.length} مهمة`)
        : el("button", { class: "btn-ghost btn-sm", type: "button", title: "إنشاء مهمة متابعة لهذا التعديل", onclick: () => openTask(null, { editId: e.id, title: `متابعة: ${e.type || "تعديل"} على ${e.entity || ""}`.slice(0, 200), platform: e.platform, due: addDays((e.at || "").slice(0, 10) || new Date().toISOString().slice(0, 10), 3) }) }, icon("plus", "ic sm"), "مهمة"));
    }
  }
  return card;
}

// ---------- edit impact: 3 days before vs 3 days after, at platform level for this client ----------
const WIN = 3;
function windowStats(platform, from, to) {
  let spend = 0, sales = 0, orders = 0, days = 0;
  for (const r of state.daily) if (r.platform === platform && r.date >= from && r.date <= to) { spend += +r.spend || 0; sales += +r.sales || 0; orders += +r.orders || 0; days++; }
  return { spend, sales, orders, days, roas: div(sales, spend), cpa: div(spend, orders) };
}
export function editImpact(e) {
  const d = (e.at || "").slice(0, 10); if (!d || !e.platform) return null;
  const lastDay = state.daily.filter(r => r.platform === e.platform).reduce((m, r) => r.date > m ? r.date : m, "");
  const b = windowStats(e.platform, addDays(d, -WIN), addDays(d, -1));
  const a = windowStats(e.platform, addDays(d, 1), addDays(d, WIN));
  let pending = 0; for (let k = 1; k <= WIN; k++) if (!lastDay || addDays(d, k) > lastDay) pending++;
  if (!b.days) return { state: "nodata" };
  if (pending > 0) return { state: "pending", pending, b };
  const rCh = b.roas && a.roas != null ? (a.roas - b.roas) / b.roas : null;
  const verdict = rCh == null ? "flat" : rCh >= 0.05 ? "up" : rCh <= -0.05 ? "down" : "flat";
  return { state: "done", b, a, rCh, verdict };
}
const pctTxt = v => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(0) + "%";
function impactRow(e) {
  const r = editImpact(e); if (!r || r.state === "nodata") return null;
  const lbl = (PMAP[e.platform]?.label || e.platform).replace(" / Instagram", "");
  const box = el("div", { class: "impact" }, el("span", { class: "impact-t" }, icon("trending", "ic sm"), `الأثر على ${lbl}`));
  if (r.state === "pending") { box.append(el("span", { class: "muted" }, `يكتمل التقييم بعد ${r.pending} ${r.pending === 1 ? "يوم" : "أيام"} من البيانات`)); return box; }
  const V = { up: ["good", "تحسّن بعد التعديل"], down: ["bad", "تراجع بعد التعديل"], flat: ["plain", "بدون تغيير واضح"] }[r.verdict];
  const m = (name, bv, av, fmt, goodUp) => {
    const ch = bv ? (av - bv) / bv : null, good = goodUp == null || ch == null || !isFinite(ch) || Math.abs(ch) < 0.05 ? "" : ((ch > 0) === goodUp ? " up" : " down");
    return el("span", { class: "imp-m" + good }, el("span", { class: "muted" }, name + " "), el("b", { class: "num" }, fmt(bv)), " ← ", el("b", { class: "num" }, fmt(av)), ch != null && isFinite(ch) ? el("span", { class: "imp-ch num" }, ` (${pctTxt(ch)})`) : null);
  };
  box.append(m("ROAS", r.b.roas, r.a.roas, v => v == null ? "-" : fmt2(v), true), m("CPA", r.b.cpa, r.a.cpa, v => v == null ? "-" : fmt0(v), false), m("الصرف/يوم", r.b.spend / r.b.days, r.a.spend / Math.max(r.a.days, 1), fmt0, null),
    el("span", { class: "pill " + V[0] }, V[1]));
  box.title = `مقارنة ${WIN} أيام قبل يوم التعديل بـ ${WIN} أيام بعده، على مستوى المنصة لهذا العميل (وليس الحملة فقط).`;
  return box;
}

const PAGE = 150;
let view = lsGet("ops.clView") || (matchMedia("(max-width: 700px)").matches ? "cards" : "table"), limit = PAGE;
const openRows = new Set();

export function renderEdits() {
  document.querySelectorAll("#clView button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === view)));
  const log = $("log"); log.innerHTML = "";
  const fp = $("fPlat").value, ft = $("fType").value, q = $("fQ").value.trim().toLowerCase();
  const who = [...new Set(state.edits.map(whoKey).filter(Boolean))];
  const curW = $("fWho").value; $("fWho").innerHTML = ""; $("fWho").append(el("option", { value: "" }, "كل المسؤولين"));
  for (const w of who) $("fWho").append(el("option", { value: w }, w.startsWith("ext:") ? w.slice(4) : nameOf(w)));
  $("fWho").value = who.includes(curW) ? curW : "";
  const fw = $("fWho").value;
  const newOnes = state.edits.filter(isNewEdit);
  $("newCount").innerHTML = "";
  if (newOnes.length) { $("newCount").append(el("span", { class: "pill new" }, `${newOnes.length} تعديل جديد من زملائك`)); $("markSeen").classList.remove("hidden"); }
  else $("markSeen").classList.add("hidden");
  const { from, to } = state.range;
  const hideSys = $("fSys").checked;
  const list = state.edits.filter(e => (!hideSys || !isSystemEdit(e)) && (!e.at || (e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to)) && (!fp || e.platform === fp) && (!fw || whoKey(e) === fw) && (!ft || e.type === ft) && (!q || (e.entity || "").toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q)));
  if (!list.length) {
    log.append(state.edits.length
      ? emptyState("search", "لا توجد نتائج", "لا توجد تعديلات في هذه الفترة أو بهذه التصفية. جرّب فترة أطول أو أزل بعض عوامل التصفية.")
      : emptyState("history", "لا توجد تعديلات بعد", "عند إجراء أي تعديل على الحسابات سجّله هنا، وسيراه زملاؤك فورًا.",
          state.canWrite ? el("button", { class: "btn-primary", type: "button", onclick: () => $("openEdit").click() }, icon("plus", "ic sm"), "سجّل تعديل") : null));
    return;
  }
  const inRange = state.edits.filter(e => !e.at || (e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to));
  const sysHidden = hideSys ? inRange.filter(isSystemEdit).length : 0;
  $("clCount").textContent = `${list.length} تعديل` + (sysHidden ? ` · ${sysHidden} تغيير نظام مخفي` : "");
  if (view === "table") { log.append(editsTable(list)); return; }
  const groups = {}; for (const e of list.slice(0, limit)) { const d = (e.at || "").slice(0, 10); (groups[d] = groups[d] || []).push(e); }
  for (const d of Object.keys(groups).sort().reverse()) {
    const g = el("div", { class: "log-day" }, el("h3", {}, d ? dayLabel(d) : "بدون تاريخ", el("span", { class: "pill plain" }, String(groups[d].length))));
    for (const e of groups[d]) g.append(editCard(e));
    log.append(g);
  }
  if (list.length > limit) log.append(moreBtn(list.length));
}

const moreBtn = total => el("div", { class: "actions", style: "justify-content:center" },
  el("button", { type: "button", onclick: () => { limit += PAGE; renderEdits(); } }, `عرض المزيد (${Math.min(PAGE, total - limit)} من ${total - limit} متبقٍ)`));

// ---------- compact table view: one row per edit, details on click ----------
function impactCell(e) {
  const r = editImpact(e);
  if (!r || r.state === "nodata") return el("span", { class: "muted" }, "—");
  if (r.state === "pending") return el("span", { class: "muted small", title: "لم تكتمل 3 أيام من البيانات بعد التعديل" }, `بعد ${r.pending} ${r.pending === 1 ? "يوم" : "أيام"}`);
  const cls = { up: "good", down: "bad", flat: "plain" }[r.verdict];
  return el("span", { class: "pill " + cls, title: `ROAS ${fmt2(r.b.roas)} ← ${fmt2(r.a.roas)} · CPA ${fmt0(r.b.cpa)} ← ${fmt0(r.a.cpa)}` }, r.rCh == null ? "—" : `ROAS ${r.rCh >= 0 ? "+" : "−"}${Math.abs(r.rCh * 100).toFixed(0)}%`);
}
function editsTable(list) {
  const wrap = el("div", { class: "tbl-wrap cl-wrap" }), t = el("table", { class: "cl-tbl" });
  t.append(el("thead", {}, el("tr", {}, el("th", {}, "الوقت"), el("th", {}, "المنصة"), el("th", {}, "النوع"), el("th", {}, "المستوى"), el("th", {}, "الحملة / المجموعة / الإعلان"), el("th", {}, "قبل ← بعد"), el("th", {}, "الأثر"), el("th", {}, "بواسطة"), el("th", {}, ""))));
  const tb = el("tbody"); let lastDay = null;
  for (const e of list.slice(0, limit)) {
    const day = (e.at || "").slice(0, 10);
    if (day !== lastDay) { lastDay = day; const n = list.filter(x => (x.at || "").slice(0, 10) === day).length; tb.append(el("tr", { class: "grp" }, el("td", { colspan: 9 }, day ? dayLabel(day) : "بدون تاريخ", el("span", { class: "pill plain" }, String(n))))); }
    const open = openRows.has(e.id), isNew = isNewEdit(e);
    const linked = state.tasks.filter(t => t.editId === e.id).length;
    const actions = el("td", { class: "cl-act" });
    if (state.canWrite) actions.append(linked
      ? el("a", { class: "pill plain", href: "#tasks", title: "مهام مرتبطة", onclick: ev => ev.stopPropagation() }, icon("check", "ic sm"), String(linked))
      : el("button", { class: "btn-ghost btn-sm icon-btn", type: "button", title: "إنشاء مهمة متابعة", "aria-label": "إنشاء مهمة متابعة", onclick: ev => { ev.stopPropagation(); newTaskFor(e); } }, icon("plus", "ic sm")));
    if (e.authorId === state.uid && state.canWrite) actions.append(el("button", { class: "btn-ghost btn-sm icon-btn", type: "button", title: "حذف", "aria-label": "حذف التعديل", onclick: ev => { ev.stopPropagation(); deleteEdit(e); } }, icon("trash", "ic sm")));
    const tr = el("tr", { class: "click" + (isNew ? " is-new" : "") + (open ? " open" : ""), tabindex: "0", "aria-expanded": String(open), title: "اضغط لعرض التفاصيل" },
      el("td", { class: "num cl-time" }, (e.at || "").slice(11, 16), isNew ? el("span", { class: "new-dot", "aria-label": "جديد" }) : null),
      el("td", { title: e.accountId ? accName(e.platform, e.accountId) : "" }, platChip(e.platform)),
      el("td", {}, el("span", { class: "pill neutral" }, e.type || "Other")),
      el("td", { class: "muted small" }, e.level || ""),
      el("td", { class: "cl-entity", title: e.entity || "" }, e.entity || "", e.source === "api" ? el("span", { class: "auto-tag", title: "مستورد تلقائيًا من المنصة" }, icon("refresh", "ic sm")) : null),
      el("td", { class: "cl-change" }, el("span", { class: "before" }, e.before || "-"), el("span", { class: "arrow" }, "←"), el("span", { class: "after" }, e.after || "-")),
      el("td", {}, impactCell(e)),
      el("td", { class: "muted small cl-who", title: whoName(e) }, whoName(e)),
      actions);
    const toggle = () => { open ? openRows.delete(e.id) : openRows.add(e.id); renderEdits(); };
    tr.addEventListener("click", toggle); tr.addEventListener("keydown", ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); } });
    tb.append(tr);
    if (open) {
      const det = el("div", { class: "cl-detail" },
        el("div", { class: "cl-detail-grid" },
          el("span", {}, el("span", { class: "muted" }, "الحساب: "), e.accountId ? accName(e.platform, e.accountId) : "—"),
          el("span", {}, el("span", { class: "muted" }, "الوقت: "), (e.at || "").replace("T", " ").slice(0, 16)),
          el("span", {}, el("span", { class: "muted" }, "المصدر: "), e.source === "api" ? "مستورد تلقائيًا" : "تسجيل يدوي")),
        el("div", { class: "entity" }, e.entity || ""),
        e.note ? el("div", { class: "why" }, icon("message", "ic sm"), e.note) : null,
        impactRow(e));
      tb.append(el("tr", { class: "cl-detail-row" }, el("td", { colspan: 9 }, det)));
    }
  }
  t.append(tb); wrap.append(t);
  const frag = document.createDocumentFragment(); frag.append(wrap);
  if (list.length > limit) frag.append(moreBtn(list.length));
  return frag;
}
const newTaskFor = e => openTask(null, { editId: e.id, title: `متابعة: ${e.type || "تعديل"} على ${e.entity || ""}`.slice(0, 200), platform: e.platform, due: addDays((e.at || "").slice(0, 10) || new Date().toISOString().slice(0, 10), 3) });

async function submit(ev) {
  ev.preventDefault(); const c = client(); if (!c || !guard()) return;
  const atLocal = $("eAt").value; if (!atLocal) return;
  const data = { clientId: c.id, at: atLocal + ":00", platform: $("ePlat").value, accountId: $("eAcc").value || null, level: $("eLevel").value, type: $("eType").value, entity: $("eEntity").value.trim(), before: $("eBefore").value.trim(), after: $("eAfter").value.trim(), note: $("eWhy").value.trim(), authorId: state.uid, createdAt: new Date().toISOString() };
  const btn = $("eSubmit"); btn.disabled = true; btn.classList.add("loading");
  const ok = await safe(state.db.collection("edits").add(data), "تم تسجيل التعديل");
  btn.disabled = false; btn.classList.remove("loading");
  if (ok) { ["eEntity", "eBefore", "eAfter", "eWhy"].forEach(id => $(id).value = ""); $("eAt").value = nowLocalInput(); closeDialog("editDlg"); }
}

async function deleteEdit(e) {
  if (!guard()) return;
  if (!await confirmDialog({ title: "حذف التعديل؟", body: `سيُحذف تعديل "${e.entity || ""}" من السجل لدى جميع أعضاء الفريق.`, ok: "حذف" })) return;
  await safe(state.db.doc("edits/" + e.id).delete(), "تم الحذف");
}

async function markSeen() {
  if (!state.db || !state.uid) return;
  const ts = new Date().toISOString(); state.lastSeen = ts; renderEdits();
  try { await state.db.doc(`data/users/${state.uid}/state`).set({ lastSeen: ts }); } catch (_) {}
}

export async function resolveNames(onChange) {
  if (!state.user) return;
  const ids = [...new Set(state.edits.map(e => e.authorId).filter(Boolean))].filter(i => i !== state.uid);
  if (!ids.length) return;
  try {
    const ps = await state.user.profiles(ids); let ch = false;
    for (const id of ids) { const n = ps?.[id]?.name || ""; if (n && state.names[id] !== n) { state.names[id] = n; ch = true; } }
    if (ch) onChange();
  } catch (_) {}
}
