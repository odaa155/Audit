// Shared constants, formatting, DOM helpers, dialogs and toasts.

export const PLATFORMS = [
  { key: "google",   label: "Google",           color: "#1a9e55" },
  { key: "meta",     label: "Meta / Instagram", color: "#d6337f", server: "Meta Ads" },
  { key: "snapchat", label: "Snapchat",         color: "#e6c300", server: "snap" },
  { key: "tiktok",   label: "TikTok",           color: "#25c4cf", server: "TikTok" },
  { key: "apple",    label: "Apple Search Ads", color: "#8a8f9c" }
];
export const PMAP = Object.fromEntries(PLATFORMS.map(p => [p.key, p]));
export const ALIASES = { google: "google", "google ads": "google", meta: "meta", instagram: "meta", facebook: "meta", fb: "meta", ig: "meta", snapchat: "snapchat", snap: "snapchat", tiktok: "tiktok", "tik tok": "tiktok", apple: "apple", "apple search ads": "apple", asa: "apple" };
export const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
export const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const CURRENCIES = ["SAR","EGP","AED","USD","KWD","QAR"];
export const FX_DEFAULT = { SAR: { USD: 3.75, AED: 1.021, EGP: 0.0759, KWD: 12.2, QAR: 1.03 }, EGP: { USD: 49.4, SAR: 13.17, AED: 13.45 }, USD: { SAR: 0.2667, EGP: 0.0202, AED: 0.2723 } };
export const CONV_ID = Array.from({ length: 20 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");

// ---------- formatting ----------
export const fmt0 = n => (n == null || !isFinite(n)) ? "-" : Math.round(n).toLocaleString("en-US");
export const fmt2 = n => (n == null || !isFinite(n)) ? "-" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct  = (n, d = 2) => (n == null || !isFinite(n)) ? "-" : (n * 100).toFixed(d) + "%";
export const div  = (a, b) => (b && isFinite(a) && isFinite(b)) ? a / b : null;
export const pad = n => String(n).padStart(2, "0");
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => isoOf(new Date());
export const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return isoOf(new Date(y, m - 1, d + n)); };
export const dayLabel = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS_EN[m - 1]} ${y}`; };
export const monthLabel = ym => { const [y, m] = ym.split("-").map(Number); return `${MONTHS_AR[m - 1]} ${y}`; };
export const daysIn = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
export const nowLocalInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const slug = s => (s || "").toString().replace(/[^A-Za-z0-9_\-.~:@+]/g, "-").slice(0, 60);
export const initial = s => (String(s || "?").trim()[0] || "?").toUpperCase();
export const timeAgo = iso => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "الآن";
  if (s < 3600) return `منذ ${Math.round(s / 60)} دقيقة`;
  if (s < 86400) return `منذ ${Math.round(s / 3600)} ساعة`;
  return `منذ ${Math.round(s / 86400)} يوم`;
};

export const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

// ---------- DOM ----------
export const $ = id => document.getElementById(id);
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
  return e;
};
const NS = "http://www.w3.org/2000/svg";
export const icon = (name, cls = "ic") => {
  const s = document.createElementNS(NS, "svg"); s.setAttribute("class", cls); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(NS, "use"); u.setAttribute("href", "#i-" + name); s.append(u); return s;
};
export const platChip = key => { const p = PMAP[key] || { label: key, color: "#999" }; const i = el("i"); i.style.background = p.color; return el("span", { class: "plat" }, i, p.label); };
export const emptyState = (ic, title, text, action) => el("div", { class: "empty" }, icon(ic, "ic lg"), title ? el("b", {}, title) : null, text ? el("span", {}, text) : null, action || null);
export const notice = (kind, ...kids) => el("div", { class: "notice " + kind }, icon(kind === "good" ? "check" : kind === "info" ? "info" : "alert"), el("div", {}, ...kids));

export function fillPlatSelect(sel, withAll) { sel.innerHTML = ""; if (withAll) sel.append(el("option", { value: "" }, "كل المنصات")); for (const p of PLATFORMS) sel.append(el("option", { value: p.key }, p.label)); }
export function fillCurSelect(sel) { sel.innerHTML = ""; for (const c of CURRENCIES) sel.append(el("option", { value: c }, c)); }

// ---------- feedback ----------
export function toast(msg, kind = "") {
  const box = $("toasts"); if (!box) return;
  const t = el("div", { class: "toast " + kind, role: "status" }, kind ? icon(kind === "good" ? "check" : "alert", "ic sm") : null, msg);
  box.append(t); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), 3200);
}
export function status(msg, kind = "info") {
  const s = $("status"); if (!s) return;
  if (!msg) { s.classList.add("hidden"); s.innerHTML = ""; return; }
  s.className = "notice " + kind; s.innerHTML = "";
  s.append(icon(kind === "info" ? "info" : "alert"), el("div", {}, msg));
}
export async function busy(btn, fn) {
  btn.disabled = true; btn.classList.add("loading");
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove("loading"); }
}

// ---------- dialogs ----------
export function openDialog(id) {
  const d = typeof id === "string" ? $(id) : id; if (!d) return;
  if (!d.open) d.showModal();
  const f = d.querySelector("[autofocus]") || d.querySelector(".dlg-body input:not([type=hidden]):not([type=checkbox]):not([disabled]),.dlg-body select,.dlg-body textarea");
  setTimeout(() => f?.focus(), 30);
}
export function closeDialog(id) { const d = typeof id === "string" ? $(id) : id; if (d?.open) d.close(); }
document.addEventListener("click", e => {
  if (e.target.tagName === "DIALOG") { e.target.close(); return; } // backdrop
  const c = e.target.closest("[data-close]"); if (c) { c.closest("dialog")?.close(); return; }
  const o = e.target.closest("[data-open]"); if (o && !o.disabled) openDialog(o.dataset.open);
});
export function confirmDialog({ title, body, ok = "تأكيد", danger = true }) {
  const d = $("confirmDlg");
  d.querySelector("h2").textContent = title; d.querySelector(".cbody").textContent = body || "";
  const okBtn = d.querySelector(".ok"); okBtn.textContent = ok; okBtn.className = "ok " + (danger ? "btn-danger solid" : "btn-primary");
  d.showModal(); setTimeout(() => d.querySelector("[data-close]").focus(), 30);
  return new Promise(res => {
    const done = v => { okBtn.onclick = null; d.onclose = null; if (d.open) d.close(); res(v); };
    okBtn.onclick = () => done(true); d.onclose = () => done(false);
  });
}

// ---------- plain JSON API (admin views) ----------
export async function api(url, opts = {}) {
  const r = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401) { location.href = "/login.html"; throw new Error("login required"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "حدثت مشكلة");
  return j;
}
