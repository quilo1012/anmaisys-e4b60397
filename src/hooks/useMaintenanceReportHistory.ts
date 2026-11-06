import { logAuditEvent } from "@/hooks/useAuditLogs";
import type { ShiftReport } from "@/lib/maintenanceShiftReport";
import type { ReportFormat } from "@/lib/maintenanceReportExport";

/**
 * Each report generated leaves one line in `audit_logs`, through `log-audit-event`, the
 * edge function every other audit entry uses. The report dialog no longer lists them
 * (owner's decision, 06/11/2026); the Audit screen still does.
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
  total_minutes: number;
  engineer: string | null;
}

export function recordReportGenerated(report: ShiftReport, format: ReportFormat): Promise<void> {
  const details: ReportHistoryDetails = {
    session_date: report.window.sessionDate,
    shift: report.window.shift,
    format,
    validated: report.problems.length === 0,
    problems: report.problems.length,
    stops_read: report.downtimeEvents,
    listed: report.completed.length,
    total_minutes: report.totalCountedMinutes,
    engineer: report.generatedBy,
  };
  return logAuditEvent(REPORT_AUDIT_ACTION, ENTITY, undefined, details as unknown as Record<string, unknown>);
}
