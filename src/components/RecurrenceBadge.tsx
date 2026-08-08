import { useNavigate } from "react-router-dom";
import { RotateCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  originalWoId: string | null | undefined;
  compact?: boolean;
}

/**
 * Small 🔁 badge shown on a WO row/card when it is a recurrence of another WO.
 * Clicking it navigates to the original WO detail page.
 */
export function RecurrenceBadge({ originalWoId, compact }: Props) {
  const navigate = useNavigate();
  if (!originalWoId) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/dashboard/wo/${originalWoId}`);
          }}
          className={`inline-flex items-center gap-1 rounded-full border border-warning/60 bg-warning/10 text-warning-strong dark:bg-warning/40 dark:text-warning-strong hover:bg-warning/90 dark:hover:bg-warning/60 font-semibold ${
            compact ? "px-1.5 py-0 text-2xs" : "px-2 py-0.5 text-xs"
          }`}
          aria-label="Recurrence of previous maintenance order"
        >
          <RotateCw className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />
          {compact ? "🔁" : "Recurrence"}
        </button>
      </TooltipTrigger>
      <TooltipContent>Recurrence — click to open the original WO</TooltipContent>
    </Tooltip>
  );
}
