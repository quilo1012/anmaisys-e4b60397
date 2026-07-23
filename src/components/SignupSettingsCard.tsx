import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
const cfg = () => supabase.from("signup_config" as any);

/** Admin card: manage the self-registration invite code + on/off switch. */
export function SignupSettingsCard() {
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ok = true;
    cfg().select("invite_code, enabled").eq("id", true).maybeSingle().then(({ data }: { data: { invite_code: string | null; enabled: boolean } | null }) => {
      if (!ok || !data) { setLoading(false); return; }
      setCode(data.invite_code ?? "");
      setEnabled(!!data.enabled);
      setLoading(false);
    });
    return () => { ok = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    const { error } = await cfg().update({ invite_code: code.trim() || null, enabled, updated_at: new Date().toISOString() }).eq("id", true);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Sign-up settings saved");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4" /> Self sign-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm">Allow new users to register</Label>
                <p className="text-xs text-muted-foreground">When on, people can create an account with the invite code. New accounts stay <b>pending</b> until you approve them below.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-code" className="text-sm">Invite code</Label>
              <Input id="invite-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AN-2026" autoComplete="off" />
              <p className="text-xs text-muted-foreground">Share this code with people you want to let register. Change it anytime to revoke access.</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Save</Button>
            </div>
            <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              To approve a pending user: find them in the staff list (shown as <b>Inactive</b>, no role), edit them, set a role and mark <b>Active</b>.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
