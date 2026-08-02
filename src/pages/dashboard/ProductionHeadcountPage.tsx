import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Printer, CopyPlus, Users, Factory, Wrench, PlaneTakeoff, Clock3, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { BackButton } from "@/components/BackButton";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { AreaPicker } from "@/components/workforce/AreaPicker";
import {
  useHeadcountAreas,
  useShiftRoster,
  useAllocations,
  useAllocationMutations,
  type AllocStatus,
  type HeadcountArea,
  type HeadcountEmployee,
} from "@/hooks/useHeadcount";

/** Employee id currently being dragged (HTML5 dataTransfer isn't readable on dragover). */
let draggedEmployeeId: string | null = null;

type ShiftKey = "Day" | "Night";
type ViewKey = ShiftKey | "Split";

const AWAY_BLOCKS: { status: AllocStatus; label: string; accent: string }[] = [
  { status: "absence", label: "Absence", accent: "border-amber-500/40 bg-amber-500/5" },
  { status: "holiday", label: "Holidays", accent: "border-amber-500/40 bg-amber-500/5" },
  { status: "overtime", label: "Overtime", accent: "border-violet-500/40 bg-violet-500/5" },
];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatLong(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function dayTypeLabel(iso: string) {
  const w = new Date(`${iso}T12:00:00`).getDay();
  if (w === 0) return "Sunday";
  if (w === 6) return "Saturday";
  return "Weekday";
}

/**
 * A section heading with a rule running out to the edge.
 *
 * Production and support are read differently — one is the line running, the other is
 * who keeps it running — and in a single grid Office sat between Line 3 and Line 4 as
 * though it were the next line.
 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 text-2xs font-extrabold uppercase tracking-widest text-muted-foreground first:mt-0">
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Two letters, for the square that sits before the name. */
function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/**
 * How each shift looks.
 *
 * The colour is what makes the split view work: two boards of identical grey columns
 * side by side are one board twice the size, and the eye has to read a heading to
 * know which factory it is looking at.
 */
const LOOK: Record<string, { icon: typeof Sun; banner: string; soft: string; ink: string }> = {
  Day: { icon: Sun, banner: "from-amber-600 to-amber-400", soft: "bg-amber-500/10", ink: "text-warning-strong" },
  Night: { icon: Moon, banner: "from-indigo-900 to-indigo-500", soft: "bg-indigo-500/10", ink: "text-indigo-700 dark:text-indigo-300" },
};

/**
 * The line leader, picked out.
 *
 * A supervisor scanning a column wants to know it has a leader before they want
 * anybody's name. It comes off `department`, which was typed by hand over months —
 * hence a pattern rather than an exact list.
 */
function isLeader(department: string | null | undefined) {
  return !!department && /team\s*lead|supervisor/i.test(department);
}

function Chip({
  name,
  tone,
  leader,
  overtime,
  draggable,
  onDragStart,
}: {
  name: string;
  tone: "production" | "support" | "away" | "overtime" | "roster";
  leader?: boolean;
  /** Working a day their own rota does not cover — marked on the line, not moved off it. */
  overtime?: boolean;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const tones: Record<string, string> = {
    production: "bg-primary/5 border-primary/20",
    support: "bg-muted/40 border-border",
    away: "bg-amber-500/10 border-amber-500/30",
    overtime: "bg-violet-500/10 border-violet-500/30",
    roster: "bg-card border-border",
  };
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-1.5 py-1 text-xs font-medium",
        leader ? "border-primary/40 bg-primary/10 font-semibold"
          : overtime ? "border-violet-500/40 bg-violet-500/10"
          : tones[tone],
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
      )}
      title={name}
    >
      {/* The leader's square says LEAD rather than their initials. Initials in a
          darker box only read as "this one is somehow different"; the word says which
          way, and it is the thing being looked for when a column is scanned. */}
      <span className={cn(
        "grid h-5 shrink-0 place-items-center rounded-md text-[9px] font-bold leading-none",
        leader ? "w-9 bg-primary text-primary-foreground tracking-wide" : "w-5 bg-background/70 text-muted-foreground",
      )}>
        {leader ? "LEAD" : initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function DropZone({
  children,
  onDrop,
  disabled,
  className,
}: {
  children: React.ReactNode;
  onDrop: () => void;
  disabled: boolean;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={cn("rounded-lg transition-colors", over && "ring-2 ring-primary/60 bg-primary/5", className)}
    >
      {children}
    </div>
  );
}

/**
 * A big number and what it is, in the order it gets read.
 *
 * The first one carries the shift's colour because it is the figure the sheet ends
 * on — "how many are in production" is the question, and the other four are how it
 * breaks down.
 */
function KpiPill({
  icon: Icon, label, value, tone, highlight, valueTone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; tone: string; highlight?: boolean; valueTone?: string;
}) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5 shadow-sm", highlight ? cn(tone, "border-transparent") : "bg-card")}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", highlight ? "" : "text-muted-foreground")} />
        <span className={cn("font-mono text-2xl font-bold leading-none tabular-nums", valueTone)}>{value}</span>
      </div>
      <div className="mt-1.5 truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function ShiftBoard({
  onDate,
  shift,
  areas,
  canManage,
}: {
  onDate: string;
  shift: ShiftKey;
  areas: HeadcountArea[];
  canManage: boolean;
}) {
  const { data: roster = [], byId: everyoneById, onShift = [], isLoading: rosterLoading } = useShiftRoster(shift, onDate);
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);
  const { data: allocations = [], isLoading: allocLoading } = useAllocations(onDate, shift);
  const { place, remove, copyLastLikeDay } = useAllocationMutations(onDate, shift);

  const byEmployee = useMemo(() => {
    const m = new Map<string, (typeof allocations)[number]>();
    allocations.forEach((a) => m.set(a.employee_id, a));
    return m;
  }, [allocations]);

  // Everyone active, not only whoever is eligible today: a saved allocation is a fact
  // and has to show in its column. If the person stops being eligible the card stays,
  // so somebody can take them off — rather than vanishing from the screen while still
  // counting in the totals, which is what made the board read "20 support" with the
  // WH Team column at zero.
  const employeeById = everyoneById ?? new Map<string, HeadcountEmployee>();

  /**
   * Who is working in an area, leader first.
   *
   * Overtime counts as working here: somebody called in on a day their rota does not
   * cover is on that line, doing that job, and the sheet lists them on the line *and*
   * under Overtime staff. Showing them only in the Overtime card took them off the
   * line they were actually standing on.
   *
   * The leader is forced to the top rather than sorted alphabetically, because the
   * first thing anybody asks of a column is whether it has one.
   */
  const peopleIn = (areaId: string) =>
    allocations
      .filter((a) => (a.status === "assigned" || a.status === "overtime")
        && a.area_id === areaId && employeeById.has(a.employee_id))
      .map((a) => ({ person: employeeById.get(a.employee_id)!, overtime: a.status === "overtime" }))
      .sort((a, b) => {
        const la = isLeader(a.person.department) ? 0 : 1;
        const lb = isLeader(b.person.department) ? 0 : 1;
        return la - lb || a.person.full_name.localeCompare(b.person.full_name);
      });

  const peopleWith = (status: AllocStatus) =>
    allocations
      .filter((a) => a.status === status && employeeById.has(a.employee_id))
      .map((a) => employeeById.get(a.employee_id)!)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const unassigned = roster.filter((e) => !byEmployee.has(e.id));

  // Working = placed on an area, whether the day is a normal one or an overtime one.
  // The sheet's "Total staff in Production" counts the overtime people too — they are
  // in the factory — so leaving them out made the board disagree with the sheet.
  // Only people the board can actually draw. Somebody marked as having left keeps
  // their allocation rows — the day they worked is history and deleting it would take
  // that with them — but they are no longer on the roster, so their card disappears.
  // Counting them anyway is how a column reading zero sat under a total saying ten.
  const working = allocations.filter(
    (a) => (a.status === "assigned" || a.status === "overtime") && employeeById.has(a.employee_id),
  );
  const assignedCount = working.length;
  const productionIds = new Set(areas.filter((a) => a.kind === "production").map((a) => a.id));
  const onLines = working.filter((a) => a.area_id && productionIds.has(a.area_id)).length;
  const support = assignedCount - onLines;
  const away = allocations.filter(
    (a) => (a.status === "absence" || a.status === "holiday") && employeeById.has(a.employee_id),
  ).length;
  const overtime = working.filter((a) => a.status === "overtime").length;

  const dragStart = (e: React.DragEvent, employeeId: string) => {
    e.dataTransfer.setData("text/plain", employeeId);
    e.dataTransfer.effectAllowed = "move";
  };
  const readDrag = () => draggedEmployeeId;

  const handleDrop = (target: { areaId: string | null; status: AllocStatus } | "roster") => (employeeId: string) => {
    if (!employeeId) return;
    if (target === "roster") { remove.mutate(employeeId); return; }
    const current = byEmployee.get(employeeId);

    // Overtime says *how* the day counts; the area says *where* they are. They are
    // two answers, and moving somebody between lines only changes the second — so an
    // overtime person dragged onto Line 2 stays overtime and simply moves. Before,
    // every area drop wrote "assigned" and quietly cancelled the overtime.
    const status: AllocStatus =
      target.status === "assigned" && current?.status === "overtime" ? "overtime" : target.status;

    // Marking somebody overtime from the Overtime card keeps the area they are on,
    // for the same reason. Absence and holiday do clear it: they are not at a place.
    const areaId = target.status === "overtime"
      ? target.areaId ?? current?.area_id ?? null
      : target.areaId;

    place.mutate({ employeeId, areaId, status });
  };

  const look = LOOK[shift] ?? LOOK.Day;
  const ShiftIcon = look.icon;

  if (rosterLoading || allocLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-4">
      {/* The shift banner: says whose board this is before a single column is read. */}
      <div className={cn("flex flex-wrap items-center gap-3 rounded-xl bg-gradient-to-r px-4 py-3 text-white", look.banner)}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/20">
          <ShiftIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold leading-tight">{shift} shift</h3>
          <div className="truncate text-2xs opacity-90">{roster.length} on the rota today</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {canManage && (
            <Button size="sm" variant="secondary" className="print:hidden" onClick={() => copyLastLikeDay.mutate()} disabled={copyLastLikeDay.isPending}>
              <CopyPlus className="mr-2 h-4 w-4" />
              Copy from last same day
            </Button>
          )}
          <div className="text-right">
            <b className="block font-mono text-2xl font-extrabold leading-none tabular-nums">{assignedCount}</b>
            <small className="text-[10px] uppercase tracking-wider opacity-90">staff assigned</small>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiPill icon={Users} label="Total staff in production" value={assignedCount} tone={cn(look.soft, look.ink)} highlight />
        <KpiPill icon={Factory} label="On lines" value={onLines} tone="" />
        <KpiPill icon={Wrench} label="Support" value={support} tone="" />
        <KpiPill icon={PlaneTakeoff} label="Away" value={away} tone="" valueTone={away ? "text-warning-strong" : ""} />
        <KpiPill icon={Clock3} label="Overtime" value={overtime} tone="" valueTone={overtime ? "text-violet-600 dark:text-violet-400" : ""} />
      </div>

      {(["production", "support"] as const).map((kind) => {
        const ofKind = areas.filter((a) => a.kind === kind);
        if (ofKind.length === 0) return null;
        return (
        <div key={kind}>
        <SectionLabel>{kind === "production" ? "Production" : "Support"}</SectionLabel>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
        {ofKind.map((area) => {
          const people = peopleIn(area.id);
          return (
            <DropZone
              key={area.id}
              disabled={!canManage}
              onDrop={() => handleDrop({ areaId: area.id, status: "assigned" })(readDrag() ?? "")}
            >
              <Card className={cn("h-full overflow-hidden border-l-4", area.kind === "production" ? "border-l-primary" : "border-l-slate-400")}>
                <CardHeader
                  className={cn("flex flex-row items-center justify-between gap-2 space-y-0 border-b px-2.5 py-2", area.kind === "production" ? "bg-primary/5" : "bg-muted", canManage && "cursor-pointer hover:brightness-95")}
                  onClick={canManage ? () => setPicking({ id: area.id, name: area.name }) : undefined}
                  title={canManage ? `Add or remove people on ${area.name}` : undefined}
                >
                  <CardTitle className="truncate text-xs font-bold">{area.name}</CardTitle>
                  <span className={cn(
                    "grid h-5 min-w-[1.5rem] shrink-0 place-items-center rounded-full border bg-background px-1.5 font-mono text-xs font-bold",
                    people.length ? (area.kind === "production" ? "text-primary" : "text-foreground") : "text-muted-foreground/50",
                  )}>
                    {people.length}
                  </span>
                </CardHeader>
                <CardContent className="min-h-[76px] p-2">
                  <div className="flex flex-col gap-1">
                    {people.map(({ person: p, overtime: isOt }) => (
                      <Chip
                        key={p.id}
                        name={p.full_name}
                        leader={isLeader(p.department)}
                        overtime={isOt}
                        tone={area.kind === "production" ? "production" : "support"}
                        draggable={canManage}
                        onDragStart={(e) => {
                          draggedEmployeeId = p.id;
                          dragStart(e, p.id);
                        }}
                      />
                    ))}
                    {people.length === 0 && <span className="text-xs text-muted-foreground">Drop people here</span>}
                  </div>
                </CardContent>
              </Card>
            </DropZone>
          );
        })}
        </div>
        </div>
        );
      })}

      {/* Filling a line by dragging seventy cards is the reason people go back to the
          spreadsheet. The column heading opens a search over the whole shift — the same
          picker the Workforce daily board uses, so the two behave alike. */}
      {picking && (
        <AreaPicker
          areaId={picking.id}
          areaName={picking.name}
          open
          onOpenChange={(v) => !v && setPicking(null)}
          people={onShift.map((e) => {
            const current = byEmployee.get(e.id)?.area_id ?? null;
            return {
              ...e,
              currentAreaId: current,
              currentAreaName: current ? areas.find((a) => a.id === current)?.name ?? null : null,
            };
          })}
          onToggle={(person, toAreaId) => {
            if (!toAreaId) { remove.mutate(person.id); return; }
            // Same rule as the drag: placing somebody who is on overtime moves them,
            // it does not take the overtime off them.
            const wasOvertime = byEmployee.get(person.id)?.status === "overtime";
            place.mutate({
              employeeId: person.id,
              areaId: toAreaId,
              status: wasOvertime ? "overtime" : "assigned",
            });
          }}
        />
      )}

      <SectionLabel>Away &amp; overtime</SectionLabel>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))" }}>
        {AWAY_BLOCKS.map((block) => {
          const people = peopleWith(block.status);
          return (
            <DropZone
              key={block.status}
              disabled={!canManage}
              onDrop={() => handleDrop({ areaId: null, status: block.status })(readDrag() ?? "")}
            >
              <Card className={cn("h-full", block.accent)}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
                  <CardTitle className="text-sm font-semibold">{block.label}</CardTitle>
                  <Badge variant="outline" className="tabular-nums">{people.length}</Badge>
                </CardHeader>
                <CardContent className="min-h-[64px] pb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <Chip
                        key={p.id}
                        name={p.full_name}
                        tone={block.status === "overtime" ? "overtime" : "away"}
                        draggable={canManage}
                        onDragStart={(e) => {
                          draggedEmployeeId = p.id;
                          dragStart(e, p.id);
                        }}
                      />
                    ))}
                    {people.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </CardContent>
              </Card>
            </DropZone>
          );
        })}
      </div>

      <DropZone disabled={!canManage} onDrop={() => handleDrop("roster")(readDrag() ?? "")}>
        <Card className="border-dashed print:hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
            <CardTitle className="text-sm font-semibold">Unallocated ({shift})</CardTitle>
            <Badge variant="outline" className="tabular-nums">{unassigned.length}</Badge>
          </CardHeader>
          <CardContent className="min-h-[64px] pb-3">
            <div className="flex flex-wrap gap-1.5">
              {unassigned.map((p) => (
                <Chip
                  key={p.id}
                  name={p.full_name}
                  tone="roster"
                  draggable={canManage}
                  onDragStart={(e) => {
                    draggedEmployeeId = p.id;
                    dragStart(e, p.id);
                  }}
                />
              ))}
              {unassigned.length === 0 && <span className="text-xs text-muted-foreground">Everyone is allocated</span>}
            </div>
          </CardContent>
        </Card>
      </DropZone>
    </div>
  );
}

