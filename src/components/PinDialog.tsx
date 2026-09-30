import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, Lock, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EngineerIdentity {
  id: string;
  name: string;
  is_leader?: boolean;
  leader_line?: string | null;
  leader_lines?: string[];
}


interface PinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (engineer: EngineerIdentity) => void | Promise<void>;
  title?: string;
  description?: string;
}

// Cosmetic-only ceiling for the local countdown when the server hasn't sent a
// `locked_until` (e.g. transient errors). The server is the authority.
const FALLBACK_LOCKOUT_SECONDS = 30;

export function PinDialog({ open, onOpenChange, onSuccess, title = "Enter PIN", description = "Enter your engineer PIN to confirm this action." }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const lockoutTimerRef = useRef<number | null>(null);

  // Countdown for lockout (cosmetic — server enforces the real lock)
  useEffect(() => {
    if (lockoutLeft <= 0) return;
    lockoutTimerRef.current = window.setTimeout(() => setLockoutLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
    };
  }, [lockoutLeft]);

  const isLocked = lockoutLeft > 0;

  const handleVerify = async () => {
    if (isLocked) return;
    if (pin.length < 4) {
      setError("PIN must be 4 digits");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error } = await supabase.rpc("verify_pin_with_lockout", { _pin: pin });
      if (error) throw error;


      // Legacy shape: array of { engineer_id, engineer_name }
      // New shape:    { success, engineer_id?, engineer_name?, error?, locked_seconds?, remaining? }
      const arrMatch = Array.isArray(data) ? (data[0] as any) : null;
      const obj = !Array.isArray(data) ? (data as any) : null;

      const engineerId = arrMatch?.engineer_id ?? (obj?.success ? obj.engineer_id : null);
      const engineerName = arrMatch?.engineer_name ?? obj?.engineer_name;

      if (engineerId) {
        setRemaining(null);
        const rawLines = obj?.leader_lines ?? arrMatch?.leader_lines;
        const linesArr: string[] = Array.isArray(rawLines)
          ? rawLines.filter((x: any) => typeof x === "string" && x.trim() !== "")
          : [];
        const engineer: EngineerIdentity = {
          id: engineerId as string,
          name: engineerName as string,
          is_leader: !!(obj?.is_leader ?? arrMatch?.is_leader),
          // Never invent a "home line" from the first allowed line — leaders rotate,
          // and doing so wrongly reported every leader as belonging to Line 1.
          leader_line: (obj?.leader_line ?? arrMatch?.leader_line ?? null) as string | null,
          leader_lines: linesArr,
        };

        // The PIN was right; whether the ACTION behind it worked is a separate
        // question. This used to close the dialog from a `finally`, so a failed
        // action closed the dialog anyway, skipped the success toast, and left
        // the rejected promise unhandled — the engineer saw the dialog close and
        // assumed it had gone through. Now a failure keeps the dialog open and
        // says so in the error box this component already renders.
        try {
          await onSuccess(engineer);
        } catch (actionErr) {
          const msg = (actionErr as { message?: string } | null)?.message;
          setError(`❌ ${msg || "The PIN was accepted but the action did not complete. Try again."}`);
          return;
        }
        toast.success(`✅ ${engineer.name} verified`);
        resetState();
        onOpenChange(false);
      } else {
        setPin("");
        const lockedSeconds = Number(obj?.locked_seconds ?? 0);
        const left = Number.isFinite(obj?.remaining) ? Number(obj.remaining) : null;
        setRemaining(left);
        if (lockedSeconds > 0) {
          setLockoutLeft(lockedSeconds);
          setError(`❌ Too many attempts. Wait ${lockedSeconds}s before trying again.`);
        } else if (left !== null) {
          setError(`❌ Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left before lockout.`);
        } else {
          setError("❌ Incorrect PIN. Please try again.");
        }
      }
    } catch (err: any) {
      // Reaching here means the request itself failed, not that the PIN was
      // wrong — so the digits stay where they are. Clearing them made a dropped
      // connection look like a rejected PIN and forced a re-type on a tablet.
      // AdminPinGate already distinguishes the two; this now matches it.
      setError(`❌ ${err.message || "Could not reach the server. The PIN itself is fine — try again."}`);
      // Defensive cosmetic lockout if server didn't respond cleanly.
      if (!isLocked) setLockoutLeft(FALLBACK_LOCKOUT_SECONDS);
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setPin("");
    setError("");
    setRemaining(null);
    setLockoutLeft(0);
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) resetState();
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <InputOTP maxLength={4} value={pin} onChange={setPin} disabled={isLocked || loading} autoFocus>
            <InputOTPGroup>
              <InputOTPSlot index={0} mask />
              <InputOTPSlot index={1} mask />
              <InputOTPSlot index={2} mask />
              <InputOTPSlot index={3} mask />
            </InputOTPGroup>
          </InputOTP>
          {error && (
            <div className="flex items-start gap-2 w-full rounded-md border border-destructive bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 text-destructive-strong shrink-0 mt-0.5" />
              <p className="text-sm text-destructive-strong font-medium">{error}</p>
            </div>
          )}
          {isLocked && (
            <p className="text-xs text-muted-foreground">Try again in {lockoutLeft}s</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={handleVerify} disabled={loading || pin.length < 4 || isLocked}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isLocked ? `Wait ${lockoutLeft}s` : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
