import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationSetup() {
  const { supported, permission, subscribed, loading, subscribe, unsubscribe, sendTest } =
    usePushNotifications();

  const statusBadge = !supported ? (
    <Badge variant="outline">Unsupported</Badge>
  ) : permission === "denied" ? (
    <Badge variant="destructive">Blocked</Badge>
  ) : subscribed ? (
    <Badge className="bg-green-600 hover:bg-green-700">Active</Badge>
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
        {!supported && (
          <p className="text-sm text-muted-foreground">
            This browser does not support web push notifications.
          </p>
        )}

        {supported && permission === "denied" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked. Enable them in your browser site settings,
            then reload this page.
          </p>
        )}

        {supported && permission !== "denied" && (
          <>
            <p className="text-sm text-muted-foreground">
              Receive native alerts for new work orders and critical events even
              when this tab is closed.
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
                  Send test
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
