/**
 * What job iTouching has on a machine — the answer this system never stored.
 *
 * WHY THE POLL HAS TO HOLD THIS. On 12/08 at 11:04 UTC Line 2 sat in "Line
 * Preparation" with zero `production_items`: the 1.832 that had been on its card
 * were Line 3's production logged on the wrong line — identical batch, identical
 * quantity — and were deleted. So the board could not name the product the line
 * was being set up for, while the iTouching screen beside it could. Three places
 * could have held that answer and none did: `production_orders` has been empty
 * since it was created, `intouch_machine_map` had no product column at all, and
 * `rag_weekly_entries` carries a plan quantity with no SKU next to it.
 *
 * NOT AN ORDER. Nothing is measured against what this returns and nothing is
 * scored from it — the pace still needs a production row with a quantity behind
 * it. It answers "what is on the line" for a line nobody has written down yet,
 * and the card marks it as iTouching's word rather than ours.
 *
 * RUNNING, OR THE NEXT ONE, AND IT SAYS WHICH. A line in Line Preparation has no
 * running job by definition; the job it is being set up for is the head of the
 * queue. Calling that "running" would be a lie and omitting it leaves the board
 * knowing less than the screen two metres away, so the state travels with it.
 *
 * The field names are the ones `intouch-list-scheduled-jobs` already reads off
 * this endpoint — WorksOrders per machine, PartCode, Description, OrderQty,
 * Status/IsRunning — not a guess about a payload nobody has seen.
 */

export interface RunningJob {
  /** PartCode, normalised the way the importer normalises it. Batch suffix kept. */
  code: string;
  /** iTouching's description, or the code when it sends none. */
  name: string;
  /** Order quantity, or null when the payload carried none. Never invented. */
  qty: number | null;
  /** Whether iTouching says this job is running, or that it is the next one up. */
  state: "running" | "next";
}

const CODE_KEYS = [
  "PartCode", "Part Code", "ProductCode", "SkuCode", "SKUCode", "SKU",
  "ItemCode", "ItemNo", "StockCode", "JobProductCode", "ProductID", "ProductId", "Code",
];
const NAME_KEYS = [
  "Description", "LongDescription", "ProductDescription", "PartDescription",
  "MaterialDescription", "ShortDescription", "Name", "ProductName", "ItemName",
];
const QTY_KEYS = [
  "OrderQty", "Order Qty", "JobOrderQuantity", "Job Order Quantity", "OrderQuantity",
  "RequiredQuantity", "RequiredQty", "Quantity", "Qty", "PlannedQuantity", "PlanQty",
  "ScheduledQty", "TargetQty",
];
const SEQ_KEYS = [
  "Sequence", "Seq", "QueuePosition", "Position", "SequenceNumber", "JobOrder",
  "PriorityOrder", "RowNumber",
];
const STATUS_KEYS = ["Status", "JobStatus", "State", "RunStatus", "CurrentStatus"];

/** Case-insensitive lookup over a list of candidate key names. */
function pick(o: unknown, keys: string[]): unknown {
  if (!o || typeof o !== "object") return undefined;
  const obj = o as Record<string, unknown>;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    const v = real ? obj[real] : undefined;
    if (v != null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function walk(v: unknown, cb: (o: Record<string, unknown>) => void) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) { for (const x of v) walk(x, cb); return; }
  cb(v as Record<string, unknown>);
  for (const x of Object.values(v)) walk(x, cb);
}

/** Same normalisation the importer applies, so both sides match one catalogue. */
const cleanCode = (v: unknown) => String(v ?? "").trim().replace(/^['"]+|['"]+$/g, "").trim().toUpperCase();

function readQty(o: unknown): number | null {
  const raw = pick(o, QTY_KEYS);
  if (raw == null) return null;
  let c = String(raw).replace(/[^\d,.-]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(c)) c = c.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(c)) c = c.replace(/,/g, "");
  else if (c.includes(",") && !c.includes(".")) c = c.replace(",", ".");
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

function isRunning(o: unknown): boolean {
  const raw = String(pick(o, STATUS_KEYS) ?? "").toLowerCase();
  if (/run|active|in.?progress|started/.test(raw)) return true;
  const flag = pick(o, ["IsRunning", "Running", "IsActive"]);
  return flag === true || String(flag).toLowerCase() === "true";
}

/** A finished job is not what the line is doing, and must not head the queue. */
function isDone(o: unknown): boolean {
  const raw = String(pick(o, STATUS_KEYS) ?? "").toLowerCase();
  return /complet|finish|closed|done|cancel/.test(raw);
}

function readSeq(o: unknown, fallback: number): number {
  const n = Number(pick(o, SEQ_KEYS));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * The job on the machine, from one machine's `getscheduledjobs` response.
 *
 * Returns null for anything that does not name a product: an empty queue, a
 * payload with no usable PartCode, an error string. Null is what the poll writes
 * to the columns, so "no job" and "the answer was unusable" both land as "the
 * board has nothing to show" rather than as a stale product on a card.
 */
export function pickRunningJob(raw: unknown): RunningJob | null {
  type Candidate = RunningJob & { seq: number; order: number };
  const found: Candidate[] = [];
  let order = 0;

  const consider = (o: unknown) => {
    const code = cleanCode(pick(o, CODE_KEYS));
    // Two characters is the shortest real code in this catalogue; one character
    // is a column header or a flag that happened to match a key name.
    if (code.length < 2) return;
    if (isDone(o)) return;
    const name = String(pick(o, NAME_KEYS) ?? code).trim() || code;
    found.push({
      code,
      name,
      qty: readQty(o),
      state: isRunning(o) ? "running" : "next",
      seq: readSeq(o, Number.MAX_SAFE_INTEGER),
      order: order++,
    });
  };

  // Work orders nested per machine — the shape this deployment answers with.
  walk(raw, (obj) => {
    const wos = obj.WorksOrders ?? obj.WorkOrders ?? obj.worksOrders;
    if (!Array.isArray(wos)) return;
    for (const wo of wos) consider(wo);
  });

  // Flat rows, for a deployment that does not nest them.
  if (!found.length) walk(raw, (obj) => consider(obj));
  if (!found.length) return null;

  const running = found.filter((j) => j.state === "running");
  const pool = running.length ? running : found;
  // Lowest sequence wins; where iTouching numbered nothing, the order it sent
  // them in is the queue it means.
  pool.sort((a, b) => a.seq - b.seq || a.order - b.order);
  const { code, name, qty, state } = pool[0];
  return { code, name, qty, state };
}
