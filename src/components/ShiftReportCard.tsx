import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Moon, Sun, Send, Plus, Trash2, Save, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Settings = {
  id?: string;
  day_enabled: boolean;
  night_enabled: boolean;
  extra_recipients: string[];
  include_admins_managers: boolean;
  last_sent_day_at?: string | null;
  last_sent_night_at?: string | null;
};

const DEFAULT: Settings = {
  day_enabled: false,
  night_enabled: false,
  extra_recipients: [],
  include_admins_managers: true,
};

export function ShiftReportCard() {
  const [s, setS] = useState<Settings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState<"day" | "night" | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any)
        .from("shift_report_settings").select("*").limit(1).maybeSingle();
      if (error) toast.error(error.message);
      if (data) setS({ ...DEFAULT, ...data, extra_recipients: data.extra_recipients || [] });
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        day_enabled: s.day_enabled,
        night_enabled: s.night_enabled,
        extra_recipients: s.extra_recipients,
        include_admins_managers: s.include_admins_managers,
        updated_at: new Date().toISOString(),
      };
      if (s.id) {
        const { error } = await (supabase as any).from("shift_report_settings").update(payload).eq("id", s.id);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any).from("shift_report_settings").insert(payload).select().single();
        if (error) throw error;
        setS((p) => ({ ...p, id: data.id }));
      }
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast.error("Invalid email"); return; }
    if (s.extra_recipients.includes(e)) { toast.error("Already in list"); return; }
    setS((p) => ({ ...p, extra_recipients: [...p.extra_recipients, e] }));
    setNewEmail("");
  };
  const removeEmail = (e: string) => setS((p) => ({ ...p, extra_recipients: p.extra_recipients.filter((x) => x !== e) }));

  const sendTest = async (shift: "day" | "night") => {
    const e = testEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { toast.error("Enter a valid test email"); return; }
    setSending(shift);
    try {
      const { data, error } = await supabase.functions.invoke("send-shift-report", {
        body: { shift, testRecipient: e },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Test ${shift} report sent to ${e}`);
    } catch (err: any) {
      toast.error(err.message || "Send failed");
    } finally {
      setSending(null);
    }
  };

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const cronSql = `-- Day shift report at 18:00 UTC, Night shift report at 06:00 UTC
select cron.schedule('shift-report-day', '0 18 * * *', $$
  select net.http_post(
    url:='https://${projectRef}.supabase.co/functions/v1/send-shift-report',
    headers:='{"Content-Type":"application/json","apikey":"<YOUR_ANON_KEY>"}'::jsonb,
    body:='{"shift":"day"}'::jsonb
  );
$$);
select cron.schedule('shift-report-night', '0 6 * * *', $$
  select net.http_post(
    url:='https://${projectRef}.supabase.co/functions/v1/send-shift-report',
    headers:='{"Content-Type":"application/json","apikey":"<YOUR_ANON_KEY>"}'::jsonb,
    body:='{"shift":"night"}'::jsonb
  );
$$);`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          Shift Reports (Day / Night)
        </CardTitle>
        <CardDescription>
          Email a shift summary with KPIs, downtime per line and top problems at the end of each shift.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg border p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sun className="h-4 w-4 text-amber-500" />
                  <div>
                    <div className="font-medium text-sm">Day Shift (06:00–18:00)</div>
                    {s.last_sent_day_at && <div className="text-[11px] text-muted-foreground">Last sent: {new Date(s.last_sent_day_at).toLocaleString("en-GB")}</div>}
                  </div>
                </div>
                <Switch checked={s.day_enabled} onCheckedChange={(v) => setS((p) => ({ ...p, day_enabled: v }))} />
              </div>
              <div className="rounded-lg border p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Moon className="h-4 w-4 text-indigo-400" />
                  <div>
                    <div className="font-medium text-sm">Night Shift (18:00–06:00)</div>
                    {s.last_sent_night_at && <div className="text-[11px] text-muted-foreground">Last sent: {new Date(s.last_sent_night_at).toLocaleString("en-GB")}</div>}
                  </div>
                </div>
                <Switch checked={s.night_enabled} onCheckedChange={(v) => setS((p) => ({ ...p, night_enabled: v }))} />
              </div>
            </div>

            <div className="rounded-lg border p-3 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Include all Admins + Managers automatically</div>
                <div className="text-xs text-muted-foreground">Pulls emails from their profiles.</div>
              </div>
              <Switch checked={s.include_admins_managers} onCheckedChange={(v) => setS((p) => ({ ...p, include_admins_managers: v }))} />
            </div>

            <div className="space-y-2">
              <Label>Extra recipients</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="add@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
                  autoComplete="off"
                />
                <Button type="button" variant="outline" onClick={addEmail}><Plus className="h-4 w-4" /></Button>
              </div>
              {s.extra_recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {s.extra_recipients.map((e) => (
                    <Badge key={e} variant="secondary" className="gap-1.5">
                      {e}
                      <button onClick={() => removeEmail(e)} className="hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Saving..." : "Save settings"}
              </Button>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Send a test now</Label>
              <div className="flex gap-2">
                <Input placeholder="your@email.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} autoComplete="off" />
                <Button variant="outline" onClick={() => sendTest("day")} disabled={sending !== null}>
                  <Send className="h-4 w-4 mr-1" /> {sending === "day" ? "..." : "Day"}
                </Button>
                <Button variant="outline" onClick={() => sendTest("night")} disabled={sending !== null}>
                  <Send className="h-4 w-4 mr-1" /> {sending === "night" ? "..." : "Night"}
                </Button>
              </div>
            </div>

            <details className="rounded-lg border bg-muted/30 p-3">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">Schedule automatically (pg_cron)</summary>
              <pre className="mt-2 rounded-md border bg-background p-3 text-[11px] overflow-x-auto whitespace-pre">{cronSql}</pre>
              <p className="text-xs text-muted-foreground mt-2">
                Run once in the database SQL editor. Replace <code>&lt;YOUR_ANON_KEY&gt;</code> with your public anon key. Times are UTC.
              </p>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
