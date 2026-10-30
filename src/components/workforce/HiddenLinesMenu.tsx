import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The lines hidden on this board, and the way back.
 *
 * Hidden lines are not deleted and their people are not moved: this only lists what the
 * board has stopped drawing on this shift, each with "Show", and "Show all".
 */
export function HiddenLinesMenu({
  shiftLabel, hidden, canManage, onShow, busy,
}: {
  shiftLabel: string;
  hidden: { id: string; name: string; staffed: boolean }[];
  canManage: boolean;
  onShow: (areaIds: string[]) => void;
  busy?: boolean;
}) {
  if (hidden.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-11 gap-1.5 px-3 text-xs print:hidden sm:h-8 sm:text-sm">
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
          Hidden lines ({hidden.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <p className="px-1 pb-1.5 text-xs text-muted-foreground">
          Hidden on the {shiftLabel.toLowerCase()} shift only. Nothing is deleted; people and records stay as they are.
        </p>
        <ul aria-label={`Lines hidden on the ${shiftLabel} shift`} className="space-y-1">
          {hidden.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-muted">
              <span className="min-w-0 text-sm">
                {h.name}
                {h.staffed && <span className="ml-1 text-2xs text-warning">· has people today, still drawn</span>}
              </span>
              {canManage && (
                <Button size="sm" variant="ghost" className="h-9 px-2 sm:h-7" disabled={busy} onClick={() => onShow([h.id])}>
                  Show
                </Button>
              )}
            </li>
          ))}
        </ul>
        {canManage && hidden.length > 1 && (
          <Button size="sm" variant="secondary" className="mt-2 h-9 w-full sm:h-8" disabled={busy} onClick={() => onShow(hidden.map((h) => h.id))}>
            Show all {hidden.length}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
