import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Lock, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type ShiftCode = "DAY" | "NIGHT";

const KEY = (c: ShiftCode) => `an_shift_unlock_${c}`;
const isUnlocked = (c: ShiftCode) => {
  try { return sessionStorage.getItem(KEY(c)) === "1"; } catch { return false; }
};

const label = (c: ShiftCode) => (c === "DAY" ? "Day" : "Night");

/**
 * Gates production data behind the per-shift password. `shifts` are the shift
 * codes currently in view; children render only once every shift that HAS a
 * password is unlocked for this browser session. Shifts with no password
 * configured are treated as open, so nobody is locked out before an admin sets
 * one. Unlock is remembered per shift for the session (sessionStorage).
 */
export function ShiftLock({ shifts, children }: { shifts: ShiftCode[]; children: ReactNode }) {
  const uniq = Array.from(new Set(shifts));
  const [tick, setTick] = useState(0); // bump to re-read sessionStorage after an unlock
  const [pw, setPw] = useState("");
  const [checking, setChecking] = useState(false);

  const { data: setMap, isLoading } = useQuery({
    queryKey: ["shift-pw-set", uniq.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        uniq.map(async (c) => {
          const { data } = await (supabase as unknown as {
            rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null }>;
          }).rpc("shift_password_is_set", { _shift_code: c });
          return [c, Boolean(data)] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<ShiftCode, boolean>;
    },
    staleTime: 60_000,
  });

  if (isLoading || !setMap) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  // A shift is "locked" when it has a password and hasn't been unlocked yet.
  void tick;
  const locked = uniq.filter((c) => setMap[c] && !isUnlocked(c));
  if (locked.length === 0) return <>{children}</>;

  const target = locked[0];
  const submit = async () => {
    if (!pw) return;
    setChecking(true);
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: boolean | null; error: { message: string } | null }>;
    }).rpc("verify_shift_password", { _shift_code: target, _password: pw });
    setChecking(false);
    if (error) { toast.error(error.message); return; }
    if (data === true) {
      try { sessionStorage.setItem(KEY(target), "1"); } catch { /* ignore */ }
      setPw("");
      setTick((t) => t + 1);
    } else {
      toast.error(`Wrong ${label(target).toLowerCase()} shift password`);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center">
      <div className="rounded-full bg-muted p-3"><Lock className="h-7 w-7 text-muted-foreground" /></div>
      <div className="text-lg font-bold">{label(target)} shift is locked</div>
      <p className="max-w-sm text-sm text-muted-foreground">
        Enter the {label(target).toLowerCase()} shift password to view its production.
        {locked.length > 1 && " You'll be asked for the other shift next."}
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          placeholder={`${label(target)} password`}
          className="h-11 w-56"
          autoFocus
        />
        <Button onClick={() => void submit()} disabled={checking || !pw} className="h-11">
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
        </Button>
      </div>
    </div>
  );
}
