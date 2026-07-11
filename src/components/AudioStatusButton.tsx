import { Volume2, VolumeX, Volume1 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCriticalAlert } from "@/contexts/CriticalAlertContext";
import { cn } from "@/lib/utils";

/**
 * Header button that shows the current alert-audio state and exposes a small
 * settings popover for the engineer:
 *  - Enable / disable critical alert sound
 *  - Adjust the siren volume (0–100%)
 *  - Test the siren
 *
 * Green pill = audio unlocked. Red pulsing pill = blocked/muted (one tap on
 * the button + Enable inside the popover re-unlocks it).
 */
export function AudioStatusButton() {
  const {
    audioEnabled,
    promptEnableAudio,
    testSound,
    volume,
    setVolume,
  } = useCriticalAlert();

  const pct = Math.round(volume * 100);
  // Treat "audio on with 0% volume" as effectively muted so the icon & switch
  // reflect reality.
  const effectivelyOn = audioEnabled && volume > 0;
  const Icon = !effectivelyOn ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const label = effectivelyOn ? `AUDIO ${pct}%` : "AUDIO OFF";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={effectivelyOn ? "outline" : "destructive"}
          size="sm"
          aria-label={effectivelyOn ? `Alert sound on at ${pct}%` : "Alert sound muted — tap to configure"}
          aria-pressed={effectivelyOn}
          className={cn(
            "shrink-0 gap-1.5 h-9 font-bold uppercase tracking-wide",
            effectivelyOn
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
              : "animate-pulse"
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline text-[11px]">{label}</span>
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              effectivelyOn ? "bg-emerald-500" : "bg-destructive-foreground"
            )}
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="alert-audio-toggle" className="text-sm font-semibold">
              Critical alert sound
            </Label>
            <p className="text-xs text-muted-foreground">
              Plays a continuous siren for new Work Orders.
            </p>
          </div>
          <Switch
            id="alert-audio-toggle"
            checked={effectivelyOn}
            onCheckedChange={(on) => {
              if (on) {
                // Restore audible volume; if audio was never unlocked, prompt.
                if (volume === 0) setVolume(1);
                if (!audioEnabled) {
                  try { sessionStorage.removeItem("an_audio_prompted"); } catch { /* ignore */ }
                  promptEnableAudio();
                }
              } else {
                // Mute without losing unlock state on this device.
                setVolume(0);
              }
            }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="alert-volume" className="text-sm">Volume</Label>
            <span className="text-xs font-mono tabular-nums text-muted-foreground">{pct}%</span>
          </div>
          <Slider
            id="alert-volume"
            min={0}
            max={100}
            step={5}
            value={[pct]}
            onValueChange={(v) => setVolume((v?.[0] ?? 0) / 100)}
            disabled={!audioEnabled}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => {
            if (!audioEnabled) {
              try { sessionStorage.removeItem("an_audio_prompted"); } catch { /* ignore */ }
              promptEnableAudio();
              return;
            }
            if (volume === 0) setVolume(1);
            testSound();
          }}
        >
          {audioEnabled ? "Test siren" : "Enable alerts"}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
