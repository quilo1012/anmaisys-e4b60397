import { Bell, BellOff, BellRing, Loader2, Share } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationSetup() {
  const { supported, environment, permission, subscribed, loading, subscribe, unsubscribe, sendTest } =
    usePushNotifications();
  const iosInstall = environment.kind === "ios-install";
  const iosTooOld = environment.kind === "ios-too-old";

  const statusBadge = iosInstall ? (
    <Badge variant="secondary">Add to Home Screen</Badge>
  ) : !supported ? (
    <Badge variant="outline">Unsupported</Badge>
  ) : permission === "denied" ? (
    <Badge variant="destructive">Blocked</Badge>
  ) : subscribed ? (
    <Badge className="bg-success hover:bg-success/90">Active</Badge>
  ) : (
    <Badge variant="secondary">Off</Badge>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <BellRing className="h-5 w-5" /> Push Notifications
          </span>
          {statusBadge}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {iosInstall && (
          <div className="flex items-start gap-3 text-sm">
            <Share className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="text-muted-foreground">
              On iPhone, notifications only work for an app on the Home Screen. In Safari tap{" "}
              <span className="font-medium text-foreground">Share</span>, then{" "}
              <span className="font-medium text-foreground">Add to Home Screen</span>, open the app
              from its icon, and come back to this page to turn them on.
            </div>
          </div>
        )}

        {iosTooOld && (
          <p className="text-sm text-muted-foreground">
            This iPhone is on iOS {environment.kind === "ios-too-old" ? environment.version : ""}. Notifications
            need iOS 16.4 or later — update in Settings → General → Software Update.
          </p>
        )}

        {!supported && !iosInstall && !iosTooOld && (
          <p className="text-sm text-muted-foreground">
            This browser does not support web push notifications.
          </p>
        )}

        {supported && permission === "denied" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked. On iPhone open Settings → Notifications, pick this app and
            allow them; elsewhere use your browser's site settings. Then reload this page.
          </p>
        )}

        {supported && permission !== "denied" && (
          <>
            <p className="text-sm text-muted-foreground">
              Receive native alerts for chat messages, overtime and critical events even
              when the app is closed or the screen is locked.
            </p>
            <div className="flex flex-wrap gap-2">
              {subscribed ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={unsubscribe}
                  disabled={loading}
                  className="h-10"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <BellOff className="h-4 w-4 mr-2" />
                  )}
                  Disable
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={subscribe}
                  disabled={loading}
                  className="h-10"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Bell className="h-4 w-4 mr-2" />
                  )}
                  Enable
                </Button>
              )}
              {subscribed && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={sendTest}
                  className="h-10"
                >
                  Send test to this phone
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
