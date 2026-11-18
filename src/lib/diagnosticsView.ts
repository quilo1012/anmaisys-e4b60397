import { pushVerdict, type PushVerdict } from "@/lib/pushDiagnostics";

/**
 * What Root Diagnostics and Phone Notifications list, worked out from the rows they load.
 *
 * Kept apart from the pages so the rules can be tested without rendering them.
 */
export interface DiagnosticsRow {
  id: string;
  created_at: string;
  user_id: string | null;
  error_type: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Readings, not errors, written on purpose. Root Diagnostics does not list them: it is the
 * list of things that went wrong, and on 18/11/2026 a chip of readings beside it was read,
 * twice in one day, as "more errors".
 *  - PUSH_STATE: each device saying, once a day, how push stands on it (`pushDiagnostics`).
 *    Listed on Phone Notifications. The ones that ARE faults still come back into Root
 *    Diagnostics through `pushVerdict`.
 *  - NO_SESSION: a request that went out before the token was there (`requestAuth`).
 *    Counted in one muted line under the list, never a chip.
 */
export const INFO_TYPES = new Set(["PUSH_STATE", "NO_SESSION"]);

/** One device: the same login on the same kind of device, opened the same way. */
function deviceKey(row: DiagnosticsRow): string {
  const m = row.metadata ?? {};
  return `${row.user_id ?? "?"}|${String(m.platform ?? "?")}|${String(m.display ?? "?")}`;
}

/**
 * The newest PUSH_STATE row of each device. A phone writes one a day, so a week of the
 * same healthy phone used to fill the list with seven copies of "working". `rows` must be
 * newest first, as the pages load them.
 */
export function latestPushPerDevice<T extends DiagnosticsRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (r.error_type !== "PUSH_STATE") continue;
    const key = deviceKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface PushSummary { ok: number; person: number; fault: number }

export interface PushDevicesView<T> {
  /** One row per device: faults first, then what waits on the person, then working. */
  devices: (T & { verdict: PushVerdict })[];
  summary: PushSummary;
}

/** What Phone Notifications shows. `rows` are PUSH_STATE rows, newest first. */
export function pushDevicesView<T extends DiagnosticsRow>(rows: T[]): PushDevicesView<T> {
  const summary: PushSummary = { ok: 0, person: 0, fault: 0 };
  const rank: Record<PushVerdict, number> = { fault: 0, person: 1, ok: 2 };
  const devices = latestPushPerDevice(rows).map((d) => {
    const verdict = pushVerdict(d.metadata);
    summary[verdict]++;
    return { ...d, verdict };
  });
  // Stable sort: newest first inside each verdict, the order they were loaded in.
  devices.sort((a, b) => rank[a.verdict] - rank[b.verdict]);
  return { devices, summary };
}

export interface DiagnosticsView<T> {
  /** One chip per type of error present, with its count. Never a chip for a reading. */
  chips: { type: string; count: number }[];
  /** Everything that went wrong: error rows, newest first, plus devices whose push is broken. */
  problems: T[];
  shown: T[];
  /** NO_SESSION rows: recorded, not errors, counted once under the list. */
  readings: number;
}

/**
 * What Root Diagnostics shows. `errors` are the non-PUSH_STATE rows, `pushRows` the
 * PUSH_STATE rows — loaded apart, so a busy day of phones cannot push a crash out of the
 * newest 200. Both newest first.
 */
export function diagnosticsView<T extends DiagnosticsRow>(errors: T[], pushRows: T[], filter: string): DiagnosticsView<T> {
  const pushFaults = latestPushPerDevice(pushRows).filter((d) => pushVerdict(d.metadata) === "fault");
  const problems = [...errors.filter((l) => !INFO_TYPES.has(l.error_type)), ...pushFaults]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const order: string[] = [];
  for (const l of problems) if (!order.includes(l.error_type)) order.push(l.error_type);
  const chips = order.map((type) => ({ type, count: problems.filter((l) => l.error_type === type).length }));

  const shown = filter === "all" ? problems : problems.filter((l) => l.error_type === filter);
  const readings = errors.filter((l) => l.error_type === "NO_SESSION").length;
  return { chips, problems, shown, readings };
}
