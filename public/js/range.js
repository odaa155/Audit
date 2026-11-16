// Date range: presets, previous-period comparison, and the picker popover in the top bar.
import { $, el, icon, todayISO, addDays, daysIn, monthLabel, MONTHS_AR, lsGet, lsSet } from "./lib.js";
import { state, hooks } from "./store.js";

const monthStart = iso => iso.slice(0, 7) + "-01";
const monthEnd = ym => `${ym}-${String(daysIn(ym)).padStart(2, "0")}`;
const prevMonth = ym => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5) + 1;

export const PRESETS = [
  { id: "today",     label: "اليوم",          calc: t => [t, t] },
  { id: "yesterday", label: "أمس",            calc: t => [addDays(t, -1), addDays(t, -1)] },
  { id: "last7",     label: "آخر 7 أيام",      calc: t => [addDays(t, -6), t] },
  { id: "last14",    label: "آخر 14 يومًا",    calc: t => [addDays(t, -13), t] },
  { id: "last30",    label: "آخر 30 يومًا",    calc: t => [addDays(t, -29), t] },
  { id: "thisMonth", label: "هذا الشهر",       calc: t => [monthStart(t), t] },
  { id: "lastMonth", label: "الشهر الماضي",    calc: t => { const m = prevMonth(t.slice(0, 7)); return [m + "-01", monthEnd(m)]; } },
];

const short = iso => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS_AR[m - 1]}${iso.slice(0, 4) !== todayISO().slice(0, 4) ? " " + y : ""}`; };
export function rangeLabel(r = state.range) {
  const p = PRESETS.find(x => x.id === r.preset);
  if (p) return p.label;
  if (r.preset?.startsWith("m:")) return monthLabel(r.preset.slice(2));
  return r.from === r.to ? short(r.from) : `${short(r.from)} – ${short(r.to)}`;
}
export const rangeDates = (r = state.range) => r.from === r.to ? short(r.from) : `${short(r.from)} – ${short(r.to)}`;

// Same-length window that ends the day before the range starts.
export function prevRange(r = state.range) {
  if (r.preset === "thisMonth" || r.preset?.startsWith("m:") || r.preset === "lastMonth") {
    // whole/partial month → same days of the previous month
    const pm = prevMonth(r.from.slice(0, 7)), len = daysBetween(r.from, r.to);
    const to = addDays(pm + "-01", Math.min(len, daysIn(pm)) - 1);
    return { from: pm + "-01", to };
  }
  const len = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}
// Months touched by a range (for syncing)
export function monthsIn(from, to) {
  const out = []; let m = from.slice(0, 7);
  while (m <= to.slice(0, 7) && out.length < 6) { out.push(m); const [y, mm] = m.split("-").map(Number); const d = new Date(y, mm, 1); m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  return out;
}

export function setRange(preset, from, to, { save = true } = {}) {
  const t = todayISO();
  const p = PRESETS.find(x => x.id === preset);
  if (p) [from, to] = p.calc(t);
  else if (preset?.startsWith("m:")) { const ym = preset.slice(2); from = ym + "-01"; to = monthEnd(ym); if (to > t && from <= t) to = t; }
  if (from > to) [from, to] = [to, from];
  state.range = { preset, from, to };
  state.month = to.slice(0, 7);
  if (save) lsSet("ops.range", JSON.stringify({ preset, from, to }));
}
export function initRange() {
  let saved = null; try { saved = JSON.parse(lsGet("ops.range") || "null"); } catch (_) {}
  if (saved?.preset && (PRESETS.some(p => p.id === saved.preset) || saved.preset.startsWith("m:"))) setRange(saved.preset, saved.from, saved.to, { save: false });
  else if (saved?.preset === "custom" && saved.from && saved.to) setRange("custom", saved.from, saved.to, { save: false });
  else setRange("thisMonth", null, null, { save: false });
}

// ---------- picker UI ----------
export function mountPicker() {
  const btn = $("rangeBtn"), pop = $("rangePop"), list = $("rangePresets");
  const open = v => { pop.classList.toggle("hidden", !v); btn.setAttribute("aria-expanded", String(v)); if (v) { draw(); (list.querySelector('[aria-checked="true"]') || list.firstChild)?.focus(); } };
  function draw() {
    list.innerHTML = "";
    for (const p of PRESETS) {
      const on = state.range.preset === p.id;
      const [f, t] = p.calc(todayISO());
      list.append(el("button", { type: "button", role: "menuitemradio", "aria-checked": String(on), class: "preset" + (on ? " on" : ""),
        onclick: () => { setRange(p.id); open(false); hooks.renderAll(); } },
        el("span", { class: "chk" }, on ? icon("check", "ic sm") : null), el("span", {}, p.label), el("span", { class: "muted small" }, f === t ? short(f) : `${short(f)} – ${short(t)}`)));
    }
    $("rFrom").value = state.range.from; $("rTo").value = state.range.to; $("rFrom").max = $("rTo").max = todayISO();
  }
  btn.addEventListener("click", e => { e.stopPropagation(); open(pop.classList.contains("hidden")); });
  pop.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", () => open(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.classList.contains("hidden")) { open(false); btn.focus(); } });
  $("rApply").addEventListener("click", () => { const f = $("rFrom").value, t = $("rTo").value; if (!f || !t) return; setRange("custom", f, t); open(false); hooks.renderAll(); });
}
export function drawPickerLabel() {
  $("rangeLabel").textContent = rangeLabel();
  $("rangeBtn").title = rangeDates();
}
