import { ShiftTag } from "@/components/ShiftTag";
import { HeadcountHoursTable } from "@/components/workforce/HeadcountHoursTable";
import { useAuth } from "@/contexts/AuthContext";
import { format, parseISO } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { sheetBandOf } from "@/lib/headcountBlocks";
import { holdDrag, clearDrag, takeDrag } from "@/lib/boardDrag";
import { useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Star, ChevronDown, ChevronLeft, ChevronRight, Printer, Download, Upload, CloudDownload, CopyPlus, Users, Factory, Wrench, PlaneTakeoff, Clock3, Sun, Moon, CalendarDays, GripVertical, UserCheck, UserX, Search, Undo2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardLayout } from "@/components/DashboardLayout";
import { WorkforceTabs } from "@/components/workforce/WorkforceTabs";
import { cn } from "@/lib/utils";
import { hasPlaceOnBoard, tallyBoard } from "@/lib/boardTally";
import { useRole } from "@/hooks/useRole";
import { AreaPicker } from "@/components/workforce/AreaPicker";
import { useShiftPatterns } from "@/hooks/useWorkforce";
import { PersonDayDialog } from "@/components/workforce/PersonDayDialog";
import { roleStripe } from "@/lib/workforceRoles";
import { disambiguators } from "@/lib/boardNames";
import { SheetCellInput } from "@/components/workforce/SheetCellInput";
import {
  useHeadcountAreas,
  useShiftRoster,
  useAllocations,
  useAllocationMutations,
  useCopyableDays,
  useHeadcountMatrix,
  useSaveMatrix,
  useChangeShift,
  useReorderAreas,
  useSetShiftPattern,
  crewBadge,
  type AllocStatus,
  type HeadcountArea,
  type HeadcountEmployee,
} from "@/hooks/useHeadcount";
import { HeadcountSheetDialog } from "@/components/workforce/HeadcountSheetDialog";
import { HeadcountPrintSheet } from "@/components/workforce/HeadcountPrintSheet";
import { printSheetLayout } from "@/lib/headcountSheet";
import { MatrixDialog } from "@/components/workforce/MatrixDialog";
import { PeriodCalendar } from "@/components/workforce/PeriodCalendar";
import { HeadcountOvertimePanel } from "@/components/workforce/HeadcountOvertimePanel";
import { currentShift } from "@/lib/operationalShift";
import { useSearchParams } from "react-router-dom";
import { boardNotImported } from "@/lib/headcountImportReport";
import { ClockCoverageNote } from "@/components/workforce/ClockCoverageNote";
import { DayClockBadge } from "@/components/workforce/DayClockBadge";
import { ModuleHeader } from "@/components/ui/ModuleHeader";

/**
 * The boards there are. Two, and Weekend is not one of them.
 *
 * This comment used to say the opposite — that Weekend was a third board and that
 * without a tab for it 37 allocations were saved and then invisible. That was true
 * once and the fix went the other way: `boardShiftFor` sends every crew except Night
 * to the Day board, and the card says which crew with `crewBadge` ("FRI–MON" for the
 * weekend forty). `daily_allocations` holds 6 696 rows across Day and Night and
 * **none** on any third value, so nothing is hidden by there being two tabs.
 *
 * Left stale, the old comment read as a live bug report against a screen that is
 * behaving, which is worse than no comment: the next person to touch this starts by
 * hunting for 37 rows that are not there.
 */
type ShiftKey = "Day" | "Night";
type ViewKey = ShiftKey | "Split";

/**
 * The blocks under the columns — everybody the board has something to say about who is
 * not standing on a line.
 *
 * Training is not an absence and it is not overtime: they came in, they are paid, and
 * they are in a classroom rather than on Line 3. It had nowhere to go on this board,
 * so a training day was marked as holiday or left blank — and `employee_attendance`
 * has accepted `training` since the workforce board was written, so the record could
 * say it while the board it is written from could not. Purple, because that is what
 * training already looks like on the Workforce board; the same fact should not change
 * colour between two screens.
 */
const AWAY_BLOCKS: { status: AllocStatus; label: string; head: SheetFill }[] = [
  { status: "sick", label: "Sickness", head: "away" },
  { status: "unpaid", label: "Unpaid", head: "away" },
  { status: "holiday", label: "Holidays", head: "leave" },
  // "Overtime", as the supervisors asked (12/10/2026), and as the company sheet heads
  // the same column. It was "Called in" for a while, to keep it apart from timesheet
  // overtime — hours over contract in the clock. That clash is gone at the source:
  // My Attendance no longer calls a day with extra clocked minutes "OT", so on every
  // screen the word now means one thing — an overtime shift somebody was accepted for
  // (the ask → board bridge, 20261012190000) or placed on by hand. The stored status
  // was always `overtime` and stays so.
  { status: "overtime", label: "Overtime", head: "leave" },
  // Amarelo, como uma área: na planilha o Training é uma coluna de sítio, não de falta.
  { status: "training", label: "Training", head: "heading" },
];

/**
 * As cores da planilha, as mesmas que o export escreve (`SHEET_LOOKS` em
 * `lib/headcountSheet.ts`): amarelo nos cabeçalhos, verde nos Totais, nas férias e nas
 * horas extra, vermelho nas faltas, cinzento no líder, roxo no total da produção.
 *
 * O board era um ecrã de cartões e a folha um quadro de células, e quem passava de um
 * para o outro tinha de reaprender onde estava cada coisa. Agora o board É a folha:
 * as mesmas cores no mesmo sítio, e as mesmas pessoas na mesma célula.
 *
 * Cores fixas e não tokens do tema, de propósito: são as da folha da empresa, e uma
 * célula amarela tem de ser amarela de noite também, com o texto preto que a folha usa.
 */
type SheetFill = "heading" | "away" | "leave" | "total" | "grand" | "leader";
const SHEET_FILL: Record<SheetFill, string> = {
  heading: "bg-[#FFFF00] text-black",
  away: "bg-[#FF0000] text-white",
  leave: "bg-[#92D050] text-black",
  total: "bg-[#92D050] text-black",
  grand: "bg-[#7030A0] text-white",
  leader: "bg-[#D9D9D9] text-black",
};
/** A linha fina preta à volta de cada célula da folha. */
const SHEET_RULE = "border-neutral-900 dark:border-neutral-400";

/**
 * Uma coluna da folha: o cabeçalho, uma célula por pessoa, células vazias até ao fundo
 * da banda, e `Total` com o número por baixo, os dois a verde.
 *
 * As vazias não são enfeite. Na folha todas as colunas de uma banda têm a mesma altura
 * e os Totais ficam todos na mesma linha, por isso lê-se a fila verde de um lado ao
 * outro sem procurar. Uma coluna que encolhe para o tamanho dos seus nomes partia
 * essa fila em degraus.
 */
