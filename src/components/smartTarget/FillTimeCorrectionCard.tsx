import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { correctedFillTime } from "@/lib/fillTimeCorrection";
import { cn } from "@/lib/utils";

/** Type what the iTouch screen shows; when Performance is over 100% it gives the standard that would read 100%. */
export function FillTimeCorrectionCard() {
  const [std, setStd] = useState("");
  const [perf, setPerf] = useState("");
  const s = Number(std.replace(",", "."));
  const p = Number(perf.replace(",", ".").replace("%", ""));
  const fixed = correctedFillTime(s, p);
  const ready = s > 0 && p > 0;

  return (
    <Card data-testid="fill-time-correction">
      <CardHeader>
        <CardTitle>Correct a standard fill time</CardTitle>
        <p className="text-sm text-muted-foreground">
          Performance can't be above 100%. When iTouch shows more, the standard fill time is slower than the line really runs. Type the two numbers from the iTouch screen.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-sm font-medium">Standard fill time (s)
          <Input value={std} onChange={(e) => setStd(e.target.value)} inputMode="decimal" placeholder="12.3" className="h-14 text-lg" autoComplete="off" />
        </label>
        <label className="space-y-1 text-sm font-medium">Performance (%)
          <Input value={perf} onChange={(e) => setPerf(e.target.value)} inputMode="decimal" placeholder="144.83" className="h-14 text-lg" autoComplete="off" />
        </label>
        <div className={cn("flex flex-col justify-center rounded-lg border px-4", fixed ? "border-primary bg-primary/10" : "bg-muted/30")}>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Standard to put in iTouch</span>
          <span className="text-2xl font-semibold tabular-nums">
            {!ready ? "—" : fixed ? `${fixed.toFixed(2)} s` : `${s.toFixed(2)} s`}
          </span>
          <span className="text-xs text-muted-foreground">
            {!ready ? "Waiting for both numbers" : fixed ? `${(60 / fixed).toFixed(1)} fills/min · ${Math.round(3600 / fixed)}/h` : "At or under 100% — keep it"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground md:col-span-3">
          Check over a full run, not a few minutes: during set-up or blending iTouch can show a high figure from very few units.
        </p>
      </CardContent>
    </Card>
  );
}
