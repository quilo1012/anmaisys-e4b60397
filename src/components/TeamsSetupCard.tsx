import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function TeamsSetupCard() {
  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("notify-teams", {
        body: {
          event: "test",
          title: "Test Notification",
          message: "Microsoft Teams integration is working.",
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Test card sent to Teams");
    } catch (e: any) {
      toast.error(e.message || "Failed to send test card. Check TEAMS_WEBHOOK_URL secret.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          Microsoft Teams
        </CardTitle>
        <CardDescription>
          Push Adaptive Card alerts to a Teams channel for critical work orders, unassigned WOs, and line stops.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
          <p className="font-medium">Setup steps</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
            <li>In Teams, open the target channel → <strong>Connectors</strong> → add <strong>Incoming Webhook</strong>.</li>
            <li>Copy the webhook URL.</li>
            <li>
              Add it as a secret named <Badge variant="secondary">TEAMS_WEBHOOK_URL</Badge> in backend settings.
            </li>
            <li>Send a test below.</li>
          </ol>
          <a
            href="https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Teams webhook docs <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Button onClick={sendTest} disabled={sending} className="w-full sm:w-auto">
          <Send className="h-4 w-4 mr-2" />
          {sending ? "Sending..." : "Send test card"}
        </Button>
      </CardContent>
    </Card>
  );
}
