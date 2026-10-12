/**
 * Which functions this codebase calls before their migration has been pasted.
 *
 * Nothing in this repository applies a migration: a person pastes
 * `docs/apply-passo-3/APPLY-ALL-IN-ORDER.sql` into the SQL editor. A merge therefore
 * ships the client that calls a new function minutes or days before the function
 * exists, and PostgREST answers every one of those calls with
 *
 *     PGRST202  Could not find the function public.<name> without parameters
 *               in the schema cache
 *
 * Each screen below already handles that and renders something correct. What nobody
 * handled was the log: `installApiErrorTelemetry` sits on the global fetch, below
 * react-query, and files them as API_ERROR — so Root Diagnostics collects a steady
 * drip of faults for a gap that is already known and already waiting on one paste.
 * Two of them reached the operator board on 10/10 within ninety minutes.
 *
 * Same doctrine as `schemaProbes` and `userCorrectable`, for the same reason: keying
 * on PGRST202 alone would silence every missing function in the app, including the
 * ones nothing falls back to — and a missing function with no fallback is exactly the
 * drift this log exists to catch. An entry has to be true twice over:
 *
 * 1. **Something falls back**, so the screen is right without the function.
 * 2. **The fallback is named below**, so the claim can be checked, and so deleting
 *    that fallback leaves a lie somebody can grep for.
 *
 * Anything unlisted stays a fault.
 *
 * These are still recorded, as SCHEMA_DRIFT — not dropped. The migration really has
 * not landed, and the day somebody wonders why the tablet's QR carries no code, this
 * is the answer. **Delete the entry when the block is applied**, so the list stays a
 * list of what is pending rather than a list of what was once pending.
 */

interface PendingRpc {
  /** The function name, exactly as PostgREST spells it in the message. */
  name: string;
  /** Which block of the paste package creates it. */
  block: string;
  /** What the screen shows instead. Point 1 of the doctrine, written down. */
  fallback: string;
}

const PENDING: readonly PendingRpc[] = [
  {
    name: "my_attendance",
    block: "BLOCO 90 — 20261012160000_an_employee_sees_only_their_own.sql",
    fallback:
      "useMyAttendance turns PGRST202 into `notSetUp`, and MyAttendancePage says \"My " +
      "Attendance is being set up\" instead of drawing an empty month — an empty month " +
      "would read as a month with no record, which is a statement about the person.",
  },
  {
    name: "signup_invite_code",
    block: "BLOCO 86 — 20261011230000_the_invite_code_rides_the_link.sql",
    fallback:
      "useSignupInviteCode returns null, so the Create account link carries no code and " +
      "SignupQrCard draws the QR without one — exactly what the login screen has always " +
      "done. The sign-up form then asks for the code, as it does today.",
  },
  {
    name: "link_me_by_employee_ref",
    block: "BLOCO 81 — 20261010100000_you_say_who_you_are_with_the_number_on_your_badge.sql",
    fallback:
      "useOvertimeMutations.linkMe turns PGRST202 into 'Sign-up is being updated right now. " +
      "Ask your supervisor to link your account.' — the one sentence that is true and " +
      "actionable while the function is missing.",
  },
];

/**
 * Whether a PostgREST error names a function we are knowingly ahead of.
 *
 * Takes the message rather than the code so the caller decides how strict to be about
 * `PGRST202`; the name has to appear for this to answer true, so a different error
 * that happens to mention the function is still matched only by name — which is the
 * conservative direction here, since the alternative is silencing by code alone.
 */
export function isPendingRpc(message: string | null | undefined): boolean {
  if (!message) return false;
  return PENDING.some((p) => message.includes(p.name));
}

/** The list itself, for a test that keeps it honest. */
export const PENDING_RPCS = PENDING;
