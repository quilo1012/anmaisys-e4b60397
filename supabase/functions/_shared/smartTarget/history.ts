/**
 * Each line's performance factor, recalculated from the shifts before the one being
 * forecast (decided 05/11, Q25).
 *
 * The page reads the last eight weeks of closed shifts, quantities only, and turns
 * them into the HistoryShift shape lineFactors() takes. Only shifts strictly before
 * the forecast date are used, so a forecast never learns from the shift it predicts.
 *
 * Which lines may SHOW a number is a separate, human decision. The factor is
 * computed for all six lines. On 05/11 only Lines 2, 4 and 5 forecast October within
 * about 12% using a factor learnt on August and September. Lines 1, 3 and 6 were off
 * by 19–25%. Those three stay at "—", with that reason, until Production sets the
 * error it accepts.
 */

import { forecastShift, parseLineNo, shiftWindow, type LineNo, type ShiftType } from "./engine.ts";
import { identifyItemSku, type SkuCatalogue } from "../production/lineSku.ts";
import { familyFromName, isSampleProduct } from "./rates.ts";
import { setupMinutes, type SmartTargetSession } from "./input.ts";
import type { HistoryShift } from "./rates.ts";

/** Whether a SKU is a sample, from its code and its name in the product list. */
export function skuIsSample(catalogue: SkuCatalogue): (sku: string) => boolean {
  return (sku) => isSampleProduct(sku, identifyItemSku({ sku_id: null, sku_code_text: sku, actual: 0, started_at: null, finished_at: null }, catalogue)?.name);
}

/** A SKU's product family, from its name in the product list. */
export function skuFamily(catalogue: SkuCatalogue): (sku: string) => string | null {
  return (sku) => familyFromName(identifyItemSku({ sku_id: null, sku_code_text: sku, actual: 0, started_at: null, finished_at: null }, catalogue)?.name);
}

/** How far back the factor looks. */
export const FACTOR_WINDOW_DAYS = 56;

/**
 * Every line shows its number, office and tablet alike (decided 06/11: a line with no target
 * on the tablet read as broken). A line that misses by more than the 15% goal says so beside
 * the number instead of losing it.
 */
export const FORECAST_LINES: readonly LineNo[] = [1, 2, 3, 4, 5, 6];

/** Median miss, in percent, of the lines over the goal, from the fair test on shifts since 15/09. */
export const WIDE_MARGIN_LINES: Partial<Record<LineNo, number>> = { 3: 22 };

