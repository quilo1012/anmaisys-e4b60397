/**
 * Reads the `Actions` sheet of the workbook `generateQualityReportExcel` writes and
 * turns each row back into what the log form saves — through the SAME
 * `buildQualityActionPayload`, so an import cannot write a shape the form does not
 * (in particular it never sends `status`).
 *
 * `Product` is ignored on purpose: it is derived from `SKU` in the export, not data.
 */
import { buildQualityActionPayload, type QualityActionFormInput } from "@/lib/qualityActionPayload";
import { QUALITY_SEVERITIES, VALIDATION_STATES, SAFETY_KINDS } from "@/lib/qualityConstants";
import { resolveLeaderId } from "@/lib/leaderNameMatch";
import type { Database } from "@/integrations/supabase/types";

type SafetyKindEnum = Database["public"]["Enums"]["safety_kind"];

export type QualityImportPayload = Omit<ReturnType<typeof buildQualityActionPayload>, "safety_kind"> & {
  safety_kind: SafetyKindEnum | null;
};

export interface QualityImportRow {
  /** 1-based row number on the sheet (header is row 1). */
  rowNo: number;
  form: QualityActionFormInput;
  payload: QualityImportPayload | null;
  /** Empty when the row is valid. */
  errors: string[];
  /** Non-blocking notes shown in the preview. */
  warnings: string[];
}

export interface QualityImportResult {
  rows: QualityImportRow[];
  valid: number;
  rejected: number;
}

const DOMAINS = ["quality", "safety"] as const;

const fold = (s: unknown) => String(s ?? "").trim().toLowerCase();

function cell(row: Record<string, unknown>, aliases: string[]): string {
  for (const key of Object.keys(row)) {
    if (aliases.includes(fold(key))) return String(row[key] ?? "").trim();
  }
  return "";
}

/** "High" → "high". Accepts the code itself too. Unknown → null with a reason. */
export function severityFromLabel(s: string): { value: string | null; error?: string } {
  const k = fold(s);
  if (!k || k === "—" || k === "-") return { value: null };
  const hit = QUALITY_SEVERITIES.find((x) => fold(x.label) === k || x.value === k);
  return hit ? { value: hit.value } : { value: null, error: `Unknown severity "${s}"` };
}

/**
 * Preview-only: imports never write `validation_status` (Quality rules on it in the
 * app), but the sheet's Validation column is still read so the user sees it in the
 * preview and gets warned when a verdict will be dropped.
 */
export function validationFromLabel(s: string): { value: string; label: string; warning?: string } {
  const raw = String(s ?? "").trim();
  const k = fold(s);
  if (!k) return { value: "open", label: "" };
  if (k === "awaiting verdict") return { value: "open", label: raw };
  const hit = VALIDATION_STATES.find((x) => fold(x.label) === k || x.value === k);
  return hit
    ? { value: hit.value, label: raw }
    : { value: "open", label: raw, warning: `Unknown validation "${raw}"` };
}

/** dd/mm/yyyy (what the export writes), ISO, or anything Date parses. */
export function parseSheetDate(s: string): string | null {
  if (!s) return null;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]); const m = Number(dmy[2]); let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d, 12, 0, 0);
    if (!isNaN(dt.getTime()) && dt.getMonth() === m - 1) return dt.toISOString();
    return null;
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function parseQualityImport(
  sheetRows: Record<string, unknown>[],
  leaders: ReadonlyArray<{ id: string; name: string }>,
): QualityImportResult {
  const rows: QualityImportRow[] = [];
  sheetRows.forEach((r, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNo = i + 2;

    const dateStr = cell(r, ["date", "data"]);
    const sev = severityFromLabel(cell(r, ["severity", "severidade"]));
    if (sev.error) errors.push(sev.error);
    // Validation verdicts are never imported — Quality rules on them in the app.
    const val = validationFromLabel(cell(r, ["validation", "validação", "validacao"]));
    if (val.warning) warnings.push(val.warning);
    else if (val.value !== "open") {
      warnings.push(`Validation "${val.label}" ignored — Quality rules on this in the app`);
    }

    const kindStr = cell(r, ["kind", "safety kind", "tipo"]);
    let domain: "quality" | "safety" = "quality";
    let safety_kind = "";
    if (kindStr) {
      const k = fold(kindStr);
      const kind = SAFETY_KINDS.find((x) => fold(x.label) === k || x.value === k);
      if (kind) { domain = "safety"; safety_kind = kind.value; }
      else errors.push(`Unknown kind "${kindStr}"`);
    }
    const domainStr = fold(cell(r, ["domain", "domínio", "dominio"]));
    if (domainStr) {
      if ((DOMAINS as readonly string[]).includes(domainStr)) domain = domainStr as "quality" | "safety";
      else errors.push(`Unknown domain "${domainStr}"`);
    }
    if (domain === "safety" && !safety_kind) errors.push("Safety row needs a Kind");

    const leader_name = cell(r, ["leader", "líder", "lider"]);
    const leader_id = resolveLeaderId(leader_name, leaders);
    if (leader_name && !leader_id) warnings.push("Leader not matched — saved by name only");

    const labelsStr = cell(r, ["labels", "label", "etiquetas"]);
    const form: QualityActionFormInput = {
      action_no: cell(r, ["action #", "action no", "action", "#"]),
      line: cell(r, ["line", "linha"]),
      shift: cell(r, ["shift", "turno"]).toUpperCase(),
      leader_id: leader_id ?? "",
      leader_name,
      date: dateStr,
      sku: cell(r, ["sku"]),
      batch: cell(r, ["batch", "batch code", "lote"]),
      department: cell(r, ["department", "dept", "departamento"]),
      severity: sev.value ?? "",
      labels: labelsStr ? labelsStr.split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [],
      description: cell(r, ["notes", "note", "description", "descrição", "descricao"]),
      domain,
      safety_kind,
      original_leader_id: null,
    };

    const empty = !form.line && !form.description && !form.action_no && !form.sku && !form.leader_name && form.labels.length === 0;
    if (empty) return; // a blank trailing row, not data

    const recordedAt = parseSheetDate(dateStr);
    if (!recordedAt) errors.push(dateStr ? `Unreadable date "${dateStr}"` : "Missing date");
    if (domain === "safety" && !form.line) errors.push("Safety row needs a Line");
    if (domain === "safety" && !form.leader_name) errors.push("Safety row needs a Leader");

    const matched = leader_id ? leaders.find((l) => l.id === leader_id)?.name ?? null : null;
    const payload = errors.length === 0 && recordedAt
      ? {
          ...buildQualityActionPayload(form, matched, recordedAt),
          // Validated above against SAFETY_KINDS, which mirrors the DB enum.
          safety_kind: (domain === "safety" ? safety_kind : null) as SafetyKindEnum | null,
        }
      : null;
    rows.push({ rowNo, form, payload, errors, warnings });
  });
  return { rows, valid: rows.filter((r) => r.payload).length, rejected: rows.filter((r) => !r.payload).length };
}
