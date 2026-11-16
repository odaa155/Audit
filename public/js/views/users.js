// Users (admin): team members, roles and which clients each media buyer can see.
import { $, el, icon, initial, api, toast, openDialog, closeDialog, confirmDialog, emptyState, busy } from "../lib.js";
import { state } from "../store.js";

let users = [], editing = null, loading = false;

export function init() {
  $("openAddUser").addEventListener("click", () => openUser(null));
  $("userForm").addEventListener("submit", submit);
  $("uRole").addEventListener("change", renderClientChips);
}

export function render() { draw(); }
export function enter() { if (!loading) load(); }

async function load() {
  loading = true;
  try { users = await api("/api/users"); } catch (e) { toast(e.message, "bad"); }
  loading = false; draw();
}

const roleLabel = r => r === "admin" ? "مدير" : "مسؤول حملات";
const clientName = id => state.clients.find(c => c.id === id)?.name || id;

function draw() {
  const box = $("usersList"); box.innerHTML = "";
  $("usersSub").textContent = users.length ? `${users.length} مستخدم · ${users.filter(u => u.role === "admin").length} مدير` : "";
  if (!users.length) { box.append(emptyState("users", "لا يوجد مستخدمون", "")); return; }
  const tbl = el("table");
  tbl.append(el("thead", {}, el("tr", {}, el("th", {}, "المستخدم"), el("th", {}, "الدور"), el("th", {}, "العملاء"), el("th", {}, ""))));
  const tb = el("tbody");
  for (const u of users) {
    const self = u.id === state.me?.id;
    const clientsCell = u.role === "admin" ? el("span", { class: "muted small" }, "كل العملاء")
      : u.clients.length ? el("div", { class: "chips" }, u.clients.slice(0, 3).map(id => el("span", { class: "pill plain" }, clientName(id))), u.clients.length > 3 ? el("span", { class: "pill plain" }, `+${u.clients.length - 3}`) : null)
      : el("span", { class: "pill warn" }, "لا يوجد عملاء");
    const actions = el("div", { class: "actions end" },
      el("button", { class: "btn-sm", type: "button", onclick: () => openUser(u) }, icon("pencil", "ic sm"), "تعديل"),
      self ? null : el("button", { class: "btn-ghost btn-sm icon-btn", type: "button", "aria-label": `حذف ${u.name}`, title: "حذف", onclick: () => del(u) }, icon("trash", "ic sm")));
    tb.append(el("tr", {},
      el("td", {}, el("div", { class: "user-cell" }, el("span", { class: "avatar" }, initial(u.name)), el("div", {}, el("b", {}, u.name, self ? el("span", { class: "muted small" }, " (أنت)") : null), el("div", { class: "muted small ltr" }, "@" + u.id)))),
      el("td", {}, el("span", { class: "pill " + (u.role === "admin" ? "neutral" : "plain") }, roleLabel(u.role))),
      el("td", { style: "white-space:normal" }, clientsCell), el("td", {}, actions)));
  }
  tbl.append(tb); box.append(el("div", { class: "tbl-wrap" }, tbl));
}

function renderClientChips(sel) {
  const box = $("uClients"); const selected = Array.isArray(sel) ? sel : [...box.querySelectorAll("input:checked")].map(x => x.value);
  box.innerHTML = "";
  if ($("uRole").value === "admin") { box.append(el("span", { class: "muted small" }, "يرى المدير جميع العملاء ويمكنه إدارة المستخدمين وربط المنصات.")); return; }
  if (!state.clients.length) { box.append(el("span", { class: "muted small" }, "لا يوجد عملاء بعد. أضفهم من صفحة الحسابات والعملاء.")); return; }
  for (const c of [...state.clients].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"))) {
    const cb = el("input", { type: "checkbox", value: c.id }); cb.checked = selected.includes(c.id);
    box.append(el("label", { class: "check-chip" }, cb, c.name || c.id));
  }
}

function openUser(u) {
  editing = u;
  const self = u && u.id === state.me?.id;
  $("userDlgTitle").textContent = u ? `تعديل ${u.name}` : "إضافة مستخدم";
  $("uName").value = u?.name || ""; $("uId").value = u?.id || ""; $("uId").disabled = !!u;
  $("uPw").value = ""; $("uPw").placeholder = u ? "اتركه فارغًا إن لم ترغب في تغييره" : "6 أحرف على الأقل"; $("uPw").required = !u;
  $("uRole").value = u?.role || "buyer"; $("uRole").disabled = !!self;
  $("uSubmit").textContent = u ? "حفظ" : "إضافة المستخدم";
  renderClientChips(u?.clients || []);
  openDialog("userDlg");
}

async function submit(ev) {
  ev.preventDefault();
  const clients = [...$("uClients").querySelectorAll("input:checked")].map(x => x.value);
  const body = { name: $("uName").value.trim(), id: $("uId").value.trim(), role: $("uRole").value, clients };
  if ($("uPw").value) body.password = $("uPw").value;
  await busy($("uSubmit"), async () => {
    try {
      await api("/api/users", { method: editing ? "PUT" : "POST", body: JSON.stringify(body) });
      toast(editing ? "تم الحفظ" : "تمت إضافة المستخدم", "good"); closeDialog("userDlg"); await load();
    } catch (e) { toast(e.message, "bad"); }
  });
}

async function del(u) {
  if (!await confirmDialog({ title: `حذف ${u.name}؟`, body: `@${u.id} لن يتمكن من الدخول إلى النظام مرة أخرى، وستبقى التعديلات التي سجّلها محفوظة.`, ok: "حذف المستخدم" })) return;
  try { await api("/api/users", { method: "DELETE", body: JSON.stringify({ id: u.id }) }); toast("تم حذف المستخدم", "good"); load(); } catch (e) { toast(e.message, "bad"); }
}
