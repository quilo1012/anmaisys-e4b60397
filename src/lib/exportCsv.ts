import { differenceInMinutes } from "date-fns";

interface WOForExport {
  id?: string;
  wo_number?: number;
  requester_name: string;
  machine: string;
  line_at_time?: string | null;
  description: string;
  status: string;
  operator?: { name: string };
  engineer?: { name: string };
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// Quote every cell and neutralise CSV formula injection. Without this, any field
// with a comma/quote/newline shifts the columns, and a leading =,+,-,@ executes as
// a formula in Excel/Sheets.
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Rows already ordered to match the headers, quoted and handed to the browser.
 *
 * Kept separate from the work-order export so a second report does not have to
 * copy the formula-injection guard to get a download — copying it is how one of
 * the two ends up without it.
 */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportWorkOrdersCsv(workOrders: WOForExport[], filename = "work_orders.csv", partsCounts?: Record<string, number>) {
  const headers = ["WO#", "Requester", "Line", "Machine", "Description", "Status", "Operator", "Engineer", "Created", "Started", "Completed", "Response Time (min)", "Total Time (min)", "Parts Used"];
  const rows = workOrders.map((wo) => {
    const responseTime = wo.started_at ? differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at)) : "";
    const totalTime = wo.completed_at ? differenceInMinutes(new Date(wo.completed_at), new Date(wo.created_at)) : "";
    return [
      wo.wo_number ? `WO-${new Date(wo.created_at).getFullYear()}-${String(wo.wo_number).padStart(6, "0")}` : "",
      wo.requester_name,
      wo.line_at_time || "",
      wo.machine || "",
      wo.description,
      wo.status,
      wo.operator?.name || "",
      wo.engineer?.name || "",
      wo.created_at,
      wo.started_at || "",
      wo.completed_at || "",
      responseTime,
      totalTime,
      wo.id && partsCounts?.[wo.id] ? partsCounts[wo.id] : "",
    ];
  });
  downloadCsv(filename, headers, rows);
}
