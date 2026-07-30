import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Loader2, Sun, Moon, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

type ShiftCode = "DAY" | "NIGHT";
const SHIFTS: { code: ShiftCode; label: string; icon: typeof Sun }[] = [
  { code: "DAY", label: "Day shift", icon: Sun },
  { code: "NIGHT", label: "Night shift", icon: Moon },
];

const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> }).rpc(fn, args);

function ShiftPasswordRow({ code, label, Icon, isSet, onSaved }: {
  code: ShiftCode; label: string; Icon: typeof Sun; isSet: boolean; onSaved: () => void;
}) {
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (pw.trim().length < 3) { toast.error("Password must be at least 3 characters"); return; }
    setSaving(true);
    const { error } = await rpc("set_shift_password", { _shift_code: code, _password: pw });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${label} password ${isSet ? "updated" : "set"}`);
    setPw("");
    onSaved();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" /> {label}
          {isSet
            ? <Badge className="ml-1 gap-1 bg-emerald-500/15 text-emerald-600 border border-emerald-500/40"><CheckCircle2 className="h-3 w-3" /> Password set</Badge>
            : <Badge variant="secondary" className="ml-1">No password — shift open</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor={`pw-${code}`}>{isSet ? "New password" : "Set password"}</Label>
          <div className="flex gap-2">
            <Input
              id={`pw-${code}`}
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              placeholder={`${label} password`}
              className="h-11 max-w-xs"
              autoComplete="new-password"
            />
            <Button onClick={() => void save()} disabled={saving || !pw.trim()} className="h-11">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Anyone opening this shift's production (Production Control, My Production, Performance, RAG Weekly) must enter this password.
        </p>
      </CardContent>
    </Card>
  );
}

export default function ShiftPasswordSettingsPage() {
  const { data: setMap, isLoading, refetch } = useQuery({
    queryKey: ["shift-pw-set-admin"],
    queryFn: async () => {
      const entries = await Promise.all(SHIFTS.map(async (s) => {
        const { data } = await rpc("shift_password_is_set", { _shift_code: s.code });
        return [s.code, Boolean(data)] as const;
      }));
      return Object.fromEntries(entries) as Record<ShiftCode, boolean>;
    },
  });

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold"><KeyRound className="h-6 w-6" /> Shift Passwords</h2>
          <p className="text-muted-foreground">
            Set a separate password for each shift. To view a shift's production, users type that shift's password.
            A shift with no password stays open.
          </p>
        </div>
        {isLoading || !setMap ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {SHIFTS.map((s) => (
              <ShiftPasswordRow key={s.code} code={s.code} label={s.label} Icon={s.icon} isSet={setMap[s.code]} onSaved={() => refetch()} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
