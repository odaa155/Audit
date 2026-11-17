// "Link Telegram" dialog from the account menu: deep link for a private chat or a group, list of linked chats, test message.
import { $, el, icon, api, toast, openDialog, busy, notice } from "./lib.js";

let poll = null;
export function mountTelegram() {
  $("tgMenu").addEventListener("click", () => { $("meMenu").classList.add("hidden"); open(); });
  $("tgDlg").addEventListener("close", () => { clearInterval(poll); poll = null; refreshMenuState(); });
  refreshMenuState();
}
async function refreshMenuState() {
  try { const st = await api("/api/telegram"); const n = st.links.filter(l => l.enabled).length; $("tgMenuState").textContent = n ? "مربوط" : ""; $("tgMenuState").classList.toggle("hidden", !n); } catch (_) {}
}
async function open() { openDialog("tgDlg"); await draw(); }

async function draw(linkInfo) {
  const body = $("tgBody"); let st;
  try { st = await api("/api/telegram"); } catch (e) { body.innerHTML = ""; body.append(notice("bad", e.message)); return; }
  body.innerHTML = "";
  if (!st.bot) {
    body.append(notice("warn", st.isAdmin ? "لم يتم إعداد بوت تيليجرام بعد. أضف توكن البوت من صفحة ربط المنصات أولًا." : "لم يُعد المدير بوت تيليجرام بعد."),
      st.isAdmin ? el("a", { class: "btn btn-primary", href: "#settings", onclick: () => $("tgDlg").close() }, "فتح صفحة ربط المنصات") : null);
    return;
  }
  // linked chats
  const list = el("div", { style: "display:grid;gap:8px" });
  if (!st.links.length) list.append(el("p", { class: "muted small" }, "لا توجد محادثات مربوطة بعد."));
  for (const l of st.links) {
    const cb = el("input", { type: "checkbox", "aria-label": "تفعيل التنبيهات" }); cb.checked = !!l.enabled;
    cb.addEventListener("change", async () => { try { await api("/api/telegram/chat", { method: "PUT", body: JSON.stringify({ chat_id: l.chat_id, enabled: cb.checked }) }); toast(cb.checked ? "تم تفعيل التنبيهات" : "تم إيقاف التنبيهات", "good"); } catch (e) { toast(e.message, "bad"); } });
    list.append(el("div", { class: "tg-chat" },
      el("span", { class: "avatar xs" }, l.type === "private" ? icon("user", "ic sm") : icon("users", "ic sm")),
      el("div", { class: "grow" }, el("b", {}, l.title || l.chat_id), el("span", {}, l.type === "private" ? "محادثة خاصة" : "مجموعة")),
      el("label", { class: "switch" }, cb, "التنبيهات"),
      el("button", { class: "btn-ghost btn-sm icon-btn", type: "button", "aria-label": "فك الربط", title: "فك الربط", onclick: async () => { try { await api("/api/telegram/chat?chat_id=" + encodeURIComponent(l.chat_id), { method: "DELETE" }); toast("تم فك الربط", "good"); draw(); } catch (e) { toast(e.message, "bad"); } } }, icon("trash", "ic sm"))));
  }
  const linkPrivate = el("button", { class: "btn-primary", type: "button" }, icon("send", "ic sm"), st.links.some(l => l.type === "private") ? "ربط محادثة أخرى" : "ربط حسابي على تيليجرام");
  const linkGroup = el("button", { type: "button" }, icon("users", "ic sm"), "ربط مجموعة");
  const test = el("button", { type: "button", class: "btn-ghost" }, icon("bell", "ic sm"), "إرسال رسالة تجربة");
  test.disabled = !st.links.some(l => l.enabled);
  const go = async (kind, btn) => busy(btn, async () => {
    const w = window.open("about:blank", "_blank"); // open inside the click so popup blockers allow it
    try {
      const r = await api("/api/telegram/link", { method: "POST" });
      if (w) w.location.href = kind === "group" ? r.groupUrl : r.url;
      draw(r); startPolling(st.links.length);
    } catch (e) { w?.close(); toast(e.message, "bad"); }
  });
  linkPrivate.addEventListener("click", () => go("private", linkPrivate));
  linkGroup.addEventListener("click", () => go("group", linkGroup));
  test.addEventListener("click", () => busy(test, async () => { try { const r = await api("/api/telegram/test", { method: "POST" }); toast(r.sent ? `تم الإرسال إلى ${r.sent} محادثة` : "تعذّر الإرسال", r.sent ? "good" : "bad"); } catch (e) { toast(e.message, "bad"); } }));

  body.append(el("div", { class: "muted small" }, "البوت: ", el("a", { href: `https://t.me/${st.bot}`, target: "_blank", rel: "noopener", class: "ltr" }, "@" + st.bot)), list,
    el("div", { class: "actions" }, linkPrivate, linkGroup, test));
  if (linkInfo) body.append(notice("info", el("div", { style: "display:grid;gap:6px" },
    el("span", {}, "فُتح تيليجرام في نافذة جديدة. اضغط ", el("b", {}, "Start"), " (أو اختر المجموعة) وسيظهر الربط هنا تلقائيًا."),
    el("span", { class: "small" }, "لم يفتح؟ أرسل للبوت هذه الرسالة: ", el("code", { class: "ltr" }, `/start ${linkInfo.code}`), " · صالح لمدة 30 دقيقة."))));
  body.append(el("p", { class: "muted small" }, "تصلك تنبيهات العملاء المعيّنين لك فقط (والمدير يصله الكل). يمكنك إيقاف التنبيهات من تيليجرام بإرسال /stop."));
}
function startPolling(before) {
  clearInterval(poll); let n = 0;
  poll = setInterval(async () => {
    if (++n > 100) return clearInterval(poll);
    try { const st = await api("/api/telegram"); if (st.links.length > before) { clearInterval(poll); toast("تم ربط تيليجرام ✅", "good"); draw(); } } catch (_) {}
  }, 3000);
}
