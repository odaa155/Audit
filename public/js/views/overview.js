// Overview: KPI strip vs previous period, daily trend, spend by platform, platform table,
// monthly target tracking, what's required to hit the target, latest edits.
import { $, el, icon, fmt0, fmt2, pct, div, daysIn, dayLabel, monthLabel, platChip, emptyState, notice, PMAP, PLATFORMS, addDays } from "../lib.js";
import { state, client, cur, monthData, rangeData, basisNumbers, elapsedDays, isNewEdit } from "../store.js";
import { prevRange, rangeDates, daysBetween } from "../range.js";
import { lineChart, sparkBars, compact } from "../charts.js";
import { editCard } from "./changelog.js";
import { taskCard } from "./tasks.js";

const hiddenSeries = new Set();
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function init() {
  $("roasMode").addEventListener("change", renderRequired);
}

export function render() {
  const c = client(), r = state.range;
  $("ovSub").textContent = c ? `${c.name} · ${rangeDates()} · المبالغ بـ ${cur()}` : "";
  const md = rangeData(r.from, r.to), p = prevRange(), pd = rangeData(p.from, p.to);
  renderKpis(md, pd, p); renderTrend(md); renderPlatBars(md); renderInsights(md, pd);
  renderTarget(); renderRequired(); renderRecent(); renderTasks();
}

function renderTasks() {
  const box = $("recentTasks"); box.innerHTML = "";
  const open = state.tasks.filter(t => t.status !== "done").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")).slice(0, 4);
  if (!open.length) { box.append(emptyState("check", null, "لا توجد مهام مفتوحة.", el("a", { class: "btn btn-sm", href: "#tasks" }, "أضف مهمة"))); return; }
  for (const t of open) box.append(taskCard(t, true));
}

// ---------- KPI strip ----------
const change = (a, b) => (b ? (a - b) / Math.abs(b) : null);
function delta(ch, goodWhenUp) {
  if (ch == null || !isFinite(ch)) return el("span", { class: "delta flat" }, "—");
  const up = ch >= 0, flat = Math.abs(ch) < 0.005;
  const cls = flat || goodWhenUp == null ? "flat" : (up === goodWhenUp ? (up ? "up-good" : "down-good") : (up ? "up-bad" : "down-bad"));
  return el("span", { class: "delta " + cls }, flat ? null : icon(up ? "arrow-up" : "arrow-down"), Math.abs(ch * 100).toFixed(1) + "%");
}
function renderKpis(md, pd, p) {
  const box = $("kpiStrip"); box.innerHTML = ""; const C = cur();
  const cpa = div(md.tot.spend, md.tot.orders), pcpa = div(pd.tot.spend, pd.tot.orders);
  const roas = div(md.tot.sales, md.tot.spend), proas = div(pd.tot.sales, pd.tot.spend);
  const hasPrev = pd.rows.length > 0;
  const cell = (label, val, unit, ch, goodUp) => el("div", { class: "kpi-cell" },
    el("span", { class: "label" }, label),
    el("span", { class: "val num" }, val, unit ? el("small", {}, unit) : null),
    el("span", { class: "cmp" }, hasPrev ? delta(ch, goodUp) : el("span", { class: "delta flat" }, "—"), hasPrev ? "عن الفترة السابقة" : "لا توجد بيانات للمقارنة"));
  box.append(
    cell("الصرف", fmt0(md.tot.spend), C, change(md.tot.spend, pd.tot.spend), null),
    cell("المبيعات", fmt0(md.tot.sales), C, change(md.tot.sales, pd.tot.sales), true),
    cell("الطلبات", fmt0(md.tot.orders), "", change(md.tot.orders, pd.tot.orders), true),
    cell("تكلفة الطلب (CPA)", fmt2(cpa), C, change(cpa, pcpa), false),
    cell("ROAS", roas == null ? "-" : fmt2(roas) + "x", "", change(roas, proas), true));
  box.title = `الفترة السابقة للمقارنة: ${rangeDates({ ...p, preset: "custom" })}`;
}

// ---------- trend ----------
function renderTrend(md) {
  const r = state.range, dates = [];
  for (let d = r.from; d <= r.to && dates.length < 400; d = addDays(d, 1)) dates.push(d);
  const has = Object.keys(md.byDay).length > 0;
  const series = [
    { key: "sales", label: "المبيعات", color: css("--s1"), values: dates.map(d => md.byDay[d]?.sales || 0), area: true },
    { key: "spend", label: "الصرف", color: css("--s2"), values: dates.map(d => md.byDay[d]?.spend || 0), area: true },
  ];
  $("trendSub").textContent = `${daysBetween(r.from, r.to)} يوم · ${cur()}`;
  const lg = $("trendLegend"); lg.innerHTML = "";
  for (const x of series) {
    const cb = el("input", { type: "checkbox" }); cb.checked = !hiddenSeries.has(x.key);
    cb.addEventListener("change", () => { cb.checked ? hiddenSeries.delete(x.key) : hiddenSeries.add(x.key); renderTrend(md); });
    lg.append(el("label", {}, cb, el("i", { class: "key", style: `background:${x.color}` }), x.label));
  }
  lineChart($("trendChart"), { dates: has ? dates : [], series, hidden: hiddenSeries, fmt: v => fmt0(v),
    extra: i => { const d = md.byDay[dates[i]]; return d && d.spend ? [["ROAS", fmt2(d.sales / d.spend) + "x"], ["الطلبات", fmt0(d.orders)]] : []; } });
}

