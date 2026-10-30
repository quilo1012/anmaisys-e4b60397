import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import type { ShiftReport } from "@/lib/maintenanceShiftReport";
import type { ReportFormat } from "@/lib/maintenanceReportExport";

/**
 * Report history, kept in `audit_logs` rather than a table of its own.
 *
 * Writing goes through `log-audit-event`, the edge function every other audit entry
 * uses, so nothing new is granted to anyone. Reading is whatever `audit_logs` already
 * allows — admins, managers and maintenance managers; an engineer's shared tablet
 * account sees nothing, which is the existing rule and not one this screen changes.
 * Only the shift, the counts and the verdict are kept: no stop, order or name from
 * inside the report.
 */
export const REPORT_AUDIT_ACTION = "maintenance_report_generated";
const ENTITY = "maintenance_report";

export interface ReportHistoryDetails {
  session_date: string;
  shift: "day" | "night";
  format: ReportFormat;
  validated: boolean;
  problems: number;
  stops_read: number;
  listed: number;
  engineer: string | null;
}

export interface ReportHistoryEntry {
  id: string;
  created_at: string;
  user_name: string;
  details: Partial<ReportHistoryDetails> | null;
}

export function recordReportGenerated(report: ShiftReport, format: ReportFormat): Promise<void> {
  const details: ReportHistoryDetails = {
    session_date: report.window.sessionDate,
    shift: report.window.shift,
    format,
    validated: report.problems.length === 0,
    problems: report.problems.length,
    stops_read: report.stopsRead,
    listed: report.items.reduce((n, it) => n + it.stops.length, 0),
    engineer: report.generatedBy,
  };
  return logAuditEvent(REPORT_AUDIT_ACTION, ENTITY, undefined, details as unknown as Record<string, unknown>);
}

/** The newest reports generated, as far as the viewer's role may see the audit log. */
export function useMaintenanceReportHistory(enabled: boolean) {
  return useQuery({
    queryKey: ["maintenance-report-history"],
    enabled,
    queryFn: async (): Promise<ReportHistoryEntry[]> => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, created_at, user_name, details")
        .eq("action", REPORT_AUDIT_ACTION)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as ReportHistoryEntry[];
    },
  });
}
