// Accounts & clients: manage clients, link ad accounts to the selected client, browse connected platform accounts.
import { $, el, icon, slug, initial, platChip, PMAP, FX_DEFAULT, fillPlatSelect, fillCurSelect, toast, openDialog, closeDialog, confirmDialog, emptyState, notice } from "../lib.js";
import { runSync } from "./performance.js";
import { state, hooks, client, cur, guard, safe, isAdmin, callMcp, mcpErrorText } from "../store.js";

export function init() {
  fillPlatSelect($("mPlat")); for (const id of ["mCur", "newClientCur", "cCur"]) fillCurSelect($(id));
  $("openAddClient").addEventListener("click", () => openDialog("clientDlg"));
  $("addClient").addEventListener("click", addClient);
  $("newClientName").addEventListener("keydown", e => { if (e.key === "Enter") addClient(); });
  $("saveClient").addEventListener("click", saveClient);
  $("delClient").addEventListener("click", delClient);
  $("openManual").addEventListener("click", () => { if (!client()) { toast("اختر عميلًا أولًا", "bad"); return; } openDialog("manualDlg"); });
  $("addManualAcc").addEventListener("click", addManual);
}

export function render() {
  const c = client();
  $("clientEdit").classList.toggle("hidden", !c);
  const ncc = $("noClientCard"); ncc.classList.toggle("hidden", !!c || !state.loadedClients); ncc.innerHTML = "";
  if (!c) ncc.append(emptyState("briefcase", "لا يوجد عملاء بعد", isAdmin() ? "أضف أول عميل، ثم اربط حساباته الإعلانية من الأسفل." : "لم يعيّن لك المدير أي عملاء بعد.",
    isAdmin() ? el("button", { class: "btn-primary", type: "button", onclick: () => openDialog("clientDlg") }, icon("plus", "ic sm"), "إضافة عميل") : null));
  if (c) {
    $("clientAvatar").textContent = initial(c.name);
    $("clientTitle").textContent = c.name || c.id;
    $("clientMeta").textContent = `${(c.accounts || []).length} حساب مربوط · عملة التقارير ${c.currency || "SAR"}`;
    if (document.activeElement !== $("cName")) { $("cName").value = c.name || ""; $("cCur").value = c.currency || "SAR"; }
  }
  $("delClient").classList.toggle("hidden", !isAdmin());
  $("openAddClient").classList.toggle("hidden", !isAdmin());
  $("linkedTitle").textContent = c ? `حسابات ${c.name}` : "حسابات العميل";
  $("openManual").disabled = !c || !state.canWrite;
  // ربط الحسابات بالعملاء للمدير فقط؛ مسؤول الحملات يرى حسابات عملائه فقط
  $("openManual").classList.toggle("hidden", !isAdmin());
  $("connSection").classList.toggle("hidden", !isAdmin());

  const t = $("linkedTbl"); t.innerHTML = "";
  t.append(el("thead", {}, el("tr", {}, el("th", {}, "المنصة"), el("th", {}, "الحساب"), el("th", {}, "رقم الحساب"), el("th", {}, "العملة"), el("th", { class: "n" }, `التحويل لـ ${cur()}`), el("th", {}, "المصدر"), el("th", {}, ""))));
  const tb = el("tbody");
  const accs = c?.accounts || [];
  if (!c) tb.append(el("tr", {}, el("td", { colspan: 7, class: "muted-cell" }, "اختر عميلًا أو أضف عميلًا جديدًا أولًا.")));
  else if (!accs.length) tb.append(el("tr", {}, el("td", { colspan: 7, class: "muted-cell" }, isAdmin() ? "لا توجد حسابات مربوطة بهذا العميل. اختر حساباته من المنصات بالأسفل أو أضف حسابًا يدويًا." : "لم يربط المدير أي حسابات بهذا العميل بعد.")));
  accs.forEach((a, i) => {
    const fx = el("input", { type: "number", step: "any", min: "0", value: a.fx ?? 1, "aria-label": "سعر التحويل", id: "fx_" + i, style: "width:110px;text-align:left", dir: "ltr" });
    fx.disabled = !state.canWrite;
    fx.addEventListener("change", () => updateAccount(i, { fx: +fx.value || 1 }));
    const rm = el("button", { class: "btn-ghost btn-sm", type: "button", "aria-label": "إزالة الحساب" }, icon("x", "ic sm"), "إزالة");
    rm.disabled = !state.canWrite; rm.addEventListener("click", () => removeAccount(i, a));
    if (!isAdmin()) rm.classList.add("hidden");
    tb.append(el("tr", {}, el("td", {}, platChip(a.platform)), el("td", {}, a.name || "-"), el("td", { class: "num" }, a.accountId), el("td", {}, a.currency || "-"), el("td", { class: "n" }, fx),
      el("td", {}, a.via === "api" ? el("span", { class: "pill good" }, icon("link", "ic sm"), "مربوط بالمنصة") : el("span", { class: "pill plain" }, "يدوي")), el("td", {}, rm)));
  });
  t.append(tb);
  renderConnectors();
}

