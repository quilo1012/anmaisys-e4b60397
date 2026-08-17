import { useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/EmptyState";
import { Medal } from "lucide-react";
import { LeaderScorecard } from "@/components/LeaderScorecard";
import { parseScorecardParams } from "@/lib/scorecardRoute";

/**
 * One leader's scorecard, at an address.
 *
 * The card itself was a dialog on Production Performance. A dialog cannot be linked,
 * bookmarked, or sent to the person it is about, and it left the leader scorecard
 * living in two unrelated places — a page in the menu for the week's board, a modal
 * on another screen for the analysis. Both are now under `/dashboard/leader-scorecard`:
 * the board with no leader, one leader's card with a name.
 *
 * Everything about the period comes off the address, so Production Performance can
 * hand over the filters the reader had already set. `parseScorecardParams` decides
 * what a mangled address means — see its tests; the rules matter more than they look.
 */
/**
 * The period, written the way a person says it.
 *
 * "2026-08-17 → 2026-08-17" is a machine repeating itself; one day is one date. The
 * shift is named only when one was asked for, because its absence is the default and
 * printing "All shifts" would suggest a filter had been applied.
 */
function periodLabel(from: string, to: string, shift: "all" | "DAY" | "NIGHT"): string {
  const day = (d: string) => format(new Date(`${d}T00:00:00`), "d MMM yyyy");
  const range = from === to
    ? day(from)
    : `${format(new Date(`${from}T00:00:00`), "d MMM")} → ${day(to)}`;
  return shift === "all" ? range : `${range} · ${shift === "DAY" ? "Day" : "Night"} shift`;
}

export default function LeaderScorecardDetailPage() {
  const { leader: leaderParam } = useParams<{ leader: string }>();
  const [search] = useSearchParams();
  const today = format(new Date(), "yyyy-MM-dd");
  const { leader, from, to, shift } = parseScorecardParams(leaderParam, search, today);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <BackButton />
        {/* The leader is the title, not the subtitle.
            "Leader scorecard" was the title and the person's name sat in the
            description underneath — on a page whose whole subject is that person, and
            which is meant to be sent to them. The module plate already says which part
            of the system this is, so the title is free to say who it is about. The
            period goes underneath because every figure on the card is bounded by it. */}
        <PageHeader
          module="Production · Leader scorecard"
          title={leader ?? "Leader scorecard"}
          description={leader ? periodLabel(from, to, shift) : "This link carries no leader name."}
        />
        {leader ? (
          <LeaderScorecard leaderName={leader} from={from} to={to} shift={shift} />
        ) : (
          /* A link that lost its leader must say so. Rendering the card with a blank
             name would draw an empty scorecard, which reads as a leader with nothing
             against them rather than as a broken link. */
          <EmptyState
            icon={Medal}
            title="No leader in this link"
            description="The address has no leader name. Open a leader's scorecard from Production Performance, or pick one on the week's board."
          />
        )}
      </div>
    </DashboardLayout>
  );
}
