import { DashboardLayout } from "@/components/DashboardLayout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Admin = {
  id: string; name: string | null; email: string | null;
  day: boolean; night: boolean;
  mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean;
};

const DAYS: { key: keyof Admin; label: string; title: string }[] = [
  { key: "mon", label: "M", title: "Monday" }, { key: "tue", label: "T", title: "Tuesday" },
  { key: "wed", label: "W", title: "Wednesday" }, { key: "thu", label: "T", title: "Thursday" },
  { key: "fri", label: "F", title: "Friday" }, { key: "sat", label: "S", title: "Saturday" },
  { key: "sun", label: "S", title: "Sunday" },
];
const ALL_DAYS = { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true };
const WEEKEND = { mon: true, tue: false, wed: false, thu: false, fri: true, sat: true, sun: true };

export default function OperatorChatSettingsPage() {
  const qc = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["operator-chat-admins"],
    queryFn: async () => {
      const { data: roleRows, error: e1 } = await supabase.from("user_roles").select("user_id").eq("role", "admin");
      if (e1) throw e1;
      const ids = (roleRows ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [] as Admin[];
      const { data: admins, error: e2 } = await supabase
        .from("profiles").select("id, name, email").in("id", ids).eq("active", true).order("name");
      if (e2) throw e2;
      const { data: assign, error: e3 } = await (supabase as any)
        .from("operator_chat_admins").select("user_id, day, night, mon, tue, wed, thu, fri, sat, sun");
      if (e3) throw e3;
      const map = new Map<string, any>((assign ?? []).map((a: any) => [a.user_id, a]));
      return (admins ?? []).map((p: any) => {
        const a = map.get(p.id);
        return {
          id: p.id, name: p.name, email: p.email,
          day: a?.day ?? false, night: a?.night ?? false,
          mon: a?.mon ?? false, tue: a?.tue ?? false, wed: a?.wed ?? false, thu: a?.thu ?? false,
          fri: a?.fri ?? false, sat: a?.sat ?? false, sun: a?.sun ?? false,
        } as Admin;
      });
    },
  });

  const save = useMutation({
    mutationFn: async (a: Admin) => {
      const { error } = await (supabase as any).from("operator_chat_admins").upsert({
        user_id: a.id, day: a.day, night: a.night,
        mon: a.mon, tue: a.tue, wed: a.wed, thu: a.thu, fri: a.fri, sat: a.sat, sun: a.sun,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["operator-chat-admins"] }),
    onError: (e: any) => toast.error(e?.message || "Failed to save"),
  });

  const patch = (a: Admin, changes: Partial<Admin>) => save.mutate({ ...a, ...changes });

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <MessageCircle className="h-6 w-6" /> Operator Chat
          </h2>
          <p className="text-muted-foreground">
            Choose which admins operators can message, by shift and by day of week. An operator only sees
            an admin when the current shift (Day 06:00–18:00, else Night) <b>and</b> the current day are
            enabled for them. Supervisors are always available.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle>Reachable admins</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No admin users found.</p>
            ) : (
              <div className="divide-y">
                {rows.map((a) => (
                  <div key={a.id} className="py-3 space-y-2">
                    <div className="flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{a.name || a.email}</div>
                        {a.name && <div className="text-xs text-muted-foreground truncate">{a.email}</div>}
                      </div>
                      <label className="flex items-center gap-1.5 text-xs"><span className="text-muted-foreground">Day</span>
                        <Switch checked={a.day} onCheckedChange={(v) => patch(a, { day: v })} aria-label={`Day shift for ${a.name || a.email}`} />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs"><span className="text-muted-foreground">Night</span>
                        <Switch checked={a.night} onCheckedChange={(v) => patch(a, { night: v })} aria-label={`Night shift for ${a.name || a.email}`} />
                      </label>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {DAYS.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          title={d.title}
                          onClick={() => patch(a, { [d.key]: !a[d.key] } as Partial<Admin>)}
                          className={cn(
                            "h-7 w-7 rounded-full text-xs font-semibold transition-colors",
                            a[d.key] ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                      <span className="mx-1 text-muted-foreground">·</span>
                      <button type="button" onClick={() => patch(a, ALL_DAYS)} className="text-xs text-muted-foreground underline hover:text-foreground">Every day</button>
                      <button type="button" onClick={() => patch(a, WEEKEND)} className="text-xs text-muted-foreground underline hover:text-foreground">Weekend (Fri–Mon)</button>
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
