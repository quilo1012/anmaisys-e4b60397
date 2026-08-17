import type { ScorecardEntryVerdict } from "@/lib/scorecardEntry";
import { RagChip } from "./RagChip";

/**
 * The verdict tal como a base o deu. This component reads `overall_rag` and
 * `rag_driver` off the row and prints them — it does not compare, threshold or
 * rank anything. A null `overall_rag` renders through `RagChip` as absent, not
 * as a colour: "no data" and "the week is Red" must stay visibly different.
 */
export function ScorecardVerdict({ verdict }: { verdict: ScorecardEntryVerdict | null }) {
  return (
    <section className="rounded border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Result</span>
        <RagChip value={verdict?.overall_rag ?? null} />
      </div>
      {verdict?.rag_driver && (
        <p className="mt-2 text-sm text-muted-foreground">{verdict.rag_driver}</p>
      )}
    </section>
  );
}