export default function ProductionHeadcountPage() {
  const { can } = useRole();
  const canManage = can("headcount.manage");
  const [date, setDate] = useState<string>(() => toISO(new Date()));
  const [view, setView] = useState<ViewKey>("Day");
  const { data: areas = [], isLoading } = useHeadcountAreas();

  const shiftDate = (delta: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(toISO(d));
  };

  return (
    <div className="space-y-4">
      {/* Above the banner rather than inside it: the banner is navy, and a ghost
          button on it reads as disabled. Same component and same position as every
          other screen, so leaving the board is where the hand already expects it —
          the board scrolls for twenty columns and the shell's Back is a long way up. */}
      <BackButton className="no-print" />

      <div className="rounded-xl bg-[hsl(215_60%_18%)] p-4 text-white shadow-sm print:bg-white print:text-black">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Production Headcount</h1>
            <p className="text-xs text-white/70 print:text-black">Daily allocation of people to production and support areas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-white/10 p-1 print:bg-transparent">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 print:hidden" onClick={() => shiftDate(-1)} aria-label="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[9.5rem] text-center text-sm font-semibold tabular-nums">{formatLong(date)}</span>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 print:hidden" onClick={() => shiftDate(1)} aria-label="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Badge variant="outline" className="border-white/40 text-white print:text-black">{dayTypeLabel(date)}</Badge>
            <Button size="sm" variant="secondary" className="print:hidden" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)} className="print:hidden">
        <TabsList>
          <TabsTrigger value="Day">Day</TabsTrigger>
          <TabsTrigger value="Night">Night</TabsTrigger>
          <TabsTrigger value="Split">Split</TabsTrigger>
        </TabsList>
      </Tabs>

      {!canManage && (
        <p className="text-xs text-muted-foreground">Read-only view — you don't have permission to change allocations.</p>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : view === "Split" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <ShiftBoard onDate={date} shift="Day" areas={areas} canManage={canManage} />
          <ShiftBoard onDate={date} shift="Night" areas={areas} canManage={canManage} />
        </div>
      ) : (
        <ShiftBoard onDate={date} shift={view} areas={areas} canManage={canManage} />
      )}
    </div>
  );
}
