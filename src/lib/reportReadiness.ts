/**
 * Whether a downloadable report may be written from what the screen has read.
 *
 * The screens that export keep their rows in React Query with `data = []` as the
 * default. That default is what a table should draw while it waits — and exactly
 * what a report must never be built from: an export clicked before the read returned,
 * or after it failed, came out as a well-formed file with no rows in it, which reads
 * as "nothing happened in this period". Every read a report depends on is checked
 * here; anything short of success blocks the download and says which read it was.
 */
export type ReadStatus = "pending" | "error" | "success";

export interface ReportRead {
  /** What was being read, as the message to the user should name it. */
  what: string;
  status: ReadStatus;
}

/** `null` when the report may be written; otherwise the sentence to show instead. */
export function reportBlocker(reads: ReportRead[]): string | null {
  const failed = reads.find((r) => r.status === "error");
  if (failed) return `Report not downloaded: ${failed.what} could not be read. Reload and try again.`;
  const waiting = reads.find((r) => r.status === "pending");
  if (waiting) return `Report not downloaded: ${waiting.what} ${waiting.what.endsWith("s") ? "are" : "is"} still loading. Try again in a moment.`;
  return null;
}
