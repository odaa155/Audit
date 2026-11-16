// Change log: what each media buyer changed on the ad accounts, so teammates see it instantly.
import { $, el, icon, dayLabel, platChip, nowLocalInput, emptyState, fillPlatSelect, openDialog, closeDialog, confirmDialog } from "../lib.js";
import { state, client, nameOf, guard, safe, isNewEdit } from "../store.js";

export const EDIT_TYPES = ["Budget", "Bid / Cost cap", "Status (On/Off)", "Targeting", "Creative", "Optimization event", "Placement", "Schedule", "New launch", "Other"];
const LEVELS = ["Campaign", "Ad set / Ad group", "Ad", "Account", "Catalog / Pixel"];

export function init() {
  fillPlatSelect($("ePlat")); fillPlatSelect($("fPlat"), true);
  for (const l of LEVELS) $("eLevel").append(el("option", {}, l));
  for (const t of EDIT_TYPES) { $("eType").append(el("option", {}, t)); $("fType").append(el("option", { value: t }, t)); }
  $("ePlat").addEventListener("change", renderEditAccSelect);
  ["fPlat", "fWho", "fType"].forEach(id => $(id).addEventListener("change", renderEdits));
  $("fQ").addEventListener("input", renderEdits);
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
  const who = el("span", { class: "who" }, icon("user", "ic sm"), el("span", {}, nameOf(e.authorId)), el("span", { class: "num" }, compact ? (e.at || "").slice(5, 16).replace("T", " ") : (e.at || "").slice(11, 16)));
  if (!compact && e.authorId === state.uid && state.canWrite) {
    who.append(el("button", { class: "btn-ghost btn-sm icon-btn", type: "button", "aria-label": "حذف التعديل", title: "حذف", onclick: () => deleteEdit(e) }, icon("trash", "ic sm")));
  }
  card.append(el("div", { class: "row1" }, platChip(e.platform),
    e.accountId && !compact ? el("span", { class: "muted small" }, accName(e.platform, e.accountId)) : null,
    el("span", { class: "pill neutral" }, e.type || "Other"),
    !compact && e.level ? el("span", { class: "pill plain" }, e.level) : null,
    isNewEdit(e) ? el("span", { class: "pill new" }, "جديد") : null, who));
  card.append(el("div", { class: "entity" }, e.entity || ""));
  card.append(el("div", { class: "change" }, el("span", { class: "before" }, e.before || "-"), el("span", { class: "arrow" }, "←"), el("span", { class: "after" }, e.after || "-")));
  if (e.note && !compact) card.append(el("div", { class: "why" }, icon("message", "ic sm"), e.note));
  return card;
}

export function renderEdits() {
  const log = $("log"); log.innerHTML = "";
  const fp = $("fPlat").value, ft = $("fType").value, q = $("fQ").value.trim().toLowerCase();
  const who = [...new Set(state.edits.map(e => e.authorId).filter(Boolean))];
  const curW = $("fWho").value; $("fWho").innerHTML = ""; $("fWho").append(el("option", { value: "" }, "كل المسؤولين"));
  for (const w of who) $("fWho").append(el("option", { value: w }, nameOf(w)));
  $("fWho").value = who.includes(curW) ? curW : "";
  const fw = $("fWho").value;
  const newOnes = state.edits.filter(isNewEdit);
  $("newCount").innerHTML = "";
  if (newOnes.length) { $("newCount").append(el("span", { class: "pill new" }, `${newOnes.length} تعديل جديد من زملائك`)); $("markSeen").classList.remove("hidden"); }
  else $("markSeen").classList.add("hidden");
  const list = state.edits.filter(e => (!fp || e.platform === fp) && (!fw || e.authorId === fw) && (!ft || e.type === ft) && (!q || (e.entity || "").toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q)));
  if (!list.length) {
    log.append(state.edits.length
      ? emptyState("search", "لا توجد نتائج", "لا توجد تعديلات تطابق هذه التصفية. جرّب إزالة بعض عوامل التصفية.")
      : emptyState("history", "لا توجد تعديلات بعد", "عند إجراء أي تعديل على الحسابات سجّله هنا، وسيراه زملاؤك فورًا.",
          state.canWrite ? el("button", { class: "btn-primary", type: "button", onclick: () => $("openEdit").click() }, icon("plus", "ic sm"), "سجّل تعديل") : null));
    return;
  }
  const groups = {}; for (const e of list) { const d = (e.at || "").slice(0, 10); (groups[d] = groups[d] || []).push(e); }
  for (const d of Object.keys(groups).sort().reverse()) {
    const g = el("div", { class: "log-day" }, el("h3", {}, d ? dayLabel(d) : "بدون تاريخ", el("span", { class: "pill plain" }, String(groups[d].length))));
    for (const e of groups[d]) g.append(editCard(e));
    log.append(g);
  }
}

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
