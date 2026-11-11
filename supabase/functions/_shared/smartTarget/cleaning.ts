/**
 * Deep and drill cleans between products (decided 10/11, Q81–Q83).
 *
 * The rule is the one the line plans in "Time and motion studies New.xlsx" (L1–L6 PLAN)
 * follow, written down: a cleaning row sits between two products, of two kinds.
 *
 *  - ⭕DRILL CLEANING⭕ (planned 120 min): a change of flavour or product. 168 of its 178
 *    rows were before another flavoured product.
 *  - DRILL CLEANING AND FULL BLEND CLEANDOWN (planned 240 min), the deep clean: before a
 *    plain product, unflavoured or a single ingredient (93 of the 103 changes to one), and
 *    from a product with milk to one without, which is what most of its other 108 rows are.
 *
 * The next batch of the same blend needs nothing, whatever the pack size: CREAM OF RICE
 * TOFFEE BISCUIT runs 1 kg then 2 kg with no clean between.
 *
 * Durations are what each line logged for the clean, not the plan's 120 and 240, which
 * stand in only where a line has no history of that clean (Q83).
 */

import type { CleaningRule, CleaningStep } from "./engine.ts";

export type { CleaningRule, CleaningStep };
export type CleanKind = CleaningStep["kind"];

/** The plan sheet's times, used where a line has not logged the clean often enough. */
export const PLAN_SHEET_MINUTES: Record<CleanKind, number> = { drill: 120, full: 240 };
/** Fewer logged cleans than this and the line's own time is not trusted. */
export const MIN_LOGGED_CLEANS = 3;
export const CLEAN_HISTORY_DAYS = 56;

export interface CleanProduct {
  name: string;
  /** Confirmed on SKU Products, or null while only suggested from the name. */
  allergens: string[] | null;
}

