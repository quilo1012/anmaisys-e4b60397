import { DashboardLayout } from "@/components/DashboardLayout";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { LoadFailed } from "@/components/portal/LoadFailed";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShiftTag } from "@/components/ShiftTag";
import { shiftEdge } from "@/lib/shiftLook";
import { useMyAttendance } from "@/hooks/useMyAttendance";
import { currentShift } from "@/lib/operationalShift";
import { isSharedTabletSession } from "@/lib/sharedTabletSession";
import { myShifts } from "@/lib/myAttendance";
import { KIND_LABEL, areaText, fmtDay, plusDays } from "@/lib/myShiftText";

/**
 * Where the signed-in person works over the next fourteen days: which board, which
 * hours, which column. It used to sit on top of My Attendance; it has its own place in
 * the menu now, because it answers a different question (where, not how many hours).
 * Same read as before (`my_attendance`), so it can only ever be their own.
 */
export default function MyWorkAreaPage() {
  const sharedTablet = isSharedTabletSession();
  const today = currentShift().operationalDate;
  const to = plusDays(today, 13);
  const { data: result, isPending, isError, refetch } = useMyAttendance(today, to);

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <ModuleHeader
          module="Production"
          title="Where I'm working"
          description="Your shifts and work area for the next two weeks, from the Headcount Board."
          brand
        />
        {sharedTablet ? (
          <Card><CardContent className="p-4 text-sm">
            This tablet is signed in for the line, not for one person, so it cannot show anybody's
            work area. Open this page on your own phone, signed in with your badge.
          </CardContent></Card>
        ) : isPending ? (
          <div role="status" aria-label="Loading your work area" className="space-y-3">
            <Skeleton className="h-64 w-full" />
          </div>
        ) : isError ? (
          <LoadFailed message="Your work area could not be loaded. Check your connection and try again." onRetry={() => void refetch()} />
        ) : result?.state === "notSetUp" ? (
          <Card><CardContent className="p-4 text-sm">
            This page is being set up. Your record is safe — it will show here once the update is finished.
          </CardContent></Card>
        ) : result?.state === "unlinked" ? (
          <Card><CardContent className="p-4 text-sm">
            Your account is not linked to your badge yet, so there is nothing to show. Open My Overtime and
            enter the number on your badge, or ask your supervisor to link it.
          </CardContent></Card>
        ) : result?.state === "ready" ? (
          <WorkAreaCard today={today} to={to} data={result.data} />
        ) : null}
      </div>
    </DashboardLayout>
  );
}

function WorkAreaCard({ today, to, data }: { today: string; to: string; data: Parameters<typeof myShifts>[0] }) {
  const shifts = myShifts(data, today, to).filter((s) => !["holiday", "sick", "unpaid", "other"].includes(s.kind));
  return (
    <Card data-testid="where-im-working">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4" /> Next 14 days</CardTitle>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {shifts.length === 0 ? (
          <p className="px-4 pb-2 text-sm text-muted-foreground">No shifts planned in the next two weeks.</p>
        ) : (
          <ul className="divide-y text-sm">
            {shifts.map((sh, i) => (
              <li key={`${sh.date}-${sh.shift}-${i}`} className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2 pl-3 pr-4", shiftEdge(sh.shift))}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                    {sh.date === today ? "Today" : fmtDay(sh.date)}
                    <ShiftTag shift={sh.shift} />
                    {sh.hours && <span className="font-normal text-muted-foreground">{sh.hours}</span>}
                  </div>
                  <div className={cn("text-xs", sh.area ? "text-foreground" : "text-muted-foreground")}>{areaText(sh)}</div>
                </div>
                {sh.kind !== "scheduled" && <Badge variant="outline">{KIND_LABEL[sh.kind]}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
