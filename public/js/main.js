// App shell: routing, top tabs, client/date-range context, realtime subscriptions, boot.
import { $, el, initial, monthLabel, lsGet, lsSet, toast, status, PMAP, emptyState, icon, todayISO } from "./lib.js";
import { state, hooks, client, isAdmin, isNewEdit, monthsAvailable } from "./store.js";
import { mountTelegram } from "./tg.js";
import { initRange, mountPicker, drawPickerLabel, setRange, monthsIn, prevRange } from "./range.js";
import * as overview from "./views/overview.js";
import * as performance from "./views/performance.js";
import * as changelog from "./views/changelog.js";
import * as tasks from "./views/tasks.js";
import * as accounts from "./views/accounts.js";
import * as targets from "./views/targets.js";
import * as users from "./views/users.js";
import * as settings from "./views/settings.js";

// filter: "range" = date range picker, "month" = month picker (targets), none = client only
const VIEWS = {
  overview:    { title: "نظرة عامة",        mod: overview,    client: true,  filter: "range" },
  performance: { title: "الأداء اليومي",     mod: performance, client: true,  filter: "range" },
  changelog:   { title: "سجل التعديلات",     mod: changelog,   client: true,  filter: "range" },
  tasks:       { title: "المهام",            mod: tasks,       client: true },
  targets:     { title: "الهدف والميزانية",             mod: targets,     client: true,  filter: "month" },
  accounts:    { title: "الحسابات والعملاء", mod: accounts,    client: false },
  users:       { title: "المستخدمون",        mod: users,       client: false, admin: true, noContext: true },
  settings:    { title: "ربط المنصات",       mod: settings,    client: false, admin: true, noContext: true },
};
const LEGACY = { dashboard: "overview" };

