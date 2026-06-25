import { format } from "date-fns";

export type Shift = "DAY" | "NIGHT";

export interface ParsedRagRow {
  entry_date: string;
  line: string;
  shift: Shift;
  plan_qty: number;
  actual_qty: number;
  upm_target: number;
  upm_actual: number;
  downtime_min: number;
  notes: string | null;
}

export interface ParseResult {
  rows: ParsedRagRow[];
  linesDetected: string[];
  datesDetected: string[];
  blocksFound: number;
  metricRowsFound: number;
  sheetsProcessed: string[];
}

export async function parseRagLayoutFile(
  file: File,
  knownLines: string[],
  weekStart: Date,
  weekDates: Date[],
): Promise<ParseResult> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekDates[weekDates.length - 1], "yyyy-MM-dd");
  const selectedWeekDates = weekDates.map((d) => format(d, "yyyy-MM-dd"));

  const inWeek = (d: string) => d >= weekStartStr && d <= weekEndStr;
  const toDate = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date && !isNaN(v.getTime())) {
      const s = format(v, "yyyy-MM-dd");
      return inWeek(s) ? s : null;
    }
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      const [, d, mo, y] = m;
      const yyyy = y.length === 2 ? `20${y}` : y;
      if (Number(yyyy) < 2020) return null;
      const out = `${yyyy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      return inWeek(out) ? out : null;
    }
    const n = Number(s);
    if (!isNaN(n) && n > 40000 && n < 80000) {
      const out = format(new Date(Math.round((n - 25569) * 86400 * 1000)), "yyyy-MM-dd");
      return inWeek(out) ? out : null;
    }
    return null;
  };
  const num = (v: unknown) => {
    const raw = String(v ?? "").trim();
    const n = Number(raw.replace(/[, ]/g, ""));
    return isNaN(n) ? 0 : n;
  };
  const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const clean = (v: unknown) => norm(v).replace(/[^a-z0-9]+/g, " ").trim();

  const aliasMap: Record<string, string> = {
    "tablet": "Capsules & Tablets",
    "tablets": "Capsules & Tablets",
    "tablet line": "Capsules & Tablets",
    "tablets line": "Capsules & Tablets",
    "capsule": "Capsules & Tablets",
    "capsules": "Capsules & Tablets",
    "capsule line": "Capsules & Tablets",
    "capsules line": "Capsules & Tablets",
    "caps tabs": "Capsules & Tablets",
    "c t": "Capsules & Tablets",
    "gel": "Gel Line",
    "gel line": "Gel Line",
  };
  const findLineMatch = (text: string): string | null => {
    const t = clean(text);
    if (!t) return null;
    if (aliasMap[t] && knownLines.includes(aliasMap[t])) return aliasMap[t];
    for (const l of knownLines) if (clean(l) === t) return l;
    for (const l of knownLines) {
      const ll = clean(l);
      if (ll.length >= 3 && (t.includes(ll) || ll.includes(t))) return l;
    }
    const stop = new Set(["line", "linha", "ln", "and", "the", "of", "de", "da", "do"]);
    const tTokens = new Set(t.split(" ").filter((w) => w.length >= 3 && !stop.has(w)));
    const tAbbrev = t.replace(/\s+/g, "");
    for (const l of knownLines) {
      const ll = clean(l);
      const lTokens = ll.split(" ").filter((w) => w.length >= 3 && !stop.has(w));
      if (lTokens.length === 0) continue;
      const hits = lTokens.filter((w) => tTokens.has(w)).length;
      if (hits >= Math.min(1, lTokens.length) && (hits / lTokens.length) >= 0.5) return l;
      const initials = lTokens.map((w) => w[0]).join("");
      if (initials.length >= 2 && (tAbbrev === initials || t.split(" ").join("") === initials)) return l;
    }
    const lineToken = t.match(/\b(?:line|linha|ln|l)\s*0*(\d{1,2})\b/);
    if (lineToken) {
      const n = Number(lineToken[1]);
      const dbMatch = knownLines.find((l) => new RegExp(`\\b0*${n}\\b`).test(clean(l)));
      return dbMatch ?? `Line ${n}`;
    }
    return null;
  };

  const agg = new Map<string, { plan: number; actual: number; downtime: number }>();
  const bump = (
    date: string,
    line: string,
    shift: Shift,
    patch: Partial<{ plan: number; actual: number; downtime: number }>,
  ) => {
    const k = `${date}|${line}|${shift}`;
    const ex = agg.get(k) ?? { plan: 0, actual: 0, downtime: 0 };
    agg.set(k, {
      plan: Math.max(ex.plan, patch.plan ?? 0),
      actual: Math.max(ex.actual, patch.actual ?? 0),
      downtime: Math.max(ex.downtime, patch.downtime ?? 0),
    });
  };

  const linesDetected = new Set<string>();
  const datesDetected = new Set<string>();
  let blocksFound = 0;
  let metricRowsFound = 0;
  const sheetsProcessed: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
    sheetsProcessed.push(sheetName);

    let currentLine: string | null = null;
    let currentDates: string[] = [];
    let currentCols: number[] = [];
    let currentDayNightCols: { day: number; night: number }[] = [];

    const hasMetricNear = (startRow: number) => {
      for (let rr = startRow + 1; rr <= Math.min(aoa.length - 1, startRow + 8); rr++) {
        const label = clean((aoa[rr] ?? []).slice(0, 8).join(" "));
        if (/\b(plan|planned|target|actual|produced|downtime|down time|dt)\b/.test(label)) return true;
      }
      return false;
    };

    const updateHeaderFromRows = (rowIndex: number): boolean => {
      const candidates: { col: number; date: string }[] = [];
      for (let rr = Math.max(0, rowIndex - 3); rr <= Math.min(aoa.length - 1, rowIndex + 3); rr++) {
        const row = aoa[rr] ?? [];
        for (let c = 0; c < row.length; c++) {
          const d = toDate(row[c]);
          if (d) candidates.push({ col: c, date: d });
        }
      }
      if (candidates.length >= 5) {
        const seen = new Set<string>();
        const uniq: { col: number; date: string }[] = [];
        for (const d of candidates.sort((a, b) => a.col - b.col)) {
          if (!seen.has(d.date)) { seen.add(d.date); uniq.push(d); }
        }
        currentDates = uniq.slice(0, 7).map((u) => u.date);
        currentCols = uniq.slice(0, 7).map((u) => u.col);
        currentDayNightCols = currentCols.map((col) => ({ day: col, night: col + 1 }));
        return true;
      }

      for (let rr = Math.max(0, rowIndex - 3); rr <= Math.min(aoa.length - 1, rowIndex + 3); rr++) {
        const row = aoa[rr] ?? [];
        const dayCols = new Map<string, number>();
        for (let c = 0; c < row.length; c++) {
          const label = clean(row[c]);
          const weekday = label.match(/^(mon|monday|seg|segunda|tue|tuesday|ter|terca|terça|wed|wednesday|qua|quarta|thu|thursday|qui|quinta|fri|friday|sex|sexta|sat|saturday|sab|sábado|sun|sunday|dom|domingo)$/)?.[1];
          if (weekday && !dayCols.has(weekday.slice(0, 3))) dayCols.set(weekday.slice(0, 3), c);
        }
        const ordered = ["mon", "seg", "tue", "ter", "wed", "qua", "thu", "qui", "fri", "sex", "sat", "sab", "sun", "dom"]
          .map((d) => dayCols.get(d))
          .filter((c): c is number => typeof c === "number");
        const uniqueOrdered = [...new Set(ordered)];
        if (uniqueOrdered.length >= 5) {
          currentDates = selectedWeekDates;
          currentCols = uniqueOrdered.slice(0, 7);
          currentDayNightCols = currentCols.map((col) => ({ day: col, night: col + 1 }));
          return true;
        }
      }
      return false;
    };

    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] ?? [];

      for (let c = 0; c < Math.min(10, row.length); c++) {
        const cell = norm(row[c]);
        if (!cell || cell.length < 3) continue;
        const match = findLineMatch(cell);
        if (match && hasMetricNear(r)) {
          currentLine = match;
          linesDetected.add(match);
          currentDates = []; currentCols = []; currentDayNightCols = [];
          updateHeaderFromRows(r);
          blocksFound++;
          break;
        }
      }

      const dc: { col: number; date: string }[] = [];
      for (let c = 1; c < row.length; c++) {
        const d = toDate(row[c]);
        if (d) dc.push({ col: c, date: d });
      }
      if (dc.length >= 5) {
        const seen = new Set<string>();
        const uniq: { col: number; date: string }[] = [];
        for (const d of dc) if (!seen.has(d.date)) { seen.add(d.date); uniq.push(d); }
        currentDates = uniq.slice(0, 7).map((u) => u.date);
        currentCols = uniq.slice(0, 7).map((u) => u.col);
        currentDayNightCols = currentCols.map((col) => ({ day: col, night: col + 1 }));
        currentDates.forEach((d) => datesDetected.add(d));
        continue;
      }

      if (currentLine && !currentDates.length) updateHeaderFromRows(r);
      if (!currentLine || !currentDates.length) continue;
      currentDates.forEach((d) => datesDetected.add(d));

      const label = clean(row.slice(0, 8).join(" "));
      if (/\b(total|variance|var|upm|percent|percentage)\b/.test(label) || label.includes("%")) continue;
      let metric: "plan" | "actual" | "downtime" | null = null;
      if (/\b(downtime|down time|dt|paragem|parada)\b/.test(label)) metric = "downtime";
      else if (/\b(actual|produced|production)\b/.test(label)) metric = "actual";
      else if (/\b(plan|planned|target)\b/.test(label)) metric = "plan";
      if (!metric) continue;

      metricRowsFound++;

      for (let i = 0; i < currentDates.length; i++) {
        const date = currentDates[i];
        const cols = currentDayNightCols[i] ?? { day: currentCols[i], night: currentCols[i] + 1 };
        const dayVal = num(row[cols.day]);
        const nightVal = num(row[cols.night]);
        const patchDay = metric === "plan" ? { plan: dayVal } : metric === "actual" ? { actual: dayVal } : { downtime: dayVal };
        const patchNight = metric === "plan" ? { plan: nightVal } : metric === "actual" ? { actual: nightVal } : { downtime: nightVal };
        bump(date, currentLine, "DAY", patchDay);
        bump(date, currentLine, "NIGHT", patchNight);
      }
    }
  }

  const rows: ParsedRagRow[] = [];
  for (const [k, v] of agg) {
    if (!v.plan && !v.actual && !v.downtime) continue;
    const [entry_date, line, shift] = k.split("|");
    rows.push({
      entry_date,
      line,
      shift: shift as Shift,
      plan_qty: v.plan,
      actual_qty: v.actual,
      upm_target: 0,
      upm_actual: 0,
      downtime_min: v.downtime,
      notes: null,
    });
  }

  return {
    rows,
    linesDetected: [...linesDetected].sort(),
    datesDetected: [...datesDetected].sort(),
    blocksFound,
    metricRowsFound,
    sheetsProcessed,
  };
}
