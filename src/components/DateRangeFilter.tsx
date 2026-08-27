import { useEffect, useState } from "react";
import { startOfDay, endOfDay, subDays, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { periodLabel, stepRange, type StepDirection } from "@/lib/dateStep";
import { getCurrentFactoryShift, londonWallToUtc } from "@/lib/shifts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDeviceType } from "@/hooks/use-device-type";

export type DateRange = { from?: Date; to?: Date };

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "shift"
  | "7d"
  | "30d"
  | "90d"
  | "month"
  | "all"
  | "custom";

const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  shift: "Current shift",
  // "Last" rather than a bare number: "7 days" reads as a duration, and somebody
  // choosing it wants the week behind them, not any seven days.
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  // Um trimestre, porque há perguntas que trinta dias não respondem: um MTBF medido
  // sobre um mês, numa fábrica onde metade dos activos falha menos de uma vez por
  // mês, é medido sobre uma falha.
  "90d": "Last 90 days",
  month: "This month",
  all: "All time",
};

function currentShiftRange(now = new Date()): DateRange {
  // DAY 06–18, NIGHT 18–06, on London time from end to end.
  //
  // This used the browser's local hour AND built the boundary with setHours, so on a
  // device in another timezone both the branch and the 06:00/18:00 edge were wrong,
  // silently: at 15:00 local on a device two hours ahead, "Current shift" meant the
  // night one and started at the wrong instant. Every other shift calculation in the
  // system — getCurrentFactoryShift, session_write_deadline, the shift filters — is
  // London-based, so this one disagreed with all of them.
  //
  // getCurrentFactoryShift decides which shift is running and londonWallToUtc turns
  // a London wall-clock hour into a real instant, both already used by the rest of
  // the system.
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  const [y, mo, d] = sessionDate.split("-").map(Number);
  const from = new Date(londonWallToUtc(y, mo, d, shiftCode === "night" ? 18 : 6));
  return { from, to: now };
}

export function getPresetRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: now };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "shift":
      return currentShiftRange(now);
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: now };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: now };
    case "90d":
      return { from: startOfDay(subDays(now, 89)), to: now };
    case "month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "all":
      return {};
    default:
      return {};
  }
}

interface Props {
  value: DateRange;
  preset: DateRangePreset;
  onChange: (range: DateRange, preset: DateRangePreset) => void;
  className?: string;
  /** When set, persists the current preset+range to localStorage and restores on mount. */
  storageKey?: string;
  /**
   * As setas que andam com o período para trás e para a frente, pelo seu próprio
   * tamanho — um dia anda um dia, um mês anda um mês.
   *
   * Por dentro e não por fora porque o período é um objecto só: o Production Control
   * tinha um alternador `Daily | Monthly`, um navegador de mês com setas próprias e
   * dois botões de atalho, todos ligados ao mesmo veio deste campo e nenhum a saber
   * dos outros. Opcional porque os outros ecrãs que usam este campo lêem um relatório
   * de um intervalo escolhido, e a um relatório não se pergunta "e o anterior?".
   */
  steppable?: boolean;
}

export function DateRangeFilter({ value, preset, onChange, className, storageKey, steppable }: Props) {
  const [open, setOpen] = useState(false);
  const device = useDeviceType();

  // Restore from localStorage on mount
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`dr:${storageKey}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { preset: DateRangePreset; from?: string; to?: string };
      if (parsed.preset && parsed.preset !== "custom") {
        onChange(getPresetRange(parsed.preset), parsed.preset);
      } else if (parsed.preset === "custom") {
        onChange(
          { from: parsed.from ? new Date(parsed.from) : undefined, to: parsed.to ? new Date(parsed.to) : undefined },
          "custom",
        );
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on change
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        `dr:${storageKey}`,
        JSON.stringify({
          preset,
          from: value.from?.toISOString(),
          to: value.to?.toISOString(),
        }),
      );
    } catch {
      /* ignore */
    }
  }, [storageKey, preset, value.from, value.to]);

  const setPreset = (p: DateRangePreset) => onChange(getPresetRange(p), p);

  // Um preset foi escolhido pelo nome, e é o nome que se lê de volta — "Today", "Last 7
  // days". Fora deles, "Custom" não é o nome de nada: quem chegou ali pelo calendário
  // ou pelas setas quer ler o período, não a categoria a que ele pertence.
  const named = preset !== "custom";
  const written = periodLabel(value.from, value.to);
  const presetLabel = named ? PRESET_LABELS[preset as Exclude<DateRangePreset, "custom">] : written;

  const quick: DateRangePreset[] = ["today", "yesterday", "shift", "7d", "30d", "90d", "month", "all"];

  // Andar fora do preset é sair dele: "Today" um dia atrás já não é hoje. O período
  // passa a escrever-se por extenso, que é o que o rótulo acima faz.
  const step = (direction: StepDirection) => {
    const next = stepRange(value, direction);
    if (next) onChange(next, "custom");
  };
  const canStep = steppable && stepRange(value, 1) !== null;

  const trigger = (
    <PopoverTrigger asChild>
      {/* One control, not eight.
          Today, Yesterday, Current shift, 7 days, 30 days, This month, All and
          Custom were eight things to read before choosing one, and the row wrapped
          on anything narrower than a desktop. The button says what is selected; the
          choosing happens when somebody asks for it. */}
      <Button
        variant="outline"
        className={cn(
          "h-9 min-w-0 justify-start gap-2 font-normal",
          steppable ? "flex-1 rounded-none border-x-0" : className,
        )}
        aria-label="Period"
      >
        <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{presetLabel}</span>
        {named && (
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{written}</span>
        )}
        <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
      </Button>
    </PopoverTrigger>
  );

  const body = (

      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          {/* The presets read as a list, in the order somebody actually reaches for
              them: today's work first, then the periods a report covers. */}
          <div className="flex min-w-[11rem] flex-col gap-0.5 border-b p-2 sm:border-b-0 sm:border-r">
            {quick.map((p) => {
              const active = preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPreset(p); setOpen(false); }}
                  className={cn(
                    "flex h-9 items-center justify-between rounded-md px-2.5 text-sm transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {PRESET_LABELS[p as Exclude<DateRangePreset, "custom">]}
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>

          <div className="p-2">
            <p className="px-1 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Custom range
            </p>
            <Calendar
              mode="range"
              numberOfMonths={device === "desktop" ? 2 : 1}
              defaultMonth={value.from ?? new Date()}
              selected={{ from: value.from, to: value.to }}
              onSelect={(r) => {
                const from = r?.from ? startOfDay(r.from) : undefined;
                const to = r?.to ? endOfDay(r.to) : r?.from ? endOfDay(r.from) : undefined;
                onChange({ from, to }, "custom");
                // Only close once both ends are chosen — closing on the first click
                // made picking a range impossible.
                if (from && to) setOpen(false);
              }}
              initialFocus
              className="pointer-events-auto p-0"
            />
          </div>
        </div>
      </PopoverContent>
  );

  if (!steppable) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        {body}
      </Popover>
    );
  }

  // As setas coladas ao campo, um botão só de três peças: o período e os seus dois
  // vizinhos são a mesma pergunta, e uma seta a flutuar ao lado seria outra coisa.
  return (
    <div className={cn("flex items-stretch", className)}>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-r-none"
        onClick={() => step(-1)}
        disabled={!canStep}
        aria-label="Previous period"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        {trigger}
        {body}
      </Popover>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-l-none"
        onClick={() => step(1)}
        disabled={!canStep}
        aria-label="Next period"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