// ---------- theme ----------
const isDark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
function applyThemeIcon() {
  const dark = isDark();
  $("themeBtn").querySelector("use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
  $("themeBtn").setAttribute("aria-label", dark ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن");
}
$("themeBtn").addEventListener("click", () => { const next = isDark() ? "light" : "dark"; document.documentElement.dataset.theme = next; lsSet("ops.theme", next); applyThemeIcon(); renderAll(); });
applyThemeIcon();

// ---------- account menu ----------
const openMenu = v => { $("meMenu").classList.toggle("hidden", !v); $("meBtn").setAttribute("aria-expanded", String(v)); };
$("meBtn").addEventListener("click", e => { e.stopPropagation(); openMenu($("meMenu").classList.contains("hidden")); });
document.addEventListener("click", () => openMenu(false));
document.addEventListener("keydown", e => { if (e.key === "Escape") openMenu(false); });

// ---------- routing ----------
let pendingClient = null; // from links like #overview?client=ID (e.g. Telegram alerts)
function route() {
  let v = (location.hash || "#overview").slice(1);
  if (v.includes("?")) {
    const [h, qs] = v.split("?"); v = h; const q = new URLSearchParams(qs);
    if (q.get("client")) { pendingClient = q.get("client"); if (state.loadedClients && state.clients.some(c => c.id === pendingClient)) { const id = pendingClient; pendingClient = null; setTimeout(() => selectClient(id)); } }
    if (q.get("conn")) { const lbl = PMAP[q.get("conn")]?.label || q.get("conn"); setTimeout(() => toast(q.get("ok") === "1" ? `تم ربط ${lbl} بنجاح` : `تعذّر ربط ${lbl}: ${q.get("msg") || ""}`, q.get("ok") === "1" ? "good" : "bad"), 300); }
    history.replaceState(null, "", "#" + h);
  }
  v = LEGACY[v] || v;
  if (!VIEWS[v] || (VIEWS[v].admin && state.me && !isAdmin())) v = "overview";
  state.view = v;
  for (const name of Object.keys(VIEWS)) $("view-" + name).classList.toggle("hidden", name !== v);
  document.querySelectorAll(".tab[data-view]").forEach(a => a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false"));
  document.querySelector(`.tab[data-view="${v}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  document.title = `${VIEWS[v].title} · audit`;
  // filters live at the end of the active page's header (one row, above the content they scope)
  const slot = $("view-" + v).querySelector(".page-head .actions");
  if (slot) slot.append($("filters"));
  window.scrollTo({ top: 0 });
  renderAll();
  VIEWS[v].mod.enter?.();
}
window.addEventListener("hashchange", route);

// ---------- client & date context ----------
function renderClientSelect() {
  const sel = $("clientSel"); sel.innerHTML = "";
  if (!state.clients.length) { sel.append(el("option", { value: "" }, state.loadedClients ? "لا يوجد عملاء" : "جارٍ التحميل…")); sel.disabled = true; return; }
  sel.disabled = false;
  for (const c of [...state.clients].sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"))) sel.append(el("option", { value: c.id }, c.name || c.id));
  sel.value = state.cid || "";
}
$("clientSel").addEventListener("change", e => selectClient(e.target.value));
function selectClient(id) {
  if (id === state.cid) return;
  state.cid = id; lsSet("ops.client", id || "");
  state.daily = []; state.store = []; state.edits = []; state.tasks = []; state.targets = {}; state.found = {};
  subscribeClient(); renderAll();
}
hooks.selectClient = selectClient;

function renderMonthSelect() {
  const sel = $("month"), months = monthsAvailable();
  sel.innerHTML = ""; for (const m of months) sel.append(el("option", { value: m }, monthLabel(m)));
  sel.value = state.month;
}
$("month").addEventListener("change", e => { setRange("m:" + e.target.value); renderAll(); });

// ---------- render ----------
function renderAll() {
  const V = VIEWS[state.view];
  renderClientSelect(); renderMonthSelect(); drawPickerLabel();
  $("clientPicker").classList.toggle("hidden", !!V.noContext);
  $("rangePicker").classList.toggle("hidden", V.filter !== "range");
  $("monthPicker").classList.toggle("hidden", V.filter !== "month");
  const hasClient = !!client();
  const blocked = V.client && !hasClient;
  $("noClient").classList.toggle("hidden", !(blocked && state.loadedClients));
  $("noClient").innerHTML = "";
  if (blocked && state.loadedClients) $("noClient").append(emptyState("briefcase", "لا يوجد عملاء بعد", isAdmin() ? "ابدأ بإضافة عميل ثم اربط حساباته الإعلانية." : "لم يعيّن لك المدير أي عملاء بعد.", isAdmin() ? el("a", { class: "btn btn-primary", href: "#accounts" }, icon("plus", "ic sm"), "إضافة عميل") : null));
  // keep the page header (and its filters) visible even without a client
  for (const n of $("view-" + state.view).children) if (!n.classList.contains("page-head")) n.classList.toggle("hidden-blocked", blocked);
  if (!blocked && (state.db || V.admin)) V.mod.render();
  maybeAutoSync();
  const n = state.edits.filter(isNewEdit).length;
  $("navBadge").textContent = n > 99 ? "99+" : String(n); $("navBadge").classList.toggle("hidden", !n);
  const tn = tasks.myDueCount(); $("taskBadge").textContent = String(tn); $("taskBadge").classList.toggle("hidden", !tn);
  $("taskBadge").title = tn ? `${tn} مهمة مستحقة اليوم أو متأخرة عليك` : "";
}
hooks.renderAll = renderAll;

// جلب تلقائي لأشهر الفترة المختارة (والفترة السابقة للمقارنة) إذا كانت أرقامها قديمة أو غير موجودة
const autoSynced = new Set();
function maybeAutoSync() {
  const c = client(); if (!c || !state.db || !state.canWrite || !state.mcp || !state.loadedClients || state.syncing || !state.range) return;
  if (!(c.accounts || []).some(a => a.via === "api")) return;
  const cm = todayISO().slice(0, 7);
  const months = [...new Set([...monthsIn(prevRange().from, state.range.to), state.month])].filter(m => m <= cm);
  const need = months.filter(ym => {
    if (autoSynced.has(c.id + "|" + ym)) return false;
    const ls = c.lastSync, fresh = ls?.at && ls.month === ym && Date.now() - new Date(ls.at).getTime() < 3600e3;
    const hasRows = state.daily.some(r => r.date?.startsWith(ym) && r.source === "api");
    return !(fresh || (ym !== cm && hasRows));
  });
  if (!need.length) return;
  need.forEach(ym => autoSynced.add(c.id + "|" + ym));
  setTimeout(() => performance.runSync({ silent: true, months: need }), 300);
}

function applyWriteState() {
  const dis = !state.canWrite;
  ["openEdit", "openTask", "saveTarget", "openEntry", "openPaste", "saveDaily", "delDaily", "saveStore", "doPaste", "addClient", "saveClient", "delClient", "addManualAcc", "openManual", "openAddClient"].forEach(id => { const b = $(id); if (b) b.disabled = dis; });
  if (dis && state.db) status("لديك صلاحية عرض فقط. اطلب من المدير صلاحية التعديل لتتمكن من التسجيل والتعديل.", "warn");
}

// ---------- subscriptions ----------
function subscribeClient() {
  for (const u of state.unsubs) try { u(); } catch (_) {} state.unsubs = [];
  const cid = state.cid; if (!state.db || !cid) return;
  const onErr = () => status("حدثت مشكلة في تحميل البيانات. يُرجى تحديث الصفحة.", "bad");
  const q = col => state.db.collection(col).where("clientId", "==", cid);
  state.unsubs.push(q("daily").onSnapshot(s => { if (state.cid !== cid) return; state.daily = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, onErr));
  state.unsubs.push(q("store").onSnapshot(s => { if (state.cid !== cid) return; state.store = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, onErr));
  state.unsubs.push(q("targets").onSnapshot(s => { if (state.cid !== cid) return; state.targets = Object.fromEntries(s.docs.map(d => { const t = d.data(); return [t.month, t]; })); renderAll(); }, onErr));
  state.unsubs.push(q("tasks").onSnapshot(s => { if (state.cid !== cid) return; state.tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); }, onErr));
  state.unsubs.push(q("edits").orderBy("at", "desc").limit(1000).onSnapshot(s => { if (state.cid !== cid) return; state.edits = s.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); changelog.resolveNames(renderAll); }, onErr));
}

// ---------- boot ----------
initRange(); mountPicker(); mountTelegram();
for (const V of Object.values(VIEWS)) V.mod.init();
route();
(async function boot() {
  const [db, user, mcp] = await Promise.all([claude.use("db"), claude.use("user"), claude.use("mcp")]);
  state.db = db; state.user = user; state.mcp = mcp;
  if (!mcp) { const n = $("mcpNotice"); n.classList.remove("hidden"); n.append(icon("info"), el("div", {}, "جلب الحسابات والأرقام مباشرة من المنصات غير مفعّل. يمكنك إضافة الحسابات يدويًا وإدخال الأرقام أو لصقها من جدول بيانات.")); }
  try {
    state.me = await user.me(); state.uid = state.me.id;
    $("meName").textContent = state.me.name || state.me.id;
    $("meRole").textContent = state.me.role === "admin" ? "مدير" : "مسؤول حملات";
    $("meAvatar").textContent = initial(state.me.name || state.me.id);
    document.querySelectorAll(".admin-only").forEach(x => x.classList.toggle("hidden", !isAdmin()));
    if (VIEWS[state.view].admin && !isAdmin()) { location.hash = "#overview"; }
  } catch (_) {}
  try { state.people = await user.profiles() || {}; } catch (_) {}
  let cw = null; try { cw = await user.can("data.write"); } catch (_) {}
  state.canWrite = cw !== false && !!state.uid;
  applyWriteState();
  const timer = setTimeout(() => { if (!state.loadedClients) status("الاتصال بالبيانات بطيء. جرّب تحديث الصفحة.", "warn"); }, 10000);
  db.collection("clients").onSnapshot(s => {
    state.clients = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!s.metadata.fromCache) { state.loadedClients = true; clearTimeout(timer); if (state.canWrite) status(""); }
    if (!state.cid || !state.clients.some(c => c.id === state.cid)) {
      const saved = lsGet("ops.client"); const pick = state.clients.find(c => c.id === saved) || state.clients[0];
      if (pick) { state.cid = null; selectClient(pick.id); return; }
      else if (state.cid) { state.cid = null; subscribeClient(); }
    }
    if (pendingClient && state.clients.some(c => c.id === pendingClient)) { const id = pendingClient; pendingClient = null; if (id !== state.cid) { selectClient(id); return; } }
    renderAll();
  }, () => status("حدثت مشكلة في تحميل العملاء. يُرجى تحديث الصفحة.", "bad"));
  if (state.uid) { try { const st = await db.doc(`data/users/${state.uid}/state`).get(); state.lastSeen = st.exists ? (st.data().lastSeen || null) : new Date(0).toISOString(); renderAll(); } catch (_) {} }
})();
