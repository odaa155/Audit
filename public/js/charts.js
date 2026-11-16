// Minimal SVG charts: line chart with crosshair tooltip, sparkline bars. One y-axis only.
import { el, MONTHS_AR } from "./lib.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); for (const c of kids) if (c) e.append(c); return e; };
export const compact = n => { const a = Math.abs(n); if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M"; if (a >= 1e4) return Math.round(n / 1e3) + "K"; if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K"; return String(Math.round(n)); };
const niceStep = (max, n = 4) => { if (max <= 0) return 1; const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag; };
const dLabel = iso => { const [, m, d] = iso.split("-").map(Number); return `${d} ${MONTHS_AR[m - 1]}`; };

/**
 * lineChart(box, { dates, series:[{key,label,color,values,area}], hidden:Set, fmt, extra(i)=>[[label,value]] })
 * Renders into box (a .chart element). Re-renders on resize.
 */
export function lineChart(box, opts) {
  box._chart = opts; draw(box);
  if (!box._ro) { box._ro = new ResizeObserver(() => { if (box._chart) draw(box); }); box._ro.observe(box); }
}
function draw(box) {
  const { dates, series, hidden = new Set(), fmt = v => compact(v), extra } = box._chart;
  box.innerHTML = "";
  const vis = series.filter(x => !hidden.has(x.key));
  if (!dates.length) { box.append(el("div", { class: "empty-chart" }, "لا توجد بيانات في هذه الفترة")); return; }
  const W = Math.max(box.clientWidth || 640, 280), H = 250, padL = 8, padR = 46, padT = 12, padB = 28;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...vis.flatMap(x => x.values)); const step = niceStep(max); const top = Math.ceil(max / step) * step || 1;
  const X = i => padL + (dates.length === 1 ? iw / 2 : (i / (dates.length - 1)) * iw);
  const Y = v => padT + ih - (v / top) * ih;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "رسم بياني يومي: " + vis.map(x => x.label).join(" و"), tabindex: "0", style: "direction:ltr" });
  // grid + y axis (right side, values in text tokens)
  const grid = s("g", { class: "grid" }), axis = s("g", { class: "axis" });
  for (let v = 0; v <= top + 1e-9; v += step) {
    grid.append(s("line", { x1: padL, x2: padL + iw, y1: Y(v), y2: Y(v) }));
    const t = s("text", { x: W - 4, y: Y(v) + 4, "text-anchor": "end" }); t.textContent = compact(v); axis.append(t);
  }
  const ticks = Math.min(dates.length, Math.max(2, Math.floor(iw / 90)));
  for (let k = 0; k < ticks; k++) {
    const i = ticks === 1 ? 0 : Math.round(k * (dates.length - 1) / (ticks - 1));
    const t = s("text", { x: X(i), y: H - 8, "text-anchor": k === 0 ? "start" : k === ticks - 1 ? "end" : "middle" }); t.textContent = dLabel(dates[i]); axis.append(t);
  }
  svg.append(grid, axis);
  // series: area wash + 2px line
  for (const x of vis) {
    const pts = x.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
    if (x.area) svg.append(s("path", { d: `M${X(0)},${Y(0)} L${pts.join(" L")} L${X(dates.length - 1)},${Y(0)} Z`, fill: x.color, "fill-opacity": ".10" }));
    svg.append(s("polyline", { points: pts.join(" "), fill: "none", stroke: x.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (dates.length === 1) svg.append(s("circle", { cx: X(0), cy: Y(x.values[0]), r: 4, fill: x.color }));
  }
  // hover layer: crosshair snaps to nearest day; one tooltip lists every series
  const hair = s("line", { class: "hair", y1: padT, y2: padT + ih, visibility: "hidden" });
  const dots = vis.map(x => s("circle", { r: 4.5, fill: x.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }));
  const hit = s("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent" });
  svg.append(hair, ...dots, hit);
  const tip = el("div", { class: "tip hidden", role: "status" });
  box.append(svg, tip);
  let cur = -1;
  const show = i => {
    cur = i; const x = X(i);
    hair.setAttribute("x1", x); hair.setAttribute("x2", x); hair.setAttribute("visibility", "visible");
    vis.forEach((sr, k) => { dots[k].setAttribute("cx", x); dots[k].setAttribute("cy", Y(sr.values[i])); dots[k].setAttribute("visibility", "visible"); });
    tip.innerHTML = "";
    tip.append(el("div", { class: "t-date" }, dLabel(dates[i]) + " " + dates[i].slice(0, 4)));
    for (const sr of vis) tip.append(el("div", { class: "t-row" }, el("span", {}, el("i", { class: "key", style: `background:${sr.color}` }), sr.label), el("b", {}, fmt(sr.values[i]))));
    for (const [l, v] of (extra ? extra(i) : [])) tip.append(el("div", { class: "t-row" }, el("span", {}, l), el("b", {}, v)));
    tip.classList.remove("hidden");
    const bw = box.clientWidth, tw = tip.offsetWidth, px = (x / W) * bw;
    tip.style.left = Math.min(Math.max(px + 12 + tw > bw ? px - tw - 12 : px + 12, 0), bw - tw) + "px"; tip.style.top = "8px";
  };
  const hide = () => { cur = -1; hair.setAttribute("visibility", "hidden"); dots.forEach(d => d.setAttribute("visibility", "hidden")); tip.classList.add("hidden"); };
  hit.addEventListener("pointermove", e => { const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width); const i = Math.round(((px - padL) / iw) * (dates.length - 1)); show(Math.max(0, Math.min(dates.length - 1, i))); });
  hit.addEventListener("pointerleave", hide);
  svg.addEventListener("keydown", e => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const d = e.key === "ArrowRight" ? 1 : -1; show(Math.max(0, Math.min(dates.length - 1, (cur < 0 ? dates.length - 1 : cur + d)))); } if (e.key === "Escape") hide(); });
  svg.addEventListener("blur", hide);
}

// Tiny column sparkline (no axes). values: numbers; color: CSS color.
export function sparkBars(values, color, w = 96, h = 26) {
  const n = values.length; if (!n) return el("span", { class: "muted small" }, "—");
  const max = Math.max(...values, 1), gap = 1.5, bw = Math.max(1.5, (w - gap * (n - 1)) / n);
  const svg = s("svg", { class: "spark", width: w, height: h, viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true", style: "direction:ltr" });
  values.forEach((v, i) => { const bh = Math.max(1.5, (v / max) * h); svg.append(s("rect", { x: i * (bw + gap), y: h - bh, width: bw, height: bh, rx: Math.min(1.5, bw / 2), fill: color })); });
  return svg;
}
