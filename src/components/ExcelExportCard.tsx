import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileSpreadsheet, Mail, Copy } from "lucide-react";
import { invokeFunction } from "@/lib/invokeFunction";
import { toast } from "sonner";

const PROJECT_URL = "https://ybtrzqzliepknpzqdajx.supabase.co";

export function ExcelExportCard() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const cronSql = `-- Run every Monday at 07:00 UTC
select cron.schedule(
  'weekly-excel-report',
  '0 7 * * 1',
  $$ select net.http_post(
    url := '${PROJECT_URL}/functions/v1/export-weekly-excel',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{"to":"${email || "you@example.com"}"}'::jsonb
  ); $$
);`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" /> Weekly CSV / Excel Export
        </CardTitle>
        <CardDescription>Email a 7-day work-order export. Schedule via pg_cron for automation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Label>Recipient email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@yourcompany.com" />
          </div>
          <Button
            className="self-end"
            disabled={!email || busy}
            onClick={async () => {
              setBusy(true);
              const { error } = await invokeFunction("export-weekly-excel", { to: email });
              setBusy(false);
              if (error) toast.error(error.message ?? "Failed to send");
              else toast.success("Report sent");
            }}
          >
            <Mail className="h-4 w-4 mr-2" /> Send now
          </Button>
        </div>
        <div>
          <Label>pg_cron snippet (run in SQL editor)</Label>
          <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap">{cronSql}</pre>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => { navigator.clipboard.writeText(cronSql); toast.success("Copied"); }}>
            <Copy className="h-3 w-3 mr-1" /> Copy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
