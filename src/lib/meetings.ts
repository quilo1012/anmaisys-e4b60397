/**
 * Meetings (BLOCO 159): the calendar's arithmetic, kept pure so it can be tested.
 *
 * Every date on screen is a Europe/London wall-clock date, whatever the device's own
 * time zone is. A "day key" is that date as `YYYY-MM-DD`. Instants travel as ISO strings,
 * as the database stores them (`timestamptz`).
 */

export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export type MeetingResponse = "pending" | "accepted" | "declined";
export type CalendarView = "day" | "week" | "month";
export type Scope = "one" | "following";

export interface MeetingRow {
  id: string;
  series_id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  location: string | null;
  video_link: string | null;
  recurrence: Recurrence;
  recurrence_until: string | null;
  created_by: string;
  cancelled_at: string | null;
}

/** A meeting as the signed-in person sees it: with their own answer, if invited. */
export interface MyMeeting extends MeetingRow {
  my_response: MeetingResponse | null;
}

export const TZ = "Europe/London";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});

export interface LondonParts { y: number; m: number; d: number; h: number; min: number; dow: number }

const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The London wall clock at an instant. `dow` is 1 = Monday … 7 = Sunday. */
export function londonParts(at: Date | string): LondonParts {
  const parts = PARTS.formatToParts(typeof at === "string" ? new Date(at) : at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    y: Number(get("year")), m: Number(get("month")), d: Number(get("day")),
    h: Number(get("hour")) % 24, min: Number(get("minute")), dow: DOW[get("weekday")] ?? 1,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function dayKeyOf(at: Date | string): string {
  const p = londonParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** "HH:MM" in London. */
export function timeOf(at: Date | string): string {
  const p = londonParts(at);
  return `${pad(p.h)}:${pad(p.min)}`;
}

/** Minutes since London midnight. */
export function minutesOfDay(at: Date | string): number {
  const p = londonParts(at);
  return p.h * 60 + p.min;
}

/**
 * The instant at which London's clock shows this date and time. In the hour the clocks
 * skip (spring) the later reading is used; in the hour they repeat (autumn), the first.
 */
export function londonInstant(dayKey: string, time: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(guess));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Same day of the month `n` months on; the 31st becomes the month's last day. */
export function addMonths(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

export function weekdayOf(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function startOfWeek(dayKey: string): string {
  return addDays(dayKey, 1 - weekdayOf(dayKey));
}

/** The days a view shows. A month view shows whole weeks, Monday first. */
export function viewDays(view: CalendarView, anchor: string): string[] {
  if (view === "day") return [anchor];
  if (view === "week") {
    const s = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  const first = `${anchor.slice(0, 7)}-01`;
  const lastOfMonth = addDays(addMonths(first, 1), -1);
  const s = startOfWeek(first);
  const e = addDays(startOfWeek(lastOfMonth), 6);
  const days: string[] = [];
  for (let k = s; k <= e; k = addDays(k, 1)) days.push(k);
  return days;
}

/** Where "previous" and "next" go from this anchor. */
export function stepAnchor(view: CalendarView, anchor: string, dir: -1 | 1): string {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  return addMonths(`${anchor.slice(0, 7)}-01`, dir);
}

/** The instants bounding a view, for the query: [from, to). */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  const days = viewDays(view, anchor);
  return {
    from: londonInstant(days[0], "00:00").toISOString(),
    to: londonInstant(addDays(days[days.length - 1], 1), "00:00").toISOString(),
  };
}

/**
 * The occurrences a series will have — the same rule as `meeting_occurrences` in SQL:
 * the London wall clock repeated, counted from the first each time, until `until`
 * (inclusive), at most 366.
 */
export function expandOccurrences(
  startDay: string, startTime: string, durationMin: number, recurrence: Recurrence, until: string | null,
): { starts_at: string; ends_at: string }[] {
  const at = (day: string) => {
    const s = londonInstant(day, startTime);
    return { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + durationMin * 60_000).toISOString() };
  };
  if (recurrence === "none" || !until) return [at(startDay)];
  const out: { starts_at: string; ends_at: string }[] = [];
  for (let i = 0; i < 366; i++) {
    const day = recurrence === "daily" ? addDays(startDay, i)
      : recurrence === "weekly" ? addDays(startDay, 7 * i)
      : addMonths(startDay, i);
    if (day > until) break;
    out.push(at(day));
  }
  return out;
}

export interface MeetingForm {
  title: string;
  day: string;
  time: string;
  durationMin: number;
  recurrence: Recurrence;
  until: string;
  participants: string[];
  videoLink: string;
}

/** What stops the form from saving. Empty = it may save. The database checks again. */
export function formProblems(f: MeetingForm): string[] {
  const out: string[] = [];
  if (!f.title.trim()) out.push("Give the meeting a title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.day) || !/^\d{2}:\d{2}$/.test(f.time)) out.push("Pick a date and a start time.");
  if (!Number.isFinite(f.durationMin) || f.durationMin <= 0) out.push("The meeting must end after it starts.");
  if (f.recurrence !== "none") {
    if (!f.until) out.push("Choose when the repeats stop.");
    else if (f.until < f.day) out.push("\"Repeat until\" is before the first meeting.");
  }
  if (f.participants.length === 0) out.push("Invite at least one person.");
  if (f.videoLink.trim() && !/^https:\/\//i.test(f.videoLink.trim())) out.push("The video link must start with https://");
  return out;
}

export type Tone = "accepted" | "pending" | "declined" | "cancelled";

export function toneOf(m: Pick<MyMeeting, "cancelled_at" | "my_response">): Tone {
  if (m.cancelled_at) return "cancelled";
  return m.my_response ?? "pending";
}

export const TONE_CLASS: Record<Tone, string> = {
  accepted: "bg-primary text-primary-foreground border-primary",
  pending: "bg-primary/10 text-foreground border-primary border-dashed",
  declined: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-muted text-muted-foreground border-border line-through",
};

export const TONE_LABEL: Record<Tone, string> = {
  accepted: "Accepted", pending: "Not answered", declined: "Declined", cancelled: "Cancelled",
};

/** The meetings that touch one London day. */
export function meetingsOnDay<T extends Pick<MeetingRow, "starts_at" | "ends_at">>(list: T[], day: string): T[] {
  const from = londonInstant(day, "00:00").getTime();
  const to = londonInstant(addDays(day, 1), "00:00").getTime();
  return list
    .filter((m) => new Date(m.starts_at).getTime() < to && new Date(m.ends_at).getTime() > from)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/**
 * Side-by-side columns for overlapping meetings on one day: each gets a column index
 * and the number of columns in its overlapping cluster.
 */
export function layoutDay<T extends Pick<MeetingRow, "id" | "starts_at" | "ends_at">>(list: T[]): Map<string, { col: number; cols: number }> {
  const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || b.ends_at.localeCompare(a.ends_at));
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: { id: string; col: number }[] = [];
  let clusterEnd = 0;
  let colEnds: number[] = [];
  const flush = () => {
    const cols = Math.max(1, colEnds.length);
    for (const c of cluster) out.set(c.id, { col: c.col, cols });
    cluster = []; colEnds = [];
  };
  for (const m of sorted) {
    const s = new Date(m.starts_at).getTime();
    const e = new Date(m.ends_at).getTime();
    if (cluster.length && s >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) { col = colEnds.length; colEnds.push(e); } else colEnds[col] = e;
    cluster.push({ id: m.id, col });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

export interface InvitablePerson {
  user_id: string;
  name: string;
  department: string | null;
  crew: string | null;
  job: string | null;
}

export interface Audience { key: string; label: string; people: string[] }

/**
 * Departments, teams (department + crew) and crews across departments, each turned into
 * the people in it now. The form adds those people; the database stores people.
 */
export function audiences(people: InvitablePerson[]): { departments: Audience[]; teams: Audience[]; crews: Audience[] } {
  const group = (keyOf: (p: InvitablePerson) => string | null, labelOf: (k: string) => string) => {
    const m = new Map<string, string[]>();
    for (const p of people) {
      const k = keyOf(p);
      if (!k) continue;
      m.set(k, [...(m.get(k) ?? []), p.user_id]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => ({ key, label: labelOf(key), people: ids }));
  };
  return {
    departments: group((p) => p.department, (k) => k),
    teams: group((p) => (p.department && p.crew ? `${p.department}\u0000${p.crew}` : null), (k) => k.replace("\u0000", " · crew ")),
    crews: group((p) => p.crew, (k) => `Crew ${k}`),
  };
}

/** "Tue 11/11 · 09:00–09:30" in London. */
export function whenLabel(m: Pick<MeetingRow, "starts_at" | "ends_at">): string {
  const p = londonParts(m.starts_at);
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][p.dow - 1];
  return `${wd} ${pad(p.d)}/${pad(p.m)} · ${timeOf(m.starts_at)}–${timeOf(m.ends_at)}`;
}

/** Only a web address the browser should open: https, nothing else. */
export function safeVideoLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "3 accepted · 1 declined · 2 not answered" — the organiser's count, zeros left out. */
export function answerSummary(rows: { response: MeetingResponse }[]): string {
  const n = { accepted: 0, declined: 0, pending: 0 };
  for (const r of rows) n[r.response] += 1;
  const parts = [
    n.accepted ? `${n.accepted} accepted` : "",
    n.declined ? `${n.declined} declined` : "",
    n.pending ? `${n.pending} not answered` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/** The longest reason a decline can carry; the database cuts at the same place. */
export const DECLINE_REASON_MAX = 200;

/** The meetings still waiting for my answer: not cancelled, not over, not answered. */
export function waitingForMyAnswer(list: MyMeeting[], now: Date = new Date()): MyMeeting[] {
  return list.filter((m) => m.my_response === "pending" && !m.cancelled_at && new Date(m.ends_at).getTime() > now.getTime());
}
