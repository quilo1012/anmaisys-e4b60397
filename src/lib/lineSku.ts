/**
 * What a line is making, from a production row that may or may not be linked to
 * the SKU catalogue.
 *
 * `production_items` identifies its product TWICE and neither column is reliable
 * on its own: `sku_id`, a foreign key into `sku_products`, and `sku_code_text`,
 * the code as it arrived from the iTouching Work-To-List import. On 12/08 three
 * of the six rows on the board had `sku_id` NULL and the code sitting in the text
 * column — Line 2 ('ABEENG'), Line 6 ('MORCW2CNC') and Tablet Line ('Vitamin  d3
 * and k2'). A screen that reads only `sku_id` says nothing at all about those
 * lines, which is what the performance board did.
 *
 * The second reading it got wrong is worse than the blank. Line 2's pace fell to
 * "SKU has no standard rate" — about a product with 720/h in the table, and
 * without naming it. The rate was never missing; the link to it was.
 *
 * `wallboard-lines` has read `sku_code_text` since it was written. This is that
 * same rule, in one place, so the next screen does not have to rediscover it.
 */

import { productLabel } from "@/lib/productLabel";

export interface SkuRow {
  id: string;
  code: string;
  name: string;
  target_per_hour: number | null;
  /** Present on the full `sku_products` row; the ranking screen groups by it. */
  category?: string | null;
}

