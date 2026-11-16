// Targets: set the monthly sales target / budget / ROAS and review every month's progress.
import { $, el, icon, fmt0, fmt2, pct, div, monthLabel, todayISO, addDays, daysIn, toast, confirmDialog, platChip, notice, PMAP } from "../lib.js";
import { monthsIn } from "../range.js";
import { runSync } from "./performance.js";
import { setRange } from "../range.js";
import { state, hooks, client, cur, nameOf, guard, safe, monthData, rangeData, basisNumbers } from "../store.js";

export function init() {
  $("tMonth").addEventListener("change", () => { if ($("tMonth").value) { setRange("m:" + $("tMonth").value); hooks.renderAll(); } });
  $("targetForm").addEventListener("submit", save);
  $("delTarget").addEventListener("click", del);
  const t = todayISO(), nm = (() => { const [y, m] = t.split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  $("plMonth").value = +t.slice(8) >= 20 ? nm : t.slice(0, 7);
  for (const id of ["plMonth", "plLook", "plMargin", "plMode"]) $(id).addEventListener("change", () => { if (id === "plMonth") $("plSales").value = ""; plan.shares = null; drawPlanner(); });
  $("plSales").addEventListener("input", compute);
}

export function render() {
  if (!$("planner").contains(document.activeElement)) drawPlanner();
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
    const pick = () => { setRange("m:" + m); hooks.renderAll(); }; tr.addEventListener("click", pick); tr.addEventListener("keydown", e => { if (e.key === "Enter") pick(); });
    tb.append(tr);
  }
  if (!months.length) tb.append(el("tr", {}, el("td", { colspan: 8, class: "muted-cell" }, c ? "لا توجد أهداف مسجلة لهذا العميل بعد." : "اختر عميلًا أولًا.")));
  tbl.append(tb);
}

function fillForm() {
  const ym = $("tMonth").value || state.month; const t = state.targets[ym] || {};
  if (["tSales", "tBudget", "tRoas", "tOrders", "tBasis"].includes(document.activeElement?.id)) return;
  $("tSales").value = t.sales || ""; $("tBudget").value = t.budget || ""; $("tRoas").value = t.roas || ""; $("tOrders").value = t.orders || ""; $("tBasis").value = t.basis || "platform";
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
  if (await safe(state.db.doc(`targets/${c.id}_${ym}`).set(data), "تم حفظ الهدف")) { setRange("m:" + ym); hooks.renderAll(); }
}
async function del() {
  const c = client(); const ym = $("tMonth").value; if (!c || !ym || !guard()) return;
  if (!await confirmDialog({ title: `حذف هدف ${monthLabel(ym)}؟`, body: "لن تعرض لوحة المتابعة تقدم هذا الشهر حتى تحدد هدفًا جديدًا.", ok: "حذف الهدف" })) return;
  await safe(state.db.doc(`targets/${c.id}_${ym}`).delete(), "تم حذف الهدف");
}

// ---------- budget planner ----------
const plan = { rows: [], shares: null, refs: null };
function drawPlanner() {
  const out = $("plOut"); out.innerHTML = ""; const c = client(); if (!c) return;
  const C = cur(), ym = $("plMonth").value || todayISO().slice(0, 7), N = +$("plLook").value;
  if (!$("plSales").value) { const tgt = state.targets[ym] || state.targets[todayISO().slice(0, 7)]; if (tgt?.sales) $("plSales").value = tgt.sales; }
  const lastData = state.daily.reduce((m, r) => (r.date > m ? r.date : m), "");
  const to = lastData && lastData < todayISO() ? lastData : addDays(todayISO(), -1), from = addDays(to, -(N - 1));
  const md = rangeData(from, to);
  plan.rows = Object.entries(md.byPlat).filter(([, v]) => v.spend > 0).sort((a, b) => b[1].spend - a[1].spend)
    .map(([k, v]) => ({ k, spend: v.spend, sales: v.sales, orders: v.orders, roas: div(v.sales, v.spend) || 0, daysRate: v.spend / N }));
  $("plSub").textContent = `على أساس أداء ${N} يومًا (${from} إلى ${to}) · المبالغ بـ ${C}`;
  // reference months that have no platform numbers yet
  const missing = monthsIn(from, to).filter(m => !state.daily.some(r => r.date?.startsWith(m) && r.source === "api"));
  if (missing.length && (c.accounts || []).some(a => a.via === "api") && state.canWrite)
    out.append(notice("info", `بعض أيام الفترة المرجعية بدون أرقام (${missing.map(monthLabel).join("، ")}). `,
      el("button", { class: "btn-sm", type: "button", onclick: async ev => { ev.target.disabled = true; await runSync({ silent: true, months: missing }); } }, icon("refresh", "ic sm"), "جلب أرقامها")));
  if (!plan.rows.length) { out.append(notice("warn", "لا توجد أرقام صرف في الفترة المرجعية لحساب الخطة. اجلب الأرقام أو اختر فترة أطول.")); return; }
  const mode = $("plMode").value;
  if (!plan.shares || plan.shares._mode !== mode) {
    const tot = mode === "roas" ? plan.rows.reduce((a, r) => a + r.spend * r.roas, 0) : plan.rows.reduce((a, r) => a + r.spend, 0);
    plan.shares = { _mode: mode }; for (const r of plan.rows) plan.shares[r.k] = Math.round(((mode === "roas" ? r.spend * r.roas : r.spend) / tot) * 1000) / 10;
  }
  const tiles = el("div", { class: "kpis" });
  const tile = (label, key, sub) => { const v = el("span", { class: "val num" }, "-"), s2 = el("span", { class: "sub" }, sub || ""); tiles.append(el("div", { class: "card kpi" }, el("span", { class: "label" }, label), v, s2)); return { v, s: s2 }; };
  const refs = { budget: tile("الميزانية المطلوبة", "b"), daily: tile("الميزانية اليومية", "d", `على ${daysIn(ym)} يومًا`), roas: tile("ROAS المتوقع للخطة", "r"), orders: tile("الطلبات المتوقعة", "o"), rows: {} };
  const tbl = el("table"), tb = el("tbody");
  tbl.append(el("thead", {}, el("tr", {}, el("th", {}, "المنصة"), el("th", { class: "n" }, "ROAS المرجعي"), el("th", { class: "n" }, "ROAS بعد الهامش"), el("th", { class: "n" }, "النسبة %"), el("th", { class: "n" }, "الميزانية"), el("th", { class: "n" }, "يوميًا"), el("th", { class: "n" }, "مبيعات متوقعة"), el("th", {}, ""))));
  for (const r of plan.rows) {
    const inp = el("input", { type: "number", min: "0", max: "100", step: "0.1", value: plan.shares[r.k], dir: "ltr", style: "width:84px;text-align:left", "aria-label": `نسبة ${PMAP[r.k]?.label || r.k}` });
    inp.disabled = mode !== "manual";
    inp.addEventListener("input", () => { plan.shares[r.k] = +inp.value || 0; compute(); });
    const cells = { eff: el("td", { class: "n" }), budget: el("td", { class: "n" }), daily: el("td", { class: "n" }), exp: el("td", { class: "n" }), warn: el("td", {}) };
    refs.rows[r.k] = cells;
    tb.append(el("tr", {}, el("td", {}, platChip(r.k)), el("td", { class: "n" }, fmt2(r.roas)), cells.eff, el("td", { class: "n" }, inp), cells.budget, cells.daily, cells.exp, cells.warn));
  }
  refs.total = { share: el("td", { class: "n" }), budget: el("td", { class: "n" }), daily: el("td", { class: "n" }), exp: el("td", { class: "n" }) };
  tb.append(el("tr", { class: "total" }, el("td", {}, "الإجمالي"), el("td", {}), el("td", {}), refs.total.share, refs.total.budget, refs.total.daily, refs.total.exp, el("td", {})));
  tbl.append(tb);
  refs.msg = el("div");
  refs.apply = el("button", { class: "btn-primary", type: "button", onclick: applyPlan }, icon("target", "ic sm"), `اعتماد كهدف ${monthLabel(ym)}`);
  refs.apply.disabled = !state.canWrite;
  out.append(tiles, el("div", { class: "tbl-wrap" }, tbl), refs.msg,
    el("div", { class: "actions" }, refs.apply, el("span", { class: "muted small" }, "يُحفظ هدف المبيعات والميزانية وROAS المتوقع لهذا الشهر، ويمكنك تعديلها لاحقًا.")));
  plan.refs = refs; compute();
}

function compute() {
  const R = plan.refs; if (!R) return;
  const C = cur(), ym = $("plMonth").value || todayISO().slice(0, 7), dim = daysIn(ym), m = +$("plMargin").value, target = +$("plSales").value || 0;
  const sumShare = plan.rows.reduce((a, r) => a + (plan.shares[r.k] || 0), 0);
  const w = plan.rows.map(r => ({ ...r, share: sumShare ? (plan.shares[r.k] || 0) / sumShare : 0, eff: r.roas * (1 - m) }));
  const blended = w.reduce((a, r) => a + r.share * r.eff, 0);
  const B = target && blended ? target / blended : 0;
  const aov = div(plan.rows.reduce((a, r) => a + r.sales, 0), plan.rows.reduce((a, r) => a + r.orders, 0));
  R.budget.v.textContent = target ? `${fmt0(B)} ${C}` : "-"; R.budget.s.textContent = target ? `لتحقيق ${fmt0(target)} ${C}` : "أدخل هدف المبيعات";
  R.daily.v.textContent = target ? `${fmt0(B / dim)} ${C}` : "-";
  R.roas.v.textContent = blended ? fmt2(blended) + "x" : "-"; R.roas.s.textContent = m ? `بعد هامش أمان ${Math.round(m * 100)}%` : "بدون هامش أمان";
  R.orders.v.textContent = target && aov ? fmt0(target / aov) : "-"; R.orders.s.textContent = aov ? `على متوسط طلب ${fmt0(aov)} ${C}` : "";
  let warns = 0;
  for (const r of w) {
    const c = R.rows[r.k], bud = B * r.share, daily = bud / dim;
    c.eff.textContent = fmt2(r.eff); c.budget.textContent = target ? fmt0(bud) : "-"; c.daily.textContent = target ? fmt0(daily) : "-"; c.exp.textContent = target ? fmt0(bud * r.eff) : "-";
    c.warn.innerHTML = "";
    const jump = r.daysRate ? daily / r.daysRate : null;
    if (target && jump && jump > 1.5) { warns++; c.warn.append(el("span", { class: "pill warn", title: `الصرف اليومي المرجعي ${fmt0(r.daysRate)} ${C}` }, `+${Math.round((jump - 1) * 100)}% عن المعتاد`)); }
  }
  R.total.share.textContent = sumShare.toFixed(1) + "%"; R.total.budget.textContent = target ? fmt0(B) : "-"; R.total.daily.textContent = target ? fmt0(B / dim) : "-"; R.total.exp.textContent = target ? fmt0(target) : "-";
  R.msg.innerHTML = "";
  if ($("plMode").value === "manual" && Math.abs(sumShare - 100) > 0.5) R.msg.append(notice("warn", `مجموع النسب ${sumShare.toFixed(1)}%، وسيتم توزيعها نسبيًا كأنها 100%.`));
  if (warns) R.msg.append(notice("warn", "بعض المنصات تحتاج زيادة كبيرة عن معدل صرفها الحالي. العائد غالبًا يقل مع الزيادة الكبيرة، لذا يُفضَّل رفع الصرف تدريجيًا أو زيادة هامش الأمان."));
  R.apply.disabled = !state.canWrite || !target || !B;
  plan.result = { ym, target, B, blended };
}

async function applyPlan() {
  const c = client(), r = plan.result; if (!c || !r?.B || !guard()) return;
  const ex = state.targets[r.ym];
  if (ex?.sales && !await confirmDialog({ title: `استبدال هدف ${monthLabel(r.ym)}؟`, body: `الهدف الحالي ${fmt0(ex.sales)} ${cur()}. سيتم تحديث هدف المبيعات والميزانية وROAS المستهدف حسب الخطة.`, ok: "اعتماد الخطة", danger: false })) return;
  const data = { ...(ex || {}), clientId: c.id, month: r.ym, sales: Math.round(r.target), budget: Math.round(r.B), roas: Math.round(r.blended * 100) / 100, basis: ex?.basis || "platform", updatedBy: state.uid, updatedAt: new Date().toISOString(), planned: true };
  if (await safe(state.db.doc(`targets/${c.id}_${r.ym}`).set(data), `تم اعتماد خطة ${monthLabel(r.ym)}`)) { setRange("m:" + r.ym); hooks.renderAll(); }
}
