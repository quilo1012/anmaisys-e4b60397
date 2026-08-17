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
export default function LeaderScorecardDetailPage() {
  const { leader: leaderParam } = useParams<{ leader: string }>();
  const [search] = useSearchParams();
  const today = format(new Date(), "yyyy-MM-dd");
  const { leader, from, to, shift } = parseScorecardParams(leaderParam, search, today);

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <BackButton />
        <PageHeader
          module="Production"
          title="Leader scorecard"
          description={
            leader
              ? `${leader} · ${from === to ? from : `${from} → ${to}`}${shift === "all" ? "" : ` · ${shift === "DAY" ? "Day" : "Night"} shift`}`
              : "No leader in the address"
          }
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
