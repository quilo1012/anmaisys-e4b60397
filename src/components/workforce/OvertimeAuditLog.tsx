import { useState } from "react";
import { History, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOvertimeAudit } from "@/hooks/useOvertimeAudit";
import { useOvertimeRoster } from "@/hooks/useOvertimeRequests";
import {
  EVENT_LABEL, EVENT_GROUPS, SOURCE_LABEL, actorLine, detailLine, whenLine,
} from "@/lib/overtimeAudit";

const PAGE = 50;

/**
 * The overtime record, read-only.
 *
 * `manage`: the Overtime Management screen, every row, with filters by kind of event
 * and by person. `mine`: My Overtime, the person's own rows, no filters. Which rows
 * come back is decided by the database, not by this prop — `mine` only hides the
 * controls that would be pointless with one person's history.
 *
 * Closed until asked for, so it never pushes the asks on the screen down the page.
 */
export function OvertimeAuditLog({ mode }: { mode: "manage" | "mine" }) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string>("all");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE);
  const { data, isLoading, isError } = useOvertimeAudit({
    limit,
    events: group === "all" ? null : EVENT_GROUPS[group].events,
    employeeId: mode === "manage" && employeeId !== "all" ? employeeId : null,
  });

  return (
    <Card data-testid="overtime-audit">
      <CardHeader className="py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 text-left">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> {mode === "mine" ? "My overtime history" : "Overtime history"}
          </CardTitle>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 pt-0">
          {mode === "manage" && (
            <div className="flex flex-wrap gap-2">
              <Select value={group} onValueChange={(v) => { setGroup(v); setLimit(PAGE); }}>
                <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs" aria-label="Kind of event"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything</SelectItem>
                  {Object.entries(EVENT_GROUPS).map(([k, g]) => <SelectItem key={k} value={k}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <PersonSelect value={employeeId} onChange={(v) => { setEmployeeId(v); setLimit(PAGE); }} />
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : isError ? (
            <p className="text-sm text-destructive-strong">The history could not be loaded. Try again in a moment.</p>
          ) : data?.state === "notSetUp" ? (
            <p className="text-sm text-muted-foreground">The overtime history is being set up and will appear here soon.</p>
          ) : !data?.rows.length ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <>
              <ul className="divide-y rounded-md border text-sm">
                {data.rows.map((r) => {
                  const when = whenLine(r);
                  const detail = detailLine(r);
                  return (
                    <li key={r.id} className="space-y-0.5 px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-medium">
                          {EVENT_LABEL[r.event_type] ?? r.event_type}
                          {mode === "manage" && r.employee_name && <span className="font-normal"> · {r.employee_name}</span>}
                        </span>
                        <time className="text-xs text-muted-foreground" dateTime={r.occurred_at}>
                          {new Date(r.occurred_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </time>
                      </div>
                      {when && <div className="text-xs text-muted-foreground">For {when}</div>}
                      {detail && <div className="text-xs">{detail}</div>}
                      {r.note && <div className="text-xs italic text-foreground/80">“{r.note}”</div>}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>By {actorLine(r)}</span>
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{SOURCE_LABEL[r.source]}</Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {data.more && (
                <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>Show older</Button>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/** Its own component so the roster is only asked for on the screen that filters by it. */
function PersonSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: roster = [] } = useOvertimeRoster();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[11rem] text-xs" aria-label="Person"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Everyone</SelectItem>
        {roster.map((r) => <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
