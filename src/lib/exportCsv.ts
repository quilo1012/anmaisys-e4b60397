import { differenceInMinutes } from "date-fns";

interface WOForExport {
  id?: string;
  wo_number?: number;
  requester_name: string;
  machine: string;
  description: string;
  status: string;
  operator?: { name: string };
  engineer?: { name: string };
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function exportWorkOrdersCsv(workOrders: WOForExport[], filename = "work_orders.csv", partsCounts?: Record<string, number>) {
  const headers = ["WO#", "Requester", "Machine", "Description", "Status", "Operator", "Engineer", "Created", "Started", "Completed", "Response Time (min)", "Total Time (min)", "Parts Used"];
  const rows = workOrders.map((wo) => {
    const responseTime = wo.started_at ? differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at)) : "";
    const totalTime = wo.completed_at ? differenceInMinutes(new Date(wo.completed_at), new Date(wo.created_at)) : "";
    return [
      wo.wo_number ? `AN-${String(wo.wo_number).padStart(4, "0")}` : "",
      wo.requester_name,
      wo.machine,
      `"${wo.description.replace(/"/g, '""')}"`,
      wo.status,
      wo.operator?.name || "",
      wo.engineer?.name || "",
      wo.created_at,
      wo.started_at || "",
      wo.completed_at || "",
      String(responseTime),
      String(totalTime),
      String(wo.id && partsCounts?.[wo.id] ? partsCounts[wo.id] : ""),
    ].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
