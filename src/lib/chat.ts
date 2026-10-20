/**
 * The rules of Messages that do not need a network: what a file may be, where it is
 * stored, how a thread is laid out, and how a page from the server and a live event
 * become one list.
 *
 * The database decides who may see what (BLOCO 108, `20261019160000`). These rules only
 * have to agree with it — the folder names especially, because the storage policies
 * read them.
 */

/** Same list as the `chat-files` bucket's `allowed_mime_types`. */
export const CHAT_FILE_TYPES: Record<string, string> = {
  "image/jpeg": "Image",
  "image/png": "Image",
  "image/webp": "Image",
  "image/gif": "Image",
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/csv": "CSV",
  "application/msword": "Word",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.ms-powerpoint": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
};
/** Same as the bucket's `file_size_limit`; storage refuses anything bigger anyway. */
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_FILES_PER_MESSAGE = 5;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_BODY_MAX = 4000;

/** A browser that does not know a file's type leaves it empty; go by the name then. */
const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function fileType(file: { name: string; type: string }): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a file cannot be sent, or null when it can. Said the way a person reads it. */
export function fileProblem(file: { name: string; type: string; size: number }): string | null {
  if (!CHAT_FILE_TYPES[fileType(file)]) return `${file.name}: images, PDF, Word, Excel, PowerPoint, text or CSV only`;
  if (file.size <= 0) return `${file.name} is empty`;
  if (file.size > CHAT_FILE_MAX_BYTES) return `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(CHAT_FILE_MAX_BYTES)}`;
  return null;
}

export function avatarProblem(file: { name: string; type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(fileType(file))) return "A photo must be a JPEG, PNG or WebP image";
  if (file.size > AVATAR_MAX_BYTES) return `That photo is ${formatBytes(file.size)}; the limit is ${formatBytes(AVATAR_MAX_BYTES)}`;
  return null;
}

/**
 * A name that is safe as the last part of a storage path: no folders, no control
 * characters, nothing a URL has to escape. The original name is kept on the
 * attachment row for display.
 */
export function storageSafeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .slice(0, 60) || "file";
  return ext ? `${base}.${ext}` : base;
}

/**
 * The folder of a private conversation: both logins, lower first. `chat_may_use_file`
 * refuses the other order, so there is exactly one folder per pair.
 */
export function pairFolder(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `dm/${x}_${y}`;
}

export function groupFolder(groupId: string): string {
  return `g/${groupId}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export interface Timed {
  id: string;
  created_at: string;
}

/** Oldest first; two messages of the same instant keep a fixed order. */
export function byTime(a: Timed, b: Timed): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Pages and live events into one thread. A message seen twice — the page that loaded
 * it and the Realtime event for it, a second tab, a reconnect — is one message; the
 * later copy wins, so a server row replaces the optimistic one with the same id.
 */
export function mergeMessages<T extends Timed>(...lists: (readonly T[] | undefined)[]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const m of list ?? []) byId.set(m.id, m);
  return [...byId.values()].sort(byTime);
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", "Monday 12 October", "12 October 2025". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("en-GB", sameYear
    ? { weekday: "long", day: "numeric", month: "long" }
    : { day: "numeric", month: "long", year: "numeric" });
}

export interface ThreadRow<T> {
  /** A message, with whether it starts a run from one sender (name and avatar show). */
  message?: T;
  startsRun?: boolean;
  /** Or a date line. */
  day?: string;
}

/** Messages with a date line before each new day; runs from one sender within 5 min. */
export function layoutThread<T extends Timed & { sender_id: string }>(messages: readonly T[], now = new Date()): ThreadRow<T>[] {
  const rows: ThreadRow<T>[] = [];
  let lastDay = "";
  let prev: T | null = null;
  for (const m of messages) {
    const k = dayKey(new Date(m.created_at));
    if (k !== lastDay) {
      rows.push({ day: dayLabel(m.created_at, now) });
      lastDay = k;
      prev = null;
    }
    const startsRun = !prev || prev.sender_id !== m.sender_id
      || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
    rows.push({ message: m, startsRun });
    prev = m;
  }
  return rows;
}

/** The time in the conversation list: "14:05" today, "Yesterday", "Mon", "12/10/25". */
export function listTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString("en-GB", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export type ConversationKey = `dm:${string}` | `group:${string}`;

export function parseConversationKey(k: string | null | undefined): { kind: "dm" | "group"; id: string } | null {
  if (!k) return null;
  const m = /^(dm|group):([0-9a-f-]{36})$/i.exec(k);
  return m ? { kind: m[1] as "dm" | "group", id: m[2] } : null;
}

export interface ConversationSummary {
  key: ConversationKey;
  kind: "dm" | "group";
  id: string;
  name: string;
  subtitle: string | null;
  avatarPath: string | null;
  lastAt: string | null;
  preview: string | null;
  unread: number;
}

/** Unread first, then the most recent; conversations never written in last, by name. */
export function sortConversations(list: readonly ConversationSummary[]): ConversationSummary[] {
  return [...list].sort((a, b) =>
    (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0)
    || (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
    || a.name.localeCompare(b.name));
}

/** Lower case, no accents, single spaces: "  Quiló " and "quilo" are the same word. */
export function foldForSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Every word typed must appear in the name or the job, in any order, accents and case
 * ignored: "daniel", "quilo", "Quiló", "dan qui" and "quilo daniel" all find Daniel Quiló.
 */
export function matchesSearch(c: ConversationSummary, q: string): boolean {
  const words = foldForSearch(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = foldForSearch(`${c.name} ${c.subtitle ?? ""}`);
  return words.every((w) => hay.includes(w));
}