function renderConnectors() {
  for (const box of document.querySelectorAll(".conn")) {
    const key = box.dataset.plat, p = PMAP[key], found = state.found[key];
    box.innerHTML = "";
    const cs = (window.auditConn || {})[key];
    const head = el("div", { class: "conn-head" }, el("h3", {}, platChip(key)));
    box.append(head);
    if (cs && (!cs.connected || cs.expired)) {
      const pillTxt = !cs.configured ? "غير مُعد" : cs.expired ? "انتهى الربط" : "غير مربوط";
      head.append(el("span", { class: "pill " + (cs.expired ? "bad" : "warn") }, el("span", { class: "dot" }), pillTxt));
      const note = !cs.configured ? `ربط ${p.label} يحتاج إلى App ID وSecret من صفحة ربط المنصات.`
        : !cs.isAdmin ? `يجب أن يربط المدير حساب ${p.label} أولًا.` : (cs.expired ? `صلاحية ربط ${p.label} انتهت. أعد الربط.` : `اربط حسابك على ${p.label} مرة واحدة، وستظهر هنا جميع الحسابات التي تملك صلاحية عليها.`);
      box.append(el("p", { class: "muted small" }, note));
      if (!cs.configured && cs.isAdmin) box.append(el("a", { href: "#settings", class: "btn btn-sm" }, icon("sliders", "ic sm"), "افتح ربط المنصات"));
      if (cs.configured && cs.isAdmin) box.append(el("a", { href: "/api/connect/" + key, class: "btn btn-primary btn-sm" }, icon("link", "ic sm"), `ربط ${p.label}`));
      continue;
    }
    head.append(el("span", { class: "pill good" }, el("span", { class: "dot" }), "مربوط"));
    if (cs?.connected) box.append(el("div", { class: "conn-state" }, cs.name ? `بحساب ${cs.name}` : "", cs.isAdmin ? el("a", { href: "/api/connect/" + key, class: "small" }, "إعادة الربط") : null));
    const btn = el("button", { type: "button", class: "btn-sm" + (found ? "" : " btn-primary") }, icon("refresh", "ic sm"), found?.loading ? "جارٍ التحميل…" : (found ? "تحديث القائمة" : `اعرض حساباتي`));
    btn.disabled = !state.mcp || found?.loading || !client();
    if (found?.loading) btn.classList.add("loading");
    btn.addEventListener("click", () => loadAccounts(key));
    box.append(el("div", {}, btn));
    if (!found) { box.append(el("p", { class: "muted small" }, client() ? `اعرض حساباتك واختر الحسابات التابعة لـ ${client().name}.` : "اختر عميلًا أولًا.")); continue; }
    if (found.error) { box.append(notice("bad", found.error)); continue; }
    if (found.list) {
      const tools = el("div", { class: "acc-tools" });
      const q = el("input", { type: "search", placeholder: "ابحث بالاسم أو رقم الحساب…", "aria-label": `البحث في حسابات ${p.label}`, value: found.q || "" });
      const onlyCb = el("input", { type: "checkbox" }); onlyCb.checked = !!found.only;
      const count = el("div", { class: "muted small" });
      const list = el("div", { class: "acc-list" });
      tools.append(el("div", { class: "search" }, icon("search", "ic sm"), q), el("label", { class: "check-chip" }, onlyCb, "المختارة فقط"));
      q.addEventListener("input", () => { found.q = q.value; drawList(key, list, count); });
      onlyCb.addEventListener("change", () => { found.only = onlyCb.checked; drawList(key, list, count); });
      box.append(tools, count, list);
      drawList(key, list, count);
    }
  }
}

