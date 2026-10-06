import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Share, Loader2 } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

/**
 * The one thing that decides whether anybody answers an ask: whether their phone buzzes.
 *
 * The bell inside the app is written for everyone; the push to the lock screen only
 * reaches a phone that said yes once. On 06/10 the first three asks went out to three
 * linked people and zero push subscriptions — the bell had them, the phones did not.
 * This card sits above the asks until the phone says yes, and goes away by itself the
 * moment it does. It does not use the global PushOnboarding toast: a toast lasts fifteen
 * seconds and is dismissed with a thumb; a card that stays until the job is done is not.
 *
 * iPhone is the awkward one. Safari only offers push to a site that was added to the
 * Home Screen, so on an iPhone browser tab `supported` is false and there is nothing to
 * ask permission for — the card tells the person what to do instead of showing a
 * button that cannot work.
 */
export function OvertimePushNudge() {
  const { supported, permission, subscribed, loading, subscribe } = usePushNotifications();

  if (subscribed) return null;

  const isIOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined"
    && (window.matchMedia?.("(display-mode: standalone)").matches
        || (navigator as Navigator & { standalone?: boolean }).standalone === true);

  // iPhone in a browser tab: push is not on offer until the app is on the Home Screen.
  if (!supported && isIOS && !isStandalone) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 py-4">
          <Share className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <div className="font-medium">Get a buzz when overtime opens</div>
            <div className="mt-0.5 text-muted-foreground">
              On iPhone, tap <span className="font-medium">Share</span> then{" "}
              <span className="font-medium">Add to Home Screen</span>. Open the app from there
              and this card will offer notifications.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!supported) return null;

  if (permission === "denied") {
    return (
      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="flex items-start gap-3 py-4">
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="text-sm">
            <div className="font-medium">Notifications are blocked for this site</div>
            <div className="mt-0.5 text-muted-foreground">
              You'll still see asks here, but your phone won't buzz. To turn them back on, allow
              notifications for this site in your browser settings.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-start gap-3 text-sm">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <div className="font-medium">Get a buzz when overtime opens</div>
            <div className="mt-0.5 text-muted-foreground">
              Otherwise you only find out when you open the app — and the places may be gone.
            </div>
          </div>
        </div>
        <Button size="sm" disabled={loading} onClick={() => void subscribe()}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Turn on
        </Button>
      </CardContent>
    </Card>
  );
}
