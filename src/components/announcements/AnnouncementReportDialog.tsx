import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { audienceLabel, readSummary, whenLabel, type ManagedAnnouncement, type ReportRow } from "@/lib/announcements";
import { useReadReport } from "@/hooks/useAnnouncements";

type Filter = "all" | "read" | "unread";

/**
 * Announcement Read Report: who was targeted, who confirmed and when, and who has not.
 * Employees with no app login are listed and counted as not read — they have not read
 * it — and marked, so a manager knows to tell them another way.
 */
export function AnnouncementReportDialog({ announcement: a, onClose }: { announcement: ManagedAnnouncement | null; onClose: () => void }) {
  const q = useReadReport(a?.id ?? null);
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => q.data ?? [], [q.data]);
  const ackField = (r: ReportRow) => (a?.requires_ack ?? true ? r.acknowledged_at : r.read_at);
  const s = readSummary(rows, a?.requires_ack ?? true);
  const shown = rows.filter((r) => filter === "all" || (filter === "read" ? !!ackField(r) : !ackField(r)));

  return (
    <Dialog open={!!a} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Announcement read report</DialogTitle>
          <DialogDescription>
            {a ? <><span className="font-medium text-foreground">{a.title}</span> · {audienceLabel(a.audience_department, a.audience_shift_group)}</> : null}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.error && <p className="text-sm text-destructive">Could not load the report.</p>}

        {q.data && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat value={s.targeted} label="Targeted" />
              <Stat value={s.read} label="Read" tone="good" />
              <Stat value={s.unread} label="Unread" tone={s.unread > 0 ? "warn" : undefined} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold tabular-nums">{s.percent}% acknowledged</span>
                <span className="text-xs tabular-nums text-muted-foreground">{s.read} of {s.targeted}</span>
              </div>
              <Progress value={s.percent} aria-label={`${s.percent}% acknowledged`} />
              {s.noLogin > 0 && (
                <p className="text-xs text-muted-foreground">
                  {s.noLogin} of the unread {s.noLogin === 1 ? "has" : "have"} no app login and cannot see it — they need to be told another way.
                </p>
              )}
            </div>

            <ToggleGroup type="single" size="sm" variant="outline" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="justify-start">
              <ToggleGroupItem value="all">All ({s.targeted})</ToggleGroupItem>
              <ToggleGroupItem value="read">Read ({s.read})</ToggleGroupItem>
              <ToggleGroupItem value="unread">Unread ({s.unread})</ToggleGroupItem>
            </ToggleGroup>

            {shown.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nobody here.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {shown.map((r) => {
                  const at = ackField(r);
                  return (
                    <li key={r.user_id ?? r.employee_id ?? r.name} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground">{[r.department, r.shift_group].filter(Boolean).join(" · ") || "—"}</span>
                      <span className={cn("w-full text-xs tabular-nums sm:w-48 sm:text-right",
                        at ? "text-emerald-700 dark:text-emerald-400" : r.has_login ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                        {at ? `Read ${whenLabel(at)}` : r.has_login ? "Not read yet" : "No app login"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-lg border p-2">
      <div className={cn("text-2xl font-semibold tabular-nums",
        tone === "good" && "text-emerald-700 dark:text-emerald-400", tone === "warn" && "text-amber-700 dark:text-amber-400")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
