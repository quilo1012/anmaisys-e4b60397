import { format } from "date-fns";

export interface ReportPrintHeaderProps {
  /** Report title, e.g. "Analytics Report". */
  title: string;
  /** Human-readable period/date-range label, e.g. "01/07/2026 — 12/07/2026". */
  periodLabel: string;
  /** Optional shift label, e.g. "Day" / "Night" / "All". */
  shift?: string;
  /** Brand line (defaults to "Applied Nutrition"). */
  brand?: string;
  /** Optional extra className on the wrapper. */
  className?: string;
}

/**
 * Standardized header rendered at the top of a report's printable area.
 *
 * By default it is HIDDEN on screen and VISIBLE when printing / exported to PDF
 * (`hidden print:block`), so pages can drop it in without affecting the on-screen
 * layout. All labels are parameterized — no per-page text is hardcoded.
 */
export function ReportPrintHeader({
  title,
  periodLabel,
  shift,
  brand = "Applied Nutrition",
  className = "",
}: ReportPrintHeaderProps) {
  const generatedOn = format(new Date(), "dd/MM/yyyy HH:mm");

  return (
    <div
      className={`hidden print:block mb-4 pb-3 border-b-2 border-black ${className}`}
      role="banner"
      aria-label="Report header"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold uppercase tracking-wide">{title}</h1>
          <p className="text-xs text-muted-foreground print:text-gray-700">{brand}</p>
        </div>
        <div className="text-right text-xs">
          <p>
            <span className="font-medium">Period:</span> {periodLabel}
          </p>
          {shift && (
            <p>
              <span className="font-medium">Shift:</span> {shift}
            </p>
          )}
          <p className="text-muted-foreground print:text-gray-700">Generated: {generatedOn}</p>
        </div>
      </div>
    </div>
  );
}

export default ReportPrintHeader;
