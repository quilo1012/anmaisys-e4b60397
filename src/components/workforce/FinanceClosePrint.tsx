/**
 * The Finance Close as it goes on paper, and the dialog that chooses its columns.
 *
 * The sheet used to be the screen's table, printed. That made the screen and the paper
 * one thing, so a column could not leave the paper without leaving the screen. They
 * are two tables now, read off the same `CLOSE_COLUMNS`, the same rows and the same
 * `closeDisplayValues` the PDF prints with: the screen keeps every column whatever is
 * ticked, and the paper carries exactly what was ticked.
 */
import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { ClosePerson } from "@/lib/financeClose";
import {
  ALL_PRINT_KEYS, BAND_LABELS, CLOSE_COLUMNS, DEFAULT_PRINT_KEYS, MIN_PRINT_KEYS,
  closeBandSpans, closeDisplayValues, pickPrintColumns, printOrientation,
  type CloseBand, type CloseColumn,
} from "@/lib/financeCloseColumns";

/* ─── The choice, remembered per browser ─────────────────────────────────── */

const STORAGE_KEY = "finance-close.print-columns.v1";

/**
 * Which columns go on paper, kept in this browser between visits.
 *
 * Per viewer and nothing more: it changes no figure, so a lost choice (a private
 * window, cleared storage) only means the defaults come back.
 */
export function usePrintColumnKeys() {
  const [keys, setKeys] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (Array.isArray(saved) && saved.every((k) => typeof k === "string")) return saved;
    } catch { /* storage blocked: fall through to the defaults */ }
    return DEFAULT_PRINT_KEYS;
  });
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)); } catch { /* ignore */ }
  }, [keys]);
  return [keys, setKeys] as const;
}

/* ─── The printed register ───────────────────────────────────────────────── */

interface PrintTableProps {
  rows: ClosePerson[];
  columns: CloseColumn[];
  /** The line repeated at the top of every sheet: which close, period and filter. */
  caption: string;
  /** The line repeated at the foot of every sheet. */
  footer: string;
  className?: string;
}

/**
 * The register, one column per ticked column, in the close's own order.
 *
 * Built from the same column definitions and display rule as the PDF, so the sheet
 * from the printer and the PDF handed over say the same thing in the same words.
 * Widths are proportions of the ticked columns only (`--mm-total`), so a narrower
 * selection spreads across the page rather than leaving a blank strip down one side.
 */
export function ClosePrintTable({ rows, columns, caption, footer, className }: PrintTableProps) {
  const mmTotal = columns.reduce((s, c) => s + c.mm, 0);
  const cell = (c: CloseColumn, i: number) => [
    c.align === "right" ? "text-right" : "",
    i > 0 && columns[i - 1].band !== c.band ? "border-l" : "",
  ].filter(Boolean).join(" ") || undefined;
  return (
    <table className={className} data-print-columns={columns.map((c) => c.key).join(",")}>
      <colgroup>
        {columns.map((c) => (
          <col
            key={c.key}
            data-mm=""
            style={{ "--mm": c.mm, "--mm-total": mmTotal } as React.CSSProperties}
          />
        ))}
      </colgroup>
      <thead>
        {/* Repeated by the browser on every sheet: what page seven is a page of. */}
        <tr className="print-caption-row">
          <th colSpan={columns.length} className="print-caption">{caption}</th>
        </tr>
        <tr>
          {closeBandSpans(columns).map((b, i) => (
            <th
              key={`${b.band}-${i}`}
              colSpan={b.span}
              className={b.label ? "close-band border-l text-center text-2xs font-bold uppercase tracking-widest" : undefined}
            >
              {b.label}
            </th>
          ))}
        </tr>
        <tr>
          {columns.map((c, i) => <th key={c.key} className={cell(c, i)}>{c.header}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          // Keyed on the record's id: two people with one name are two rows.
          <tr key={r.employeeId} data-employee-id={r.employeeId}>
            {closeDisplayValues(r, columns).map((v, i) => (
              <td key={columns[i].key} className={cell(columns[i], i)}>{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot className="print-edge">
        <tr><td colSpan={columns.length}>{footer}</td></tr>
      </tfoot>
    </table>
  );
}

/* ─── Print settings ─────────────────────────────────────────────────────── */

interface SettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys: string[];
  onKeysChange: (keys: string[]) => void;
  rows: ClosePerson[];
  caption: string;
  footer: string;
  onPrint: () => void;
}

/** The bands in column order, each with its columns, for the tick list. */
const GROUPS: { band: CloseBand; label: string; columns: CloseColumn[] }[] = closeBandSpans().map((b) => ({
  band: b.band,
  label: BAND_LABELS[b.band] ?? "Employee",
  columns: CLOSE_COLUMNS.filter((c) => c.band === b.band),
}));

/** How many people the preview shows: enough to read the layout, not the whole close. */
const PREVIEW_ROWS = 8;

export function ClosePrintSettings({
  open, onOpenChange, keys, onKeysChange, rows, caption, footer, onPrint,
}: SettingsProps) {
  const columns = useMemo(() => pickPrintColumns(keys), [keys]);
  const chosen = new Set(columns.map((c) => c.key));
  const orientation = printOrientation(columns);
  const toggle = (key: string) => onKeysChange(
    chosen.has(key) ? columns.map((c) => c.key).filter((k) => k !== key) : [...columns.map((c) => c.key), key],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto print:hidden">
        <DialogHeader>
          <DialogTitle>Print settings</DialogTitle>
          <DialogDescription>
            Choose the columns that go on paper. The table on screen keeps every column.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => onKeysChange(ALL_PRINT_KEYS)}>Select all</Button>
          <Button size="sm" variant="outline" onClick={() => onKeysChange(MIN_PRINT_KEYS)}>Clear all</Button>
          <Button size="sm" variant="ghost" onClick={() => onKeysChange(DEFAULT_PRINT_KEYS)}>Defaults</Button>
          <span className="ml-auto text-xs text-muted-foreground" data-testid="print-summary">
            {columns.length} of {CLOSE_COLUMNS.length} columns · {rows.length}{" "}
            {rows.length === 1 ? "person" : "people"} · A4 {orientation}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {GROUPS.map((g) => (
            <fieldset key={g.band} className="rounded-md border p-2">
              <legend className="px-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {g.label}
              </legend>
              {g.columns.map((c) => (
                <Label
                  key={c.key}
                  className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm font-normal hover:bg-muted"
                  title={c.alwaysPrinted ? "Always printed — a row of figures with no name cannot be paid from" : undefined}
                >
                  <Checkbox
                    checked={chosen.has(c.key)}
                    disabled={c.alwaysPrinted}
                    onCheckedChange={() => toggle(c.key)}
                    aria-label={`Print ${c.header}`}
                  />
                  {c.header}
                  {c.alwaysPrinted && <span className="text-2xs text-muted-foreground">always</span>}
                </Label>
              ))}
            </fieldset>
          ))}
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Preview · first {Math.min(PREVIEW_ROWS, rows.length)} of {rows.length} rows, as they print
          </p>
          {/* Same component as the sheet, so the preview cannot disagree with it. */}
          <div className={`close-preview close-preview-${orientation} overflow-x-auto rounded-md border bg-white p-3 text-black`}>
            {rows.length === 0 ? (
              <p className="p-4 text-center text-sm">Nobody to print with the current filters.</p>
            ) : (
              <ClosePrintTable
                rows={rows.slice(0, PREVIEW_ROWS)}
                columns={columns}
                caption={caption}
                footer={footer}
                className="close-preview-table"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={onPrint} disabled={rows.length === 0}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
