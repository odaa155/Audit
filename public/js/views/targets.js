// Targets: set the monthly sales target / budget / ROAS and review every month's progress.
import { $, el, fmt0, fmt2, pct, div, monthLabel, todayISO, toast, confirmDialog } from "../lib.js";
import { state, hooks, client, cur, nameOf, guard, safe, monthData, basisNumbers } from "../store.js";

export function init() {
  $("tMonth").addEventListener("change", () => { if ($("tMonth").value) { state.month = $("tMonth").value; state.monthTouched = true; hooks.renderAll(); } });
  $("targetForm").addEventListener("submit", save);
  $("delTarget").addEventListener("click", del);
}

export function render() {
  const c = client(), C = cur();
  $("tSub").textContent = c ? `${c.name} · المبالغ بـ ${C}` : "";
  const ym = state.month || todayISO().slice(0, 7);
  if (document.activeElement !== $("tMonth") && $("tMonth").value !== ym) $("tMonth").value = ym;
  $("tFormTitle").textContent = `هدف ${monthLabel(ym)}`;
  fillForm();
  const tbl = $("targetsTbl"); tbl.innerHTML = "";
  tbl.append(el("thead", {}, el("tr", {}, el("th", {}, "الشهر"), el("th", { class: "n" }, "الهدف"), el("th", { class: "n" }, "المحقق"), el("th", {}, "التقدم"), el("th", { class: "n" }, "الميزانية"), el("th", { class: "n" }, "الصرف"), el("th", { class: "n" }, "ROAS مستهدف"), el("th", {}, "الأساس"))));
  const tb = el("tbody"); const months = Object.keys(state.targets).sort().reverse();
  for (const m of months) {
    const t = state.targets[m], md = monthData(m), b = basisNumbers(md, t), p = div(b.sales, t.sales) || 0;
    const bar = el("div", { class: "mini-bar" }); const f = el("i"); f.style.width = Math.min(p * 100, 100) + "%";
    if (p >= 1) f.style.background = "var(--good)";
    bar.append(f);
    const tr = el("tr", { class: "click" + (m === state.month ? " sel" : ""), tabindex: "0", title: "اضغط لعرض هذا الشهر" },
      el("td", {}, el("b", {}, monthLabel(m))), el("td", { class: "n" }, fmt0(t.sales)), el("td", { class: "n" }, fmt0(b.sales)),
      el("td", {}, el("div", { style: "display:flex;gap:10px;align-items:center" }, bar, el("span", { class: "num small" }, pct(p, 1)))),
      el("td", { class: "n" }, fmt0(t.budget)), el("td", { class: "n" }, fmt0(md.tot.spend)), el("td", { class: "n" }, t.roas ? fmt2(t.roas) : "-"),
      el("td", {}, el("span", { class: "pill plain" }, t.basis === "platform" ? "المنصات" : "المتجر")));
    const pick = () => { state.month = m; state.monthTouched = true; hooks.renderAll(); }; tr.addEventListener("click", pick); tr.addEventListener("keydown", e => { if (e.key === "Enter") pick(); });
    tb.append(tr);
  }
  if (!months.length) tb.append(el("tr", {}, el("td", { colspan: 8, class: "muted-cell" }, c ? "لا توجد أهداف مسجلة لهذا العميل بعد." : "اختر عميلًا أولًا.")));
  tbl.append(tb);
}

function fillForm() {
  const ym = $("tMonth").value || state.month; const t = state.targets[ym] || {};
  if (["tSales", "tBudget", "tRoas", "tOrders", "tBasis"].includes(document.activeElement?.id)) return;
  $("tSales").value = t.sales || ""; $("tBudget").value = t.budget || ""; $("tRoas").value = t.roas || ""; $("tOrders").value = t.orders || ""; $("tBasis").value = t.basis || "store";
  $("tMsg").textContent = t.updatedAt ? `آخر تعديل ${t.updatedAt.slice(0, 10)} بواسطة ${nameOf(t.updatedBy)}` : "";
  $("delTarget").classList.toggle("hidden", !t.sales);
  $("delTarget").disabled = !state.canWrite;
  $("saveTarget").textContent = t.sales ? "حفظ التعديلات" : "حفظ الهدف";
}

async function save(ev) {
  ev.preventDefault();
  const c = client(); if (!c) { toast("اختر عميلًا أولًا", "bad"); return; } if (!guard()) return;
  const ym = $("tMonth").value; if (!ym) { toast("اختر الشهر", "bad"); return; }
  const sales = +$("tSales").value; if (!sales) { toast("أدخل رقم هدف المبيعات", "bad"); $("tSales").focus(); return; }
  const data = { clientId: c.id, month: ym, sales, budget: +$("tBudget").value || null, roas: +$("tRoas").value || null, orders: +$("tOrders").value || null, basis: $("tBasis").value, updatedBy: state.uid, updatedAt: new Date().toISOString() };
  document.activeElement?.blur();
  if (await safe(state.db.doc(`targets/${c.id}_${ym}`).set(data), "تم حفظ الهدف")) state.month = ym;
}
async function del() {
  const c = client(); const ym = $("tMonth").value; if (!c || !ym || !guard()) return;
  if (!await confirmDialog({ title: `حذف هدف ${monthLabel(ym)}؟`, body: "لن تعرض لوحة المتابعة تقدم هذا الشهر حتى تحدد هدفًا جديدًا.", ok: "حذف الهدف" })) return;
  await safe(state.db.doc(`targets/${c.id}_${ym}`).delete(), "تم حذف الهدف");
}
