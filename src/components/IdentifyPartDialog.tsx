import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { useIdentifyPart, type PartMatch } from "@/hooks/useIdentifyPart";

/**
 * Another way to search this same list — camera instead of keyboard.
 *
 * Choosing a candidate hands its code back to the screen, which puts it in the
 * search box: the technician lands on the row, inside the list they already know.
 */
export function IdentifyPartDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (code: string) => void;
}) {
  const identify = useIdentifyPart();
  const [preview, setPreview] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (file: File) => {
    setLastFile(file);
    setPreview(URL.createObjectURL(file));
    identify.reset();
    try {
      await identify.mutateAsync(file);
    } catch {
      /* the error is shown from mutation state, and the photo stays for a retry */
    }
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await run(file);
  };

  const close = (v: boolean) => {
    if (!v) {
      setPreview(null);
      setLastFile(null);
      identify.reset();
    }
    onOpenChange(v);
  };

  const result = identify.data;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="h-5 w-5" /> Find a part by photo</DialogTitle>
          <DialogDescription>
            Photograph the part in your hand and we compare it with the catalogue. The photo is used
            for this search only and is not saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {preview ? (
              <img src={preview} alt="Photographed part" className="h-20 w-20 rounded border object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded border border-dashed text-muted-foreground">
                <Camera className="h-6 w-6" />
              </div>
            )}
            <Button
              variant="outline"
              className="h-12"
              disabled={identify.isPending}
              onClick={() => inputRef.current?.click()}
            >
              <Camera className="mr-2 h-4 w-4" />
              {preview ? "Take another photo" : "Take / upload photo"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={handlePick}
            />
          </div>

          {identify.isPending && (
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analysing the photo against the catalogue…
            </div>
          )}

          {identify.isError && !identify.isPending && (
            <div className="space-y-3 rounded-lg border border-destructive p-3">
              <div className="flex items-start gap-2 text-sm text-destructive-strong">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{identify.error?.message || "The search could not be completed."}</p>
              </div>
              {lastFile && (
                <Button size="sm" variant="outline" onClick={() => run(lastFile)}>
                  <RefreshCw className="mr-1 h-4 w-4" /> Try again
                </Button>
              )}
            </div>
          )}

          {result && !identify.isPending && (
            <div className="space-y-3">
              {result.description && (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">In the photo: </span>{result.description}
                </p>
              )}
              {result.candidates.length === 0 ? (
                // Saying "nothing plausible" is information; an empty list is not.
                <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                  No part in the catalogue plausibly matches this photo. Try another angle, better
                  light, or a close-up of any marking on the part.
                </div>
              ) : (
                <div className="space-y-2">
                  {result.candidates.map((c) => (
                    <CandidateRow key={c.code} c={c} onPick={() => { onPick(c.code); close(false); }} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function confidenceLabel(v: number): { label: string; status: "high" | "medium" | "low" } {
  if (v >= 0.7) return { label: "High confidence", status: "high" };
  if (v >= 0.4) return { label: "Possible", status: "medium" };
  return { label: "Long shot", status: "low" };
}

function CandidateRow({ c, onPick }: { c: PartMatch; onPick: () => void }) {
  const { label, status } = confidenceLabel(c.confidence);
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{c.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline" className="capitalize">{c.category}</Badge>
          <span
            className={`text-xs font-medium ${
              status === "high" ? "text-success-strong" : status === "medium" ? "text-warning-strong" : "text-muted-foreground"
            }`}
          >
            {label} · {Math.round(c.confidence * 100)}%
          </span>
        </div>
      </div>
      {c.reason && <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>}
    </button>
  );
}