// ---------- spend by platform ----------
function renderPlatBars(md) {
  const box = $("platBars"); box.innerHTML = "";
  const rows = Object.entries(md.byPlat).filter(([, v]) => v.spend > 0).sort((a, b) => b[1].spend - a[1].spend);
  $("platSub").textContent = md.tot.spend ? `الإجمالي ${fmt0(md.tot.spend)} ${cur()}` : "";
  if (!rows.length) { box.append(el("div", { class: "empty-chart" }, "لا يوجد صرف في هذه الفترة")); return; }
  const max = rows[0][1].spend, wrap = el("div", { class: "hbars" });
  rows.forEach(([k, v], idx) => {
    const p = PMAP[k] || { label: k, color: "#999" }, w = Math.max(2, (v.spend / max) * 100);
    const fill = el("div", { class: "fill" }); fill.style.width = w + "%";
    const val = el("span", { class: "v num" }, compact(v.spend)); val.style.insetInlineStart = `min(calc(${w}% + 2px), calc(100% - 60px))`;
    const dot = el("i"); dot.style.background = p.color;
    wrap.append(el("div", { class: "hbar" + (idx === 0 ? " top" : ""), title: `${p.label}: ${fmt0(v.spend)} ${cur()} · ${pct(v.spend / md.tot.spend, 1)} من الصرف` },
      el("span", { class: "nm" }, dot, p.label.replace(" / Instagram", "")), el("div", { class: "track" }, fill, val),
      el("span", { class: "meta" }, `${pct(v.spend / md.tot.spend, 0)} من الصرف · ROAS ${fmt2(div(v.sales, v.spend))}`)));
  });
  box.append(wrap);
}

// ---------- platform table with sparklines ----------
function renderInsights(md, pd) {
  const t = $("insTbl"); t.innerHTML = ""; const C = cur();
  t.append(el("thead", {}, el("tr", {}, el("th", {}, "المنصة"), el("th", { class: "n" }, `الصرف (${C})`), el("th", { class: "n" }, `المبيعات (${C})`), el("th", { class: "n" }, "الطلبات"), el("th", { class: "n" }, "CPA"), el("th", { class: "n" }, "ROAS"), el("th", {}, "التغير"), el("th", {}, "المبيعات يوميًا"))));
  const tb = el("tbody"); const order = PLATFORMS.map(p => p.key);
  const keys = Object.keys(md.byPlat).sort((a, b) => md.byPlat[b].spend - md.byPlat[a].spend || order.indexOf(a) - order.indexOf(b));
  const dates = Object.keys(md.byDay).sort();
  for (const k of keys) {
    const v = md.byPlat[k], pv = pd.byPlat[k];
    const roas = div(v.sales, v.spend), proas = pv ? div(pv.sales, pv.spend) : null;
    const vals = dates.map(d => md.byDay[d].plat[k]?.sales || 0);
    const half = Math.floor(vals.length / 2), a = vals.slice(0, half).reduce((x, y) => x + y, 0), b = vals.slice(half).reduce((x, y) => x + y, 0);
    tb.append(el("tr", {}, el("td", {}, platChip(k)), el("td", { class: "n" }, fmt0(v.spend)), el("td", { class: "n" }, fmt0(v.sales)), el("td", { class: "n" }, fmt0(v.orders)),
      el("td", { class: "n" }, fmt2(div(v.spend, v.orders))), el("td", { class: "n" }, roas == null ? "-" : fmt2(roas) + "x"),
      el("td", {}, delta(proas ? change(roas, proas) : null, true)),
      el("td", {}, sparkBars(vals, css(b >= a ? "--good" : "--accent")))));
  }
  if (!keys.length) tb.append(el("tr", {}, el("td", { colspan: 8, class: "muted-cell" }, "لا توجد أرقام في هذه الفترة.")));
  t.append(tb);
}