const upper = (s: string) => s.toUpperCase().replace(/\[.*$/, "").replace(/\s+/g, " ").trim();

/** The blend: the name without pack size, pack type or market. Same blend, no clean. */
export function blendOf(name: string): string {
  return upper(name)
    .replace(/\b(PERU|KSA|NOT FOR EU|US|AU|UK|PAKISTAN|MOROCCO)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:KG|G|ML|L)\b/g, " ")
    .replace(/\b(BAGS?|TUBS?|POUCH(?:ES)?|SAMPLES?|SACHETS?|BLENDED|REWORK)\b/g, " ")
    .replace(/[^A-Z0-9+&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FLAVOUR = /BERRY|SLUSH|SOUR|COLA|LEMON|LIME|ORANGE|PUNCH|RASP|STRAW|WATERMELON|APPLE|PINEAPPLE|CHERRY|TROPICAL|MANGO|GRAPE|BLUE|PEACH|MOJITO|CANDY|CITRUS|BLACKCURRANT|FRUIT|VANILLA|CHOC|CARAMEL|BANANA|COOKIE|TOFFEE|COFFEE|LATTE/;

/** Unflavoured or a single ingredient, as the plan sheet deep-cleans before. */
export function isPlainProduct(name: string): boolean {
  const n = upper(name);
  if (/UNFLAV|UNLFAV|UNFLAVOURED|NATURAL\b/.test(n)) return true;
  if (/\bAAKG\b|CITRULLINE|\bHMB\b|GLUTAMINE|BETA.?ALANINE|TAURINE|CARNITINE|ASPARTIC|\bB12\b|COLLAGEN PEPTIDES|ORGAN SHIELD|MUSHROOM SUPERBLEND/.test(n)) return true;
  return /CREATINE/.test(n) && !FLAVOUR.test(n);
}

/** What the name suggests until someone confirms it on SKU Products. */
export function suggestAllergens(name: string): string[] {
  const n = upper(name);
  const out: string[] = [];
  const noMilkProtein = /BEEF|PLANT|\bPEA\b|COLLAGEN|EGG WHITE/.test(n);
  if (/WHEY|CASEIN|\bMASS\b|GAINER|ISO.?XP|MILK|MUSCLE MOOSE|COOKIE DOUGH/.test(n) || (/PROTEIN/.test(n) && !noMilkProtein)) out.push("Milk");
  if (/\bOATS?\b/.test(n)) out.push("Gluten");
  return out;
}

export const allergensOf = (p: CleanProduct): { list: string[]; confirmed: boolean } =>
  p.allergens ? { list: p.allergens, confirmed: true } : { list: suggestAllergens(p.name), confirmed: false };

export interface CleanDowntimeRow {
  line: string | null;
  date: string | null;
  shift: string | null;
  reason: string | null;
  duration_minutes: number | null;
}

/** The kind of clean a logged stop is, or null. Overruns and faults are not the clean. */
export function cleanKindOfReason(reason: string | null | undefined): CleanKind | null {
  const r = String(reason ?? "").toLowerCase();
  if (/over ?ran|fault/.test(r)) return null;
  if (/deep clean/.test(r)) return "full";
  if (/drill clean/.test(r)) return "drill";
  return null;
}

/**
 * Per line, the median minutes of each clean, a clean being everything logged for it in
 * one shift (one clean is often two rows). Only lines with MIN_LOGGED_CLEANS or more.
 */
export function cleanMinutesByLine(rows: CleanDowntimeRow[]): Map<number, Partial<Record<CleanKind, { minutes: number; cleans: number }>>> {
  const perShift = new Map<string, number>();
  for (const r of rows) {
    const kind = cleanKindOfReason(r.reason);
    const line = /^line\s*([1-6])$/i.exec(String(r.line ?? "").trim())?.[1];
    if (!kind || !line || !(Number(r.duration_minutes) > 0)) continue;
    const key = `${line}|${kind}|${r.date}|${r.shift}`;
    perShift.set(key, (perShift.get(key) ?? 0) + Number(r.duration_minutes));
  }
  const lists = new Map<string, number[]>();
  for (const [key, m] of perShift) {
    const [line, kind] = key.split("|");
    const k = `${line}|${kind}`;
    lists.set(k, [...(lists.get(k) ?? []), m]);
  }
  const out = new Map<number, Partial<Record<CleanKind, { minutes: number; cleans: number }>>>();
  for (const [k, list] of lists) {
    if (list.length < MIN_LOGGED_CLEANS) continue;
    const [line, kind] = k.split("|") as [string, CleanKind];
    const s = [...list].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    out.set(Number(line), { ...(out.get(Number(line)) ?? {}), [kind]: { minutes: Math.round(median), cleans: s.length } });
  }
  return out;
}

/** The rule for one line, from what the products are and what the line's cleans take. */
export function cleaningRule(
  line: number,
  productOf: (sku: string) => CleanProduct | null,
  minutesByLine: ReturnType<typeof cleanMinutesByLine>,
): CleaningRule {
  const timed = (kind: CleanKind, reason: string): CleaningStep => {
    const own = minutesByLine.get(line)?.[kind];
    return own
      ? { kind, minutes: own.minutes, minutesFrom: "line_history", reason }
      : { kind, minutes: PLAN_SHEET_MINUTES[kind], minutesFrom: "plan_sheet", reason };
  };
  return (from, to) => {
    const a = productOf(from);
    const b = productOf(to);
    if (!a || !b) return null;
    if (blendOf(a.name) === blendOf(b.name)) return null;
    if (isPlainProduct(b.name)) return timed("full", "to an unflavoured or single-ingredient product");
    const had = allergensOf(a);
    const has = allergensOf(b);
    const lost = had.list.filter((x) => !has.list.includes(x));
    if (lost.length) {
      const sure = had.confirmed && has.confirmed ? "" : " (allergens not confirmed)";
      return timed("full", `from ${lost.join(" and ").toLowerCase()} to a product without it${sure}`);
    }
    return timed("drill", "flavour or product change");
  };
}

export const cleanLabel = (s: CleaningStep) => `${s.kind === "full" ? "Deep clean" : "Drill clean"} ${s.minutes} min`;
