import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { cn } from "@/lib/utils";

/**
 * Header button that shows current alert-audio state.
 * - Green pill "AUDIO ON" when unlocked  → click to test the siren.
 * - Red pulsing pill "AUDIO OFF" when muted → click to unlock audio.
 */
export function AudioStatusButton() {
  const { audioEnabled, promptEnableAudio, testSound } = useCriticalAlert();

  const handleClick = () => {
    if (audioEnabled) {
      testSound();
    } else {
      // User gesture from the header button must always re-open the modal,
      // even if the once-per-session auto-prompt already fired.
      try { sessionStorage.removeItem("an_audio_prompted"); } catch { /* ignore */ }
      promptEnableAudio();
    }
  };

  const label = audioEnabled ? "AUDIO ON" : "AUDIO OFF";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={audioEnabled ? "outline" : "destructive"}
          size="sm"
          onClick={handleClick}
          aria-label={audioEnabled ? "Alert sound on — click to test" : "Alert sound muted — click to enable"}
          aria-pressed={audioEnabled}
          className={cn(
            "shrink-0 gap-1.5 h-9 font-bold uppercase tracking-wide",
            audioEnabled
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
              : "animate-pulse"
          )}
        >
          {audioEnabled ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
          <span className="hidden sm:inline text-[11px]">{label}</span>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              audioEnabled ? "bg-emerald-500" : "bg-destructive-foreground"
            )}
            aria-hidden="true"
          />
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
