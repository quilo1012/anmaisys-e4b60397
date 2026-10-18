import { WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * The one shape a failed load takes on the employee's own pages (My Overtime, My
 * Attendance): what happened, in words a person on the floor can act on, and the
 * button to try again. A bare sentence with no button left a phone with nothing to
 * press but the browser's reload — which signs nobody out, but feels like it might.
 */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardContent className="flex items-start gap-3 py-4 text-sm">
        <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-warning-strong" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <p>{message}</p>
          <Button variant="outline" className="h-11" onClick={onRetry}>Try again</Button>
        </div>
      </CardContent>
    </Card>
  );
}
