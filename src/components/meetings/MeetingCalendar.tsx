import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  TONE_CLASS, TONE_LABEL, dayKeyOf, gridStartMinutes, layoutDay, meetingsOnDay, minutesOfDay, timeOf, toneOf,
  viewDays, whenLabel, type CalendarView, type MyMeeting,
} from "@/lib/meetings";

const HOUR_PX = 48;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(day: string) {
  const [, m, d] = day.split("-");
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return { wd: WEEKDAYS[(w + 6) % 7], date: `${d}/${m}` };
}

/** The clock, re-read every minute: enough for a line that moves 0.8px a minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** A keyboard press reaches onClick with detail 0 and no pointer position. */
const fromKeyboard = (e: React.MouseEvent) => e.detail === 0;
const KEYBOARD_SLOT = "09:00";

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

function MeetingBlock({ m, style, compact, className, onOpen }: {
  m: MyMeeting; style?: React.CSSProperties; compact?: boolean; className?: string; onOpen: (m: MyMeeting) => void;
}) {
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
        className,
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
  const now = useNow();
  const nowMinutes = minutesOfDay(now);
  const scroller = useRef<HTMLDivElement>(null);
  const loaded = meetings.length > 0;
  // Opens on now when today is shown, else on the first meeting; again when the period
  // changes or the meetings first arrive, never while somebody is scrolling.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = (gridStartMinutes(days, meetings, today, minutesOfDay(new Date())) / 60) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor, loaded]);

  const slotFromClick = (day: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!onSlot) return;
    if (fromKeyboard(e)) { onSlot(day, KEYBOARD_SLOT); return; }
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
              <div key={d} className={cn("relative border-l", d === today && "bg-primary/[0.03]")}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/60" style={{ top: h * HOUR_PX }} />
                ))}
                {onSlot && (
                  <button
                    type="button"
                    className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    aria-label={`New meeting on ${dayLabel(d).wd} ${dayLabel(d).date}`}
                    onClick={(e) => slotFromClick(d, e)}
                  />
                )}
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
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-destructive" style={{ top: (nowMinutes / 60) * HOUR_PX }} aria-hidden>
                    <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-destructive" />
                  </div>
                )}
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
            <div key={d} className={cn("relative min-h-[6.5rem] border-b border-l p-1", d.slice(0, 7) !== month && "bg-muted/40 text-muted-foreground")}>
              {onSlot && (
                <button
                  type="button"
                  className="absolute inset-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`New meeting on ${dayLabel(d).wd} ${dayLabel(d).date}`}
                  onClick={() => onSlot(d, KEYBOARD_SLOT)}
                />
              )}
              <div className="pointer-events-none relative">
                <div className={cn("mb-1 text-right text-xs tabular-nums", d === today && "font-bold text-primary")}>{Number(d.slice(8))}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((m) => <MeetingBlock key={m.id} m={m} compact className="pointer-events-auto" onOpen={onOpen} />)}
                  {list.length > 3 && <p className="px-1 text-2xs text-muted-foreground">+{list.length - 3} more</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The phone's week: seven days to tap, a dot under each day with a meeting. Replaces
 * stepping one day at a time to find out where the meetings are.
 */
export function WeekStrip({ anchor, today, meetings, onPick }: {
  anchor: string; today: string; meetings: MyMeeting[]; onPick: (day: string) => void;
}) {
  const days = viewDays("week", anchor);
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days of this week">
      {days.map((d) => {
        const l = dayLabel(d);
        const n = meetingsOnDay(meetings, d).filter((m) => !m.cancelled_at).length;
        const on = d === anchor;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onPick(d)}
            aria-pressed={on}
            aria-label={`${l.wd} ${l.date}, ${n === 0 ? "no meetings" : n === 1 ? "1 meeting" : `${n} meetings`}`}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center rounded-lg border text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary text-primary-foreground" : "bg-card",
              !on && d === today && "border-primary text-primary",
            )}
          >
            <span>{l.wd}</span>
            <span className="font-semibold tabular-nums">{Number(d.slice(8))}</span>
            <span className={cn("mt-0.5 h-1 w-1 rounded-full", n > 0 ? (on ? "bg-primary-foreground" : "bg-primary") : "bg-transparent")} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** The phone's view: the day as a list, no grid. An empty day points at the next meeting. */
export function MeetingDayList({ meetings, day, next, onOpen }: {
  meetings: MyMeeting[]; day: string; next?: MyMeeting | null; onOpen: (m: MyMeeting) => void;
}) {
  const list = meetingsOnDay(meetings, day);
  if (list.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
        <p>No meetings on {dayLabel(day).wd} {dayLabel(day).date}.</p>
        {next && (
          <button type="button" onClick={() => onOpen(next)} className="mt-2 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Next: {next.title}, {whenLabel(next)}
          </button>
        )}
      </div>
    );
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
