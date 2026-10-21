import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AvailabilityDot } from "@/components/chat/AvailabilityDot";
import { useMyAvailability, useSetMyAvailability } from "@/hooks/useCommunicationPresence";
import {
  AUTOMATIC_NOTE, AVAILABILITY_HELP, AVAILABILITY_LABEL, AVAILABILITY_STATUSES, isAvailabilityStatus,
  myDisplayedAvailability, type AvailabilityStatus,
} from "@/lib/communicationPresence";
import { cn } from "@/lib/utils";

/**
 * Your own availability, chosen by you. Everybody signed in has it; nobody sets
 * somebody else's (the database writes only the caller's row). It is a menu of radio
 * items, so the keyboard, the screen reader and a phone all get the standard behaviour,
 * and every row is at least 44px tall.
 *
 * Choosing a status never stops anyone writing to you.
 */
export function AvailabilityMenu({ variant = "default", className }: {
  variant?: "default" | "sidebar"; className?: string;
}) {
  const mine = useMyAvailability();
  const save = useSetMyAvailability();
  const preference = mine.data?.preference ?? null;
  const reason = mine.data?.automaticReason ?? null;
  const shown: AvailabilityStatus | null = mine.data
    ? myDisplayedAvailability(mine.data.preference, mine.data.approvedHoliday, mine.data.automatic) : null;

  const choose = (value: string) => {
    if (!isAvailabilityStatus(value) || value === preference) return;
    save.mutate(value, {
      onSuccess: () => toast.success(`You are now set to ${AVAILABILITY_LABEL[value]}.`),
      onError: () => toast.error("Could not save your availability. Try again."),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button" variant={variant === "sidebar" ? "ghost" : "outline"} size="sm"
          disabled={!mine.data && !mine.isError}
          aria-label={shown ? `Your availability: ${AVAILABILITY_LABEL[shown]}. Change` : "Your availability"}
          className={cn(
            "h-9 min-w-0 justify-between gap-2 px-2.5 font-normal",
            variant === "sidebar" && "w-full text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {shown ? <AvailabilityDot status={shown} /> : <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            <span className="truncate text-xs">{shown ? AVAILABILITY_LABEL[shown] : "Availability"}</span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuLabel className="text-2xs uppercase tracking-wider text-muted-foreground">
          Your availability
        </DropdownMenuLabel>
        {reason && (
          <p className="px-2 pb-2 text-xs text-muted-foreground" data-testid="availability-leave-note">
            {AUTOMATIC_NOTE[reason]}
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={preference ?? ""} onValueChange={choose}>
          {AVAILABILITY_STATUSES.map((status) => (
            <DropdownMenuRadioItem key={status} value={status} className="min-h-11 items-start py-2 data-[state=checked]:bg-muted" disabled={save.isPending}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <AvailabilityDot status={status} />
                  {AVAILABILITY_LABEL[status]}
                </span>
                <span className="pl-6 text-xs text-muted-foreground">{AVAILABILITY_HELP[status]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
