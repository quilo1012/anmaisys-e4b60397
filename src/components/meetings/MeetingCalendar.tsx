import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  TONE_CLASS, TONE_LABEL, dayKeyOf, layoutDay, meetingsOnDay, minutesOfDay, timeOf, toneOf, viewDays,
  type CalendarView, type MyMeeting,
} from "@/lib/meetings";

const HOUR_PX = 48;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(day: string) {
  const [, m, d] = day.split("-");
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return { wd: WEEKDAYS[(w + 6) % 7], date: `${d}/${m}` };
}

interface Props {
  view: CalendarView;
  anchor: string;
  meetings: MyMeeting[];
  today: string;
  onOpen: (m: MyMeeting) => void;
  /** Present only for whoever may schedule: an empty slot opens the form at that time. */
  onSlot?: (day: string, time: string) => void;
}

/** Day and Week: a time grid. Month: a grid of days. Colours are the viewer's own answer. */
export function MeetingCalendar(props: Props) {
  return props.view === "month" ? <MonthGrid {...props} /> : <TimeGrid {...props} />;
}

function MeetingBlock({ m, style, compact, onOpen }: { m: MyMeeting; style?: React.CSSProperties; compact?: boolean; onOpen: (m: MyMeeting) => void }) {
  const tone = toneOf(m);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(m); }}
      style={style}
      className={cn(
        "overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        TONE_CLASS[tone],
        compact ? "block w-full truncate" : "absolute",
      )}
      aria-label={`${m.title}, ${timeOf(m.starts_at)} to ${timeOf(m.ends_at)}, ${TONE_LABEL[tone]}`}
    >
      <span className="font-semibold">{compact && `${timeOf(m.starts_at)} `}{m.title}</span>
      {!compact && <span className="block opacity-80">{timeOf(m.starts_at)}–{timeOf(m.ends_at)}{m.location ? ` · ${m.location}` : ""}</span>}
    </button>
  );
}

function TimeGrid({ view, anchor, meetings, today, onOpen, onSlot }: Props) {
  const days = viewDays(view, anchor);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, [view, anchor]);

  const slotFromClick = (day: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlot) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mins = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((e.clientY - rect.top) / HOUR_PX) * 2) * 30));
    onSlot(day, `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
      <div className="grid border-b" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => {
          const l = dayLabel(d);
          return (
            <div key={d} className={cn("px-1 py-2 text-center text-xs", d === today && "font-bold text-primary")}>
              {l.wd} <span className="tabular-nums">{l.date}</span>
            </div>
          );
        })}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-2xs tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const list = meetingsOnDay(meetings, d);
            const layout = layoutDay(list);
            return (
              <div
                key={d}
                className={cn("relative border-l", onSlot && "cursor-pointer", d === today && "bg-primary/[0.03]")}
                onClick={(e) => slotFromClick(d, e)}
                role={onSlot ? "button" : undefined}
                aria-label={onSlot ? `New meeting on ${d}` : undefined}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-border/60" style={{ top: h * HOUR_PX }} />
                ))}
                {list.map((m) => {
                  const startsHere = dayKeyOf(m.starts_at) === d;
                  const endsHere = dayKeyOf(m.ends_at) === d && minutesOfDay(m.ends_at) > 0;
                  const top = startsHere ? minutesOfDay(m.starts_at) : 0;
                  const bottom = endsHere ? minutesOfDay(m.ends_at) : 24 * 60;
                  const pos = layout.get(m.id) ?? { col: 0, cols: 1 };
                  return (
                    <MeetingBlock
                      key={m.id}
                      m={m}
                      onOpen={onOpen}
                      style={{
                        top: (top / 60) * HOUR_PX,
                        height: Math.max(20, ((bottom - top) / 60) * HOUR_PX - 2),
                        left: `calc(${(pos.col / pos.cols) * 100}% + 2px)`,
                        width: `calc(${100 / pos.cols}% - 4px)`,
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ anchor, meetings, today, onOpen, onSlot }: Props) {
  const days = viewDays("month", anchor);
  const month = anchor.slice(0, 7);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAYS.map((w) => <div key={w} className="py-2 text-center text-xs font-medium text-muted-foreground">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = meetingsOnDay(meetings, d).filter((m) => dayKeyOf(m.starts_at) === d);
          return (
            <div
              key={d}
              className={cn("min-h-[6.5rem] border-b border-l p-1", d.slice(0, 7) !== month && "bg-muted/40 text-muted-foreground", onSlot && "cursor-pointer")}
              onClick={() => onSlot?.(d, "09:00")}
            >
              <div className={cn("mb-1 text-right text-xs tabular-nums", d === today && "font-bold text-primary")}>{Number(d.slice(8))}</div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((m) => <MeetingBlock key={m.id} m={m} compact onOpen={onOpen} />)}
                {list.length > 3 && <p className="px-1 text-2xs text-muted-foreground">+{list.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The phone's view: the day as a list, no grid. */
export function MeetingDayList({ meetings, day, onOpen }: { meetings: MyMeeting[]; day: string; onOpen: (m: MyMeeting) => void }) {
  const list = meetingsOnDay(meetings, day);
  if (list.length === 0) {
    return <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">No meetings this day.</p>;
  }
  return (
    <ul className="space-y-2">
      {list.map((m) => {
        const tone = toneOf(m);
        return (
          <li key={m.id}>
            <button type="button" onClick={() => onOpen(m)} className="flex w-full items-stretch gap-3 rounded-xl border bg-card p-3 text-left">
              <span className={cn("w-1.5 shrink-0 rounded-full border", TONE_CLASS[tone])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className={cn("block font-semibold", tone === "cancelled" && "line-through text-muted-foreground")}>{m.title}</span>
                <span className="block text-sm tabular-nums text-muted-foreground">
                  {timeOf(m.starts_at)}–{timeOf(m.ends_at)}{m.location ? ` · ${m.location}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">{TONE_LABEL[tone]}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ToneLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {(["accepted", "pending", "declined", "cancelled"] as const).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block h-3 w-5 rounded border", TONE_CLASS[t])} aria-hidden />
          {TONE_LABEL[t]}
        </span>
      ))}
    </div>
  );
}