function drawList(key, list, count) {
  const found = state.found[key], c = client();
  const mine = new Set((c?.accounts || []).filter(a => a.platform === key).map(a => a.accountId));
  const others = {}; for (const oc of state.clients) if (oc.id !== state.cid) for (const a of oc.accounts || []) if (a.platform === key) others[a.accountId] = oc.name;
  const q = (found.q || "").trim().toLowerCase();
  const shown = found.list
    .filter(a => (!found.only || mine.has(a.accountId)) && (!q || (a.name || "").toLowerCase().includes(q) || String(a.accountId).toLowerCase().includes(q)))
    .sort((a, b) => (mine.has(b.accountId) ? 1 : 0) - (mine.has(a.accountId) ? 1 : 0));
  count.textContent = `${mine.size} مختار من ${found.list.length} لـ ${c?.name || ""}` + (q || found.only ? ` · يظهر ${shown.length}` : "");
  list.innerHTML = "";
  if (!found.list.length) { list.append(el("p", { class: "muted small" }, "لا توجد حسابات ظاهرة على هذا الربط.")); return; }
  if (!shown.length) { list.append(el("p", { class: "muted small", style: "text-align:center;padding:16px" }, "لا توجد حسابات تطابق البحث.")); return; }
  for (const a of shown) {
    const id = `chk_${key}_${slug(a.accountId)}`;
    const cb = el("input", { type: "checkbox", id }); cb.checked = mine.has(a.accountId); cb.disabled = !state.canWrite || !isAdmin();
    cb.addEventListener("change", () => toggleAccount(key, a, cb.checked));
    const meta = el("label", { class: "meta", for: id }, el("b", {}, a.name || a.accountId), el("span", {}, `${a.accountId}${a.currency ? " · " + a.currency : ""}`));
    const tags = el("div", { style: "display:grid;gap:4px;justify-items:end" });
    if (a.bad) tags.append(el("span", { class: "pill bad" }, a.bad));
    if (others[a.accountId]) tags.append(el("span", { class: "pill warn" }, "مع " + others[a.accountId]));
    list.append(el("div", { class: "acc" }, cb, meta, tags));
  }
}

async function loadAccounts(key) {
  const p = PMAP[key]; state.found[key] = { loading: true }; renderConnectors();
  try {
    let list = [];
    if (key === "meta") {
      let cursor = null, guard_ = 0;
      do {
        const input = { limit: 50, advertiser_job: "set_up_and_fix_ad_account" }; if (cursor) input.cursor = cursor;
        const pl = (await callMcp(p.server, "ads_get_ad_accounts", input)).payload || {};
        for (const a of pl.ad_accounts || []) list.push({ accountId: String(a.ad_account_id), name: a.ad_account_name, currency: a.currency, bad: (a.is_queryable === false || a.is_ads_mcp_enabled === false) ? (a.account_status && a.account_status !== "ACTIVE" ? a.account_status : "غير متاح للتقارير") : null });
        cursor = pl.next_cursor; guard_++;
      } while (cursor && guard_ < 10);
    } else if (key === "tiktok") {
      const pl = (await callMcp(p.server, "auth_advertiser_get", {})).payload || {};
      for (const a of pl?.data?.list || []) list.push({ accountId: String(a.advertiser_id), name: a.advertiser_name, currency: a.currency || null, bad: a.status && a.status !== "STATUS_ENABLE" ? a.status : null });
    } else if (key === "snapchat") {
      for (const rel of ["owned", "shared"]) {
        let cursor = null, guard_ = 0;
        do {
          const input = { return_fields: ["id", "name", "currency", "timezone", "status"] }; if (rel === "shared") input.account_relationship = "shared"; else input.limit = 100; if (cursor) input.cursor = cursor;
          let pl; try { pl = (await callMcp(p.server, "snap_ads_get_my_ad_accounts", input)).payload || {}; } catch (e) { if (rel === "shared") break; throw e; }
          for (const w of pl.adaccounts || []) { const a = w.adaccount || w; const v = x => x && typeof x === "object" ? x.value : x; if (!a?.id) continue; if (!list.some(z => z.accountId === a.id)) list.push({ accountId: a.id, name: v(a.name), currency: v(a.currency), timezone: v(a.timezone), bad: a.status && a.status !== "ACTIVE" ? a.status : null }); }
          const nl = pl.paging?.next_link; cursor = pl.paging?.next_cursor || (nl ? new URL(nl).searchParams.get("cursor") : null); guard_++;
        } while (cursor && guard_ < 10);
      }
    }
    list.sort((a, b) => (a.bad ? 1 : 0) - (b.bad ? 1 : 0) || (a.name || "").localeCompare(b.name || ""));
    state.found[key] = { list };
  } catch (e) { state.found[key] = { error: mcpErrorText(e, p.label) }; }
  renderConnectors();
}

