// Users (admin): team members, roles and which clients each media buyer can see.
import { $, el, icon, initial, api, toast, openDialog, closeDialog, confirmDialog, emptyState, busy } from "../lib.js";
import { state } from "../store.js";

let users = [], editing = null, loading = false;

export function init() {
  $("openAddUser").addEventListener("click", () => openUser(null));
  $("userForm").addEventListener("submit", submit);
  $("uRole").addEventListener("change", renderClientChips);
  for (const b of document.querySelectorAll("#uTabs button")) b.addEventListener("click", () => setTab(b.dataset.v));
  for (const id of ["acUser", "acType"]) $(id).addEventListener("change", drawActivity);
  $("acQ").addEventListener("input", drawActivity);
  $("acReload").addEventListener("click", loadActivity);
}

let tab = "team", activity = [];
function setTab(v) {
  tab = v;
  document.querySelectorAll("#uTabs button").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.v === v)));
  $("uTeam").classList.toggle("hidden", v !== "team"); $("uActivity").classList.toggle("hidden", v !== "activity");
  $("openAddUser").classList.toggle("hidden", v !== "team");
  if (v === "activity") loadActivity();
}

export function render() { draw(); }
export function enter() { if (!loading) load(); if (tab === "activity") loadActivity(); }

// ---------- activity log ----------
async function loadActivity() {
  try { activity = (await api("/api/audit?limit=1000")).rows; } catch (e) { toast(e.message, "bad"); }
  const sel = $("acUser"), keep = sel.value; sel.innerHTML = ""; sel.append(el("option", { value: "" }, "كل المستخدمين"));
  for (const u of [...new Set(activity.map(r => r.user).filter(Boolean))]) sel.append(el("option", { value: u }, userName(u)));
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "";
  drawActivity();
}
const userName = id => users.find(u => u.id === id)?.name || state.people?.[id]?.name || id || "—";
const clientNameOf = id => state.clients.find(c => c.id === id)?.name || id || "";
const PL = k => ({ meta: "Meta", tiktok: "TikTok", snapchat: "Snapchat" }[k] || k);
const accList = a => (a || []).map(x => `${PL(x.platform)}: ${x.name || x.id}`).join("، ");
const money = v => v == null ? "—" : Number(v).toLocaleString("en-US");
const ACTIONS = {
  login: ["تسجيل دخول", "plain", () => ""],
  login_failed: ["محاولة دخول فاشلة", "bad", (d, r) => `باسم المستخدم @${r.user || "؟"}`],
  logout: ["تسجيل خروج", "plain", () => ""],
  setup: ["إنشاء حساب المدير", "neutral", () => ""],
  user_add: ["إضافة مستخدم", "neutral", d => `@${d.id} · ${d.role === "admin" ? "مدير" : "مسؤول حملات"}`],
  user_update: ["تعديل مستخدم", "neutral", d => [`@${d.id}`, d.role && `الدور: ${d.role[0] === "admin" ? "مدير" : "مسؤول حملات"} ← ${d.role[1] === "admin" ? "مدير" : "مسؤول حملات"}`, d.name && `الاسم: ${d.name[1]}`, d.password && "تغيير كلمة المرور", d.clientsAdded && `أُضيف إلى: ${d.clientsAdded.map(x => clientNameOf(x)).join("، ")}`, d.clientsRemoved && `أُزيل من: ${d.clientsRemoved.map(x => clientNameOf(x)).join("، ")}`].filter(Boolean).join(" · ")],
  user_delete: ["حذف مستخدم", "bad", d => `@${d.id} (${d.name || ""})`],
  settings_update: ["تحديث إعدادات منصة", "warn", d => (d.keys || []).join("، ")],
  settings_clear: ["مسح إعدادات منصة", "bad", d => PL(d.platform)],
  platform_connect: ["ربط منصة", "good", d => `${PL(d.platform)}${d.name ? " · " + d.name : ""}`],
  platform_connect_failed: ["فشل ربط منصة", "bad", d => `${PL(d.platform)} · ${d.error || ""}`],
  client_add: ["إضافة عميل", "neutral", d => d.name || ""],
  client_delete: ["حذف عميل", "bad", d => d.name || ""],
  client_update: ["تعديل عميل", "neutral", d => [d.client, d.name && `الاسم: ${d.name[0]} ← ${d.name[1]}`, d.currency && `العملة: ${d.currency[0]} ← ${d.currency[1]}`, d.fx && d.fx.map(x => `سعر تحويل ${x.account}: ${x.from} ← ${x.to}`).join("، ")].filter(Boolean).join(" · ")],
  accounts_link: ["ربط حسابات بعميل", "good", d => `${d.client}: ${accList(d.accounts)}`],
  accounts_unlink: ["فك ربط حسابات", "warn", d => `${d.client}: ${accList(d.accounts)}`],
  target_set: ["تحديد هدف", "neutral", (d, r) => `${clientNameOf(r.client)} · ${d.month}: ${d.before?.sales ? money(d.before.sales) + " ← " : ""}${money(d.after?.sales)}${d.after?.budget ? ` · ميزانية ${money(d.after.budget)}` : ""}`],
  target_delete: ["حذف هدف", "bad", (d, r) => `${clientNameOf(r.client)} · ${d.month}`],
  data_delete: ["حذف بيانات", "bad", (d, r) => `${clientNameOf(r.client)} · ${{ edits: "تعديل", daily: "أرقام يومية", store: "أرقام المتجر", tasks: "مهمة" }[d.col] || d.col}${d.entity ? ": " + d.entity : ""}${d.date ? " · " + String(d.date).slice(0, 10) : ""}`],
};
const TYPE = { login: ["login", "login_failed", "logout", "setup"], user: ["user_"], client: ["client_"], accounts: ["accounts_"], target: ["target_"], settings: ["settings_"], platform: ["platform_"], data_delete: ["data_delete"] };
function drawActivity() {
  const u = $("acUser").value, ty = $("acType").value, q = $("acQ").value.trim().toLowerCase();
  const t = $("acTbl"); t.innerHTML = "";
  t.append(el("thead", {}, el("tr", {}, el("th", {}, "الوقت"), el("th", {}, "المستخدم"), el("th", {}, "النشاط"), el("th", {}, "التفاصيل"), el("th", {}, "IP"))));
  const tb = el("tbody"); let n = 0;
  for (const r of activity) {
    if (u && r.user !== u) continue;
    if (ty && !TYPE[ty].some(p => r.action === p || r.action.startsWith(p))) continue;
    const A = ACTIONS[r.action] || [r.action, "plain", () => ""];
    let detail = ""; try { detail = A[2](r.detail || {}, r) || ""; } catch (_) {}
    if (q && !(`${A[0]} ${detail} ${userName(r.user)}`.toLowerCase().includes(q))) continue;
    const d = new Date(r.at);
    tb.append(el("tr", {}, el("td", { class: "num", title: r.at }, d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })),
      el("td", {}, r.user ? userName(r.user) : "—"), el("td", {}, el("span", { class: "pill " + A[1] }, A[0])),
      el("td", { style: "white-space:normal;min-width:260px" }, detail), el("td", { class: "num muted small" }, r.ip || "")));
    if (++n >= 500) break;
  }
  if (!n) tb.append(el("tr", {}, el("td", { colspan: 5, class: "muted-cell" }, activity.length ? "لا يوجد نشاط بهذه التصفية." : "لا يوجد نشاط مسجل بعد.")));
  t.append(tb);
}

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
