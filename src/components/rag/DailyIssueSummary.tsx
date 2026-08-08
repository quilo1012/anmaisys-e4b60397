import { Sun, Moon, ClipboardCopy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, summaryToText, type DayShiftIssues } from "@/hooks/useDailyIssueSummary";

/**
 * What the orders say happened, above the box where somebody says what really did.
 *
 * The summary is never written into the comment for them. iTouching reports stops
 * with names like "Alarm" and "Mechanical Stop", and an order's recorded problem is
 * only as good as whoever typed it — so this is offered as the starting point, not
 * the answer. "Use as draft" copies it in and it becomes theirs to correct; leaving
 * it alone costs nothing and the summary stays visible either way.
 */
export function DailyIssueSummary({
  issues, onUseAsDraft, canEdit,
}: {
  issues: DayShiftIssues | undefined;
  onUseAsDraft: (text: string) => void;
  canEdit: boolean;
}) {
  const day = issues?.day ?? [];
  const night = issues?.night ?? [];
  if (day.length === 0 && night.length === 0) return null;

  const Section = ({ label, list, icon: Icon, tone }: {
    label: string; list: typeof day; icon: typeof Sun; tone: string;
  }) => {
    if (list.length === 0) return null;
    return (
      <div>
        <div className={cn("flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider", tone)}>
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <ul className="mt-0.5 space-y-0.5">
          {list.map((i, n) => (
            <li key={`${i.woNumber ?? "x"}-${n}`} className="text-2xs leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">{i.problem}</span>
              {" · "}down {formatDuration(i.downtimeSec)}
              {" · "}repair {formatDuration(i.repairSec)}
              {i.woNumber != null && <span className="ml-1 font-mono opacity-70">WO-{i.woNumber}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="mb-1.5 space-y-1 rounded border border-dashed bg-muted/30 p-1.5">
      <Section label="Day" list={day} icon={Sun} tone="text-warning-strong" />
      <Section label="Night" list={night} icon={Moon} tone="text-primary" />
      {canEdit && (
        <button
          type="button"
          onClick={() => onUseAsDraft(summaryToText({ day, night }))}
          className="flex items-center gap-1 text-2xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <ClipboardCopy className="h-3 w-3" />
          Use as draft
        </button>
      )}
    </div>
  );
}
