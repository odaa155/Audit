// Platform connections (admin): OAuth app credentials + connect/reconnect per platform.
import { $, el, icon, api, toast, confirmDialog, platChip, busy, PMAP } from "../lib.js";

const PL = [
  { k: "meta", id: "META_APP_ID", sec: "META_APP_SECRET", idL: "App ID", secL: "App Secret",
    help: ["ادخل إلى developers.facebook.com ← My Apps ← Create App، واختر النوع Business.", "من Add products أضف Marketing API وFacebook Login for Business.", "في Facebook Login ← Settings، الصق رابط Redirect URL الموضح أعلاه في Valid OAuth Redirect URIs.", "من App settings ← Basic، انسخ App ID وApp Secret وأدخلهما هنا."] },
  { k: "snapchat", id: "SNAP_CLIENT_ID", sec: "SNAP_CLIENT_SECRET", idL: "Client ID", secL: "Client Secret",
    help: ["ادخل إلى Snapchat Business Manager ← Business Settings ← Business Details.", "من OAuth Apps اضغط + OAuth App، والصق رابط Redirect URL الموضح أعلاه.", "انسخ Client ID وClient Secret وأدخلهما هنا. يظهر الـ Secret مرة واحدة فقط."] },
  { k: "tiktok", id: "TIKTOK_APP_ID", sec: "TIKTOK_APP_SECRET", idL: "App ID", secL: "Secret",
    help: ["ادخل إلى business-api.tiktok.com ← My Apps ← Create a developer app.", "في Advertiser redirect URL الصق رابط Redirect URL الموضح أعلاه.", "فعّل صلاحيات Ad Account Management وReporting، ثم أرسل التطبيق للمراجعة (من يوم إلى 3 أيام).", "بعد الموافقة انسخ App ID وSecret وأدخلهما هنا."] },
];
let loading = false;

export function init() {}
export function render() {}
export function enter() { if (!loading) load(); }

async function load() {
  loading = true;
  let s, conn;
  try { [s, conn] = await Promise.all([api("/api/settings"), api("/api/connections")]); window.auditConn = conn; }
  catch (e) { loading = false; toast(e.message, "bad"); return; }
  loading = false;
  const box = $("settingsCards"); box.innerHTML = "";
  for (const p of PL) {
    const idv = s.keys[p.id], sv = s.keys[p.sec], c = conn[p.k], ready = idv.set && sv.set;
    const pill = !ready ? el("span", { class: "pill warn" }, el("span", { class: "dot" }), "يحتاج إلى App ID")
      : c.connected && !c.expired ? el("span", { class: "pill good" }, el("span", { class: "dot" }), "مربوط" + (c.name ? " · " + c.name : ""))
      : el("span", { class: "pill neutral" }, el("span", { class: "dot" }), c.expired ? "انتهى الربط" : "جاهز للربط");
    const iid = el("input", { value: idv.value || "", autocomplete: "off", dir: "ltr", id: "s_" + p.id });
    const isec = el("input", { type: "password", dir: "ltr", id: "s_" + p.sec, placeholder: sv.set ? sv.value + "  (اتركه فارغًا إن لم ترغب في تغييره)" : "", autocomplete: "new-password" });
    const save = el("button", { class: "btn-primary", type: "button" }, "حفظ");
    const card = el("section", { class: "card pad-lg", id: p.k, style: "display:grid;gap:16px" },
      el("div", { class: "card-head", style: "margin:0" }, el("h2", {}, platChip(p.k)), pill),
      el("div", { class: "field" }, "Redirect URL (الصقه في إعدادات التطبيق)",
        el("div", { class: "redir" }, el("code", {}, s.redirects[p.k]),
          el("button", { class: "btn-sm", type: "button", onclick: () => { navigator.clipboard?.writeText(s.redirects[p.k]); toast("تم نسخ رابط Redirect URL", "good"); } }, icon("copy", "ic sm"), "نسخ"))),
      el("div", { class: "form-grid" }, el("label", { class: "field", for: iid.id }, p.idL, iid), el("label", { class: "field", for: isec.id }, p.secL, isec)),
      el("div", { class: "actions" }, save,
        ready ? el("a", { href: "/api/connect/" + p.k, class: "btn" }, icon("link", "ic sm"), c.connected ? "إعادة الربط" : "ربط الحساب الآن") : null,
        ready ? el("button", { class: "btn-danger", type: "button", onclick: () => reset(p) }, "مسح الإعدادات") : null),
      el("details", { class: "more" }, el("summary", {}, `كيف أحصل على ${p.idL} و${p.secL}؟`), el("ol", { class: "steps" }, p.help.map(h => el("li", {}, h)))));
    save.addEventListener("click", () => busy(save, async () => {
      const body = { [p.id]: iid.value, [p.sec]: isec.value };
      if (!body[p.id].trim()) { toast(`أدخل ${p.idL}`, "bad"); iid.focus(); return; }
      if (!sv.set && !body[p.sec].trim()) { toast(`أدخل ${p.secL}`, "bad"); isec.focus(); return; }
      try { await api("/api/settings", { method: "PUT", body: JSON.stringify(body) }); toast(`تم حفظ إعدادات ${PMAP[p.k].label}. اضغط "ربط الحساب الآن".`, "good"); load(); } catch (e) { toast(e.message, "bad"); }
    }));
    box.append(card);
  }
}

async function reset(p) {
  if (!await confirmDialog({ title: "مسح إعدادات الربط؟", body: `سيُحذف App ID وSecret وربط ${PMAP[p.k].label}، وسيتوقف جلب الأرقام من هذه المنصة حتى تعيد ربطها.`, ok: "مسح" })) return;
  try { await api("/api/settings?platform=" + p.k, { method: "DELETE" }); toast("تم الحذف", "good"); load(); } catch (e) { toast(e.message, "bad"); }
}
