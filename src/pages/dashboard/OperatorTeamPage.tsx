import { PageHeader } from "@/components/ui/PageHeader";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2, Crown, Clock3 } from "lucide-react";
import { OperatorLineGuard } from "@/components/OperatorLineGuard";
import { useDeviceLineCtx } from "@/contexts/DeviceLineContext";
import { useLineTeamBoard, type LineTeamMember } from "@/hooks/useLineTeamBoard";
import { bayInk, bayWash } from "@/lib/lineBay";
import { cn } from "@/lib/utils";

/**
 * "My Team" on the operator tablet: who is on this line's board for the shift
 * that is running now. Read-only — the board itself is planned elsewhere; the
 * tablet only answers "who is here with me today".
 */
export default function OperatorTeamPage() {
  return (
    <DashboardLayout>
      <OperatorLineGuard>
        <OperatorTeamContent />
      </OperatorLineGuard>
    </DashboardLayout>
  );
}

const STATUS_LABEL: Record<string, string> = {
  assigned: "Assigned",
  overtime: "Overtime",
  sick: "Sick",
  unpaid: "Absence",
  holiday: "Holiday",
  training: "Training",
};

function OperatorTeamContent() {
  const { selectedLineId: lineId, selectedLineName: lineName } = useDeviceLineCtx();
  const { data: team, isLoading, isError, error } = useLineTeamBoard(lineId);

  const shift = team?.[0]?.shift;
  const working = (team ?? []).filter((m) => m.status === "assigned" || m.status === "overtime");
  const away = (team ?? []).filter((m) => m.status !== "assigned" && m.status !== "overtime");
  // One card per board area when the line has several (Line 5 A&B, Pill line…).
  const areaGroups: { area: string; members: LineTeamMember[] }[] = [];
  for (const m of working) {
    const area = m.area_name ?? lineName;
    let g = areaGroups.find((x) => x.area === area);
    if (!g) { g = { area, members: [] }; areaGroups.push(g); }
    g.members.push(m);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`My Team — ${lineName}`}
        description={shift ? `${shift} shift, today` : "Who is on your line this shift"}
      />

      {isLoading && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="py-6 text-center text-sm text-destructive">
            The team board could not be loaded — {String((error as Error)?.message ?? "no answer")}.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && team?.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nobody is allocated to {lineName} on the {shift ?? "current"} shift board yet.
          </CardContent>
        </Card>
      )}

      {areaGroups.map((g) => (
        <Card key={g.area} style={{ borderLeft: `6px solid ${bayInk(lineName)}`, backgroundColor: bayWash(lineName, "soft") }}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5" style={{ color: bayInk(lineName) }} />
              {areaGroups.length > 1 ? g.area : "On the line"}
              <Badge variant="outline" className="ml-1">{g.members.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {g.members.map((m, i) => (
              <MemberChip key={`${m.display_name}-${i}`} member={m} lineName={lineName} />
            ))}
          </CardContent>
        </Card>
      ))}

      {away.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Clock3 className="h-5 w-5" />
              Not on the line today
              <Badge variant="outline" className="ml-1">{away.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {away.map((m, i) => (
              <MemberChip key={`${m.display_name}-${i}`} member={m} lineName={lineName} dim />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MemberChip({ member, lineName, dim }: { member: LineTeamMember; lineName: string; dim?: boolean }) {
  const ink = bayInk(lineName);
  return (
    <div
      className={cn(
        "flex h-14 items-center gap-2 rounded-lg border px-3",
        dim && "opacity-70",
      )}
      style={{ borderColor: ink, backgroundColor: bayWash(lineName) }}
    >
      {member.is_leader && (
        <span className="flex h-6 w-10 items-center justify-center rounded bg-warning text-[10px] font-black text-warning-foreground">
          LEAD
        </span>
      )}
      <span
        className={cn("truncate text-base", member.is_leader && "font-bold")}
        style={member.is_leader ? { color: ink } : undefined}
      >
        {member.display_name ?? member.employee_name}
      </span>
      {member.sheet_start_time && <Badge variant="outline" className="text-[10px]">{member.sheet_start_time}</Badge>}
      {member.sheet_tag && <Badge variant="outline" className="text-[10px] capitalize">{member.sheet_tag}</Badge>}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {member.is_leader && <Crown className="h-3.5 w-3.5" style={{ color: ink }} />}
        {member.half_day && <Badge variant="outline" className="text-[10px]">½ day</Badge>}
        {member.status === "overtime" && <Badge variant="outline" className="text-[10px]">OT</Badge>}
        {member.status !== "assigned" && member.status !== "overtime" && (
          <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[member.status] ?? member.status}</Badge>
        )}
      </span>
    </div>
  );
}