function SheetColumn({
  title, head, onHeadClick, headHint, grip, rows, count, children, blank, filled,
}: {
  /** Células já ocupadas, quando há mais do que `count` (nomes do plano, a cinzento). */
  filled?: number;
  /** O que vai na primeira célula vazia — o campo para escrever um nome. */
  blank?: React.ReactNode;
  title: string;
  head: SheetFill;
  onHeadClick?: () => void;
  headHint?: string;
  grip?: React.ReactNode;
  /** Quantas linhas de nomes a banda tem — a coluna mais comprida, mais uma livre. */
  rows: number;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("headcount-sheet-column flex h-full flex-col border bg-card", SHEET_RULE)}>
      <div
        className={cn(
          "flex min-h-[40px] items-center gap-1 border-b px-1.5",
          SHEET_RULE, SHEET_FILL[head],
          onHeadClick && "cursor-pointer hover:brightness-95",
        )}
        onClick={onHeadClick}
        title={headHint}
      >
        {grip}
        <span className="headcount-column-title flex-1 truncate text-center text-sm font-bold">{title}</span>
      </div>
      <div className="flex flex-col">
        {children}
        {Array.from({ length: Math.max(0, rows - (filled ?? count)) }, (_, i) =>
          i === 0 && blank ? (
            <div key={i} className={cn("h-12 shrink-0 border-b", SHEET_RULE)}>{blank}</div>
          ) : (
            <div key={i} aria-hidden className={cn("h-12 shrink-0 border-b", SHEET_RULE)} />
          ),
        )}
      </div>
      {/* `Total` e o número por baixo, que é como cada coluna da planilha acaba. */}
      <div className="mt-auto flex flex-col">
        <span className={cn("border-b py-1 text-center text-xs font-semibold", SHEET_RULE, SHEET_FILL.total)}>Total</span>
        <span className={cn("py-1 text-center font-figure text-sm font-bold tabular-nums", SHEET_FILL.total)}>{count}</span>
      </div>
    </div>
  );
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatLong(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
/** "Fri 07 Aug" — the weekday first, because that is what a day is chosen by. */
function formatWeekday(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
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
/**
 * The blocks the board is read in, in the order the factory walks them.
 *
 * Not the same question as `kind`: kind decides whether somebody counts as on a line
 * or in support, and these decide where the card is drawn. Keeping them apart is what
 * lets Gel Room count as production while sitting beside the capsule machines.
 */
/**
 * As duas bandas em que o board desenha — as da planilha da empresa.
 *
 * Eram três. "Sectors" tinha sido separada das outras duas de propósito: o WH Team e a
 * Maintenance estavam sob Support ao lado do Lab e do Office, e a Hygiene e a Quality
 * sob Production ao lado das linhas, e quem ia verificar a cobertura da higiene
 * procurava primeiro na metade errada do ecrã.
 *
 * Continuam juntas — passaram as duas para o apoio, que é onde a folha de Outubro as
 * tem. O que se ganha é o ecrã e o papel serem o mesmo objecto: quem arruma o board de
 * manhã e quem lê a folha impressa à tarde deixam de ter de traduzir entre duas
 * arrumações da mesma gente. A regra de qual é qual é `sheetBandOf`, a mesma que o
 * export e o import usam.
 */
const SECTIONS: { key: string; label: string; accent: string }[] = [
  { key: "production", label: "Production", accent: "text-primary" },
  { key: "support", label: "Support", accent: "text-muted-foreground" },
];

/** Which band an area is drawn in. `kind` still decides what the totals count. */


/**
 * A section heading that can be folded away.
 *
 * A supervisor watching the lines run does not need Office and Maintenance taking a
 * third of the screen. Folded state is remembered per section, because the one you
 * do not care about at 6am is the same one at 2pm.
 */
function SectionLabel({
  children, accent, count, open, onToggle,
}: {
  children: React.ReactNode; accent?: string; count?: number;
  open?: boolean; onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      // `print-keep` is load-bearing, not styling. The global print sheet hides every
      // button that does not carry it, and these headings are buttons because they
      // fold — so a printed board came out as an unbroken wall of columns with
      // Production, Sectors, Support and Away & overtime all missing from it.
      className="print-keep headcount-section-label mb-2 mt-5 flex w-full items-center gap-2 text-left text-2xs font-extrabold uppercase tracking-widest text-muted-foreground first:mt-0"
    >
      {onToggle && (
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform print:hidden", open && "rotate-90")} />
      )}
      <span className={accent}>{children}</span>
      {count !== undefined && (
        <span className="rounded-full bg-muted px-1.5 font-figure text-2xs font-bold">{count}</span>
      )}
      <span className="h-px flex-1 bg-border" />
    </button>
  );
}


/**
 * How each shift looks.
 *
 * The colour is what makes the split view work: two boards of identical grey columns
 * side by side are one board twice the size, and the eye has to read a heading to
 * know which factory it is looking at.
 *
 * Keyed by `ShiftKey`, not by `string`. There was a third entry here for Weekend and
 * `LOOK[shift]` could never reach it — `shift` is a ShiftKey and Weekend is not one.
 * Typing the key is what makes a fourth one impossible to add by accident: a board
 * with no look falls back to Day silently, which on the split view means two boards
 * the same colour and no way to tell them apart.
 */
const LOOK: Record<ShiftKey, { icon: typeof Sun; rule: string; chip: string; soft: string; ink: string }> = {
  Day: { icon: Sun, rule: "border-l-warning", chip: "bg-warning/15 text-warning-strong", soft: "bg-warning/10", ink: "text-warning-strong" },
  Night: { icon: Moon, rule: "border-l-primary", chip: "bg-primary/15 text-primary", soft: "bg-primary/10", ink: "text-primary" },
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
  personRef,
  sheetName,
  tone,
  leader,
  lineLeader,
  lineName,
  role,
  dimmed,
  overtime,
  half,
  leftEarlyAt,
  arrivedLateAt,
  crew,
  leftOn,
  startTime,
  tag,
  draggable,
  onOpen,
  onDragStart,
}: {
  name: string;
  /** Número de funcionário (ou departamento) quando outro no board tem o mesmo nome. */
  personRef?: string | null;
  /** Como a folha escreve esta pessoa, quando é diferente do cadastro. Vai no tooltip. */
  sheetName?: string | null;
  /** "14:00" written beside the name on the sheet. */
  startTime?: string | null;
  /** "training" written in brackets on the sheet. */
  tag?: string | null;
  tone: "production" | "support" | "away" | "overtime" | "roster" | "training";
  leader?: boolean;
  /** Named role — LEAD, SUP, TEC, LAB, WH, OFF — when the department says one. */
  role?: { short: string; label: string; cls: string } | null;
  /** True when this person is the leader *marked on this line* — their name wears
      the line's own colour, not just the leader's amber. */
  lineLeader?: boolean;
  /** The column's name, for the leader's colour. Null keeps the plain amber mark. */
  lineName?: string | null;
  /** Somebody is searching and it is not this person. */
  dimmed?: boolean;
  onOpen?: () => void;
  /** Working a day their own rota does not cover — marked on the line, not moved off it. */
  overtime?: boolean;
  /** Off for half the shift. Shown on the chip so the block's count can be read honestly. */
  half?: boolean;
  /** Came in and went home early, at this time. A day worked, not a day off. */
  leftEarlyAt?: string | null;
  /** Came in after the shift started, at this time. Also a day worked, not a day off. */
  arrivedLateAt?: string | null;
  /** Which crew they belong to — FRI–MON, WH, NIGHT. Null for the plain day shift,
      which is most of the board and needs no label to say so. */
  crew?: string | null;
  /** Their last day, if they have left. The card stays on the days they worked. */
  leftOn?: string | null;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
}) {
  // Células brancas, como na folha. A cor fica para os cabeçalhos e para o líder; um
  // nome numa coluna de Holidays já diz o que é pela coluna onde está.
  const plain = "bg-card text-foreground";
  const tones: Record<string, string> = {
    production: plain, support: plain, away: plain, overtime: plain, training: plain, roster: plain,
  };
  return (
    <span
      draggable={draggable}
      onDragStart={onDragStart}
      // Fires however the drag ends — dropped, cancelled with Escape, released over
      // nothing. Without it a cancelled drag left the id set and the next drop on any
      // zone placed that person.
      onDragEnd={clearDrag}
      className={cn(
        // 44px tall and a 26px square: this board is used on a tablet, on the floor,
        // by somebody wearing gloves. A 30px row is a row you miss.
        // `headcount-chip` is what the print sheet takes that height back through —
        // paper has no thumbs, and 44px × eighty names is two pages of white space.
        // Uma célula da folha: quadrada, a linha fina por baixo, o nome ao centro.
        // O nome numa linha só para ele, e as marcas (crew, papel, horas) por baixo.
        // Lado a lado, o FRI–MON comia metade de uma coluna de 150px e o nome saía
        // "Sandro V…" — numa folha que existe para se lerem nomes.
        // Altura fixa, com ou sem marcas: é a mesma em todas as células, por isso os
        // Totais de uma banda continuam numa só fila.
        "headcount-chip flex h-12 w-full max-w-full shrink-0 flex-col overflow-hidden items-center justify-center gap-0.5 border-b px-2 py-1 text-center text-sm font-medium",
        SHEET_RULE,
        // The leader of *this* line wears the line's own colour — border and wash from
        // the bay, the way the column header already does — so scanning the board says
        // which line they lead before the name is read. The plain amber mark stays for
        // a Team Leader who is on a line that has not named them its leader.
        // O líder é a célula cinzenta, como na primeira linha de cada coluna da folha.
        lineLeader || leader ? cn(SHEET_FILL.leader, "font-bold")
          : overtime ? "bg-[#92D050]/25 text-foreground"
          : tones[tone],
        draggable ? "cursor-grab active:cursor-grabbing" : onOpen ? "cursor-pointer" : "cursor-default",
        dimmed && "opacity-20",
      )}
      title={[name, personRef, sheetName && sheetName !== name ? `on the sheet: ${sheetName}` : null].filter(Boolean).join(" — ")}
      onClick={onOpen}
      onKeyDown={(e) => { if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      {/* The leader's square says LEAD rather than their initials. Initials in a
          darker box only read as "this one is somehow different"; the word says which
          way, and it is the thing being looked for when a column is scanned. */}
      {/* As iniciais saíram: a folha não as tem, e eram o nome outra vez em duas letras.
          O LEAD fica, pequeno, porque o cinzento sozinho não se lê num ecrã ao sol. */}
      {leader && <span className="sr-only">Lead: </span>}
      <span className="flex max-w-full items-baseline justify-center gap-1">
        <span className="truncate">{name}</span>
        {personRef && (
          <span className="shrink-0 font-figure text-2xs font-semibold text-muted-foreground">{personRef}</span>
        )}
      </span>
      {(startTime || tag || crew || leftOn || half || arrivedLateAt || leftEarlyAt || (role && !leader && role.short !== crew)) && (
      <span className="flex max-w-full flex-wrap items-center justify-center gap-1 leading-none">
      {startTime && (
        <span title={`Starts ${startTime}`} className="shrink-0 rounded-sm border border-primary/40 bg-primary/10 px-1 py-px text-[10px] font-bold leading-tight text-foreground">
          {startTime}
        </span>
      )}
      {tag && (
        <span title={tag} className="shrink-0 rounded-sm border border-border bg-muted px-1 py-px text-[10px] font-bold capitalize leading-tight text-muted-foreground">
          {tag}
        </span>
      )}
      {/* Somebody who has since left, on a day they worked. Said on the card, because
          a name nobody recognises on Monday's board is the first thing anyone asks about. */}
      {leftOn && (
        <span
          title={`Left on ${format(parseISO(leftOn), "dd/MM/yyyy")}`}
          className="shrink-0 rounded-sm border border-destructive/40 bg-destructive/10 px-1 py-px text-2xs font-bold uppercase leading-tight tracking-wide text-destructive"
        >
          Left
        </span>
      )}
      {/* Day and the Fri–Mon crew share this board, so the card has to say which is
          which. Only the ones that are not the plain day shift are labelled — a badge
          on every card is a badge that stops being read. */}
      {crew && <ShiftTag shift={crew} noun="crew" className="px-1 py-px text-2xs" />}
      {/* Half a day, said on the chip. Without it the block reads "2 away" and both
          look identical, when one of them worked the morning. */}
      {half && (
        <span
          title="Half day — worked part of the shift"
          className="shrink-0 rounded-sm bg-background/70 px-1 py-px text-2xs font-bold leading-tight text-muted-foreground"
        >
          ½
        </span>
      )}
      {/* Came in late. Same arrow, pointing the other way: the column counts them as in
          all day, and the line was a body short until nine. Before the early-finish mark
          because that is the order the day happened in. */}
      {arrivedLateAt && (
        <span
          title={`Arrived late — came in at ${arrivedLateAt.slice(0, 5)}`}
          className="shrink-0 rounded-sm bg-warning/20 px-1 py-px text-2xs font-bold leading-tight text-warning-strong"
        >
          {arrivedLateAt.slice(0, 5)}→
        </span>
      )}
      {/* Went home early. On the chip because the column counts them as in — which
          they were — and the supervisor reading the board at four needs to know the
          line lost somebody at two without opening every card. */}
      {leftEarlyAt && (
        <span
          title={`Left early — went home at ${leftEarlyAt.slice(0, 5)}`}
          className="shrink-0 rounded-sm bg-warning/20 px-1 py-px text-2xs font-bold leading-tight text-warning-strong"
        >
          ←{leftEarlyAt.slice(0, 5)}
        </span>
      )}
      {/* The named role rides after the name, the way a label does on a card. Only
          when there is one: a badge every row carries tells the eye nothing. */}
      {role && !leader && role.short !== crew && (
        <span
          title={role.label}
          className={cn("shrink-0 rounded-sm px-1 py-px text-2xs font-bold uppercase leading-tight", role.cls)}
        >
          {role.short}
        </span>
      )}
      </span>
      )}
    </span>
  );
}

/**
 * A column that can be picked up by its grip.
 *
 * The grip is a separate target on purpose: the heading itself opens the search, and
 * a header that both opens a dialog and starts a drag would do the wrong one about
 * half the time on a tablet.
 */
function SortableColumn({ id, children }: { id: string; children: (grip: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "z-10 opacity-70")}
    >
      {children(
        <button
          type="button"
          aria-label="Reorder column"
          // Was 14px at half opacity with no padding around it: the one control on
          // the board nobody could find, on a screen used through gloves. Full
          // contrast and a real hit area — the drag still only starts from here, so
          // the heading keeps opening the picker.
          className="-ml-1 grid h-8 w-6 shrink-0 place-items-center cursor-grab touch-none rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing no-print"
          title="Drag to move this column"
          onClick={(e) => e.stopPropagation()}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>,
      )}
    </div>
  );
}

function DropZone({
  children,
  onDrop,
  disabled,
  className,
}: {
  children: React.ReactNode;
  /** Given the employee the browser says was dropped. Empty means "not one of ours". */
  onDrop: (employeeId: string) => void;
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
        // The event first, the module global only if it is empty. `dataTransfer` IS
        // readable here — it is only `dragover` that hides it — and it is the one
        // answer that belongs to THIS drop rather than to the last one that started.
        // Anything dragged in from outside the board carries no id of ours and the
        // caller is handed an empty string, which it ignores.
        onDrop(takeDrag(e.dataTransfer.getData("text/plain")));
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
/** A band action: icon always, its word from 1536px up. The word is the accessible name either way. */
function HeaderAction({
  icon: Icon, label, title, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>; label: string; title: string; onClick: () => void;
}) {
  return (
    <Button size="sm" variant="secondary" className="h-8 px-2.5 print:hidden" aria-label={label} title={title} onClick={onClick}>
      <Icon className="h-4 w-4 2xl:mr-2" />
      <span className="hidden 2xl:inline">{label}</span>
    </Button>
  );
}

function KpiPill({
  icon: Icon, label, value, tone, highlight, valueTone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; tone: string; highlight?: boolean; valueTone?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 whitespace-nowrap", highlight && cn(tone, "rounded-md px-2 py-1"))}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", highlight ? "" : "text-muted-foreground")} />
      <span className={cn("font-figure text-xl font-bold leading-none tabular-nums", valueTone)}>{value}</span>
      <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function ShiftBoard({
  onDate,
  shift,
  areas,
  canManage,
  onSync,
}: {
  onDate: string;
  shift: ShiftKey;
  areas: HeadcountArea[];
  canManage: boolean;
  /**
   * Opens the SharePoint sync for this board's sheet, from the "not imported" notice.
   * Absent where the band's sync would read the other board's sheet — in Both, it reads
   * the day sheet, so the night board offers only the copy.
   */
  onSync?: () => void;
}) {
  /**
   * Everyone on the crew, rota or no rota.
   *
   * The board answers "who is due in today", and on a Monday that hides the twenty-one
   * people on a Tue–Fri rota — correctly, but a supervisor calling somebody in needs
   * to see them. Off by default, because a board listing people who are at home is a
   * list, not a plan.
   */
  const [showAll, setShowAll] = useState(false);
  /**
   * Find a person on the board.
   *
   * Dims rather than filters: a column whose counter moves while you type stops
   * being a count of the line and becomes a count of your search, and the board is
   * read for the first of those.
   */
  const [find, setFind] = useState("");
  const { data: roster = [], byId: everyoneById, boardById, onShift = [], noCrew = [], isLoading: rosterLoading } = useShiftRoster(shift, onDate, showAll);
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);
  /** Absence / Holidays / Overtime, opened the same way an area column is. */
  const [pickingAway, setPickingAway] = useState<{ status: AllocStatus; label: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Folded sections are remembered: the one you do not care about at 6am is the same
  // one at 2pm, and re-folding it every morning is a small tax on every shift.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("headcount_open_sections") ?? "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    // Guarded like the read above it. A folded section is a convenience, and in a
    // private window or with the quota full `setItem` throws — which from inside an
    // effect takes the whole board down over somebody having collapsed Support.
    try { localStorage.setItem("headcount_open_sections", JSON.stringify(openSections)); }
    catch { /* not remembered this time; the board still draws */ }
  }, [openSections]);
  /**
   * Which blocks the board draws at all.
   *
   * Folding a section keeps it one tap away; this is for the day a supervisor only
   * wants the lines — no Warehouse, no Support — and does not want to fold the same
   * two headings every morning. All on by default, remembered in this browser, and
   * screen-only: the printed sheet always carries the whole board, because paper
   * missing fourteen people looks exactly like paper that is right.
   */
  const [visibleBlocks, setVisibleBlocks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("headcount_visible_blocks") ?? "{}"); }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem("headcount_visible_blocks", JSON.stringify(visibleBlocks)); }
    catch { /* same bargain as the sections above */ }
  }, [visibleBlocks]);
  const blockVisible = (key: string) => visibleBlocks[key] !== false;
  const changeShift = useChangeShift(onDate);
  const reorder = useReorderAreas();
  const setPattern = useSetShiftPattern(onDate);
  const { data: patterns = [] } = useShiftPatterns();
  // A little distance first, so a tap on the heading is not read as a drag.
  const columnSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { data: allocations = [], isLoading: allocLoading } = useAllocations(onDate, shift);
  const { place, remove, copyLastLikeDay, undoCopy, readUndo, keepCopy, setLeader } = useAllocationMutations(onDate, shift);
  const { data: copyableDays = [], isLoading: copyableLoading } = useCopyableDays(onDate, shift);
  const matrix = useHeadcountMatrix(shift, onDate);
  const saveMatrix = useSaveMatrix(onDate, shift);
  const [matrixOpen, setMatrixOpen] = useState(false);

  /**
   * The copy that can still be taken back off this board.
   *
   * Held here rather than read on every render because it lives in `localStorage`,
   * which does not tell React when it changes. It is re-read whenever the board being
   * looked at changes, so paging to another day never offers to undo this one's copy.
   */
  const [undoable, setUndoable] = useState(() => readUndo());
  useEffect(() => { setUndoable(readUndo()); }, [readUndo]);
  /** Every copy goes through here, so every copy leaves the strip behind it. */
  const runCopy = (from: Parameters<typeof copyLastLikeDay.mutate>[0]) =>
    copyLastLikeDay.mutate(from, { onSuccess: () => setUndoable(readUndo()) });

  const byEmployee = useMemo(() => {
    const m = new Map<string, (typeof allocations)[number]>();
    allocations.forEach((a) => m.set(a.employee_id, a));
    return m;
  }, [allocations]);

  // Everyone active, not only whoever is eligible today: a saved allocation is a fact
  // and has to show in its column. If the person stops being eligible the card stays,
  // so somebody can take them off — rather than vanishing from the screen while still
  // counting in the totals, which is what made the board read "20 support" with the
  // WH Team column at zero. Leavers too, on the days up to their last one, marked
  // LEFT: the day they worked is history (`boardPeopleOn`).
  const employeeById = useMemo(() => boardById ?? new Map<string, HeadcountEmployee>(), [boardById]);

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
  /**
   * Everybody working, bucketed by area once.
   *
   * This used to be a function that walked every allocation per column. The board
   * draws about twenty columns and asks again in the `inSection` reduce, so one pass
   * over ~80 allocations became forty — and it ran on EVERY render, including every
   * keystroke in "Find a person…", because that box is state in this same component.
   * Roughly 3 200 comparisons and twenty sorts per letter typed, on a tablet, through
   * gloves. The search only dims cards; it has no business re-bucketing the board.
   *
   * Keyed on the two things that actually change it. `find` is deliberately not a
   * dependency.
   */
  const peopleByArea = useMemo(() => {
    const byArea = new Map<string, {
      person: HeadcountEmployee; shown: string; sheetName: string | null; startTime: string | null;
      tag: string | null; overtime: boolean; leader: boolean;
    }[]>();
    for (const a of allocations) {
      if (a.status !== "assigned" && a.status !== "overtime") continue;
      if (!a.area_id) continue;
      const person = employeeById.get(a.employee_id);
      if (!person) continue;
      const list = byArea.get(a.area_id) ?? [];
      list.push({
        person,
        // O nome do cadastro, um por pessoa. A grafia da folha vai para o tooltip.
        shown: person.full_name,
        sheetName: a.sheet_name ?? null,
        startTime: a.sheet_start_time ?? null,
        tag: a.sheet_tag ?? null,
        overtime: a.status === "overtime",
        // The day's own leader wins. `department` is only the fallback, so a board
        // nobody has named a leader on still shows the Team Leaders it has.
        leader: a.is_leader ?? false,
      });
      byArea.set(a.area_id, list);
    }
    for (const list of byArea.values()) {
      list.sort((a, b) => {
        // The leader marked on this particular line and shift always takes the first
        // position, even when another Team Leader is helping on the same line.
        const la = a.leader ? 0 : isLeader(a.person.department) ? 1 : 2;
        const lb = b.leader ? 0 : isLeader(b.person.department) ? 1 : 2;
        return la - lb || a.shown.localeCompare(b.shown);
      });
    }
    return byArea;
  }, [allocations, employeeById]);

  /** Same answer as before, now a lookup. Empty areas keep returning a fresh []. */
  const peopleIn = (areaId: string) => peopleByArea.get(areaId) ?? [];

  const peopleWith = (status: AllocStatus) =>
    allocations
      .filter((a) => a.status === status && employeeById.has(a.employee_id))
      .map((a) => {
        const p = employeeById.get(a.employee_id)!;
        return Object.assign({}, p, {
          shown: p.full_name,
          sheetName: a.sheet_name ?? null,
          startTime: a.sheet_start_time ?? null,
          tag: a.sheet_tag ?? null,
        });
      })
      .sort((a, b) => a.shown.localeCompare(b.shown));

  // A row that places nobody anywhere (`assigned` with no line) is no place: the person
  // goes to the tray rather than vanishing from the board. Somebody the rota does not
  // have due today but who holds such a row is added too — the row is still a fact.
  const placedHere = (id: string) => {
    const a = byEmployee.get(id);
    return !!a && hasPlaceOnBoard(a);
  };
  const rosterIds = new Set([...roster, ...noCrew].map((e) => e.id));
  const linelessOffRoster = allocations
    .filter((a) => !hasPlaceOnBoard(a) && !rosterIds.has(a.employee_id))
    .map((a) => employeeById.get(a.employee_id))
    .filter((p): p is HeadcountEmployee => !!p);
  const unassigned = [...roster.filter((e) => !placedHere(e.id)), ...linelessOffRoster];
  // Sem crew no cadastro, ninguém os punha em board nenhum. Não são "por colocar" do
  // turno — o rota não os põe cá — por isso ficam numa bandeja à parte, em ambos os
  // boards, até alguém os colocar ou lhes dar um crew.
  const noCrewUnplaced = noCrew.filter((e) => !placedHere(e.id));

  // Quem está no ecrã hoje — colocados, ausentes e por colocar — e, entre eles, quem
  // partilha o nome com outro. Só esses levam o número ao lado.
  // Quem se pode escrever numa célula: toda a gente activa, de qualquer crew — o
  // mesmo que o picker do cabeçalho oferece. E onde cada um está hoje, para a lista.
  const everyone = useMemo(() => [...(everyoneById?.values() ?? [])], [everyoneById]);
  const whereNow = (id: string): string | null => {
    const a = byEmployee.get(id);
    if (!a) return null;
    if (a.area_id) return areas.find((x) => x.id === a.area_id)?.name ?? null;
    return AWAY_BLOCKS.find((b) => b.status === a.status)?.label ?? null;
  };

  const refOf = disambiguators([
    ...allocations.map((a) => employeeById.get(a.employee_id)).filter((p): p is HeadcountEmployee => !!p),
    ...unassigned,
    ...noCrewUnplaced,
  ]);

  // Working = status `assigned`. Sickness, Unpaid and Overtime are columns of their
  // own at the end of the sheet and are not added into "Total staff in Production":
  // that total is the crew the day was planned with. It used to count the overtime
  // people as well, which put the purple number above what the lines and support
  // add up to. Overtime keeps its own figure.
  // Only people the board can actually draw. A leaver is drawn on the days up to their
  // last one, so they count there and nowhere after; a row for anybody else the board
  // cannot draw stays out of the total. Counting what is not drawn is how a column
  // reading zero sat under a total saying ten.
  // The rules live in `tallyBoard`, which the Production dashboard reads too, so the
  // dashboard and this board cannot come to different totals.
  const tally = tallyBoard({ allocations, areas, roster, drawable: (id) => employeeById.has(id) });
  const assignedCount = tally.working;

  /**
   * Um dia que ainda não aconteceu e que ninguém planeou, mostrado como o rota o põe.
   *
   * O board só tem o que foi gravado, e amanhã é gravado amanhã de manhã. Quem
   * abria o dia seguinte para saber em que linha ia estar via colunas vazias e o nome
   * em "Not placed yet" — a pergunta era "onde vou estar?", e o sítio estava no
   * matrix, a um menu de distância. Aqui aparece a cinzento, na coluna onde o matrix
   * do dia (changeover às segundas e sextas, standard nos outros) põe cada pessoa que o
   * rota traz. Nada é gravado: "Save this plan" faz a mesma cópia do menu, e os nomes
   * a cinzento são exactamente as linhas que ela escreve.
   *
   * Só quando o dia está por planear — ninguém colocado numa coluna: um dia que
   * alguém começou a arrumar é a palavra dessa pessoa, não do matrix. Contava-se
   * qualquer pessoa "a trabalhar", e uma linha que ninguém arrumou bastava para apagar
   * o plano inteiro: a overtime aceite (que chega sem coluna, pela ponte) ou um
   * holiday marcado com antecedência deixavam o dia 17 com toda a gente em "Not
   * placed yet". Uma linha sem coluna não é arrumar o dia.
   */
  const todayIso = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  })();
  const placedOnArea = allocations.some((a) => !!a.area_id);
  const planKind: "normal" | "changeover" = [1, 5].includes(new Date(`${onDate}T12:00:00`).getDay()) ? "changeover" : "normal";
  const plan = matrix.matrices.find((m) => m.kind === planKind);
  const ghostByArea = useMemo(() => {
    const out = new Map<string, HeadcountEmployee[]>();
    if (onDate <= todayIso || placedOnArea || !plan) return out;
    for (const r of plan.due) {
      // Só para colunas que o board desenha; uma área desactivada deixaria a pessoa
      // fora da coluna e fora da bandeja ao mesmo tempo.
      if (!r.area_id || !areas.some((x) => x.id === r.area_id) || byEmployee.has(r.employee_id)) continue;
      const p = employeeById.get(r.employee_id);
      if (!p) continue;
      out.set(r.area_id, [...(out.get(r.area_id) ?? []), p]);
    }
    for (const list of out.values()) list.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return out;
  }, [onDate, todayIso, placedOnArea, plan, byEmployee, employeeById, areas]);
  const ghostCount = [...ghostByArea.values()].reduce((n, l) => n + l.length, 0);
  const ghostIds = new Set([...ghostByArea.values()].flat().map((p) => p.id));
  const ghostsIn = (areaId: string) => ghostByArea.get(areaId) ?? [];
  // A bandeja é para quem não tem sítio nenhum — nem gravado, nem no plano.
  const trayPeople = unassigned.filter((e) => !ghostIds.has(e.id));
  // A segunda banda leva as faltas, como na folha — só quando está à vista.
  const supportShown = blockVisible("support") && openSections["support"] !== false
    && areas.some((a) => sheetBandOf(a) === "support");
  const awayInSupport = supportShown;

  /**
   * O fim da segunda banda: `Total staff in Production` a roxo, e depois as faltas, as
   * horas extra e a formação, cada uma na sua coluna com a cor que a folha lhe dá.
   */
  const sheetTail = (rows: number) => (
    <>
      <div className={cn("-mb-px -mr-px flex h-full flex-col border", SHEET_RULE)}>
        {/* "Total staff in Pr", cortado como a folha o escreve: numa linha só, para o
            cabeçalho ter a altura dos outros. O nome inteiro fica no title. */}
        <div
          className={cn("flex min-h-[40px] items-center justify-center border-b px-1.5 text-center text-sm font-bold", SHEET_RULE, SHEET_FILL.grand)}
          title="Total staff in Production — everyone on a line or in support; Sickness, Unpaid and Overtime are not added in"
        >
          Total staff in Pr
        </div>
        <div className={cn("flex min-h-[44px] items-center justify-center font-figure text-2xl font-bold tabular-nums", SHEET_FILL.grand)}>
          {assignedCount}
        </div>
        <div className="flex-1 bg-card" />
      </div>
      {AWAY_BLOCKS.map((block) => {
        const people = peopleWith(block.status);
        return (
          <DropZone
            key={block.status}
            disabled={!canManage}
            className="-mb-px -mr-px h-full rounded-none"
            onDrop={(employeeId) => handleDrop({ areaId: null, status: block.status })(employeeId)}
          >
            <SheetColumn
              title={block.label}
              head={block.head}
              onHeadClick={canManage ? () => setPickingAway({ status: block.status, label: block.label }) : undefined}
              headHint={canManage ? `Add or remove people in ${block.label}` : undefined}
              rows={rows}
              count={people.length}
              blank={canManage ? (
                <SheetCellInput
                  className="h-full"
                  people={everyone}
                  columnName={block.label}
                  whereNow={whereNow}
                  onPick={(id) => handleDrop({ areaId: null, status: block.status })(id)}
                />
              ) : undefined}
            >
              {people.map((p) => (
                <Chip
                  key={p.id}
                  name={p.shown}
                  personRef={refOf.get(p.id)}
                  sheetName={p.sheetName}
                  startTime={p.startTime}
                  tag={p.tag}
                  onOpen={() => setEditing(p.id)}
                  dimmed={isDimmed(p.shown) && isDimmed(p.full_name)}
                  role={roleStripe(p.department)}
                  tone={block.status === "overtime" ? "overtime" : block.status === "training" ? "training" : "away"}
                  half={byEmployee.get(p.id)?.half_day === true}
                  leftEarlyAt={byEmployee.get(p.id)?.left_early_at ?? null}
                  arrivedLateAt={byEmployee.get(p.id)?.arrived_late_at ?? null}
                  crew={crewBadge(p.shift_group)}
                  leftOn={p.left_on ?? null}
                  draggable={canManage}
                  onDragStart={(e) => {
                    holdDrag(p.id);
                    dragStart(e, p.id);
                  }}
                />
              ))}
            </SheetColumn>
          </DropZone>
        );
      })}
    </>
  );
  const { onLines, support, overtime, training } = tally;
  // Training is outside `away` and outside working: a person in training is here and
  // is paid, and counting them as away would tell a supervisor to ring them. It is
  // said on its own line instead, and only when there are any.
  const away = tally.away.total;

  const dragStart = (e: React.DragEvent, employeeId: string) => {
    e.dataTransfer.setData("text/plain", employeeId);
    e.dataTransfer.effectAllowed = "move";
  };

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

  const term = find.trim().toLowerCase();
  const isDimmed = (n: string) => !!term && !n.toLowerCase().includes(term);

  const look = LOOK[shift] ?? LOOK.Day;
  const ShiftIcon = look.icon;

  if (rosterLoading || allocLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <>
    {/* What goes to the printer. The board below is `headcount-on-screen` and stays
        there; see HeadcountPrintSheet for why paper gets the company's grid instead. */}
    <HeadcountPrintSheet
      title={`Production Headcount — ${shift} shift — ${format(parseISO(onDate), "EEEE dd.MM.yyyy")}`}
      layout={printSheetLayout({ areas, allocations, employeeById })}
    />
    <div className="headcount-on-screen space-y-3">
      {/* Says whose board this is before a single column is read.
          It used to be a full-width colour slab in white type. The colour is doing
          real work — in Split the two boards are otherwise identical grids side by
          side — so it stays, as a rule down the edge and a tinted icon rather than
          the loudest thing on the screen.

          One card, two lines: what the board adds up to, then what can be done to it.
          They were a bar of controls and, under it, five tall cards for five numbers —
          two hundred pixels of a laptop before Line 1. The figures are the same five,
          counted the same way; they are just set in a line instead of in boxes. */}
      <div className={cn("rounded-xl border bg-card border-l-[3px]", look.rule)}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md", look.chip)}>
              <ShiftIcon className="h-4 w-4" />
            </div>
            {/* The day type is in the band above, once for both boards. */}
            <h3 className="whitespace-nowrap text-sm font-bold leading-tight">{shift} shift</h3>
          </div>
          {/* The two numbers side by side, because apart they invite the wrong sum:
              46 assigned out of 82 due in is a shift half planned, and "46" alone
              reads like the whole answer. The rest of the rota is named underneath so
              nobody has to work out where the other 36 went. */}
          <div className="shrink-0 sm:border-l sm:pl-4">
            <div className="flex items-baseline gap-1.5">
              <b className={cn("font-figure text-lg font-extrabold leading-none tabular-nums", look.ink)}>{assignedCount}</b>
              <span className="whitespace-nowrap text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                / {roster.length} {showAll ? "on this shift" : "on the rota"}
              </span>
            </div>
            <div className="mt-1 h-1 w-36 overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full", look.rule.replace("border-l-", "bg-"))}
                style={{ width: `${roster.length ? Math.min(100, (assignedCount / roster.length) * 100) : 0}%` }}
              />
            </div>
            <div className="mt-0.5 whitespace-nowrap text-2xs text-muted-foreground">
              {unassigned.length} unallocated · {away} away
              {training > 0 && <> · {training} training</>}
              {noCrewUnplaced.length > 0 && <> · {noCrewUnplaced.length} with no crew</>}
            </div>
          </div>
          {/* `headcount-kpis`: the print sheet sets these five in one row. See index.css. */}
          <div className="headcount-kpis flex min-w-0 flex-1 basis-80 flex-wrap items-center gap-x-4 gap-y-1 sm:border-l sm:pl-4">
            <KpiPill icon={Users} label="Total staff in production" value={assignedCount} tone={cn(look.soft, look.ink)} highlight />
            <KpiPill icon={Factory} label="On lines" value={onLines} tone="" />
            <KpiPill icon={Wrench} label="Support" value={support} tone="" />
            <KpiPill icon={PlaneTakeoff} label="Away" value={away} tone="" valueTone={away ? "text-warning-strong" : ""} />
            {/* People on an overtime shift, not hours. */}
            <KpiPill icon={Clock3} label="Overtime" value={overtime} tone="" valueTone={overtime ? "text-primary" : ""} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 print:hidden">
          {/* Sector filter: which blocks are drawn at all. Screen-only — the printed
              sheet always carries the whole board. */}
          <div className="flex items-center gap-1 print:hidden" role="group" aria-label="Show sectors">
            {SECTIONS.map((s) => {
              const on = blockVisible(s.key);
              return (
                <Button
                  key={s.key}
                  size="sm"
                  variant={on ? "secondary" : "outline"}
                  className={cn("h-8 px-2.5 text-2xs", !on && "text-muted-foreground")}
                  aria-pressed={on}
                  title={on ? `Hide ${s.label}` : `Show ${s.label}`}
                  onClick={() => setVisibleBlocks((v) => ({ ...v, [s.key]: !on }))}
                >
                  {s.label}
                </Button>
              );
            })}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 print:hidden"
            onClick={() => setShowAll((v) => !v)}
            title={showAll ? "Only the people the rota puts in today" : "Everyone on this shift, rota or not"}
          >
            {showAll ? <UserCheck className="mr-2 h-4 w-4" /> : <UserX className="mr-2 h-4 w-4" />}
            {showAll ? "Only today's rota" : "Show everyone"}
          </Button>
          <div className="relative print:hidden">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find a person…"
              aria-label="Find a person on the board"
              className="h-8 w-44 pl-8 text-xs"
            />
          </div>
          {/* Named for what it does. "Copy from last same day" promised a matching
              weekday, and on a board without one it could only fail — which is what it
              did every time it was pressed on a weekend night.

              Split, because the last day worked is the right answer most mornings and
              the wrong one on a Monday, where the day behind is a Sunday of thirty and
              the board being planned is a weekday of seventy. The press does the
              common thing; the arrow names a day instead, with its headcount beside it
              so the choice is made before the copy rather than read off the toast
              afterwards. */}
          {canManage && (
            <div className="flex print:hidden">
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-r-none border-r-0"
                title={`Fills this board from the last ${shift.toLowerCase()} day anybody worked. Nobody already on this day is changed.`}
                onClick={() => runCopy({ kind: "last" })}
                disabled={copyLastLikeDay.isPending}
              >
                <CopyPlus className="mr-2 h-4 w-4" />
                Copy from the last day
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-l-none px-2"
                    aria-label="Copy from another day"
                    disabled={copyLastLikeDay.isPending}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-2xs font-bold uppercase tracking-wider text-muted-foreground">
                    Copy this board from
                  </DropdownMenuLabel>
                  {/* The matrix first, and apart, because it is a different kind of
                      answer: the board as it should look, not as it looked once. The
                      count is the people it holds who are actually due in today —
                      every weekday is a crossover of two rotas, so the matrix's own
                      total would be a number this day never sees. */}
                  {matrix.matrices.map((m) => (
                    <DropdownMenuItem
                      key={m.kind}
                      onSelect={() => runCopy({ kind: "matrix", matrix: m.kind })}
                      disabled={m.due.length === 0}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 truncate">
                          <Star className="h-3.5 w-3.5 shrink-0 text-primary" />
                          {shift} · {m.label}
                        </span>
                        <span className="block truncate pl-5 text-2xs text-muted-foreground">
                          {m.rows.length === 0
                            ? "none saved yet"
                            : m.due.length === 0
                              ? `${m.rows.length} people, none of them due in today`
                              : `of ${m.rows.length}, due in today${m.savedFrom ? ` · saved ${formatWeekday(m.savedFrom)}` : ""}`}
                        </span>
                      </span>
                      <span className="shrink-0 font-figure text-xs font-bold tabular-nums">
                        {m.due.length || "—"}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onSelect={() => setMatrixOpen(true)}
                    className="pl-5 text-2xs text-muted-foreground"
                  >
                    See what the matrices hold
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {copyableLoading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Looking…</div>}
                  {!copyableLoading && copyableDays.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No earlier {shift.toLowerCase()} day has anybody on it yet.
                    </div>
                  )}
                  {copyableDays.map((d, i) => (
                    <DropdownMenuItem
                      key={d.on_date}
                      onSelect={() => runCopy({ kind: "day", on_date: d.on_date })}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="truncate">
                        {formatWeekday(d.on_date)}
                        {i === 0 && <span className="ml-1.5 text-2xs text-muted-foreground">last</span>}
                      </span>
                      <span className="shrink-0 font-figure text-xs font-bold tabular-nums">{d.people}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          {/* Saving is separate from copying and says what it replaces before it does
              it. Two actions rather than two buttons: the question a board answers is
              which day it is a standard *for*, and asking it here is asking it once,
              at the only moment somebody knows — with the board they just arranged in
              front of them. A press by accident on a half-arranged board would
              otherwise quietly become what every future day starts from. */}
          {canManage && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 print:hidden" disabled={saveMatrix.isPending}>
                  <Star className="mr-2 h-4 w-4" />
                  Save as matrix
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>What is this board the standard for?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {assignedCount} people, as they stand on {formatWeekday(onDate)}, become one of the two standards
                    the {shift.toLowerCase()} board is copied from. Only the crews working today are replaced — people
                    from other crews already in that matrix stay there. Days already planned are not touched, and the
                    other standard is left alone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  {matrix.matrices.map((m) => (
                    <AlertDialogAction
                      key={m.kind}
                      onClick={() => saveMatrix.mutate(m.kind)}
                      className="flex h-auto w-full flex-col items-start gap-0.5 py-2 text-left"
                    >
                      <span className="font-bold">Save as the {m.label} matrix</span>
                      <span className="text-2xs font-normal opacity-80">
                        {m.hint}
                        {m.rows.length > 0 && (
                          <> · replaces {m.rows.length}{m.savedFrom ? ` saved from ${formatWeekday(m.savedFrom)}` : ""}</>
                        )}
                      </span>
                    </AlertDialogAction>
                  ))}
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* The way back from the one press on this screen that writes seventy rows.
          Copying the wrong day was a twenty-minute mistake: the only way to reverse it
          was to open seventy cards and take each person off by hand, on a tablet.

          It says what it will remove *and what it will not*, because that is the whole
          question somebody asks before pressing it. An undo that might also take back
          the morning's work is an undo nobody dares use — so this one is not "clear the
          board": the copy wrote down exactly which rows it created, and only those go.

          It outlives the toast and the page load on purpose. "I copied the wrong day"
          is noticed a minute later, by which time a four-second toast is long gone. */}
      {canManage && undoable && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-3 py-1.5 print:hidden">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-warning/15 text-warning-strong">
            <Undo2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight">
              Copied {undoable.allocations.length} {undoable.allocations.length === 1 ? "person" : "people"}
              {" from "}{undoable.sources.join(" and ")}
            </div>
            <div className="text-2xs text-muted-foreground">
              Wrong day? Undo takes back only those {undoable.allocations.length} — everybody else on this board stays.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => { keepCopy(); setUndoable(null); }}
              title="Keep the copy and stop asking"
            >
              Keep it
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 border-warning/50" disabled={undoCopy.isPending}>
                  <Undo2 className="mr-2 h-4 w-4" />
                  Undo the copy
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Take {undoable.allocations.length} {undoable.allocations.length === 1 ? "person" : "people"} back off {formatWeekday(onDate)}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Only the ones copied from {undoable.sources.join(" and ")} onto the {shift.toLowerCase()} board. Anybody who
                    was already here, and anybody placed by hand since, is left exactly as they are. The attendance records this
                    copy created go with them; ones that were already there do not.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => undoCopy.mutate(undoable, { onSuccess: () => setUndoable(readUndo()) })}
                  >
                    Undo the copy
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      {/* An empty board on a date the rota has people due is not a quiet night: it is a
          board nobody imported. Three nights went that way unnoticed behind a small
          "0 / 64 on the rota", so it is said where the board starts. */}
      {!showAll && boardNotImported({
        loading: allocLoading || rosterLoading,
        allocations: allocations.length,
        dueOnRota: roster.length,
      }) && (
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warning/50 bg-warning/10 px-3 py-1.5 text-sm print:hidden">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning-strong" />
          <span className="min-w-0 flex-1">
            <b>{shift} not imported for this date.</b>{" "}
            <span className="text-muted-foreground">
              {roster.length} on the rota and nobody on the board — import the {shift.toLowerCase()} sheet, or copy a day.
            </span>
          </span>
          {/* The two ways out, where the problem is said, rather than up in the band and
              down in the toolbar for somebody to connect. */}
          {canManage && (
            <span className="flex shrink-0 items-center gap-2">
              {onSync && (
                <Button size="sm" variant="outline" className="h-7 border-warning/50 bg-background" onClick={onSync}>
                  <CloudDownload className="mr-1.5 h-3.5 w-3.5" />
                  Sync the {shift.toLowerCase()} sheet
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => runCopy({ kind: "last" })}
                disabled={copyLastLikeDay.isPending}
              >
                <CopyPlus className="mr-1.5 h-3.5 w-3.5" />
                Copy the last day
              </Button>
            </span>
          )}
        </div>
      )}

      {ghostCount > 0 && (
        <div className={cn("flex flex-wrap items-center justify-between gap-3 border bg-muted px-3 py-1.5", SHEET_RULE)}>
          <p className="text-sm">
            <span className="font-bold">Not planned yet.</span>{" "}
            <span className="text-muted-foreground">
              The {ghostCount} names in grey italic are where the {plan?.label} matrix puts the people due in. Nothing is saved until you save it.
            </span>
          </p>
          {canManage && (
            <Button size="sm" onClick={() => runCopy({ kind: "matrix", matrix: planKind })} disabled={copyLastLikeDay.isPending}>
              Save this plan
            </Button>
          )}
        </div>
      )}

      {SECTIONS.map((section) => {
        if (!blockVisible(section.key)) return null;
        const ofKind = areas.filter((a) => sheetBandOf(a) === section.key);
        if (ofKind.length === 0) return null;
        const open = openSections[section.key] !== false;
        const inSection = ofKind.reduce((n, a) => n + peopleIn(a.id).length, 0);
        // A banda inteira tem a altura da coluna mais comprida, mais uma linha livre
        // para escrever um nome — como a folha. As faltas contam na banda de apoio
        // quando estão lá dentro.
        const bandRows = Math.max(
          0,
          ...ofKind.map((a) => peopleIn(a.id).length + ghostsIn(a.id).length),
          ...(section.key === "support" && awayInSupport ? AWAY_BLOCKS.map((b) => peopleWith(b.status).length) : []),
        ) + 1;
        return (
        <div key={section.key}>
        <SectionLabel
          accent={section.accent}
          count={inSection}
          open={open}
          onToggle={() => setOpenSections((o) => ({ ...o, [section.key]: !open }))}
        >
          {section.label}
        </SectionLabel>
        {/* Folded is hidden, not unmounted. Folding is for the screen — the supervisor
            who does not need Support at 6am — and it is remembered in this browser. The
            sheet printed from that browser came out with no Support on it at all, and a
            printed board missing fourteen people looks exactly like one that is right.
            `headcount-folded` is what the print sheet opens again. */}
        <div className={cn(!open && "hidden headcount-folded")}>
        <DndContext
          sensors={columnSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e: DragEndEvent) => {
            const { active, over } = e;
            if (!over || active.id === over.id) return;
            const ids = ofKind.map((a) => a.id);
            const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
            // Renumbered in tens, leaving room to slide something in later without
            // rewriting the whole section.
            reorder.mutate(moved.map((id, i) => ({ id, sort_order: (i + 1) * 10 })));
          }}
        >
        <SortableContext items={ofKind.map((a) => a.id)} strategy={rectSortingStrategy}>
        {/* Colunas encostadas, como as da folha: a linha fina entre duas é uma só, e
            não um corredor de cartões. Tantas lado a lado quantas o ecrã deixar. */}
        <div className="headcount-columns grid gap-0" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>
        {ofKind.map((area) => {
          const people = peopleIn(area.id);
          return (
            <SortableColumn key={area.id} id={area.id}>
            {(grip) => (
            <DropZone
              disabled={!canManage}
              className="-mb-px -mr-px h-full rounded-none"
              onDrop={(employeeId) => handleDrop({ areaId: area.id, status: "assigned" })(employeeId)}
            >
              <SheetColumn
                title={area.name}
                head="heading"
                grip={canManage ? grip : undefined}
                onHeadClick={canManage ? () => setPicking({ id: area.id, name: area.name }) : undefined}
                headHint={canManage ? `Add or remove people on ${area.name}` : undefined}
                rows={bandRows}
                count={people.length}
                filled={people.length + ghostsIn(area.id).length}
                blank={canManage ? (
                  <SheetCellInput
                    className="h-full"
                    people={everyone}
                    columnName={area.name}
                    whereNow={whereNow}
                    onPick={(id) => handleDrop({ areaId: area.id, status: "assigned" })(id)}
                  />
                ) : undefined}
              >
                    {people.map(({ person: p, shown, sheetName, startTime, tag, overtime: isOt, leader: leadsToday }) => (
                      <Chip
                        key={p.id}
                        name={shown}
                        personRef={refOf.get(p.id)}
                        sheetName={sheetName}
                        startTime={startTime}
                        tag={tag}
                        leader={leadsToday || isLeader(p.department)}
                        lineLeader={leadsToday}
                        lineName={area.name}
                        role={roleStripe(p.department)}
                        dimmed={isDimmed(shown) && isDimmed(p.full_name)}
                        overtime={isOt}
                        leftEarlyAt={byEmployee.get(p.id)?.left_early_at ?? null}
                        arrivedLateAt={byEmployee.get(p.id)?.arrived_late_at ?? null}
                        crew={crewBadge(p.shift_group)}
                        leftOn={p.left_on ?? null}
                        onOpen={() => setEditing(p.id)}
                        tone={area.kind === "production" ? "production" : "support"}
                        draggable={canManage}
                        onDragStart={(e) => {
                          holdDrag(p.id);
                          dragStart(e, p.id);
                        }}
                      />
                    ))}
                    {ghostsIn(area.id).map((p) => (
                      <div
                        key={`plan-${p.id}`}
                        data-planned
                        title={`${p.full_name} — planned by the ${plan?.label ?? "matrix"}, not saved yet`}
                        className={cn("flex h-12 shrink-0 flex-col items-center justify-center border-b px-2 text-center text-sm italic text-muted-foreground", SHEET_RULE)}
                      >
                        <span className="max-w-full truncate">{p.full_name}</span>
                      </div>
                    ))}
              </SheetColumn>
            </DropZone>
            )}
            </SortableColumn>
          );
        })}
        {/* A figura roxa e as faltas fecham a segunda banda, que é onde a folha as tem. */}
        {section.key === "support" && awayInSupport && sheetTail(bandRows)}
        </div>
        </SortableContext>
        </DndContext>
        </div>
        </div>
        );
      })}


      {/* The standard this board is copied from, read by crew rather than by column —
          which is the only way a crossover day makes sense. Opened from the copy menu,
          because the question it answers is "what would that give me". */}
      <MatrixDialog
        open={matrixOpen}
        onOpenChange={setMatrixOpen}
        shift={shift}
        onDate={onDate}
        matrices={matrix.matrices}
        areas={areas}
        employeeById={employeeById}
      />

      {/* Filling a line by dragging seventy cards is the reason people go back to the
          spreadsheet. The column heading opens a search over the whole shift — the same
          picker the Workforce daily board uses, so the two behave alike. */}
      {picking && (
        <AreaPicker
          areaId={picking.id}
          areaName={picking.name}
          open
          onOpenChange={(v) => !v && setPicking(null)}
          // Everyone active, not only this shift's crew. Somebody called in from the
          // weekend crew onto a Monday is a real thing the factory does — and a picker
          // that cannot find them is a picker that sends people back to the sheet.
          // Whose crew they are is shown, so bringing one across is a visible choice.
          people={[...(everyoneById?.values() ?? [])].map((e) => {
            const current = byEmployee.get(e.id)?.area_id ?? null;
            const theirs = onShift.find((o) => o.id === e.id);
            return {
              ...e,
              currentAreaId: current,
              currentAreaName: current ? areas.find((a) => a.id === current)?.name ?? null : null,
              offRota: theirs?.offRota ?? false,
              otherShift: theirs ? null : e.shift_group,
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

      {/* The same picker, writing a state instead of an area. Marking Holiday here is
          the quick call somebody makes when a person does not appear; the Leave screen
          is the formal request with a balance behind it. Both write the same
          `daily_allocations.status`, so the board cannot end up telling two stories. */}
      {pickingAway && (
        <AreaPicker
          areaId={`away:${pickingAway.status}`}
          areaName={pickingAway.label}
          open
          onOpenChange={(v) => !v && setPickingAway(null)}
          people={[...(everyoneById?.values() ?? [])].map((e) => {
            const alloc = byEmployee.get(e.id);
            const here = alloc?.status === pickingAway.status;
            const theirs = onShift.find((o) => o.id === e.id);
            return {
              ...e,
              // The picker ticks by area id, so the block borrows one. Somebody
              // already in this block reads as ticked; somebody on a line shows the
              // line they are on, so moving them is a visible choice rather than a
              // silent one.
              currentAreaId: here ? `away:${pickingAway.status}` : alloc?.area_id ?? null,
              currentAreaName: here
                ? pickingAway.label
                : alloc?.area_id ? areas.find((a) => a.id === alloc.area_id)?.name ?? null : null,
              offRota: theirs?.offRota ?? false,
              otherShift: theirs ? null : e.shift_group,
            };
          })}
          onToggle={(person, to) => {
            if (!to) { remove.mutate(person.id); return; }
            place.mutate({ employeeId: person.id, areaId: null, status: pickingAway.status });
          }}
        />
      )}

      {editing && (() => {
        const person = employeeById.get(editing);
        const alloc = byEmployee.get(editing);
        if (!person) return null;
        // Postgres hands back `14:00:00`; the time input wants `14:00`.
        const leftEarly = alloc?.left_early_at ? alloc.left_early_at.slice(0, 5) : null;
        const arrivedLate = alloc?.arrived_late_at ? alloc.arrived_late_at.slice(0, 5) : null;
        return (
          <PersonDayDialog
            open
            onOpenChange={(v) => !v && setEditing(null)}
            // O nome do cadastro em título, como no board; a grafia da folha
            // ("LUCAS GLOR") fica por baixo, pequena.
            name={person.full_name}
            fullName={alloc?.sheet_name ?? undefined}
            shiftGroup={person.shift_group}
            status={(alloc?.status as AllocStatus | undefined) ?? null}
            areaId={alloc?.area_id ?? null}
            areas={areas}
            canManage={canManage}
            halfDay={alloc?.half_day === true}
            // Explicit, like the status buttons: the day already says how it counts and
            // this only says how much of it was worked. Without that, ticking Half day
            // on somebody off their rota re-ran the rule and quietly made them overtime.
            onSetHalfDay={(v) => place.mutate({
              employeeId: editing,
              areaId: alloc?.area_id ?? null,
              status: (alloc?.status as AllocStatus | undefined) ?? "unpaid",
              halfDay: v,
              leftEarlyAt: leftEarly,
              arrivedLateAt: arrivedLate,
              explicit: true,
            })}
            leftEarlyAt={leftEarly}
            onSetLeftEarlyAt={(v) => place.mutate({
              employeeId: editing,
              areaId: alloc?.area_id ?? null,
              status: (alloc?.status as AllocStatus | undefined) ?? "assigned",
              halfDay: alloc?.half_day === true,
              leftEarlyAt: v,
              arrivedLateAt: arrivedLate,
              explicit: true,
            })}
            arrivedLateAt={arrivedLate}
            onSetArrivedLateAt={(v) => place.mutate({
              employeeId: editing,
              areaId: alloc?.area_id ?? null,
              status: (alloc?.status as AllocStatus | undefined) ?? "assigned",
              halfDay: alloc?.half_day === true,
              leftEarlyAt: leftEarly,
              arrivedLateAt: v,
              explicit: true,
            })}
            onSetStatus={(st) => place.mutate({
              employeeId: editing,
              // Overtime is still a place; absence and holiday are not.
              areaId: st === "assigned" || st === "overtime" ? alloc?.area_id ?? null : null,
              status: st,
              halfDay: alloc?.half_day === true,
              // Carried, not dropped: the upsert writes every column, so leaving it
              // out would silently clear an early finish somebody had recorded. The
              // mutation itself drops it when the status stops being a day worked.
              leftEarlyAt: leftEarly,
              arrivedLateAt: arrivedLate,
              // These five buttons are the one place a person says how the day counts,
              // so what they say stands — over the rota's guess and over a mark already
              // on the row. Pressing In on somebody wrongly marked overtime used to
              // write "assigned" and get "overtime" straight back.
              explicit: true,
            })}
            onSetArea={(id) => place.mutate({
              employeeId: editing,
              areaId: id,
              status: alloc?.status === "overtime" ? "overtime" : "assigned",
              halfDay: alloc?.half_day === true,
              leftEarlyAt: leftEarly,
              arrivedLateAt: arrivedLate,
            })}
            onSetShift={(sg) => changeShift.mutate({ employeeId: editing, shiftGroup: sg })}
            patterns={patterns}
            patternId={person.shift_pattern_id}
            onSetPattern={(id) => setPattern.mutate({ employeeId: editing, patternId: id })}
            isLeader={!!alloc?.is_leader}
            onSetLeader={(v) => setLeader.mutate({ employeeId: editing, areaId: alloc?.area_id ?? null, leader: v })}
            onRemove={() => { remove.mutate(editing); setEditing(null); }}
          />
        );
      })()}

      {/* Sem a banda de apoio no ecrã (filtrada ou dobrada), as faltas não podem ir com
          ela: ficam numa fila sua, com o mesmo desenho. */}
      {!awayInSupport && (
        <>
          <SectionLabel>Away, overtime &amp; training</SectionLabel>
          <div className="headcount-away grid gap-0" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>
            {sheetTail(Math.max(0, ...AWAY_BLOCKS.map((b) => peopleWith(b.status).length)) + 1)}
          </div>
        </>
      )}

      {/* Quem o rota põe neste turno e ainda não está em coluna nenhuma.
          Fora da folha, de propósito. Não é uma coluna da planilha e não tem tamanho
          certo — num domingo eram quinze — e dentro da grelha esticava as colunas da
          mesma fila: os Totais de Unpaid, Holidays e Overtime desciam para longe dos
          nomes. Aqui é uma bandeja por baixo, nas mesmas faixas de 150px da folha, para
          as células alinharem com as colunas de cima. Larga-se aqui quem se quer tirar
          de uma linha. */}
      {trayPeople.length > 0 && (
        <section aria-label={`Not placed yet: ${trayPeople.length}`} className="mt-6">
          <DropZone disabled={!canManage} onDrop={(employeeId) => handleDrop("roster")(employeeId)} className="rounded-none">
            <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 border bg-muted px-3 py-2", SHEET_RULE)}>
              <h3 className="text-sm font-bold text-foreground">
                Not placed yet <span className="font-figure tabular-nums">({trayPeople.length})</span>
              </h3>
              {canManage && (
                <p className="text-xs text-muted-foreground">
                  Drag a name onto a column, or type it in a column's empty cell.
                </p>
              )}
            </div>
            <div className="grid gap-0" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>
              {[...trayPeople]
                .sort((a, b) => a.full_name.localeCompare(b.full_name))
                .map((p) => (
                  <div key={p.id} className={cn("-mt-px border border-t-0 bg-card [&>*]:border-b-0", SHEET_RULE, "-mr-px")}>
                    <Chip
                      name={p.full_name}
                      personRef={refOf.get(p.id)}
                      dimmed={isDimmed(p.full_name)}
                      role={roleStripe(p.department)}
                      tone="roster"
                      crew={crewBadge(p.shift_group)}
                      onOpen={() => setEditing(p.id)}
                      draggable={canManage}
                      onDragStart={(e) => {
                        holdDrag(p.id);
                        dragStart(e, p.id);
                      }}
                    />
                  </div>
                ))}
            </div>
          </DropZone>
        </section>
      )}

      {/* Activos sem crew no cadastro (o import da folha cria-os assim). O roster
          separa por crew, e sem crew não estavam em board nenhum — nem em "Not placed
          yet". Ficam aqui, sem crew inventado, até alguém os colocar ou lhes dar um. */}
      {noCrewUnplaced.length > 0 && (
        <section aria-label={`No crew on file: ${noCrewUnplaced.length}`} className="mt-6">
          <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1 border bg-muted px-3 py-2", SHEET_RULE)}>
            <h3 className="text-sm font-bold text-foreground">
              No crew on file <span className="font-figure tabular-nums">({noCrewUnplaced.length})</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Active, but with no crew, so no board lists them. Place them here or give them a crew.
            </p>
          </div>
          <div className="grid gap-0" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))" }}>
            {[...noCrewUnplaced]
              .sort((a, b) => a.full_name.localeCompare(b.full_name))
              .map((p) => (
                <div key={p.id} className={cn("-mt-px border border-t-0 bg-card [&>*]:border-b-0", SHEET_RULE, "-mr-px")}>
                  <Chip
                    name={p.full_name}
                    personRef={refOf.get(p.id)}
                    dimmed={isDimmed(p.full_name)}
                    role={roleStripe(p.department)}
                    tone="roster"
                    crew={null}
                    onOpen={() => setEditing(p.id)}
                    draggable={canManage}
                    onDragStart={(e) => {
                      holdDrag(p.id);
                      dragStart(e, p.id);
                    }}
                  />
                </div>
              ))}
          </div>
        </section>
      )}

    </div>
    </>
  );
}

/**
 * Os separadores do fundo do Excel: um por dia do mês, com a data como a folha da
 * empresa a escreve (`03.08.2026`), pela ordem do calendário.
 *
 * O board já tinha as setas e o calendário; faltava ver o mês inteiro de uma vez e
 * saltar para um dia com um toque, que é como toda a gente anda na folha.
 */
function SheetDayTabs({ date, today, onPick }: { date: string; today: string; onPick: (d: string) => void }) {
  const days = useMemo(() => {
    const [y, m] = date.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);
  }, [date]);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[aria-current='date']");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [date]);

  return (
    <nav
      aria-label="Days of the month"
      className="print:hidden md:sticky md:bottom-0 md:z-10 border-t border-neutral-400 bg-muted/95 backdrop-blur"
    >
      <div ref={strip} className="flex overflow-x-auto overscroll-x-contain">
        {days.map((d) => {
          const active = d === date;
          const [yy, mm, dd] = d.split("-");
          const weekend = [0, 6].includes(new Date(`${d}T12:00:00`).getDay());
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-current={active ? "date" : undefined}
              title={formatLong(d) + (d === today ? " (today)" : "")}
              className={cn(
                "shrink-0 border-r border-neutral-400 px-3 py-2 font-figure text-xs tabular-nums",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                // O separador aberto é branco e sobe sobre a linha, como no Excel.
                active
                  ? "-mt-px border-t-2 border-t-[#217346] bg-card font-bold text-[#217346] dark:text-[#5fd08d]"
                  : cn("text-muted-foreground hover:bg-card/60 hover:text-foreground", weekend && "text-muted-foreground/60"),
                d === today && !active && "underline decoration-2 underline-offset-4",
              )}
            >
              {`${dd}.${mm}.${yy}`}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function ProductionHeadcountPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const { role } = useAuth();
  const canManage = can("headcount.manage");
  // Opens on the board that is actually running. At 03:00 that is last night's, not an
  // empty Day board for a day that has not started — see `currentShift`. The controls
  // stay free afterwards: a day supervisor at 07:00 often wants to read what the night
  // left, and the first thing anyone does is page back a day.
  const opened = useMemo(() => currentShift(), []);
  // The day and the board live in the address, not only in state. Held in state alone,
  // anything that remounted the page — a reload, a session refresh, coming back from
  // another screen — dropped the reader back on today, and paging to 14/10 and opening
  // the Night tab could land on 12/10. The address survives all of those, and a link to
  // "the night of the 14th" can be sent to somebody.
  const [params, setParams] = useSearchParams();
  const fromUrlDate = params.get("date");
  const date = fromUrlDate && /^\d{4}-\d{2}-\d{2}$/.test(fromUrlDate) ? fromUrlDate : opened.operationalDate;
  const fromUrlView = params.get("shift");
  const view: ViewKey = fromUrlView === "Day" || fromUrlView === "Night" || fromUrlView === "Split"
    ? fromUrlView : opened.shift;
  const setBoard = (next: { date?: string; view?: ViewKey }) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set("date", next.date ?? date);
      p.set("shift", next.view ?? view);
      return p;
    }, { replace: true });
  const setDate = (d: string) => setBoard({ date: d });
  const setView = (v: ViewKey) => setBoard({ view: v });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data: areas = [], isLoading } = useHeadcountAreas();

  // Split shows two boards at once, so the sheet takes the Day one — a workbook has
  // to be one shift per file for the import to know what it is reading back.
  const sheetShift: ShiftKey = view === "Split" ? "Day" : (view as ShiftKey);
  const [sheet, setSheet] = useState<"export" | "import" | null>(null);
  /** Opened by "Sync from SharePoint", so the dialog reads the day without a second press. */
  const [syncing, setSyncing] = useState(false);
  /**
   * Everybody active, not this board's crew.
   *
   * The company's day sheet carries night-crew Quality and Maintenance — they cover
   * both shifts and are written on both boards' sheets. Handing the import only the
   * day crew meant "Ismael", "Richard" and "Toni" could never match anybody, on any
   * import, and were reported as names nobody answers to. The parser resolves a name
   * both boards share to the board the sheet is for, so widening this costs nothing
   * and stops throwing those people away.
   */
  const { byId: everyoneById } = useShiftRoster(sheetShift, date, true);
  const sheetRoster = useMemo(() => [...everyoneById.values()], [everyoneById]);

  const openSync = () => { setSyncing(true); setSheet("import"); };

  const shiftDate = (delta: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + delta);
    setDate(toISO(d));
  };

  /** The calendar, and whether the board is showing the day that is running. */
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const onToday = date === opened.operationalDate;

  return (
    // The shell, which this screen was the only one in the section without.
    //
    // Employee, Annual Leave, Attendance and Finance Close all render inside
    // `DashboardLayout`; the board did not, and had never done so in its history. So
    // the one screen somebody opens first — the way in to the other four — was the one
    // with no sidebar, no breadcrumb, no shift clock, no stopped-line alarm and no dark
    // mode toggle. Reaching Quality from it meant the browser's Back button, which a
    // kiosk tablet does not have. Everything the board draws is unchanged; it is simply
    // in the building now.
    <DashboardLayout>
    {/* `print-content` is what the global print sheet hangs its rules off — without it
        a name clamped to a 200px column printed as "FELIPE DE …" and stayed clamped,
        because paper has no window to widen. `print-landscape` turns the paper: the
        board is a row of up to twenty columns, and portrait made a sheet meant to be
        read on a wall come out as pages of fragments. */}
    <div className="space-y-3 print-content print-landscape">
      {/* One line for where you are and how fresh the clock is. They were three rows —
          a second Back (the shell's is pinned above this page and never scrolls away),
          the tabs, and the clock note under them — before the band had started. */}
      <div className="no-print flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <WorkforceTabs />
        {/* Where the clock is, before any figure below is read against it. Compact here:
            this screen is the board, and the clock is context for it rather than its
            subject. */}
        <ClockCoverageNote todayIso={opened.operationalDate} compact />
      </div>

      <ModuleHeader
        title="Production Headcount"
        description="Daily allocation of people to production and support areas"
        compact
        // The band is a `<header>`, and the print sheet hides every one of those. It
        // carries the title and the date, which is everything that makes a printed
        // board a document rather than a grid of names.
        className="print-keep"
      >
        <>
            {/* Which board, beside which day: the two answer one question together, and
                with Day / Night / Both on a row of its own under the band they were read
                as separate settings. */}
            <Tabs value={view} onValueChange={(v) => setView(v as ViewKey)} className="print:hidden">
              <TabsList className="h-9 bg-white/10 p-1 text-white/70">
                {/* Two boards, not four. Day carries everybody whose shift runs while the
                    lines do — Mon–Thu, Fri–Mon and the warehouse — which is how the
                    factory's own sheets are drawn. Each card says which crew. */}
                {(["Day", "Night", "Split"] as const).map((v) => (
                  <TabsTrigger
                    key={v}
                    value={v}
                    className="h-7 px-3 text-xs text-white/75 focus-visible:ring-white/70 focus-visible:ring-offset-0 data-[state=inactive]:hover:text-white data-[state=active]:bg-white data-[state=active]:text-[hsl(var(--section))]"
                  >
                    {v === "Split" ? "Both" : v}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {/* The arrows step, and the date itself opens a calendar. Stepping is right
                for the days either side of the one you are on — which is most of the
                use — and hopeless for the rest: a board wanted three weeks out was
                twenty-one presses, so people gave up and read the spreadsheet instead.
                The date looked like a label because it was one; it is now the control
                its position always promised. */}
            <div className="flex items-center gap-0.5 rounded-lg bg-white/10 p-0.5 print:bg-transparent">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 print:hidden" onClick={() => shiftDate(-1)} aria-label="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    // `print-keep` because this is where the printed sheet says which
                    // day it is. Everything else in this band is a control and prints
                    // hidden; the date is the record.
                    className="print-keep min-w-[8.5rem] rounded-md px-2 py-1 text-center text-sm font-semibold tabular-nums text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 print:px-0 print:text-black print:hover:bg-transparent"
                    aria-label={`Showing ${formatLong(date)} — pick another day`}
                  >
                    {formatLong(date)}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="center">
                  <Calendar
                    mode="single"
                    defaultMonth={new Date(`${date}T12:00:00`)}
                    selected={new Date(`${date}T12:00:00`)}
                    onSelect={(d) => {
                      if (!d) return;
                      setDate(toISO(d));
                      setDatePickerOpen(false);
                    }}
                    initialFocus
                    className="pointer-events-auto p-3"
                  />
                </PopoverContent>
              </Popover>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-white hover:bg-white/20 print:hidden" onClick={() => shiftDate(1)} aria-label="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {/* Only once the board has been paged away from the day that is running.
                A "Today" that is always there is a button that is usually a no-op. */}
            {!onToday && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2.5 text-white hover:bg-white/20 print:hidden"
                // Asked again on the press rather than reused from mount: this screen
                // is left open on a wall tablet for days, and `opened` is the shift that
                // was running when it was loaded. A "Today" that returns to Tuesday is
                // worse than no button.
                onClick={() => setDate(currentShift().operationalDate)}
              >
                Today
              </Button>
            )}
            <Badge variant="outline" className="border-white/40 text-white print:text-black">{dayTypeLabel(date)}</Badge>
            {/* Whether the day being viewed is a plan or a record. One badge per board,
                because the two boards answer differently on the same day — see
                DayClockBadge. In Split both are named, so neither can be read as
                covering the other. */}
            {view === "Split" ? (
              <>
                <DayClockBadge onDate={date} shift="Day" boardLabel="Day" />
                <DayClockBadge onDate={date} shift="Night" boardLabel="Night" />
              </>
            ) : (
              <DayClockBadge onDate={date} shift={view as ShiftKey} />
            )}
            {/* A board showing yesterday is right at 03:00 and baffling unsaid. Drops
                away the moment the reader moves off it, so it never becomes furniture. */}
            {opened.carriedOver && date === opened.operationalDate && view === opened.shift && (
              <Badge className="border-primary/30/50 bg-primary/25 text-primary-foreground print:hidden">
                Night still running — filed under {formatLong(date)}
              </Badge>
            )}
            {/* The actions, apart from the date by a rule. Below 1536px they keep their
                icon and lose the word (the name stays as the accessible name and the
                tooltip), which is what lets the band stay one line on a laptop. Sync
                keeps a word at every width: it is the one pressed every morning. */}
            <span aria-hidden className="mx-1 hidden h-6 w-px bg-white/20 sm:block print:hidden" />
            {canManage && (
              <>
                {/* The sheet the office types every morning, one press away. It opens the
                    same preview the file path uses — nothing is saved until it is confirmed. */}
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 print:hidden"
                  aria-label="Sync from SharePoint"
                  title="Sync from SharePoint — read today's sheet and preview it before anything is saved"
                  onClick={openSync}
                >
                  <CloudDownload className="h-4 w-4 2xl:mr-2" />
                  <span className="ml-1.5 2xl:hidden">Sync</span>
                  <span className="hidden 2xl:inline">Sync from SharePoint</span>
                </Button>
                <HeaderAction icon={Upload} label="Import" title="Import a sheet from a file" onClick={() => { setSyncing(false); setSheet("import"); }} />
              </>
            )}
            <HeaderAction icon={Download} label="Export" title="Export this day as a sheet" onClick={() => setSheet("export")} />
            <HeaderAction icon={Printer} label="Print" title="Print the board" onClick={() => window.print()} />
        </>
      </ModuleHeader>

      {!canManage && (
        <p className="text-xs text-muted-foreground print:hidden">Read-only view — you don't have permission to change allocations.</p>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : view === "Split" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          <ShiftBoard onDate={date} shift="Day" areas={areas} canManage={canManage} onSync={openSync} />
          <ShiftBoard onDate={date} shift="Night" areas={areas} canManage={canManage} />
        </div>
      ) : (
        <ShiftBoard onDate={date} shift={view} areas={areas} canManage={canManage} onSync={openSync} />
      )}

      {/* The board is today; these two are the period it adds up to. Kept on the same
          screen because the questions a supervisor asks after placing people — how long
          is this period, and who is running ahead of their rota — used to mean two
          other pages.
          `no-print` because the sheet that comes off this screen is the board and
          nothing else. Print took the whole page: a twenty-eight day calendar and a
          shift-balance table followed the board onto paper, which is two extra sheets
          nobody asked for and a page of pay information left on a printer by the lines.
          Reading them is what the screen is for. */}
      {/* As abas da folha, uma por dia do mês, como no fundo do Excel. */}
      <SheetDayTabs date={date} today={opened.operationalDate} onPick={setDate} />

      {/* Fora da vista principal, à espera de quem os peça. O board é para ver quem está
          onde; as horas por linha, o período e as horas extra são outra pergunta, e de
          manhã empurravam a folha para fora do ecrã. */}
      <div className="no-print">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          aria-expanded={detailsOpen}
          className="flex items-center gap-1.5 rounded text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", detailsOpen && "rotate-90")} />
          {detailsOpen ? "Hide hours and overtime" : "Show hours and overtime"}
        </button>
      </div>
      {detailsOpen && (
      <div className="no-print space-y-4">
        {view === "Split" ? (
          <>
            <HeadcountHoursTable date={date} shift="Day" areas={areas} />
            <HeadcountHoursTable date={date} shift="Night" areas={areas} />
          </>
        ) : (
          <HeadcountHoursTable date={date} shift={view} areas={areas} />
        )}
        <PeriodCalendar />
        <HeadcountOvertimePanel />
      </div>
      )}

      <HeadcountSheetDialog
        open={sheet !== null}
        onOpenChange={(v) => !v && setSheet(null)}
        mode={sheet ?? "export"}
        date={date}
        shift={sheetShift}
        areas={areas}
        roster={sheetRoster}
        canManage={canManage}
        autoLoad={syncing}
        onImported={() => {
          qc.invalidateQueries({ queryKey: ["allocations"] });
          qc.invalidateQueries({ queryKey: ["headcount-roster-all"] });
          qc.invalidateQueries({ queryKey: ["headcount-allocations"] });
        }}
      />
    </div>
    </DashboardLayout>
  );
}
