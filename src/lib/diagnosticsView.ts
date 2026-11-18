import { pushVerdict, type PushVerdict } from "@/lib/pushDiagnostics";

/**
 * What Root Diagnostics lists, worked out from the rows it loaded.
 *
 * Kept apart from the page so the rules can be tested without rendering it.
 */
export interface DiagnosticsRow {
  id: string;
  created_at: string;
  user_id: string | null;
  error_type: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Readings, not errors, written on purpose: kept, one click away on their own chip, never
 * in "All", which is the list of things that went wrong.
 *  - PUSH_STATE: each device saying, once a day, how push stands on it (`pushDiagnostics`).
 *    The ones that ARE faults come back into "All" through `pushVerdict`.
 *  - NO_SESSION: a request that went out before the token was there (`requestAuth`).
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
 * newest first, as the page loads them.
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

export interface DiagnosticsView<T> {
  /** Chips in the order the types first appear, each with its count. */
  chips: { type: string; count: number }[];
  /** Everything that went wrong: non-reading rows, plus devices whose push is broken. */
  problems: T[];
  shown: T[];
  push: PushSummary;
}

export function diagnosticsView<T extends DiagnosticsRow>(logs: T[], filter: string): DiagnosticsView<T> {
  const devices = latestPushPerDevice(logs);
  const verdicts = new Map<string, PushVerdict>(devices.map((d) => [d.id, pushVerdict(d.metadata)]));
  const push: PushSummary = { ok: 0, person: 0, fault: 0 };
  for (const v of verdicts.values()) push[v]++;

  const problems = logs.filter((l) =>
    !INFO_TYPES.has(l.error_type) || verdicts.get(l.id) === "fault",
  );

  const order: string[] = [];
  for (const l of logs) if (!order.includes(l.error_type)) order.push(l.error_type);
  const chips = order.map((type) => ({
    type,
    count: type === "PUSH_STATE" ? devices.length : logs.filter((l) => l.error_type === type).length,
  }));

  const rank: Record<PushVerdict, number> = { fault: 0, person: 1, ok: 2 };
  const shown = filter === "all"
    ? problems
    : filter === "PUSH_STATE"
      // Faults first, then what waits on the person, then the working ones; newest first
      // inside each, which is the order they were loaded in (sort is stable).
      ? [...devices].sort((a, b) => rank[verdicts.get(a.id)!] - rank[verdicts.get(b.id)!])
      : logs.filter((l) => l.error_type === filter);

  return { chips, problems, shown, push };
}