/** The first and last session dates the factor reads for a forecast on `date`. */
export function factorWindow(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const from = new Date(d.getTime() - FACTOR_WINDOW_DAYS * 86_400_000);
  const to = new Date(d.getTime() - 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export interface HistoryItem {
  session_id: string;
  display_order: number;
  sku_id: string | null;
  sku_code_text: string | null;
  actual_qty: number | null;
}

/**
 * One HistoryShift per line, date and shift (every session of that shift together).
 * Setup minutes come from the engine itself, run on the shift's SKUs in logged order
 * with no rates, so the factor charges exactly the changeovers and mixing the
 * forecast will charge.
 */
export function historyFromSessions(
  sessions: SmartTargetSession[],
  items: HistoryItem[],
  catalogue: SkuCatalogue,
): HistoryShift[] {
  const groups = new Map<string, { line: LineNo; date: string; shift: ShiftType; ids: Set<string> }>();
  for (const s of sessions) {
    const line = parseLineNo(s.line);
    const shift = String(s.shift).trim().toUpperCase();
    if (line === null || (shift !== "DAY" && shift !== "NIGHT")) continue;
    const key = `${s.session_date}|${shift}|${line}`;
    const g = groups.get(key) ?? { line, date: s.session_date, shift: shift as ShiftType, ids: new Set<string>() };
    g.ids.add(s.id);
    groups.set(key, g);
  }

  const out: HistoryShift[] = [];
  for (const [key, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const own = items
      .filter((i) => g.ids.has(i.session_id))
      .sort((a, b) => a.display_order - b.display_order || (a.session_id < b.session_id ? -1 : 1));
    const made = new Map<string | null, number>();
    const unidentified = new Map<string, number>();
    const order: string[] = [];
    for (const i of own) {
      const identity = identifyItemSku(
        { sku_id: i.sku_id, sku_code_text: i.sku_code_text, actual: 0, started_at: null, finished_at: null },
        catalogue,
      );
      const sku = identity?.code ?? null;
      const qty = Number(i.actual_qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      made.set(sku, (made.get(sku) ?? 0) + qty);
      // Typed text that is not in the product list (Q44a): listed so it can be fixed.
      if (identity?.uncatalogued) unidentified.set(identity.code, (unidentified.get(identity.code) ?? 0) + qty);
      if (sku && !order.includes(sku)) order.push(sku);
    }
    const window = shiftWindow(g.date, g.shift);
    const engine = forecastShift({
      date: g.date,
      shift: g.shift,
      line: g.line,
      jobs: order.map((sku, n) => ({ jobId: `${key}|${n}`, sku, sequence: n + 1 })),
      rates: [],
    });
    out.push({
      key,
      line: g.line,
      made: [...made.entries()].map(([sku, qty]) => ({ sku, qty })),
      unidentified: [...unidentified.entries()].map(([text, qty]) => ({ text, qty })),
      netMinutes: (window?.grossMinutes ?? 720) - 75,
      setupMinutes: setupMinutes(engine),
    });
  }
  return out;
}

/**
 * Markets iTouch puts on a works order's code that the product list does not always have
 * (decided 11/11, Q85). CRE250PAKISTAN is CRE250 for a market: same powder, same fill.
 */
const MARKET_PREFIX = /^(PERU|NEU|NOTFOREU|US|AU|UK|KSA)(?=[A-Z0-9])/;
const MARKET_SUFFIX = /(PAKISTAN|MOROCCO|PERU|KSA|US|AU|UK|EU)$/;

/**
 * A queued code as the product list knows it: itself when listed, else the same code without
 * its market, when that one is listed. Otherwise unchanged, and it shows on the page's list
 * of codes to add.
 */
export function canonicalQueueCode(catalogue: SkuCatalogue): (code: string) => string {
  const listed = (c: string) => catalogue.byCode.has(c.toLowerCase());
  return (code) => {
    const base = String(code ?? "").replace(/\s*-\s*B\d+\s*$/i, "").trim().toUpperCase();
    if (!base || listed(base)) return code;
    for (const stripped of [base.replace(MARKET_SUFFIX, ""), base.replace(MARKET_PREFIX, "")]) {
      if (stripped && stripped !== base && listed(stripped)) return stripped;
    }
    return code;
  };
}

/** Queue rows with their codes as the product list knows them. */
export function canonicalQueue<T extends { sku: string }>(rows: T[], catalogue: SkuCatalogue): T[] {
  const canon = canonicalQueueCode(catalogue);
  return rows.map((r) => ({ ...r, sku: canon(r.sku) }));
}

/**
 * The family of a SKU from the product list, else from iTouch's own description of a queued
 * job: DYM750V is not listed, but iTouch calls it DYNAMIC MASS GAINER 750G VANILLA, the
 * family the line logged as DYNAMICMASSV, so its history counts (Q85).
 */
export function familyWithQueue(
  catalogue: SkuCatalogue,
  queue: { sku: string; description?: string | null }[],
): (sku: string) => string | null {
  const fromCatalogue = skuFamily(catalogue);
  const described = new Map<string, string>();
  for (const q of queue) {
    const code = String(q.sku ?? "").replace(/\s*-\s*B\d+\s*$/i, "").trim().toUpperCase();
    if (q.description && !described.has(code)) described.set(code, q.description);
  }
  return (sku) => fromCatalogue(sku) ?? familyFromName(described.get(String(sku).toUpperCase()) ?? null);
}

/** Queued codes the product list does not know and no description places, for the page (Q85). */
export function unknownQueueCodes(
  rows: { line: string; sku: string; description?: string | null }[],
  catalogue: SkuCatalogue,
  isSample: (sku: string) => boolean,
): { line: string; code: string; description: string | null }[] {
  const canon = canonicalQueueCode(catalogue);
  const out = new Map<string, { line: string; code: string; description: string | null }>();
  for (const r of rows) {
    const code = canon(r.sku).replace(/\s*-\s*B\d+\s*$/i, "").trim().toUpperCase();
    if (!code || catalogue.byCode.has(code.toLowerCase()) || isSample(code)) continue;
    if (familyFromName(r.description ?? null)) continue;
    const k = `${r.line}|${code}`;
    if (!out.has(k)) out.set(k, { line: r.line, code, description: r.description ?? null });
  }
  return [...out.values()];
}

