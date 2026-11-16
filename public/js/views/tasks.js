// Tasks per client: title, owner, due date, status; optionally linked to an edit in the change log.
import { $, el, icon, todayISO, addDays, dayLabel, initial, platChip, fillPlatSelect, openDialog, closeDialog, confirmDialog, emptyState } from "../lib.js";
import { state, client, guard, safe, nameOf } from "../store.js";

let filter = "open", editing = null, linkedEdit = null;
const STATUS = { open: "مفتوحة", doing: "قيد التنفيذ", done: "مكتملة" };
const personName = id => !id ? "بدون مسؤول" : id === state.uid ? "أنت" : (state.people?.[id]?.name || state.names[id] || id);

export const isOverdue = t => t.status !== "done" && t.due && t.due < todayISO();
export const isDueToday = t => t.status !== "done" && t.due === todayISO();
export const myDueCount = () => state.tasks.filter(t => t.owner === state.uid && (isOverdue(t) || isDueToday(t))).length;

export function init() {
  fillPlatSelect($("tkPlat")); $("tkPlat").prepend(el("option", { value: "" }, "—")); $("tkPlat").value = "";
  for (const b of document.querySelectorAll("#tkStatus button")) b.addEventListener("click", () => { filter = b.dataset.v; document.querySelectorAll("#tkStatus button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); render(); });
  $("tkOwner").addEventListener("change", render);
  $("tkQ").addEventListener("input", render);
  $("openTask").addEventListener("click", () => openTask());
  $("taskForm").addEventListener("submit", save);
  $("tkDelete").addEventListener("click", del);
}

function fillOwners(sel, withAll) {
  const keep = sel.value; sel.innerHTML = "";
  if (withAll) { sel.append(el("option", { value: "" }, "كل المسؤولين"), el("option", { value: "me" }, "مهامي")); }
  else sel.append(el("option", { value: "" }, "بدون مسؤول"));
  for (const [id, p] of Object.entries(state.people || {}).sort((a, b) => (a[1].name || "").localeCompare(b[1].name || "", "ar"))) sel.append(el("option", { value: id }, id === state.uid ? `${p.name} (أنت)` : p.name));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "";
}

export function taskCard(t, compact = false) {
  const done = t.status === "done";
  const cb = el("input", { type: "checkbox", "aria-label": done ? "إعادة فتح المهمة" : "تحديد المهمة كمكتملة" }); cb.checked = done; cb.disabled = !state.canWrite;
  cb.addEventListener("click", e => e.stopPropagation());
  cb.addEventListener("change", () => setStatus(t, cb.checked ? "done" : "open"));
  const due = t.due ? el("span", { class: "pill " + (isOverdue(t) ? "bad" : isDueToday(t) ? "warn" : "plain") }, icon("clock", "ic sm"), isOverdue(t) ? `متأخرة · ${dayLabel(t.due)}` : isDueToday(t) ? "اليوم" : dayLabel(t.due)) : null;
  const card = el("article", { class: "task" + (done ? " done" : "") + (compact ? " compact" : ""), tabindex: "0", role: "button", "aria-label": `تعديل المهمة: ${t.title}` },
    cb,
    el("div", { class: "task-body" },
      el("div", { class: "task-title" }, t.title),
      !compact && t.note ? el("div", { class: "muted small task-note" }, t.note) : null,
      el("div", { class: "task-meta" },
        el("span", { class: "who-chip" }, el("span", { class: "avatar xs" }, initial(state.people?.[t.owner]?.name || personName(t.owner))), personName(t.owner)),
        due, t.status === "doing" ? el("span", { class: "pill neutral" }, STATUS.doing) : null,
        t.platform ? platChip(t.platform) : null,
        t.editId && !compact ? el("span", { class: "pill plain", title: "مرتبطة بتعديل في السجل" }, icon("history", "ic sm"), "مرتبطة بتعديل") : null)));
  const open = () => openTask(t); card.addEventListener("click", open); card.addEventListener("keydown", e => { if (e.key === "Enter") open(); });
  return card;
}

export function render() {
  fillOwners($("tkOwner"), true); fillOwners($("tkOwnerIn"), false);
  const c = client(); $("tkSub").textContent = c ? `مهام ${c.name}: من المسؤول، وموعد التسليم، والحالة.` : "";
  const ow = $("tkOwner").value, q = $("tkQ").value.trim().toLowerCase();
  const list = state.tasks.filter(t => (filter === "all" || (filter === "done" ? t.status === "done" : t.status !== "done"))
    && (!ow || (ow === "me" ? t.owner === state.uid : t.owner === ow))
    && (!q || (t.title || "").toLowerCase().includes(q) || (t.note || "").toLowerCase().includes(q)));
  const box = $("taskList"); box.innerHTML = "";
  if (!list.length) {
    box.append(state.tasks.length ? emptyState("search", "لا توجد مهام بهذه التصفية", "") :
      emptyState("check", "لا توجد مهام بعد", "أضف مهمة لكل ما يحتاج متابعة، مثل اختبار إعلان أو مراجعة ميزانية.", state.canWrite ? el("button", { class: "btn-primary", type: "button", onclick: () => openTask() }, icon("plus", "ic sm"), "مهمة جديدة") : null));
    return;
  }
  const t0 = todayISO(), week = addDays(t0, 7);
  const groups = filter === "done" ? [["المكتملة", list]] : [
    ["متأخرة", list.filter(isOverdue)], ["اليوم", list.filter(isDueToday)],
    ["هذا الأسبوع", list.filter(t => t.status !== "done" && t.due > t0 && t.due <= week)],
    ["لاحقًا", list.filter(t => t.status !== "done" && t.due > week)],
    ["بدون موعد", list.filter(t => t.status !== "done" && !t.due)],
    ["المكتملة", list.filter(t => t.status === "done")]];
  for (const [title, items] of groups) {
    if (!items.length) continue;
    items.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (b.createdAt || "").localeCompare(a.createdAt || ""));
    box.append(el("div", { class: "log-day" }, el("h3", {}, title, el("span", { class: "pill plain" }, String(items.length))), ...items.map(t => taskCard(t))));
  }
}

// opts: { editId, title, platform, due } when created from a change-log entry
export function openTask(t = null, opts = {}) {
  if (!client()) return;
  editing = t; linkedEdit = t?.editId || opts.editId || null;
  fillOwners($("tkOwnerIn"), false);
  $("taskDlgT").textContent = t ? "تعديل المهمة" : "مهمة جديدة";
  $("tkTitleIn").value = t?.title || opts.title || "";
  $("tkOwnerIn").value = t ? (t.owner || "") : state.uid || "";
  $("tkDue").value = t?.due || opts.due || "";
  $("tkState").value = t?.status || "open";
  $("tkPlat").value = t?.platform || opts.platform || "";
  $("tkNote").value = t?.note || "";
  $("tkLinked").classList.toggle("hidden", !linkedEdit);
  $("tkLinked").textContent = linkedEdit ? "مرتبطة بتعديل في سجل التعديلات." : "";
  $("tkDelete").classList.toggle("hidden", !t || !state.canWrite);
  $("tkSave").disabled = !state.canWrite;
  openDialog("taskDlg");
}

async function save(ev) {
  ev.preventDefault(); const c = client(); if (!c || !guard()) return;
  const now = new Date().toISOString(), status = $("tkState").value;
  const data = { clientId: c.id, title: $("tkTitleIn").value.trim(), owner: $("tkOwnerIn").value || null, due: $("tkDue").value || null, status, platform: $("tkPlat").value || null, note: $("tkNote").value.trim(), editId: linkedEdit,
    createdBy: editing?.createdBy || state.uid, createdAt: editing?.createdAt || now, updatedAt: now, doneAt: status === "done" ? (editing?.doneAt || now) : null };
  if (!data.title) return;
  const id = editing?.id || `${c.id}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (await safe(state.db.doc("tasks/" + id).set(data), editing ? "تم حفظ المهمة" : "تمت إضافة المهمة")) closeDialog("taskDlg");
}
async function setStatus(t, status) {
  if (!guard()) return;
  await safe(state.db.doc("tasks/" + t.id).update({ status, doneAt: status === "done" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() }), status === "done" ? "أحسنت، اكتملت المهمة" : "أُعيد فتح المهمة");
}
async function del() {
  if (!editing || !guard()) return;
  if (!await confirmDialog({ title: "حذف المهمة؟", body: `سيتم حذف "${editing.title}" نهائيًا.`, ok: "حذف" })) return;
  if (await safe(state.db.doc("tasks/" + editing.id).delete(), "تم حذف المهمة")) closeDialog("taskDlg");
}