function suggestFx(accCur) { const c = cur(); if (!accCur || accCur === c) return 1; return FX_DEFAULT[c]?.[accCur] ?? 1; }
async function saveAccounts(accounts) { const c = client(); if (!c || !guard()) return false; return await safe(state.db.doc("clients/" + c.id).update({ accounts }), null); }
async function toggleAccount(key, a, on) {
  const c = client(); if (!c) return;
  let accounts = [...(c.accounts || [])];
  if (on && !accounts.some(x => x.platform === key && x.accountId === a.accountId)) accounts.push({ platform: key, accountId: a.accountId, name: a.name || "", currency: a.currency || null, timezone: a.timezone || null, fx: suggestFx(a.currency), via: "api" });
  if (!on) accounts = accounts.filter(x => !(x.platform === key && x.accountId === a.accountId));
  if (await saveAccounts(accounts)) { toast(on ? "تم ربط الحساب بالعميل، وجارٍ جلب أرقامه" : "تمت إزالة الحساب", "good"); if (on) runSync({ silent: true }); }
}
async function updateAccount(i, patch) { const c = client(); const accounts = (c.accounts || []).map((a, j) => j === i ? { ...a, ...patch } : a); if (await saveAccounts(accounts)) toast("تم حفظ سعر التحويل", "good"); }
async function removeAccount(i, a) {
  if (!await confirmDialog({ title: "إزالة الحساب من العميل؟", body: `"${a.name || a.accountId}" لن يدخل في تقارير ${client()?.name || "العميل"} بعد الآن، ولن تُحذف الأرقام المسجلة سابقًا.`, ok: "إزالة" })) return;
  const c = client(); const accounts = (c.accounts || []).filter((_, j) => j !== i); if (await saveAccounts(accounts)) toast("تمت إزالة الحساب", "good");
}
async function addManual() {
  const c = client(); if (!c) { toast("اختر عميلًا أولًا", "bad"); return; }
  const id = $("mId").value.trim(); if (!id) { toast("أدخل رقم الحساب", "bad"); $("mId").focus(); return; }
  const platform = $("mPlat").value, currency = $("mCur").value;
  if ((c.accounts || []).some(a => a.platform === platform && a.accountId === id)) { toast("هذا الحساب مضاف بالفعل", "bad"); return; }
  const accounts = [...(c.accounts || []), { platform, accountId: id, name: $("mName").value.trim(), currency, fx: suggestFx(currency), via: "manual" }];
  if (await saveAccounts(accounts)) { $("mId").value = ""; $("mName").value = ""; toast("تمت إضافة الحساب", "good"); closeDialog("manualDlg"); }
}
async function addClient() {
  if (!guard()) return;
  const name = $("newClientName").value.trim(); if (!name) { toast("أدخل اسم العميل", "bad"); $("newClientName").focus(); return; }
  const id = (slug(name).replace(/^-+|-+$/g, "").toLowerCase() || "client") + "-" + Math.random().toString(36).slice(2, 6);
  if (await safe(state.db.doc("clients/" + id).set({ name, currency: $("newClientCur").value, accounts: [], createdBy: state.uid, createdAt: new Date().toISOString() }), "تمت إضافة العميل")) {
    $("newClientName").value = ""; closeDialog("clientDlg"); hooks.selectClient(id);
  }
}
async function saveClient() { const c = client(); if (!c || !guard()) return; const name = $("cName").value.trim(); if (!name) { toast("أدخل اسم العميل", "bad"); return; } await safe(state.db.doc("clients/" + c.id).update({ name, currency: $("cCur").value }), "تم الحفظ"); }
async function delClient() {
  const c = client(); if (!c || !guard()) return;
  if (!await confirmDialog({ title: `حذف ${c.name}؟`, body: "سيُحذف العميل من القائمة لدى جميع أعضاء الفريق، ولا يمكن التراجع عن هذه الخطوة.", ok: "حذف العميل" })) return;
  if (await safe(state.db.doc("clients/" + c.id).delete(), "تم حذف العميل")) { const next = state.clients.find(x => x.id !== c.id); hooks.selectClient(next?.id || null); }
}
