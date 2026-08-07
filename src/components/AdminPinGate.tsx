import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { shouldRelock } from "@/lib/adminPinGate";

/**
 * A second door in front of payroll data.
 *
 * Attendance and Finance Close are already admin-only, so this is not about who may
 * open them — it is about the laptop left unlocked in the office. Both screens name
 * every employee alongside their hours, their sickness and what they are owed, and a
 * role check does not help once somebody is already signed in.
 *
 * The unlock lasts as long as you stay in the section and no longer. Walk out to Work
 * Orders and it locks behind you; come back and it asks again. It used to last until
 * the tab was closed, which in practice meant all day — somebody unlocked the board in
 * the morning and walked back in at four without being asked, which is not a lock
 * guarding an unattended laptop.
 *
 * Moving between the section's own tabs does not re-ask. A PIN typed four times an
 * hour stops being a lock and becomes a habit somebody works around.
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
  // Read on the first render, not in an effect. Reading it afterwards meant every
  // navigation inside an already-unlocked section painted the keypad for a frame
  // before replacing it — the section flashed locked on every tab change, which
  // teaches somebody to start typing before looking.
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(key) === "1"; } catch { return false; }
  });
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Still watched, because the key can change between screens and another tab can
  // unlock the section while this one is open.
  useEffect(() => {
    try { setUnlocked(sessionStorage.getItem(key) === "1"); } catch { /* storage blocked */ }
  }, [key]);

  // Lock behind you on the way out.
  //
  // Read at cleanup rather than at render: React Router has already committed the new
  // location by the time this runs, so `pathname` is where the user went and not where
  // they were. That is what makes it possible to tell a tab change inside the section
  // from actually leaving it.
  useEffect(() => () => {
    try {
      if (shouldRelock(storageKey, window.location.pathname)) sessionStorage.removeItem(key);
    } catch { /* storage blocked */ }
  }, [key, storageKey]);

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
      // Every failure used to read "That PIN is not right", including the ones that
      // are nothing to do with the PIN. Somebody whose session had expired, or who is
      // not an admin, or hitting a function that is not deployed, was told to try
      // another number — and no number would ever have worked. That is the difference
      // between a door that is locked and a door that is missing.
      const body = await res.json().catch(() => null as any);
      if (!res.ok || !body?.valid) {
        console.error("[AdminPinGate] verify failed", res.status, body);
        setError(
          res.status === 401 ? "Your session has expired — sign in again."
          : res.status === 403 ? "This screen is admin-only, and this account is not an admin. The PIN will not open it."
          : res.status === 404 ? "The PIN check is not reachable. Nothing you type will work until it is deployed."
          : res.status >= 500 ? "The PIN check failed on the server. Try again in a moment."
          : "That PIN is not right.",
        );
        setPin("");
        return;
      }
      try { sessionStorage.setItem(key, "1"); } catch { /* storage blocked; unlock still holds for this render */ }
      setUnlocked(true);
    } catch (e) {
      // A network failure is not a wrong PIN either — the tablet's wi-fi drops.
      console.error("[AdminPinGate] verify threw", e);
      setError("Could not reach the PIN check — no connection. The PIN itself is fine.");
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
            Locks again as soon as you leave this section.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
