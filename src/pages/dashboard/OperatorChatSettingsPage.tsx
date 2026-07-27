import { DashboardLayout } from "@/components/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

type Admin = { id: string; name: string | null; email: string | null; day: boolean; night: boolean };

export default function OperatorChatSettingsPage() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["operator-chat-admins"],
    queryFn: async () => {
      const { data: roleRows, error: e1 } = await supabase
        .from("user_roles").select("user_id").eq("role", "admin");
      if (e1) throw e1;
      const ids = (roleRows ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [] as Admin[];
      const { data: admins, error: e2 } = await supabase
        .from("profiles").select("id, name, email").in("id", ids).eq("active", true).order("name");
      if (e2) throw e2;
      const { data: assign, error: e3 } = await (supabase as any)
        .from("operator_chat_admins").select("user_id, day, night");
      if (e3) throw e3;
      const map = new Map<string, { day: boolean; night: boolean }>((assign ?? []).map((a: any) => [a.user_id, a]));
      return (admins ?? []).map((p: any) => ({
        id: p.id, name: p.name, email: p.email,
        day: map.get(p.id)?.day ?? false,
        night: map.get(p.id)?.night ?? false,
      })) as Admin[];
    },
  });

  const save = useMutation({
    mutationFn: async ({ id, day, night }: { id: string; day: boolean; night: boolean }) => {
      const { error } = await (supabase as any).from("operator_chat_admins")
        .upsert({ user_id: id, day, night, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operator-chat-admins"] }); },
    onError: (e: any) => toast.error(e?.message || "Failed to save"),
  });

  const toggle = (a: Admin, field: "day" | "night", val: boolean) =>
    save.mutate({ id: a.id, day: field === "day" ? val : a.day, night: field === "night" ? val : a.night });

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-2xl">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <MessageCircle className="h-6 w-6" /> Operator Chat
          </h2>
          <p className="text-muted-foreground">
            Choose which admins operators can message on each shift. An operator only sees the admins
            enabled for the shift that's running (Day 06:00–18:00, Night otherwise). Supervisors are
            always available. Turn both off to remove an admin from the operator chat entirely.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle>Reachable admins by shift</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No admin users found.</p>
            ) : (
              <div className="divide-y">
                <div className="flex items-center gap-4 pb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <div className="flex-1">Admin</div>
                  <div className="w-16 text-center">Day</div>
                  <div className="w-16 text-center">Night</div>
                </div>
                {rows.map((a) => (
                  <div key={a.id} className="flex items-center gap-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{a.name || a.email}</div>
                      {a.name && <div className="text-xs text-muted-foreground truncate">{a.email}</div>}
                    </div>
                    <div className="w-16 flex justify-center">
                      <Switch checked={a.day} onCheckedChange={(v) => toggle(a, "day", v)} aria-label={`Day shift for ${a.name || a.email}`} />
                    </div>
                    <div className="w-16 flex justify-center">
                      <Switch checked={a.night} onCheckedChange={(v) => toggle(a, "night", v)} aria-label={`Night shift for ${a.name || a.email}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
