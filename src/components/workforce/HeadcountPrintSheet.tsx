import { Fragment } from "react";
import type { PrintSheetColumn, PrintSheetLayout } from "@/lib/headcountSheet";

/**
 * The headcount on paper, in the shape of the company's own sheet.
 *
 * Nothing here is drawn on screen: `headcount-print-sheet` is `display: none` until the
 * print sheet in index.css turns it on and turns the board off. The board is for moving
 * people; this is for reading who is where from two metres away, which is what the
 * Excel sheet by the lines has always been for — yellow headings, the leader in grey on
 * the first row, a green Total under every column, Absence in red.
 *
 * Every colour and every rule lives in index.css under `@media print`, beside the other
 * print rules, because the global `.print-content table` rules have to be answered in
 * the same place they are made.
 */

/**
 * Columns across one band. The company's sheet has twelve and a landscape A4 holds
 * fourteen before a name stops fitting; past that the band wraps.
 */
const PER_ROW = 14;

/** A column is never wider than a twelfth of the sheet, however few there are. */
const widthOf = (columns: number) => `${(Math.min(1, columns / 12) * 100).toFixed(2)}%`;

/** A blank row under the longest column, as the sheet has — room to write a name in. */
const SPARE_ROWS = 1;

function Band({ columns, total }: { columns: PrintSheetColumn[]; total?: number }) {
  const rows: PrintSheetColumn[][] = [];
  for (let i = 0; i < columns.length; i += PER_ROW) rows.push(columns.slice(i, i + PER_ROW));

  return (
    <>
      {rows.map((cols, r) => {
        const depth = Math.max(0, ...cols.map((c) => c.names.length)) + SPARE_ROWS;
        // The purple cell sits in the last row of the bottom band, as it does on the sheet.
        const withTotal = total !== undefined && r === rows.length - 1;
        return (
          // Inline, and the one style here that is: the width is arithmetic on the data,
          // and the global print rule sets every table to 100% with `!important`.
          <table key={r} className="hps-band" ref={(el) => el?.style.setProperty("width", widthOf(cols.length + (withTotal ? 1 : 0)), "important")}>
            <thead>
              <tr>
                {cols.map((c) => <th key={c.label} className={`hps-head hps-${c.tone}`}>{c.label}</th>)}
                {withTotal && <th className="hps-head hps-total-staff">Total staff in Production</th>}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: depth }, (_, i) => (
                <tr key={i}>
                  {cols.map((c) => {
                    const n = c.names[i];
                    return (
                      <td key={c.label} className={n?.leader ? "hps-leader" : undefined}>
                        {n ? <>{n.name}{n.note && <span className="hps-note"> {n.note}</span>}</> : "\u00a0"}
                      </td>
                    );
                  })}
                  {withTotal && (i === 0
                    ? <td className="hps-total-staff-figure" rowSpan={depth + 2}>{total}</td>
                    : null)}
                </tr>
              ))}
              <tr>{cols.map((c) => <td key={c.label} className="hps-sum">Total</td>)}</tr>
              <tr>{cols.map((c) => <td key={c.label} className="hps-sum hps-sum-figure">{c.names.length}</td>)}</tr>
            </tbody>
          </table>
        );
      })}
    </>
  );
}

export function HeadcountPrintSheet({ title, layout }: { title: string; layout: PrintSheetLayout }) {
  return (
    <section className="headcount-print-sheet" aria-hidden="true">
      <div className="hps-title">{title}</div>
      <Fragment>
        <Band columns={layout.top} />
        <Band columns={layout.bottom} total={layout.totalStaff} />
      </Fragment>
    </section>
  );
}
