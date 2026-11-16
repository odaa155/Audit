// Overview: monthly target progress, what's required to hit it, latest team edits.
import { $, el, icon, fmt0, fmt2, pct, div, daysIn, dayLabel, monthLabel, platChip, emptyState, notice } from "../lib.js";
import { state, client, cur, monthData, basisNumbers, elapsedDays, isNewEdit } from "../store.js";
import { editCard } from "./changelog.js";

export function init() {
  $("roasMode").addEventListener("change", renderRequired);
}

export function render() {
  const c = client();
  $("ovSub").textContent = c ? `${c.name} · ${monthLabel(state.month)}` : "";
  renderTarget(); renderRequired(); renderRecent();
}

const kpi = (ic, label, val, unit, sub, cls = "") => el("div", { class: "card kpi " + cls },
  el("span", { class: "label" }, icon(ic, "ic sm"), label),
  el("span", { class: "val num" }, val, unit ? el("small", {}, unit) : null),
  sub ? el("span", { class: "sub" }, sub) : null);

function renderTarget() {
  const body = $("targetBody"); body.innerHTML = "";
  const ym = state.month, t = state.targets[ym], md = monthData(ym), C = cur();
  const dim = daysIn(ym), elapsed = elapsedDays(ym, md), remainingDays = Math.max(dim - elapsed, 0);
  if (!t || !t.sales) {
    body.append(emptyState("target", `لا يوجد هدف لشهر ${monthLabel(ym)}`, `حدّد هدف ${client()?.name || "العميل"} لمتابعة التقدم والمطلوب يوميًا.`,
      el("a", { class: "btn btn-primary", href: "#targets" }, icon("plus", "ic sm"), "حدّد الهدف")));
    return;
  }
  const b = basisNumbers(md, t);
  const achievedPct = div(b.sales, t.sales) || 0, pacePct = elapsed / dim;
  const forecast = elapsed ? b.sales / elapsed * dim : 0, forecastPct = div(forecast, t.sales) || 0;
  const onTrack = achievedPct >= pacePct, close = achievedPct >= pacePct * 0.85;
  const tone = onTrack ? "good" : close ? "warn" : "bad";

  const prog = el("div", { class: "card pad-lg progress-card", id: "targetProgress" });
  prog.append(el("div", { class: "progress-top" },
    el("div", { style: "display:grid;gap:6px" },
      el("span", { class: "muted small" }, `نسبة تحقيق هدف ${monthLabel(ym)}`),
      el("div", { class: "big-pct" }, el("span", { class: "val num" }, pct(achievedPct, 1)),
        el("span", { class: "muted" }, el("span", { class: "num" }, fmt0(b.sales)), " من ", el("span", { class: "num" }, fmt0(t.sales)), " " + C))),
    el("span", { class: "pill " + tone }, el("span", { class: "dot" }), onTrack ? "متقدمون على الجدول" : "متأخرون عن الجدول")));
  const bar = el("div", { class: "bar", role: "img", "aria-label": `المحقق ${pct(achievedPct, 1)} والوقت المنقضي ${pct(pacePct, 0)}` });
  const fill = el("div", { class: "fill" + (onTrack ? "" : close ? " warn" : " bad") }); fill.style.width = Math.min(achievedPct * 100, 100) + "%";
  const pace = el("div", { class: "pace" }); pace.style.insetInlineStart = `calc(${Math.min(pacePct * 100, 100)}% - 1px)`;
  bar.append(fill, pace);
  prog.append(bar, el("div", { class: "bar-legend" },
    el("span", {}, el("i", { class: "legend-swatch" }), "المحقق"),
    el("span", {}, el("i", { class: "legend-pace" }), "المتوقع حسب الأيام المنقضية: ", el("span", { class: "num" }, pct(pacePct, 0))),
    el("span", {}, icon("clock", "ic sm"), `بيانات حتى ${md.lastDate ? dayLabel(md.lastDate) : "—"} · متبقٍ ${remainingDays} يوم`)));
  prog.append(el("div", { class: "facts" },
    el("div", {}, el("span", {}, "المتوقع آخر الشهر"), el("b", { class: "num" }, fmt0(forecast)), el("span", {}, pct(forecastPct, 1) + " من الهدف")),
    el("div", {}, el("span", {}, "الطلبات"), el("b", { class: "num" }, fmt0(b.orders)), el("span", {}, t.orders ? `من ${fmt0(t.orders)}` : `AOV ${fmt2(b.aov)}`)),
    el("div", {}, el("span", {}, "الأساس"), el("b", {}, b.basis === "store" ? "المتجر" : "المنصات"), el("span", {}, b.basis === "store" ? "Total Store" : "Total platform"))));
  if (b.fellBack) prog.append(notice("warn", "لا توجد أرقام Total Store لهذا الشهر، لذا يُحسب التقدم مؤقتًا على مبيعات المنصات."));

  const kpis = el("div", { class: "kpis stack" },
    kpi("wallet", "الصرف", fmt0(md.tot.spend), C, t.budget ? `${pct(div(md.tot.spend, t.budget), 1)} من ميزانية ${fmt0(t.budget)}` : "لا توجد ميزانية محددة"),
    kpi("trending", "ROAS", fmt2(b.roas), "", t.roas ? `المستهدف ${fmt2(t.roas)}` : (b.basis === "store" ? "Store ROAS" : "Platform ROAS")),
    kpi("bag", "المبيعات المحققة", fmt0(b.sales), C, b.basis === "store" ? "مبيعات المتجر" : "مبيعات المنصات"),
    kpi("cart", "AOV", fmt2(b.aov), C, `${fmt0(b.orders)} طلب`));
  body.append(el("div", { class: "hero" }, prog, kpis));
}

