// Opens a print-friendly window for a single production session and triggers print.
// No external dependencies — uses window.print().

export interface PrintSessionItem {
  code: string;
  name: string;
  target: number;
  actual: number;
}

export interface PrintSessionData {
  session_date: string;
  shift: string;
  line: string;
  leader_name: string | null;
  staff_planned: number | null;
  staff_actual: number | null;
  notes: string | null;
  items: PrintSessionItem[];
}

const escapeHtml = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function printSessionReport(s: PrintSessionData) {
  const target = s.items.reduce((a, i) => a + i.target, 0);
  const actual = s.items.reduce((a, i) => a + i.actual, 0);
  const eff = target > 0 ? (actual / target) * 100 : 0;
  const effColor = eff >= 100 ? "#16a34a" : eff >= 80 ? "#d97706" : "#dc2626";

  const rows = s.items
    .map((i) => {
      const e = i.target > 0 ? (i.actual / i.target) * 100 : 0;
      const c = e >= 100 ? "#16a34a" : e >= 80 ? "#d97706" : "#dc2626";
      return `<tr>
        <td style="font-family:monospace;font-size:11px">${escapeHtml(i.code)}</td>
        <td>${escapeHtml(i.name)}</td>
        <td style="text-align:right">${i.target}</td>
        <td style="text-align:right">${i.actual}</td>
        <td style="text-align:right;color:${c};font-weight:600">${i.target > 0 ? e.toFixed(0) + "%" : "—"}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Shift Report — ${escapeHtml(s.session_date)} ${escapeHtml(s.shift)} ${escapeHtml(s.line)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; color: #111; margin: 0; padding: 20px; }
  h1 { margin: 0 0 4px 0; font-size: 20px; }
  .sub { color: #555; font-size: 12px; margin-bottom: 16px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 16px; }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; }
  .kpi .label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: .03em; }
  .kpi .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #e5e5e5; padding: 6px 8px; text-align: left; }
  th { background: #f4f4f5; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  .notes { margin-top: 14px; padding: 8px 10px; border-left: 3px solid #999; background: #fafafa; font-style: italic; font-size: 12px; }
  .footer { margin-top: 20px; font-size: 10px; color: #888; text-align: right; }
</style></head>
<body>
  <h1>Applied Nutrition — Shift Report</h1>
  <div class="sub">${escapeHtml(s.session_date)} • Shift <strong>${escapeHtml(s.shift)}</strong> • Line <strong>${escapeHtml(s.line)}</strong></div>
  <div class="kpis">
    <div class="kpi"><div class="label">Leader</div><div class="value">${escapeHtml(s.leader_name ?? "—")}</div></div>
    <div class="kpi"><div class="label">Staff (act/plan)</div><div class="value">${escapeHtml(s.staff_actual ?? "—")} / ${escapeHtml(s.staff_planned ?? "—")}</div></div>
    <div class="kpi"><div class="label">Target / Actual</div><div class="value">${actual} / ${target}</div></div>
    <div class="kpi"><div class="label">Efficiency</div><div class="value" style="color:${effColor}">${target > 0 ? eff.toFixed(0) + "%" : "—"}</div></div>
  </div>
  <table>
    <thead><tr><th>SKU</th><th>Name</th><th style="text-align:right">Target</th><th style="text-align:right">Actual</th><th style="text-align:right">Eff%</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:#888;padding:14px">No SKUs recorded</td></tr>`}</tbody>
  </table>
  ${s.notes ? `<div class="notes">${escapeHtml(s.notes)}</div>` : ""}
  <div class="footer">Generated ${new Date().toLocaleString()}</div>
  <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
