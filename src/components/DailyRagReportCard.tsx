import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mail, Send, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function DailyRagReportCard() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const cronSql = `-- Run daily at 18:30 London (end of day shift)
select cron.schedule(
  'daily-rag-report',
  '30 17 * * *',
  $$
  select net.http_post(
    url:='https://${projectRef}.supabase.co/functions/v1/send-daily-rag-report',
    headers:='{"Content-Type":"application/json","apikey":"<YOUR_ANON_KEY>"}'::jsonb,
    body:='{"recipient":"manager@yourcompany.com"}'::jsonb
  );
  $$
);`;

  const sendNow = async () => {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error("Enter a valid email address");
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-daily-rag-report", {
        body: { recipient: email },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Daily RAG report sent to ${email}`);
    } catch (e: any) {
      toast.error(e.message || "Failed to send report. Check RESEND_API_KEY secret.");
    } finally {
      setSending(false);
    }
  };

  const copyCron = () => {
    navigator.clipboard.writeText(cronSql);
    toast.success("Cron SQL copied to clipboard");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Daily RAG Report
        </CardTitle>
        <CardDescription>
          Email today's RAG summary — Plan vs Actual per line/shift, downtime and overall RAG status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          Requires the <Badge variant="secondary">RESEND_API_KEY</Badge> secret. From-address defaults to{" "}
          <code className="text-xs">onboarding@resend.dev</code> (verify your domain in Resend for production).
        </div>

        <div className="space-y-2">
          <Label htmlFor="rag-email">Recipient email</Label>
          <div className="flex gap-2">
            <Input
              id="rag-email"
              type="email"
              placeholder="manager@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
            <Button onClick={sendNow} disabled={sending}>
              <Send className="h-4 w-4 mr-2" />
              {sending ? "Sending..." : "Send now"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Automate (pg_cron)</Label>
            <Button variant="ghost" size="sm" onClick={copyCron}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
          <pre className="rounded-md border bg-muted p-3 text-xs overflow-x-auto whitespace-pre">{cronSql}</pre>
          <p className="text-xs text-muted-foreground">
            Run this once in the database SQL editor. Replace <code>&lt;YOUR_ANON_KEY&gt;</code> with your public anon key.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
