import { AlertTriangle, RotateCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Said instead of the figures when a read failed.
 *
 * An empty array stands in for "nothing there" and for "could not ask" alike, and on
 * these screens the first is a believable answer: zero sick today, 22.5 days left,
 * "No rota" for everybody. A failed read must not be allowed to look like one.
 */
export function ReadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        <p className="flex-1 text-sm">
          {what} could not be read, so no numbers are being shown. Check the connection and try again.
        </p>
        <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5">
          <RotateCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </CardContent>
    </Card>
  );
}