function renderRequired() {
  const body = $("requiredBody"); body.innerHTML = "";
  const ym = state.month, t = state.targets[ym], md = monthData(ym), C = cur();
  $("roasModeWrap").classList.toggle("hidden", !(t && t.roas));
  $("required").classList.toggle("hidden", !(t && t.sales));
  if (!t || !t.sales) return;
  const b = basisNumbers(md, t), dim = daysIn(ym), elapsed = elapsedDays(ym, md), remDays = Math.max(dim - elapsed, 0);
  const remSales = Math.max(t.sales - b.sales, 0);
  if (remSales <= 0) { body.append(notice("good", "تم تحقيق الهدف. أي مبيعات إضافية تتجاوز المستهدف.")); return; }
  if (remDays === 0) { body.append(notice("bad", `انتهى الشهر ومتبقٍ ${fmt0(remSales)} ${C} لتحقيق الهدف.`)); return; }
  const mode = ($("roasMode").value === "target" && t.roas) ? "target" : "current";
  const roas = mode === "target" ? t.roas : b.roas;
  if (!roas) { body.append(notice("warn", "لا يوجد صرف كافٍ هذا الشهر لحساب ROAS. اجلب الأرقام أو أدخلها أولًا من صفحة الأداء.")); return; }
  const reqSpend = remSales / roas, remBudget = t.budget ? t.budget - md.tot.spend : null, aov = b.aov;

  body.append(el("div", { class: "kpis" },
    kpi("bag", "مبيعات مطلوبة يوميًا", fmt0(div(remSales, remDays)), C, `إجمالي ${fmt0(remSales)} في ${remDays} يوم`, "accent"),
    kpi("wallet", "صرف مطلوب يوميًا", fmt0(div(reqSpend, remDays)), C, `على ROAS ${fmt2(roas)} · إجمالي ${fmt0(reqSpend)}`, "accent"),
    kpi("cart", "طلبات مطلوبة يوميًا", fmt2(div(div(remSales, aov), remDays)), "", `AOV ${fmt0(aov)} · إجمالي ${fmt0(div(remSales, aov))}`, "accent")));

  if (remBudget != null) {
    const gap = reqSpend - remBudget;
    body.append(notice(gap > 0 ? "bad" : "good", gap > 0
      ? `الميزانية المتبقية (${fmt0(remBudget)} ${C}) غير كافية: نحتاج إلى ${fmt0(gap)} ${C} إضافية، أو رفع ROAS إلى ${fmt2(remSales / remBudget)} لتحقيق الهدف بالميزانية نفسها.`
      : `الميزانية المتبقية (${fmt0(remBudget)} ${C}) كافية، وسيتبقى منها ${fmt0(-gap)} ${C} بهذا الـ ROAS.`));
  }
  if (t.orders) {
    const ro = Math.max(t.orders - b.orders, 0);
    body.append(el("p", { class: "muted small" }, `هدف الطلبات: متبقٍ ${fmt0(ro)} طلب (${fmt2(div(ro, remDays))} يوميًا).`));
  }

  const plats = Object.entries(md.byPlat).filter(([, v]) => v.spend > 0);
  if (plats.length) {
    const factor = mode === "target" ? div(t.roas, div(md.tot.sales, md.tot.spend)) : (b.basis === "store" ? div(b.sales, md.tot.sales) : 1);
    const pt = el("table", { id: "reqPlatTbl" });
    pt.append(el("thead", {}, el("tr", {}, el("th", {}, "المنصة"), el("th", { class: "n" }, "% من الصرف"), el("th", { class: "n" }, "ROAS المنصة"), el("th", { class: "n" }, "صرف مطلوب"), el("th", { class: "n" }, "صرف يومي"), el("th", { class: "n" }, "مبيعات متوقعة"))));
    const ptb = el("tbody"); let sumSpend = 0, sumSales = 0, sumDaily = 0;
    plats.sort((a, b) => b[1].spend - a[1].spend);
    for (const [k, v] of plats) {
      const share = v.spend / md.tot.spend, sp = reqSpend * share, pr = div(v.sales, v.spend), exp = sp * (pr || 0) * (factor || 1);
      sumSpend += sp; sumSales += exp; sumDaily += div(sp, remDays) || 0;
      ptb.append(el("tr", {}, el("td", {}, platChip(k)), el("td", { class: "n" }, pct(share, 1)), el("td", { class: "n" }, fmt2(pr)), el("td", { class: "n" }, fmt0(sp)), el("td", { class: "n" }, fmt0(div(sp, remDays))), el("td", { class: "n" }, fmt0(exp))));
    }
    ptb.append(el("tr", { class: "total" }, el("td", {}, "الإجمالي"), el("td", { class: "n" }, "100%"), el("td", { class: "n" }, "-"), el("td", { class: "n" }, fmt0(sumSpend)), el("td", { class: "n" }, fmt0(sumDaily)), el("td", { class: "n" }, fmt0(sumSales))));
    pt.append(ptb);
    body.append(el("div", { class: "section" },
      el("div", { class: "section-head" }, el("h3", {}, "توزيع المطلوب على المنصات"), el("span", { class: "sub" }, `بنفس نسب الصرف الحالية · ${C}`)),
      el("div", { class: "tbl-wrap" }, pt)));
  }
}

function renderRecent() {
  const box = $("recentEdits"); box.innerHTML = "";
  const list = state.edits.slice(0, 4);
  const n = state.edits.filter(isNewEdit).length;
  $("recentNew").innerHTML = ""; if (n) $("recentNew").append(el("span", { class: "pill new" }, `${n} جديد`));
  if (!list.length) { box.append(emptyState("history", null, "لا توجد تعديلات مسجلة لهذا العميل بعد.", el("a", { class: "btn btn-sm", href: "#changelog" }, "سجّل أول تعديل"))); return; }
  for (const e of list) box.append(editCard(e, true));
}
