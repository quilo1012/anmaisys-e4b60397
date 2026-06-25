// Parser for Intouch "Work To List" CSV exports.
// The file is a flat CSV with section markers like:
//   Machine: Filler Line 1
//   Start Time,End Time,Order No.,Part Code,Order Quantity,Balance,...
//   06:00,14:00,WO-12345,CARBPM-B1,520,520,...
// We group by Machine name, strip -B\d+ batch suffixes from Part Code,
// remove [HS CODE:...] from descriptions and aggregate Order Quantity per SKU.

export type WorkToListRow = { sku_code: string; qty: number; description?: string };
export type WorkToListSection = { line: string; items: WorkToListRow[] };

function splitCsv(line: string): string[] {
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

function cleanCode(raw: string): string {
  return raw.trim().replace(/-B\d+$/i, "").toUpperCase();
}

function cleanDesc(raw: string): string {
  return raw.replace(/\[HS CODE:[^\]]*\]/gi, "").trim();
}

export function parseIntouchWorkToList(text: string): WorkToListSection[] {
  const lines = text.split(/\r?\n/);
  const sections: WorkToListSection[] = [];
  let current: WorkToListSection | null = null;
  let header: string[] | null = null;
  let idxCode = -1, idxQty = -1, idxDesc = -1;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const cols = splitCsv(line);
    const lower = cols.map((c) => c.toLowerCase());

    // Section marker: accept Machine / Line / Production Line / Asset / Area / Resource
    // Either inline ("Machine: Filler Line 1") or as its own cell with the name in the
    // next non-empty cell (xlsx-converted rows often look like: "Machine:","Filler Line 1").
    const markerRe = /^(machine|line|production\s*line|asset|area|resource|work\s*centre|work\s*center)\s*:?\s*$/;
    const inlineRe = /^(machine|line|production\s*line|asset|area|resource|work\s*centre|work\s*center)\s*:\s*(.+)$/i;
    const markerIdx = lower.findIndex((c) => markerRe.test(c) || inlineRe.test(c));
    if (markerIdx !== -1) {
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
        name = name.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ");
        current = { line: name, items: [] };
        sections.push(current);
        header = null;
        continue;
      }
    }

    // Header row — if found before any section marker, start a default section
    // so files without explicit machine markers still import.
    if (!header && lower.some((c) => c.includes("part code") || c === "code" || c.includes("product code") || c.includes("item code"))
                 && lower.some((c) => c.includes("order quantity") || c.includes("quantity") || c.includes("qty"))) {
      if (!current) {
        current = { line: "Imported Plan", items: [] };
        sections.push(current);
      }
      header = cols;
      idxCode = lower.findIndex((c) => c.includes("part code") || c === "code" || c.includes("product code") || c.includes("item code"));
      idxQty = lower.findIndex((c) => c.includes("order quantity") || c.includes("quantity") || c.includes("qty"));
      idxDesc = lower.findIndex((c) => c.includes("description") || c.includes("product name") || c.includes("item name"));
      continue;
    }

    if (!current || !header || idxCode === -1 || idxQty === -1) continue;
    const code = cleanCode(cols[idxCode] ?? "");
    const qty = Number(String(cols[idxQty] ?? "0").replace(/[, ]/g, ""));
    if (!code || !qty || isNaN(qty)) continue;
    current.items.push({
      sku_code: code,
      qty,
      description: idxDesc !== -1 ? cleanDesc(cols[idxDesc] ?? "") : undefined,
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
