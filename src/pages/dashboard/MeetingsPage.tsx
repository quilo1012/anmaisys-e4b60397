import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, MessageCircle, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { can } from "@/lib/permissions";
import { dayKeyOf, stepAnchor, viewDays, viewRange, type CalendarView, type MyMeeting } from "@/lib/meetings";
import { isNotInstalled, useMeeting, useMeetingsInRange } from "@/hooks/useMeetings";
import { MeetingCalendar, MeetingDayList, ToneLegend } from "@/components/meetings/MeetingCalendar";
import { MeetingDetails } from "@/components/meetings/MeetingDetails";
import { MeetingFormDialog } from "@/components/meetings/MeetingFormDialog";
import { MeetingsToAnswer } from "@/components/meetings/MeetingsToAnswer";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function periodLabel(view: CalendarView, anchor: string): string {
  const days = viewDays(view, anchor);
  const fmt = (k: string) => `${Number(k.slice(8))} ${MONTHS[Number(k.slice(5, 7)) - 1].slice(0, 3)}`;
  if (view === "day") return `${fmt(anchor)} ${anchor.slice(0, 4)}`;
  if (view === "week") return `${fmt(days[0])} – ${fmt(days[6])} ${days[6].slice(0, 4)}`;
  return `${MONTHS[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
}

/**
 * Meetings, in the Communication Hub (BLOCO 159). Everybody sees the meetings they are
 * invited to — the database decides which — and only who holds `meetings.manage`
 * schedules, changes or cancels.
 */
export default function MeetingsPage() {
  const { user, role } = useAuth();
  const isMobile = useIsMobile();
  const canManage = can(role, "meetings.manage");
  const today = dayKeyOf(new Date());
  const [params, setParams] = useSearchParams();

  const [chosenView, setView] = useState<CalendarView>("week");
  const view: CalendarView = isMobile ? "day" : chosenView;
  const [anchor, setAnchor] = useState(today);
  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const meetings = useMeetingsInRange(range.from, range.to);

  // ?meeting=<id> — where a bell row lands. The meeting is read on its own, so it opens
  // even when it is outside the week on screen.
  // Only the id is kept, never the meeting it was clicked with: that copy went stale the
  // moment the person answered, and "Your answer" kept the old one until reopened (11/11).
  const linkedId = params.get("meeting");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const openId = pickedId ?? linkedId;
  const single = useMeeting(openId);
  const inView = openId ? (meetings.data ?? []).find((x) => x.id === openId) ?? null : null;
  const open = openId ? single.data ?? inView : null;
  const pick = (m: MyMeeting) => setPickedId(m.id);
  const closeDetails = () => {
    setPickedId(null);
    if (linkedId) { params.delete("meeting"); setParams(params, { replace: true }); }
  };

  const [form, setForm] = useState<{ slot?: { day: string; time: string } | null; editing?: MyMeeting | null } | null>(null);

  const notInstalled = meetings.error && isNotInstalled(meetings.error);

  return (
    <DashboardLayout>
      <div className="flex min-h-0 flex-col gap-3">
        <PageHeader
          module="Communication"
          title="Meetings"
          description={canManage ? "Schedule meetings and see who is coming." : "The meetings you are invited to."}
          icon={<CalendarDays className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard/communication"><MessageCircle className="mr-1 h-4 w-4" />Messages</Link>
              </Button>
              {canManage && !notInstalled && (
                <Button size="sm" onClick={() => setForm({ slot: { day: anchor, time: "09:00" } })}>
                  <Plus className="mr-1 h-4 w-4" />New meeting
                </Button>
              )}
            </div>
          }
        />

        {notInstalled ? (
          <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            Meetings are not switched on yet: the database part (BLOCO 159) has not been applied.
          </p>
        ) : (
          <>
            <MeetingsToAnswer onOpen={pick} />
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" aria-label="Previous" onClick={() => setAnchor(stepAnchor(view, anchor, -1))}><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => setAnchor(today)}>Today</Button>
                <Button variant="outline" size="icon" aria-label="Next" onClick={() => setAnchor(stepAnchor(view, anchor, 1))}><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <h2 className="text-base font-semibold tabular-nums">{periodLabel(view, anchor)}</h2>
              {!isMobile && (
                <ToggleGroup type="single" size="sm" variant="outline" className="ml-auto" value={view} onValueChange={(v) => v && setView(v as CalendarView)}>
                  <ToggleGroupItem value="day">Day</ToggleGroupItem>
                  <ToggleGroupItem value="week">Week</ToggleGroupItem>
                  <ToggleGroupItem value="month">Month</ToggleGroupItem>
                </ToggleGroup>
              )}
            </div>
            <ToneLegend />
            {meetings.error && <p className="text-sm text-destructive">Could not load the meetings. They will retry on their own.</p>}

            {isMobile ? (
              <MeetingDayList meetings={meetings.data ?? []} day={anchor} onOpen={pick} />
            ) : (
              <div className={view === "month" ? "" : "flex h-[calc(100dvh-16rem)] min-h-[420px] flex-col"}>
                <MeetingCalendar
                  view={view}
                  anchor={anchor}
                  today={today}
                  meetings={meetings.data ?? []}
                  onOpen={pick}
                  onSlot={canManage ? (day, time) => setForm({ slot: { day, time } }) : undefined}
                />
              </div>
            )}
          </>
        )}
      </div>

      <MeetingDetails
        meeting={open}
        canManage={canManage}
        myId={user?.id}
        onClose={closeDetails}
        onEdit={(m) => { closeDetails(); setForm({ editing: m }); }}
      />
      {canManage && user && (
        <MeetingFormDialog
          open={!!form}
          onClose={() => setForm(null)}
          myId={user.id}
          slot={form?.slot ?? null}
          editing={form?.editing ?? null}
        />
      )}
    </DashboardLayout>
  );
}