/** A `production_items` row, as much of it as identifying the product needs. */
export interface LineSkuItem {
  sku_id: string | null;
  sku_code_text: string | null;
  actual: number;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * The job iTouching says is RUNNING on the machine, as the poll last saw it.
 *
 * Not an order in this system: there is no quantity behind it and nothing was
 * logged against it. It answers "what is on the line" for a line that has not
 * been written down yet — Line 2 on 12/08 sat in Line Preparation with no
 * production_items at all, and the board could not name what it was being set up
 * for while the iTouching screen beside it could.
 */
export interface LiveJob {
  /** PartCode from iTouching's work order, cleaned. Null when no job is running. */
  code: string | null;
  /** iTouching's own description. Only used when the catalogue has no match. */
  name: string | null;
  /** When the poll last saw this job. */
  seenAt: Date | null;
  /**
   * Whether iTouching has this job RUNNING, or has it as the next one in the
   * queue. A line in Line Preparation has no running job by definition, and the
   * product it is being set up for is still the answer to "what is on this line"
   * — as long as the card does not claim it is being made.
   */
  state: "running" | "next";
}

/**
 * A live job older than this is not a state, it is a leftover.
 *
 * The poll asks every five minutes and CLEARS the field when no job is running,
 * so a value that survived far longer means the poll stopped — and a stopped
 * poll must not keep a product on the card as if somebody had confirmed it.
 */
export const LIVE_JOB_STALE_AFTER_SECONDS = 30 * 60;

export interface LineSku {
  /** The catalogue code, or verbatim what the operator typed when there is none. */
  code: string;
  /** The product name, or the code again when the catalogue does not hold it. */
  name: string;
  /**
   * Units per hour, or null when there is no standard to pace against. ZERO IS
   * NULL HERE: 208 active SKUs carry target_per_hour = 0, and a zero standard
   * paces a line against nothing while looking like a number.
   */
  ratePerHour: number | null;
  /** True when nothing in `sku_products` matches — the name is unverified. */
  uncatalogued: boolean;
  /** How many OTHER products the line ran in the period. Products, not rows. */
  others: number;
  /**
   * Where the product came from. "logged" is a production row on this line, with
   * a quantity behind it; "itouch" is the live job, which names the product and
   * measures nothing. The card keeps them apart because they are not equally good
   * evidence, and only one of them can be scored.
   */
  source: "logged" | "itouch";
  /**
   * For a product that came from iTouching, whether it is running there or is
   * next up. Null for anything logged on the line, which is measured and needs
   * no such qualifier.
   */
  liveState: "running" | "next" | null;
}

export interface SkuCatalogue {
  byId: Map<string, SkuRow>;
  byCode: Map<string, SkuRow>;
}

const norm = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();
const key = (s: string | null | undefined) => norm(s).toLowerCase();

export function buildSkuCatalogue(rows: SkuRow[]): SkuCatalogue {
  const byId = new Map<string, SkuRow>();
  const byCode = new Map<string, SkuRow>();
  for (const r of rows) {
    byId.set(r.id, r);
    const k = key(r.code);
    // First writer wins, so a duplicated code resolves to the same row every
    // render rather than to whichever page of the paginated fetch arrived last.
    if (k && !byCode.has(k)) byCode.set(k, r);
  }
  return { byId, byCode };
}

/** The catalogue row behind an item: by link first, then by the code as text. */
export function resolveItemSku(item: LineSkuItem, catalogue: SkuCatalogue): SkuRow | null {
  if (item.sku_id) {
    const linked = catalogue.byId.get(item.sku_id);
    if (linked) return linked;
  }
  const k = key(item.sku_code_text);
  return (k ? catalogue.byCode.get(k) : undefined) ?? null;
}

export interface ItemSkuIdentity {
  /**
   * Stable grouping key. The catalogue row when the product resolves, so a row
   * linked by `sku_id` and a row carrying the same code as text land in the same
   * bucket; otherwise the typed text, so an unreconciled entry is still A ROW and
   * not a silent omission.
   */
  key: string;
  code: string;
  name: string;
  /** True when nothing in `sku_products` matches. The code is what was typed. */
  uncatalogued: boolean;
  /** The catalogue row itself, for whoever needs the standard or the category. */
  row: SkuRow | null;
}

/**
 * What identifies an item at all — the catalogue row's code when there is one,
 * otherwise the text the operator typed. Two rows for the same product count
 * once, whichever column each of them used to say so.
 *
 * It does NOT guess. "Critical whey vanilla 825" and "Criticql whey vanilla 825"
 * ran on Line 6 on consecutive days and stay two products until somebody
 * reconciles them: matching them here would invent production that no record
 * supports, and hide the typo from the person who can correct it.
 */
export function identifyItemSku(item: LineSkuItem, catalogue: SkuCatalogue): ItemSkuIdentity | null {
  const row = resolveItemSku(item, catalogue);
  if (row) {
    return { key: `sku:${row.id}`, code: row.code, name: productLabel(row.name) || row.code, uncatalogued: false, row };
  }
  const typed = norm(item.sku_code_text);
  if (!typed) return null;
  return { key: `txt:${key(typed)}`, code: typed, name: typed, uncatalogued: true, row: null };
}

/**
 * The product on the line now, or the one the shift was spent on.
 *
 * A line is defined by what is on it at this minute — iTouching's own board leads
 * with the product for that reason — so the running item wins: started and not
 * finished. Where nobody recorded the times, the item with the most made stands
 * in. That is the same question answered with worse evidence, and it is the
 * common case on this board: on 12/08 every line's last item was already closed.
 *
 * With NOTHING logged, iTouching's running job answers instead — see `LiveJob`.
 * It never outranks a production row: a row has a quantity behind it and can be
 * scored, and the live job cannot, so where both exist the row is the better
 * evidence and the only one the pace may be computed from.
 */
export function pickLineSku(
  items: LineSkuItem[],
  catalogue: SkuCatalogue,
  live?: { job: LiveJob | null | undefined; now: Date },
): LineSku | null {
  const identified = items
    .map((i) => ({ item: i, id: identifyItemSku(i, catalogue) }))
    .filter((x): x is { item: LineSkuItem; id: ItemSkuIdentity } => x.id !== null);
  if (!identified.length) return liveJobSku(live, catalogue);

  const chosen = identified.find((x) => x.item.started_at && !x.item.finished_at)
    ?? identified.find((x) => !x.item.finished_at)
    ?? [...identified].sort((a, b) => b.item.actual - a.item.actual)[0];

  const rate = chosen.id.row?.target_per_hour == null ? null : Number(chosen.id.row.target_per_hour);
  const others = new Set(identified.map((x) => x.id.key)).size - 1;

  return {
    code: chosen.id.code,
    name: chosen.id.name,
    // Zero is not a cadence. 208 active SKUs carry target_per_hour = 0.
    ratePerHour: rate && rate > 0 ? rate : null,
    uncatalogued: chosen.id.uncatalogued,
    others,
    source: "logged",
    liveState: null,
  };
}

/**
 * The live job as a product, or nothing.
 *
 * Resolved against the catalogue on purpose: iTouching sends a PartCode and its
 * own description, and the name the rest of this system uses is the catalogue's.
 * The standard comes with it — a line being set up for a product that has 720/h
 * has a standard, whether or not anybody has written the order down yet.
 *
 * `others` is 0 and stays 0: this is one job at one moment, not a period with a
 * count of products in it.
 */
function liveJobSku(live: { job: LiveJob | null | undefined; now: Date } | undefined, catalogue: SkuCatalogue): LineSku | null {
  const job = live?.job;
  if (!live || !job) return null;
  const code = norm(job.code);
  if (!code) return null;

  // Unconfirmed for half an hour is a stopped poll, not a running line.
  if (!job.seenAt) return null;
  const ageSeconds = Math.floor((live.now.getTime() - job.seenAt.getTime()) / 1000);
  if (ageSeconds > LIVE_JOB_STALE_AFTER_SECONDS) return null;

  const row = catalogue.byCode.get(key(code));
  const rate = row?.target_per_hour == null ? null : Number(row.target_per_hour);
  return {
    code: row?.code ?? code,
    name: row ? (productLabel(row.name) || row.code) : (norm(job.name) || code),
    ratePerHour: rate && rate > 0 ? rate : null,
    uncatalogued: !row,
    others: 0,
    source: "itouch",
    liveState: job.state,
  };
}
