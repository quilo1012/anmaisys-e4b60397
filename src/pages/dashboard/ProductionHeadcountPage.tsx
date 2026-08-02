import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Printer, CopyPlus, Users, Factory, Wrench, PlaneTakeoff, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
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

function Chip({
  name,
  tone,
  draggable,
  onDragStart,
}: {
  name: string;
  tone: "production" | "support" | "away" | "overtime" | "roster";
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const tones: Record<string, string> = {
    production: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    support: "bg-muted text-muted-foreground border-border",
    away: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    overtime: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
    roster: "bg-card text-foreground border-border",
  };
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone],
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
      )}
      title={name}
    >
      {name}
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

function KpiPill({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", tone)}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <div className="text-lg font-bold leading-none tabular-nums">{value}</div>
        <div className="truncate text-2xs uppercase tracking-wide opacity-70">{label}</div>
      </div>
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
  const { data: roster = [], byId: everyoneById, isLoading: rosterLoading } = useShiftRoster(shift, onDate);
  const { data: allocations = [], isLoading: allocLoading } = useAllocations(onDate, shift);
  const { place, remove, copyLastLikeDay } = useAllocationMutations(onDate, shift);

  const byEmployee = useMemo(() => {
    const m = new Map<string, (typeof allocations)[number]>();
    allocations.forEach((a) => m.set(a.employee_id, a));
    return m;
  }, [allocations]);

  // Toda a gente activa, não só quem é elegível hoje: uma alocação gravada é um facto
  // e tem de aparecer na coluna. Se a pessoa deixar de ser elegível, o cartão continua
  // lá para alguém a poder tirar — em vez de desaparecer do ecrã e ficar a contar nos
  // totais, que era o que fazia o quadro dizer "20 no apoio" com a WH Team a zero.
  const employeeById = everyoneById ?? new Map<string, HeadcountEmployee>();

  const peopleIn = (areaId: string) =>
    allocations
      .filter((a) => a.status === "assigned" && a.area_id === areaId && employeeById.has(a.employee_id))
      .map((a) => employeeById.get(a.employee_id)!)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const peopleWith = (status: AllocStatus) =>
    allocations
      .filter((a) => a.status === status && employeeById.has(a.employee_id))
      .map((a) => employeeById.get(a.employee_id)!)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const unassigned = roster.filter((e) => !byEmployee.has(e.id));

  const assignedCount = allocations.filter((a) => a.status === "assigned").length;
  const productionIds = new Set(areas.filter((a) => a.kind === "production").map((a) => a.id));
  const onLines = allocations.filter((a) => a.status === "assigned" && a.area_id && productionIds.has(a.area_id)).length;
  const support = assignedCount - onLines;
  const away = allocations.filter((a) => a.status === "absence" || a.status === "holiday").length;
  const overtime = allocations.filter((a) => a.status === "overtime").length;

  const dragStart = (e: React.DragEvent, employeeId: string) => {
    e.dataTransfer.setData("text/plain", employeeId);
    e.dataTransfer.effectAllowed = "move";
  };
  const readDrag = () => draggedEmployeeId;

  const handleDrop = (target: { areaId: string | null; status: AllocStatus } | "roster") => (employeeId: string) => {
    if (!employeeId) return;
    if (target === "roster") remove.mutate(employeeId);
    else place.mutate({ employeeId, areaId: target.areaId, status: target.status });
  };

  const accent = shift === "Day" ? "border-t-4 border-t-amber-500" : "border-t-4 border-t-indigo-500";

  if (rosterLoading || allocLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className={cn("space-y-4 rounded-xl border bg-card p-3 sm:p-4", accent)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold">{shift} shift</h3>
          <Badge variant="secondary" className="tabular-nums">{roster.length} eligible</Badge>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" className="print:hidden" onClick={() => copyLastLikeDay.mutate()} disabled={copyLastLikeDay.isPending}>
            <CopyPlus className="mr-2 h-4 w-4" />
            Copy from last same day
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <KpiPill icon={Users} label="Total staff in production" value={assignedCount} tone="border-primary/30 bg-primary/5 text-primary" />
        <KpiPill icon={Factory} label="On lines" value={onLines} tone="border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300" />
        <KpiPill icon={Wrench} label="Support" value={support} tone="border-border bg-muted/40 text-muted-foreground" />
        <KpiPill icon={PlaneTakeoff} label="Away" value={away} tone="border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300" />
        <KpiPill icon={Clock3} label="Overtime" value={overtime} tone="border-violet-500/30 bg-violet-500/5 text-violet-700 dark:text-violet-300" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {areas.map((area) => {
          const people = peopleIn(area.id);
          return (
            <DropZone
              key={area.id}
              disabled={!canManage}
              onDrop={() => handleDrop({ areaId: area.id, status: "assigned" })(readDrag() ?? "")}
            >
              <Card className={cn("h-full", area.kind === "production" ? "border-blue-500/30" : "border-border")}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 py-3">
                  <CardTitle className="truncate text-sm font-semibold">{area.name}</CardTitle>
                  <Badge className={cn("tabular-nums", area.kind === "production" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground")}>
                    {people.length}
                  </Badge>
                </CardHeader>
                <CardContent className="min-h-[76px] pb-3">
                  <div className="flex flex-wrap gap-1.5">
                    {people.map((p) => (
                      <Chip
                        key={p.id}
                        name={p.full_name}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
