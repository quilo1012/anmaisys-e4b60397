/**
 * What a person wrote, separated from what the machine logged.
 *
 * An order raised by iTouching arrives with its own bookkeeping in the notes:
 *
 *   Metal Detected detected automatically by iTouching. Machine: Filler Line 4
 *   Detected: 31/07/2026, 18:38:01 [Updated from iTouching @ 2026-07-31T17:39:01.361Z]
 *   Stop code changed → Label Issue (5397A309-E25D-4DB9-A13B-DA64491BF8ED)
 *
 * Every fact in there is already on the screen — the machine in its own field, the
 * time on the timeline, the problem as the description. Printed under "Observations",
 * it buries whatever the engineer actually wrote, and a GUID tells a reader nothing.
 *
 * So the machine's lines are separated out rather than deleted: the engineer's notes
 * read on their own, and the automatic trail stays available for anyone who wants it.
 */

/** Lines the poll writes into notes, in the order they appear. */
const MACHINE_PATTERNS: RegExp[] = [
  /detected automatically by iTouching\./i,
  /^\s*Machine:\s/i,
  /^\s*Detected:\s/i,
  /\[Updated from iTouching @[^\]]*\]/i,
  /Stop code changed →/i,
  /^\s*Line resumed automatically:/i,
];

export interface SplitNotes {
  /** What a person typed. Empty when the order has only machine bookkeeping. */
  human: string;
  /** What iTouching logged, kept whole. */
  machine: string;
}

export function splitWoNotes(notes: string | null | undefined): SplitNotes {
  const text = (notes ?? "").trim();
  if (!text) return { human: "", machine: "" };

  // The poll writes its bookkeeping as one run-on paragraph, so split on the
  // bracketed stamps and on sentence starts it is known to use, not just newlines.
  const chunks = text
    .split(/\n+|(?=\[Updated from iTouching @)|(?=Stop code changed →)|(?=Machine:\s)|(?=Detected:\s)/g)
    .map((c) => c.trim())
    .filter(Boolean);

  const human: string[] = [];
  const machine: string[] = [];
  for (const chunk of chunks) {
    (MACHINE_PATTERNS.some((re) => re.test(chunk)) ? machine : human).push(chunk);
  }
  return { human: human.join("\n").trim(), machine: machine.join("\n").trim() };
}
