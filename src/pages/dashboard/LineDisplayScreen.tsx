import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getShift, SHIFT_LABEL } from "@/lib/shifts";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type RagEntry = {
  id: string;
  entry_date: string;
  line: string;
  shift: string;
  plan_qty: number;
  actual_qty: number;
  updated_at: string;
};

type ProductionItem = {
  id: string;
  planned_qty: number | null;
  actual_qty: number | null;
  sku: { code: string | null; name: string | null } | null;
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftEndsAt(shift: "day" | "night") {
  const now = new Date();
  const end = new Date(now);
  if (shift === "day") {
    end.setHours(18, 0, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
  } else {
    end.setHours(6, 0, 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
  }
  return end;
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function LineDisplayScreen() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const shift = getShift(now);
  const shiftDb = shift.toUpperCase(); // rag_weekly_entries stores DAY/NIGHT
  const date = todayISO();

  const { data: profile } = useQuery({
    queryKey: ["profile-line", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      // 1) Try profiles.production_line (explicit string match with rag_weekly_entries.line)
      const { data: prof } = await supabase
        .from("profiles")
        .select("name, production_line")
        .eq("id", user!.id)
        .maybeSingle();
      if (prof?.production_line) {
        return { name: prof.name, production_line: prof.production_line as string };
      }
      // 2) Fallback: resolve via operator_line_accounts.line_ids[0] -> lines.name
      const { data: ola } = await supabase
        .from("operator_line_accounts")
        .select("line_ids")
        .eq("user_id", user!.id)
        .maybeSingle();
      const firstLineId = (ola?.line_ids ?? [])[0];
      if (!firstLineId) return { name: prof?.name ?? "", production_line: null };
      const { data: ln } = await supabase
        .from("lines")
        .select("name")
        .eq("id", firstLineId)
        .maybeSingle();
      return { name: prof?.name ?? "", production_line: (ln?.name ?? null) as string | null };
    },
  });

  const line = profile?.production_line ?? null;

  const { data: rag } = useQuery({
    queryKey: ["rag-live", date, line, shift],
    enabled: !!line,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rag_weekly_entries")
        .select("*")
        .eq("entry_date", date)
        .eq("line", line!)
        .eq("shift", shift)
        .maybeSingle();
      if (error) throw error;
      return data as RagEntry | null;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["prod-items-live", date, line, shift],
    enabled: !!line,
    queryFn: async () => {
      const { data: sessions, error: e1 } = await supabase
        .from("production_sessions")
        .select("id")
        .eq("session_date", date)
        .eq("line", line!)
        .eq("shift", shift);
      if (e1) throw e1;
      const ids = (sessions ?? []).map((s: any) => s.id);
      if (!ids.length) return [] as ProductionItem[];
      const { data, error } = await supabase
        .from("production_items")
        .select("id, planned_qty, actual_qty, sku:sku_products(code, name)")
        .in("session_id", ids);
      if (error) throw error;
      return (data ?? []) as unknown as ProductionItem[];
    },
  });

  // Realtime subscriptions
  useEffect(() => {
    if (!line) return;
    const ch = supabase
      .channel(`line-display-${line}-${shift}-${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rag_weekly_entries" }, () => {
        qc.invalidateQueries({ queryKey: ["rag-live", date, line, shift] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "production_sessions" }, () => {
        qc.invalidateQueries({ queryKey: ["prod-items-live", date, line, shift] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "production_items" }, () => {
        qc.invalidateQueries({ queryKey: ["prod-items-live", date, line, shift] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [line, shift, date, qc]);

  const target = Number(rag?.plan_qty ?? 0);
  const actual = Number(rag?.actual_qty ?? 0);
  const remaining = Math.max(0, target - actual);
  const pct = target > 0 ? Math.min(100, (actual / target) * 100) : 0;

  const end = useMemo(() => shiftEndsAt(shift), [shift, date]);
  const countdown = formatCountdown(end.getTime() - now.getTime());

  const status = useMemo(() => {
    if (target <= 0) return { label: "NO TARGET", color: "bg-slate-700" };
    if (pct >= 95) return { label: "ON TARGET", color: "bg-green-600" };
    if (pct >= 75) return { label: "AT RISK", color: "bg-amber-500" };
    return { label: "BELOW TARGET", color: "bg-red-600" };
  }, [pct, target]);

  const barColor = pct >= 95 ? "bg-green-500" : pct >= 75 ? "bg-amber-500" : "bg-red-500";

  const goFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

  if (!line) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-4xl font-bold mb-4">No Production Line Assigned</h1>
          <p className="text-xl text-slate-400">
            Ask an admin to set <span className="font-mono">production_line</span> on your profile.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-black tracking-tight">{line}</h1>
          <p className="text-slate-400 text-xl mt-1">{SHIFT_LABEL[shift]}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className={`px-6 py-3 rounded-xl text-2xl font-bold ${status.color}`}>{status.label}</div>
          <div className="text-right">
            <div className="text-4xl font-mono font-bold">
              {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
            <div className="text-sm text-slate-400">
              Updated {rag?.updated_at ? new Date(rag.updated_at).toLocaleTimeString("en-GB") : "—"}
            </div>
          </div>
          <Button size="icon" variant="outline" onClick={goFullscreen} className="h-12 w-12">
            <Maximize2 className="h-6 w-6" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-6">
        <Kpi label="TARGET" value={target.toLocaleString()} accent="text-sky-400" />
        <Kpi label="ACTUAL" value={actual.toLocaleString()} accent="text-green-400" />
        <Kpi label="REMAINING" value={remaining.toLocaleString()} accent="text-amber-400" />
        <Kpi label="SHIFT ENDS IN" value={countdown} accent="text-purple-400" mono />
      </div>

      <div className="bg-slate-900 rounded-2xl p-6">
        <div className="flex justify-between mb-3 text-xl">
          <span className="text-slate-400">Progress</span>
          <span className="font-bold">{pct.toFixed(1)}%</span>
        </div>
        <div className="h-12 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all duration-700`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="bg-slate-900 rounded-2xl p-6 flex-1">
        <h2 className="text-2xl font-bold mb-4">SKUs this shift</h2>
        {!items?.length ? (
          <p className="text-slate-500 text-xl">No SKUs scheduled yet.</p>
        ) : (
          <ul className="space-y-3">
            {items.map((it) => {
              const p = Number(it.planned_qty ?? 0);
              const a = Number(it.actual_qty ?? 0);
              const pc = p > 0 ? Math.min(100, (a / p) * 100) : 0;
              const c = pc >= 95 ? "bg-green-500" : pc >= 75 ? "bg-amber-500" : "bg-red-500";
              return (
                <li key={it.id} className="bg-slate-800 rounded-xl p-4">
                  <div className="flex justify-between text-lg mb-2">
                    <span className="font-semibold">
                      {it.sku?.code ?? "—"} <span className="text-slate-400 font-normal">{it.sku?.name ?? ""}</span>
                    </span>
                    <span className="font-mono">
                      {a.toLocaleString()} / {p.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full ${c}`} style={{ width: `${pc}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, mono }: { label: string; value: string; accent: string; mono?: boolean }) {
  return (
    <div className="bg-slate-900 rounded-2xl p-6 text-center">
      <div className="text-slate-400 text-sm tracking-widest mb-2">{label}</div>
      <div className={`${accent} ${mono ? "font-mono" : ""} text-6xl font-black tabular-nums`}>{value}</div>
    </div>
  );
}
