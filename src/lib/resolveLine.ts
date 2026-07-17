// Resolve a friendly line label for a work order using:
//   1. the WO snapshot (line_at_time), ignoring the literal "removed"
//   2. the live machine→line mapping from the machines table
//   3. a fallback placeholder (default "—")
//
// Consolidates logic previously duplicated in FinancialDashboard,
// AnalyticsPage and ExecutiveDashboard.

export interface MachineLike {
  name?: string | null;
  line?: string | null;
}

export function resolveLine(
  wo: any,
  machines: MachineLike[] | null | undefined,
  placeholder: string = "—",
): string {
  const snapshot = ((wo?.line_at_time ?? "") as string).toString().trim();
  if (snapshot && !/^removed$/i.test(snapshot)) return snapshot;
  const machineName = wo?.machine;
  if (machineName && machines) {
    const found = machines.find((m) => m?.name === machineName);
    const live = (found?.line ?? "").toString().trim();
    if (live) return live;
  }
  return placeholder;
}
