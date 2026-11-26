/**
 * Employee Announcements (BLOCO 164): the pure part — shapes, labels, status and counts.
 *
 * Who receives an announcement is decided by the database from what each employee already
 * carries (`employees.department` and `employees.shift_group`). Nothing here decides it; the
 * screens only describe it.
 */
import { dayKeyOf, londonInstant, timeOf } from "@/lib/meetings";

/** One announcement as the person it is addressed to sees it (`my_announcements`). */
export interface MyAnnouncement {
  id: string;
  title: string;
  body: string;
  category: string;
  urgent: boolean;
  requires_ack: boolean;
  published_at: string;
  expires_at: string | null;
  audience_department: string | null;
  audience_shift_group: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

/** One announcement as its author or an admin sees it (`announcements_manage_list`). */
export interface ManagedAnnouncement {
  id: string;
  title: string;
  body: string;
  category: string;
  urgent: boolean;
  requires_ack: boolean;
  audience_department: string | null;
  audience_shift_group: string | null;
  published_at: string;
  expires_at: string | null;
  rung_at: string | null;
  withdrawn_at: string | null;
  updated_at: string | null;
  created_by: string;
  author_name: string;
  /** Everybody targeted, including active employees with no app login. */
  targeted: number;
  /** Of those, the ones with a login — the only ones who can receive it. */
  reachable: number;
  acknowledged: number;
}

/** One line of the read report (`announcement_read_report`). */
export interface ReportRow {
  employee_id: string | null;
  user_id: string | null;
  name: string;
  department: string | null;
  shift_group: string | null;
  has_login: boolean;
  read_at: string | null;
  acknowledged_at: string | null;
}

export interface AudienceOptions {
  departments: string[];
  shifts: string[];
}

/** What the form sends to publish or update. Empty department/shift = all. */
export interface AnnouncementInput {
  title: string;
  body: string;
  department: string | null;
  shiftGroup: string | null;
  urgent: boolean;
  /** null = publish now. */
  publishAt: string | null;
  expiresAt: string | null;
}

export const ALL = "__all__";

/** "Who is this for", in words. */
export function audienceLabel(department: string | null | undefined, shift: string | null | undefined): string {
  const d = department?.trim() || null;
  const s = shift?.trim() || null;
  if (!d && !s) return "All employees";
  if (d && !s) return `${d} · all shifts`;
  if (!d && s) return `${s} shift · all departments`;
  return `${d} · ${s}`;
}

export type AnnouncementStatus = "scheduled" | "live" | "expired" | "withdrawn";

export function statusOf(a: Pick<ManagedAnnouncement, "published_at" | "expires_at" | "withdrawn_at">, now: Date = new Date()): AnnouncementStatus {
  if (a.withdrawn_at) return "withdrawn";
  if (new Date(a.published_at) > now) return "scheduled";
  if (a.expires_at && new Date(a.expires_at) <= now) return "expired";
  return "live";
}

export const STATUS_LABEL: Record<AnnouncementStatus, string> = {
  scheduled: "Scheduled",
  live: "Published",
  expired: "Ended",
  withdrawn: "Withdrawn",
};

/** Read for the employee means confirmed when confirmation is asked, opened otherwise. */
export function isRead(a: Pick<MyAnnouncement, "requires_ack" | "read_at" | "acknowledged_at">): boolean {
  return a.requires_ack ? !!a.acknowledged_at : !!a.read_at;
}

/**
 * The report's numbers. The percentage is over everybody targeted — an employee with no
 * login counts as not read, because they have not — and the screen says how many of the
 * unread could not have read it.
 */
export function readSummary(rows: readonly ReportRow[], requiresAck = true) {
  const targeted = rows.length;
  const read = rows.filter((r) => (requiresAck ? r.acknowledged_at : r.read_at)).length;
  const noLogin = rows.filter((r) => !r.has_login).length;
  return { targeted, read, unread: targeted - read, noLogin, percent: percentOf(read, targeted) };
}

export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", year: "numeric" });

/** "Thu 26 Nov 2026, 10:41" in London. */
export function whenLabel(at: string | null | undefined): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const part = (t: string) => DAY_FMT.formatToParts(d).find((x) => x.type === t)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}, ${timeOf(d)}`;
}

/** A London date and time from the form ("2026-12-12", "07:00") as an ISO instant. */
export function instantFromForm(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return londonInstant(day, time).toISOString();
}

/** An instant back into the form's London date and time. */
export function formFromInstant(at: string | null | undefined): { day: string; time: string } {
  if (!at) return { day: "", time: "" };
  return { day: dayKeyOf(at), time: timeOf(at) };
}

/** What is wrong with the form, in the order a person would fix it. Empty = ready. */
export function formProblems(input: AnnouncementInput, now: Date = new Date()): string[] {
  const out: string[] = [];
  if (!input.title.trim()) out.push("Give the announcement a title.");
  else if (input.title.trim().length > 120) out.push("The title can be at most 120 characters.");
  if (!input.body.trim()) out.push("Write the message.");
  else if (input.body.length > 4000) out.push("The message can be at most 4000 characters.");
  const start = input.publishAt ? new Date(input.publishAt) : now;
  if (input.publishAt && start <= now) out.push("The scheduled time has already passed — choose a later one or publish now.");
  if (input.expiresAt && new Date(input.expiresAt) <= start) out.push("The end date must be after the publish date.");
  return out;
}

/**
 * The little formatting an announcement may carry, as people type it on a keyboard or
 * paste it from a chat: **bold**, and lines that start with "- ", "* " or "• " as a list.
 * Nothing else is interpreted, and nothing becomes HTML: the card builds React elements
 * from these blocks, so a pasted <script> is just text.
 */
export type BodyBlock =
  | { kind: "p"; lines: InlinePart[][] }
  | { kind: "list"; items: InlinePart[][] };
export type InlinePart = { text: string; bold: boolean };

const BULLET = /^\s*[-*•]\s+/;

export function inlineParts(line: string): InlinePart[] {
  const out: InlinePart[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out.filter((p) => p.text.length > 0);
}

export function parseBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const prev = blocks[blocks.length - 1];
    if (!line.trim()) { blocks.push({ kind: "p", lines: [] }); continue; }
    if (BULLET.test(line)) {
      const item = inlineParts(line.replace(BULLET, ""));
      if (prev?.kind === "list") prev.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      continue;
    }
    if (prev?.kind === "p" && prev.lines.length > 0) prev.lines.push(inlineParts(line));
    else if (prev?.kind === "p") prev.lines.push(inlineParts(line));
    else blocks.push({ kind: "p", lines: [inlineParts(line)] });
  }
  return blocks.filter((b) => (b.kind === "p" ? b.lines.length > 0 : b.items.length > 0));
}

/** The words without the marks, on one line: for previews, the bell and the phone. */
export function plainText(body: string): string {
  return body
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\n)\s*[-*•]\s+/g, "$1• ")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}
