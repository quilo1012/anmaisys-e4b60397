import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { format, parseISO } from "date-fns";

export interface TrendPoint {
  on_date: string;
  value: number;
  /** Extra lines for the hover card, e.g. "Away 4". */
  detail?: string[];
}

/**
 * One measure over days, as columns. A single series, so the title names it and
 * there is no legend; one hue (the primary), so there is no palette to validate.
 * The same numbers are in a table below it for anyone who cannot read the chart.
 */
export function TrendColumns({ title, points, unit }: { title: string; points: TrendPoint[]; unit: string }) {
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No days in this period.</p>;
  const data = points.map((p) => ({ ...p, label: format(parseISO(p.on_date), "dd/MM") }));
  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">{title}</figcaption>
      <div className="h-40 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval="preserveStartEnd"
              stroke="hsl(var(--muted-foreground))" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={10} width={36}
              stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as (TrendPoint & { label: string }) | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-md border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-sm">
                    <div className="font-medium">{format(parseISO(p.on_date), "EEE dd/MM")}</div>
                    <div className="tabular-nums">{p.value} {unit}</div>
                    {p.detail?.map((d) => <div key={d} className="text-muted-foreground tabular-nums">{d}</div>)}
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead><tr className="text-muted-foreground"><th className="font-medium">Day</th><th className="font-medium">{unit}</th><th className="font-medium">Also</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.on_date} className="border-t">
                <td>{format(parseISO(p.on_date), "EEE dd/MM")}</td>
                <td>{p.value}</td>
                <td className="text-muted-foreground">{p.detail?.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
