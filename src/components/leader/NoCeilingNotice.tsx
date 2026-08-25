/**
 * Said once, on every screen that scores a leader without knowing the gates.
 *
 * `is_gate` arrives with 20260824090000. `useGateLabels` handles its absence correctly
 * — the ladder in `selectOptions` drops the column and the query SUCCEEDS — so `ready`
 * is true and the card draws. That is deliberate: gating the card on the column would
 * leave every leader staring at "Working out which actions count…" for ever.
 *
 * But `ready` means "the query settled", not "the column exists". An empty gate set and
 * "no gate fired" are the same value, so a leader with a failed CCP reads a score that
 * was never capped, on the document they are judged by. Every other unreadiness on
 * these screens risks a number slightly wrong; this one is wrong in the direction an
 * auditor asks about, and it flatters.
 *
 * `useGateLabels` returns `missing` for exactly this and QualityActionsPage already
 * says it out loud. The three screens that draw a score did not.
 *
 * Never `print:hidden`: a printed or exported card outlives the screen it came from,
 * and the caveat has to travel with the figure.
 */
export function NoCeilingNotice() {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-strong">
      <span className="font-medium">No ceiling was applied.</span> This database does not
      record which labels gate a period, so a failed CCP has not capped this score. The
      figure can only be too high, never too low.
    </div>
  );
}