// ---------- monthly target tracking ----------
function renderTarget() {
  const body = $("targetBody"); body.innerHTML = "";
  const ym = state.month, t = state.targets[ym], md = monthData(ym), C = cur();
  $("goalSub").textContent = `هدف ${monthLabel(ym)}`;
  const dim = daysIn(ym), elapsed = elapsedDays(ym, md), remainingDays = Math.max(dim - elapsed, 0);
  if (!t || !t.sales) {
    body.append(emptyState("target", null, `لا يوجد هدف لشهر ${monthLabel(ym)}.`, el("a", { class: "btn btn-primary btn-sm", href: "#targets" }, icon("plus", "ic sm"), "حدّد الهدف")));
    return;
  }
  const b = basisNumbers(md, t);
  const achieved = div(b.sales, t.sales) || 0, pace = elapsed / dim;
  const forecast = elapsed ? b.sales / elapsed * dim : 0, fPct = div(forecast, t.sales) || 0;
  const tone = v => v >= 1 ? "good" : v >= 0.85 ? "warn" : "bad";
  const toneLbl = { good: "على المسار", warn: "يحتاج متابعة", bad: "متأخر" };
  const paceTone = tone(pace ? achieved / pace : 1);
  body.append(el("div", { class: "goal-tiles" },
    el("div", { class: "goal-tile " + paceTone }, el("span", {}, toneLbl[paceTone]), el("b", {}, pct(achieved, 0)), el("span", { style: "font-weight:500;opacity:.85" }, "تحقق")),
    el("div", { class: "goal-tile " + tone(fPct) }, el("span", {}, "المتوقع"), el("b", {}, pct(fPct, 0)), el("span", { style: "font-weight:500;opacity:.85" }, "آخر الشهر")),
    el("div", { class: "goal-tile neutral" }, el("span", {}, "الوقت"), el("b", {}, pct(pace, 0)), el("span", { style: "font-weight:500;opacity:.85" }, `متبقٍ ${remainingDays} يوم`))));
  const row = (label, current, target, fmt, goodUp = true) => {
    const p = div(current, target) || 0, ok = goodUp ? p >= pace : p <= Math.max(pace, 0.01);
    const fill = el("i", { class: goodUp ? (p >= 1 ? "good" : "") : (p > 1 ? "bad" : "") }); fill.style.width = Math.min(p * 100, 100) + "%";
    return el("div", { class: "goal-row" },
      el("div", { class: "gr-head" }, el("span", {}, label), el("span", { class: "pill " + (ok ? "good" : "warn") }, el("span", { class: "dot" }), ok ? "ضمن المسار" : "تحت المسار")),
      el("div", { class: "gbar", role: "img", "aria-label": `${label}: ${pct(p, 0)}` }, fill),
      el("div", { class: "gr-nums" }, el("span", {}, "الحالي ", el("b", { class: "num" }, fmt(current))), el("span", {}, "المستهدف ", el("b", { class: "num" }, fmt(target)))));
  };
  body.append(row(`المبيعات (${b.basis === "store" ? "المتجر" : "المنصات"})`, b.sales, t.sales, v => fmt0(v) + " " + C));
  if (t.budget) body.append(row("الصرف من الميزانية", md.tot.spend, t.budget, v => fmt0(v) + " " + C, false));
  if (t.roas) { const r = el("div", { class: "goal-row" }, el("div", { class: "gr-head" }, el("span", {}, "ROAS"), el("span", { class: "pill " + ((b.roas || 0) >= t.roas ? "good" : "warn") }, el("span", { class: "dot" }), (b.roas || 0) >= t.roas ? "أعلى من المستهدف" : "أقل من المستهدف")),
      el("div", { class: "gr-nums" }, el("span", {}, "الحالي ", el("b", { class: "num" }, fmt2(b.roas) + "x")), el("span", {}, "المستهدف ", el("b", { class: "num" }, fmt2(t.roas) + "x")))); body.append(r); }
  if (t.orders) body.append(row("الطلبات", b.orders, t.orders, v => fmt0(v)));
  body.append(el("p", { class: "muted small" }, icon("clock", "ic sm"), ` بيانات حتى ${md.lastDate ? dayLabel(md.lastDate) : "—"}`));
}

const kpi = (ic, label, val, unit, sub, cls = "") => el("div", { class: "card kpi " + cls },
  el("span", { class: "label" }, icon(ic, "ic sm"), label),
  el("span", { class: "val num" }, val, unit ? el("small", {}, unit) : null),
  sub ? el("span", { class: "sub" }, sub) : null);

function renderRequired() {
  const body = $("requiredBody"); body.innerHTML = "";
  const ym = state.month, t = state.targets[ym], md = monthData(ym), C = cur();
  $("roasModeWrap").classList.toggle("hidden", !(t && t.roas));
  $("required").classList.toggle("hidden", !(t && t.sales));
  $("reqSub").textContent = `هدف ${monthLabel(ym)} · من اليوم حتى نهاية الشهر`;
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
