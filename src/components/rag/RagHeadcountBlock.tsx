import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Users, RefreshCw } from "lucide-react";
import { useRagWeekHeadcount } from "@/hooks/useRagWeekHeadcount";
import { headcountAreaLabel, headcountAreas, type HeadcountDayShift } from "@/lib/ragHeadcount";

/**
 * Headcount for the week, beside the week's volumes.
 *
 * Its own block rather than rows inside the grid: the grid is one row per figure and
 * one column per line, and staffing is neither — it is per area, and the areas the
 * headcount sheet names are not the lines the board plans. Planned staff and actual
 * headcount stand next to each other, per day and shift, so a week where the plan was
 * missed can be read against the people who were there to make it.
 *
 * Nothing is loaded until asked for: the reader sleeps between uses.
 */
export function RagHeadcountBlock({ weekDates }: { weekDates: Date[] }) {
  const [open, setOpen] = useState(false);
  const dates = useMemo(() => weekDates.map((d) => format(d, "yyyy-MM-dd")), [weekDates]);
  const { data, isFetching, isError, error, refetch } = useRagWeekHeadcount(dates, open);

  const days = useMemo(() => [...(data?.byKey.values() ?? [])], [data]);
  const { production, support } = useMemo(() => headcountAreas(days), [days]);

  const cell = (ds: string, shift: "day" | "night"): HeadcountDayShift | undefined =>
    data?.byKey.get(`${ds}|${shift}`);

  const dash = <span className="text-muted-foreground/40">—</span>;
  const n = (v: number | undefined) => (v ? v.toLocaleString() : v === 0 ? "0" : dash);

  const weekSum = (pick: (d: HeadcountDayShift) => number, shift?: "day" | "night") => {
    let total = 0;
    for (const ds of dates) {
      for (const s of shift ? [shift] : (["day", "night"] as const)) {
        const c = cell(ds, s);
        if (c) total += pick(c);
      }
    }
    return total;
  };

  const rows: { key: string; label: string; pick: (d: HeadcountDayShift) => number; bold?: boolean; tone?: string }[] = [
    ...production.map((a) => ({
      key: `p:${a}`,
      label: headcountAreaLabel(a),
      pick: (d: HeadcountDayShift) => d.production[a] ?? 0,
    })),
    { key: "prod", label: "Production staff", pick: (d) => d.productionStaff, bold: true },
    ...support.map((a) => ({
      key: `s:${a}`,
      label: headcountAreaLabel(a),
      pick: (d: HeadcountDayShift) => d.support[a] ?? 0,
    })),
    { key: "sup", label: "Support staff", pick: (d) => d.supportStaff, bold: true },
    { key: "planned", label: "Planned staff", pick: (d) => d.planned, bold: true },
    { key: "absence", label: "Absence", pick: (d) => d.absence, tone: "text-warning-strong" },
    { key: "holidays", label: "Holidays", pick: (d) => d.holidays, tone: "text-warning-strong" },
    { key: "actual", label: "Actual headcount", pick: (d) => d.actual, bold: true },
  ];

  const source = days.find((d) => d.sourceFile || d.sheet);

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.08em] text-foreground">
          <Users className="h-4 w-4" /> Headcount
        </h3>
        {!open ? (
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
            Load from SharePoint
          </Button>
        ) : (
          <>
            <Button
              variant="outline" size="sm" className="h-7 px-2 text-xs"
              disabled={isFetching}
              onClick={() => refetch()}
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Reading the sheet…" : "Refresh"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>
              Hide
            </Button>
          </>
        )}
      </div>

      {!open && (
        <p className="text-xs text-muted-foreground">
          Planned staff and actual headcount for this week, from the SharePoint headcount
          sheet. It is read only when you ask for it — the reader can take a minute to wake up.
        </p>
      )}

      {open && isError && (
        <p className="mb-2 text-xs text-destructive">
          The headcount sheet could not be read — {String((error as Error)?.message ?? "no answer")}. The rest of
          the board is unaffected.
        </p>
      )}

      {open && !isError && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="sticky left-0 z-10 min-w-[150px] bg-muted/40 p-1 text-left font-display font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Area
                </th>
                {weekDates.map((d) => (
                  <th key={`h-${format(d, "yyyy-MM-dd")}`} colSpan={2} className="border-l p-1 text-center font-display font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {format(d, "EEE dd")}
                  </th>
                ))}
                <th colSpan={3} className="border-l-2 border-l-foreground/25 p-1 text-center font-display font-bold uppercase tracking-[0.08em] text-foreground">
                  Week
                </th>
              </tr>
              <tr className="border-b bg-muted/30 text-[10px]">
                <th className="sticky left-0 z-10 bg-muted/30 p-1" />
                {weekDates.map((d) => (
                  <Fragment key={`s-${format(d, "yyyy-MM-dd")}`}>
                    <th className="min-w-[46px] border-l p-1 text-right text-muted-foreground">Day</th>
                    <th className="min-w-[46px] p-1 text-right text-muted-foreground">Night</th>
                  </Fragment>
                ))}
                <th className="min-w-[52px] border-l-2 border-l-foreground/25 p-1 text-right text-muted-foreground">Day</th>
                <th className="min-w-[52px] p-1 text-right text-muted-foreground">Night</th>
                <th className="min-w-[52px] bg-muted/50 p-1 text-right font-bold text-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {isFetching && days.length === 0 && (
                <tr>
                  <td colSpan={weekDates.length * 2 + 4} className="p-3 text-center text-muted-foreground">
                    Reading the headcount sheet…
                  </td>
                </tr>
              )}
              {!isFetching && days.length === 0 && (
                <tr>
                  <td colSpan={weekDates.length * 2 + 4} className="p-3 text-center text-muted-foreground">
                    No headcount recorded for this week on the SharePoint sheet.
                  </td>
                </tr>
              )}
              {days.length > 0 && rows.map((row) => (
                <tr key={row.key} className="border-b last:border-b-0 hover:bg-muted/20">
                  <td className={`sticky left-0 z-10 bg-background p-1 text-left ${row.bold ? "font-semibold" : "text-muted-foreground"}`}>
                    {row.label}
                  </td>
                  {dates.map((ds) => (
                    <Fragment key={`${row.key}-${ds}`}>
                      {(["day", "night"] as const).map((s) => {
                        const c = cell(ds, s);
                        return (
                          <td
                            key={`${row.key}-${ds}-${s}`}
                            className={`p-1 text-right tabular-nums whitespace-nowrap ${s === "day" ? "border-l" : ""} ${row.bold ? "font-semibold" : ""} ${row.tone ?? ""}`}
                          >
                            {c ? n(row.pick(c)) : dash}
                          </td>
                        );
                      })}
                    </Fragment>
                  ))}
                  <td className={`border-l-2 border-l-foreground/25 p-1 text-right tabular-nums ${row.bold ? "font-semibold" : ""}`}>
                    {n(weekSum(row.pick, "day"))}
                  </td>
                  <td className={`p-1 text-right tabular-nums ${row.bold ? "font-semibold" : ""}`}>
                    {n(weekSum(row.pick, "night"))}
                  </td>
                  <td className={`bg-muted/40 p-1 text-right tabular-nums font-semibold`}>
                    {n(weekSum(row.pick))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (source || (data?.missing.length ?? 0) > 0) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {source ? `Source: SharePoint · ${source.sourceFile ?? ""}${source.sheet ? ` · sheet ${source.sheet}` : ""}` : ""}
          {(data?.missing.length ?? 0) > 0 && (
            <>
              {source ? " · " : ""}
              {data!.missing.length} day/shift not on the sheet or unreadable — those columns show a dash rather
              than a zero.
            </>
          )}
        </p>
      )}
    </div>
  );
}
