import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, Lock, ShieldCheck } from "lucide-react";

/**
 * A second door in front of payroll data.
 *
 * Attendance and Finance Close are already admin-only, so this is not about who may
 * open them — it is about the laptop left unlocked in the office. Both screens name
 * every employee alongside their hours, their sickness and what they are owed, and a
 * role check does not help once somebody is already signed in.
 *
 * The unlock lasts for the browser session and no longer. Closing the tab locks it
 * again, which is the behaviour somebody expects of a door rather than of a setting.
 * `sessionStorage`, not `localStorage`, is the whole of that difference.
 *
 * The PIN is checked by the `verify-admin-pin` edge function — the same one Clear WOs
 * uses. Nothing here decides whether the PIN is right; it only asks.
 */
export function AdminPinGate({
  storageKey, title, description, children,
}: {
  /** Distinct per screen, so unlocking one does not silently unlock the other. */
  storageKey: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const key = `pin-ok:${storageKey}`;
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try { setUnlocked(sessionStorage.getItem(key) === "1"); } catch { /* storage blocked */ }
  }, [key]);

  const submit = useCallback(async () => {
    if (pin.length < 4) return;
    setBusy(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-admin-pin`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ pin }),
      });
      const body = await res.json();
      if (!res.ok || !body?.valid) {
        setError("That PIN is not right.");
        setPin("");
        return;
      }
      try { sessionStorage.setItem(key, "1"); } catch { /* storage blocked; unlock still holds for this render */ }
      setUnlocked(true);
    } catch (e) {
      setError((e as Error).message || "Could not check the PIN.");
    } finally {
      setBusy(false);
    }
  }, [pin, key]);

  if (unlocked) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-4 p-6 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>

          <div className="flex justify-center">
            <InputOTP
              maxLength={6}
              value={pin}
              onChange={(v) => { setPin(v); setError(""); }}
              onComplete={submit}
              disabled={busy}
            >
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
          </div>

          {error && <p className="text-xs font-medium text-destructive-strong">{error}</p>}

          <Button className="w-full" onClick={submit} disabled={busy || pin.length < 4}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Unlock
          </Button>

          <p className="text-2xs text-muted-foreground">
            Stays unlocked until you close this tab.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
