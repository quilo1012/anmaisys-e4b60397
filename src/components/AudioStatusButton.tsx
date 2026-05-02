import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { cn } from "@/lib/utils";

/**
 * Header button that surfaces the current alert-audio state for engineers/admins.
 * - Green Volume2 icon when audio is unlocked.
 * - Red pulsing VolumeX icon when audio is muted (browser autoplay block).
 *   Clicking re-opens the "Enable Alerts" prompt so the user can unlock audio
 *   with a single gesture.
 */
export function AudioStatusButton() {
  const { audioEnabled, promptEnableAudio, testSound } = useCriticalAlert();

  const handleClick = () => {
    if (audioEnabled) {
      // Already unlocked — let the user verify the siren works.
      testSound();
    } else {
      promptEnableAudio();
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={audioEnabled ? "ghost" : "destructive"}
          size={audioEnabled ? "icon" : "sm"}
          onClick={handleClick}
          aria-label={audioEnabled ? "Test alert sound" : "Enable critical alert sounds"}
          className={cn(
            "shrink-0 relative gap-1.5 h-9",
            !audioEnabled && "animate-pulse font-bold"
          )}
        >
          {audioEnabled ? (
            <Volume2 className="h-5 w-5 text-emerald-500" />
          ) : (
            <>
              <VolumeX className="h-4 w-4" />
              <span className="hidden sm:inline text-[11px] uppercase tracking-wide">Audio Off</span>
            </>
          )}
          {!audioEnabled && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-card sm:hidden" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {audioEnabled
          ? "Alert sound ON — click to test"
          : "Alert sound MUTED — tap to enable critical WO sirens"}
      </TooltipContent>
    </Tooltip>
  );
}
