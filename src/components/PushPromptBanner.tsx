import { useState } from "react";
import { Bell, BellOff, Loader2, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import type { Role } from "@/lib/permissions";

/**
 * The line that gets every phone onto the push list.
 *
 * A message only reaches a locked screen if THAT phone said yes once. Until now the only
 * ways to say yes were a fifteen-second toast (never shown to the floor roles, on purpose:
 * a bare permission bar is how people tap Block) and a card on the My Overtime page. So an
 * employee who never opened My Overtime had no phone registered, and a message to them sat
 * in the bell: on 21/10 a message to Maikon Tiago Rosa reached nobody, because he had 0
 * phones on the list while his colleague, who had tapped Enable, was buzzed.
 *
 * This stays at the top of every screen, with a sentence saying what it is for, until the
 * phone is on the list. "Not now" hides it for twelve hours; it does not make it go away.
 * It does not appear on a shared `operator` tablet (a push there would buzz whoever is
 * holding it), nor where push cannot work at all.
 */
const SNOOZE_KEY = "an_push_banner_snooze_until";
const SNOOZE_MS = 12 * 60 * 60 * 1000;

function snoozed(): boolean {
  try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now(); } catch { return false; }
}

export function PushPromptBanner({ role }: { role: Role | null | undefined }) {
  const { environment, permission, subscribed, loading, subscribe } = usePushNotifications();
  const [hidden, setHidden] = useState(snoozed);

  if (!role || role === "operator") return null;
  if (subscribed || hidden) return null;
  if (environment.kind === "unsupported") return null;

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* it just comes back sooner */ }
    setHidden(true);
  };

  let icon = <Bell className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />;
  let body: React.ReactNode;
  let action: React.ReactNode = null;

  if (environment.kind === "ios-install") {
    icon = <Share className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />;
    body = (
      <>
        On iPhone, tap <span className="font-medium">Share</span> then{" "}
        <span className="font-medium">Add to Home Screen</span>, open the app from its icon and
        turn notifications on. Without it, messages and overtime only show when the app is open.
      </>
    );
  } else if (environment.kind === "ios-too-old") {
    body = <>This iPhone is on iOS {environment.version}. Notifications need iOS 16.4 or later — update in Settings → General → Software Update.</>;
  } else if (permission === "denied") {
    icon = <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />;
    body = <>Notifications are blocked for this app. On iPhone open Settings → Notifications, pick this app and allow them; elsewhere use the browser's site settings.</>;
  } else {
    body = <>Turn on notifications to get messages and overtime on this phone, even when the screen is locked.</>;
    action = (
      <Button size="sm" className="h-9" onClick={() => { void subscribe(); }} disabled={loading}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}
        Turn on notifications
      </Button>
    );
  }

  return (
    <div role="region" aria-label="Phone notifications" data-testid="push-prompt"
      className="mb-3 flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="font-medium">Get your messages on this phone</div>
        <div className="mt-0.5 text-muted-foreground">{body}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={snooze} aria-label="Not now">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
