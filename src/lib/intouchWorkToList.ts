// Parser for Intouch "Work To List" CSV exports.
// The file is a flat CSV with section markers like:
//   Machine: Filler Line 1
//   Start Time,End Time,Order No.,Part Code,Order Quantity,Balance,...
//   06:00,14:00,WO-12345,CARBPM-B1,520,520,...
// We group by Machine name, strip -B\d+ batch suffixes from Part Code,
// remove [HS CODE:...] from descriptions and aggregate Order Quantity per SKU.

export type WorkToListRow = { sku_code: string; qty: number; description?: string; status?: "Running" | "Scheduled"; seq?: number };
export type WorkToListSection = { line: string; items: WorkToListRow[] };

export function splitIntouchCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur); cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseIntouchCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => splitIntouchCsvLine(line).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

function cleanCode(raw: string): string {
  return raw.trim().replace(/^['"]+|['"]+$/g, "").replace(/-B\d+$/i, "").toUpperCase();
}

function cleanDesc(raw: string): string {
  return raw.replace(/\[HS CODE:[^\]]*\]/gi, "").trim();
}

function norm(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function numberFromCell(raw: string): number {
  const cleaned = String(raw ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(/\s/g, "");
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function isCodeHeader(cell: string): boolean {
  const n = norm(cell);
  return [
    "partcode", "productcode", "itemcode", "stockcode", "skucode", "sku", "code",
    "material", "materialcode", "fgcode", "fgitem", "itemno", "itemnumber", "product",
    "productid", "article", "articleno", "finishedgood", "finishedgoods",
  ].some((alias) => n === alias || n.includes(alias));
}

function isQtyHeader(cell: string): boolean {
  const n = norm(cell);
  return [
    "orderquantity", "orderqty", "ordqty", "quantity", "qty", "plannedqty", "planqty",
    "targetqty", "targetquantity", "requiredqty", "reqqty", "demand", "balance", "units",
    "totalqty", "scheduledqty", "productionqty",
  ].some((alias) => n === alias || n.includes(alias));
}

function isDescHeader(cell: string): boolean {
  const n = norm(cell);
  return ["description", "productname", "itemname", "name", "desc", "partdescription", "materialdescription"].some(
    (alias) => n === alias || n.includes(alias),
  );
}

function isLineHeader(cell: string): boolean {
  const n = norm(cell);
  return [
    "machine", "machinename", "line", "linename", "productionline", "asset", "area", "resource",
    "workcentre", "workcenter", "workstation", "linha", "equipment", "plantline", "filler",
  ].some((alias) => n === alias || n.includes(alias));
}

function getLineNameFromRow(cols: string[]): string {
  const markerLabels = [
    "machine", "line", "productionline", "asset", "area", "resource", "workcentre", "workcenter",
    "workcentRE", "workstation", "linha", "equipment", "plantline",
  ].map(norm);
  for (let i = 0; i < cols.length; i++) {
    const cell = cols[i]?.trim() ?? "";
    if (!cell) continue;
    const inline = cell.match(/^(machine|line|production\s*line|asset|area|resource|work\s*centre|work\s*center|workstation|linha|equipment|plant\s*line)\s*[:=-]\s*(.+)$/i);
    if (inline?.[2]?.trim()) return inline[2].trim();
    const normalized = norm(cell);
    if (markerLabels.includes(normalized)) {
      const next = cols.slice(i + 1).find((c) => c?.trim());
      if (next) return next.trim();
    }
  }
  const descriptive = cols.find((cell) => /\b(line|filler|depal|pallet|mixer|robot|machine|can|glass|pet)\b/i.test(cell) && !isCodeHeader(cell));
  return descriptive?.trim() ?? "";
}

function looksLikeSku(value: string): boolean {
  const v = cleanCode(value);
  if (v.length < 3 || v.length > 40) return false;
  if (/^(WO|ORDER|ORD|LINE|MACHINE|SHIFT|DATE|START|END|TIME)\b/i.test(v)) return false;
  if (/^\d+$/.test(v)) return false;
  if (/^\d{1,2}[:/]\d{1,2}/.test(v)) return false;
  return /[A-Z]/.test(v) && /[A-Z0-9]/.test(v) && /^[A-Z0-9._/-]+$/.test(v);
}

function findHeaderIndexes(cols: string[]) {
  const idxCode = cols.findIndex(isCodeHeader);
  const idxQty = cols.findIndex(isQtyHeader);
  const idxDesc = cols.findIndex(isDescHeader);
  const idxLine = cols.findIndex(isLineHeader);
  return { idxCode, idxQty, idxDesc, idxLine, found: idxCode !== -1 && idxQty !== -1 };
}

function ensureSection(sections: WorkToListSection[], line: string): WorkToListSection {
  const cleanLine = (line || "Imported Plan").replace(/\s*[-–—]\s*/g, " ").replace(/\s+/g, " ").trim() || "Imported Plan";
  let section = sections.find((s) => norm(s.line) === norm(cleanLine));
  if (!section) {
    section = { line: cleanLine, items: [] };
    sections.push(section);
  }
  return section;
}

export function parseIntouchWorkToList(text: string): WorkToListSection[] {
  const rows = parseIntouchCsvRows(text);
  const sections: WorkToListSection[] = [];
  let current: WorkToListSection | null = null;
  let header: string[] | null = null;
  let idxCode = -1, idxQty = -1, idxDesc = -1, idxLine = -1;

  for (const cols of rows) {
    const lower = cols.map((c) => c.toLowerCase());

    // Section marker: accept Machine / Line / Production Line / Asset / Area / Resource
    // Either inline ("Machine: Filler Line 1") or as its own cell with the name in the
    // next non-empty cell (xlsx-converted rows often look like: "Machine:","Filler Line 1").
    const markerRe = /^(machine|line|production\s*line|asset|area|resource|work\s*centre|work\s*center|workstation|linha|equipment|plant\s*line)\s*:?\s*$/;
    const inlineRe = /^(machine|line|production\s*line|asset|area|resource|work\s*centre|work\s*center|workstation|linha|equipment|plant\s*line)\s*[:=-]\s*(.+)$/i;
    const markerIdx = lower.findIndex((c) => markerRe.test(c) || inlineRe.test(c));
    const possibleHeader = findHeaderIndexes(cols);
    if (markerIdx !== -1 && !possibleHeader.found) {
      let name = "";
      const inline = cols[markerIdx].match(inlineRe);
      if (inline && inline[2].trim()) {
        name = inline[2].trim();
      } else {
        for (let i = markerIdx + 1; i < cols.length; i++) {
          if (cols[i] && cols[i].trim()) { name = cols[i].trim(); break; }
        }
      }
      if (name) {
        current = ensureSection(sections, name);
        header = null;
        continue;
      }
    }

    // Header row — if found before any section marker, start a default section
    // so files without explicit machine markers still import.
    const headerIndexes = findHeaderIndexes(cols);
    if (headerIndexes.found) {
      if (!current) {
        current = ensureSection(sections, "Imported Plan");
      }
      header = cols;
      idxCode = headerIndexes.idxCode;
      idxQty = headerIndexes.idxQty;
      idxDesc = headerIndexes.idxDesc;
      idxLine = headerIndexes.idxLine;
      continue;
    }

    if (header && idxCode !== -1 && idxQty !== -1) {
      // When the header declares a line/machine column, trust the cell value as the
      // section name (don't filter it through keyword heuristics — that drops valid
      // values like "Filler Line 2", "L2", numeric ids, etc.). Fall back to the
      // previous section only when the cell is blank (merged xlsx cells).
      let rowLine = "";
      if (idxLine !== -1) {
        const raw = (cols[idxLine] ?? "").trim();
        rowLine = raw || (current?.line ?? "");
      }
      const section = rowLine ? ensureSection(sections, rowLine) : (current ?? ensureSection(sections, "Imported Plan"));
      current = section;
      const code = cleanCode(cols[idxCode] ?? "");
      const qty = numberFromCell(cols[idxQty] ?? "0");
      if (!code || !qty || isNaN(qty)) continue;
      section.items.push({
        sku_code: code,
        qty,
        description: idxDesc !== -1 ? cleanDesc(cols[idxDesc] ?? "") : undefined,
      });
      continue;
    }

    // Last-resort parser for iTouching variants with no obvious headers:
    // detect a SKU-like token and the nearest numeric quantity on the same row.
    const lineName = getLineNameFromRow(cols);
    if (lineName && !looksLikeSku(lineName)) current = ensureSection(sections, lineName);
    const codeIdx = cols.findIndex(looksLikeSku);
    if (codeIdx === -1) continue;
    const qtyCandidates = cols
      .map((cell, index) => ({ index, qty: numberFromCell(cell) }))
      .filter((x) => x.index !== codeIdx && x.qty > 0 && Number.isFinite(x.qty));
    const preferred = qtyCandidates.find((x) => x.index > codeIdx) ?? qtyCandidates[0];
    if (!preferred) continue;
    const section = current ?? ensureSection(sections, lineName || "Imported Plan");
    const description = cols.find((cell, index) => (
      index !== codeIdx
      && index !== preferred.index
      && cell.trim() !== section.line
      && cell.length > 3
      && /[a-z]/i.test(cell)
    ));
    section.items.push({
      sku_code: cleanCode(cols[codeIdx]),
      qty: preferred.qty,
      description,
    });
  }

  // Aggregate by sku_code within each section
  for (const s of sections) {
    const agg = new Map<string, WorkToListRow>();
    for (const it of s.items) {
      const ex = agg.get(it.sku_code);
      if (ex) ex.qty += it.qty;
      else agg.set(it.sku_code, { ...it });
    }
    s.items = Array.from(agg.values());
  }
  return sections.filter((s) => s.items.length > 0);
}

// Find the section whose line name matches the selected line (loose match).
export function findSectionForLine(sections: WorkToListSection[], line: string): WorkToListSection | null {
  if (!line) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const target = norm(line);
  return sections.find((s) => norm(s.line) === target)
      ?? sections.find((s) => norm(s.line).includes(target) || target.includes(norm(s.line)))
      ?? null;
}
