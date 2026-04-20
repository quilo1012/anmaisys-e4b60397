import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, Lock, UserCheck, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EngineerIdentity {
  id: string;
  name: string;
}

interface PinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (engineer: EngineerIdentity) => void | Promise<void>;
  title?: string;
  description?: string;
}

const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

export function PinDialog({ open, onOpenChange, onSuccess, title = "Enter PIN", description = "Enter your engineer PIN to confirm this action." }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<EngineerIdentity | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockoutLeft, setLockoutLeft] = useState(0);
  const lockoutTimerRef = useRef<number | null>(null);

  // Countdown for lockout
  useEffect(() => {
    if (lockoutLeft <= 0) return;
    lockoutTimerRef.current = window.setTimeout(() => setLockoutLeft((s) => s - 1), 1000);
    return () => {
      if (lockoutTimerRef.current) clearTimeout(lockoutTimerRef.current);
    };
  }, [lockoutLeft]);

  // When lockout ends, reset attempts
  useEffect(() => {
    if (lockoutLeft === 0 && attempts >= MAX_ATTEMPTS) {
      setAttempts(0);
      setError("");
    }
  }, [lockoutLeft, attempts]);

  const isLocked = lockoutLeft > 0;

  const handleVerify = async () => {
    if (isLocked) return;
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error } = await supabase.rpc("verify_pin_by_code", { _pin: pin });
      if (error) throw error;

      const match = Array.isArray(data) ? data[0] : null;
      if (match?.engineer_id) {
        // Reset attempts on success and proceed to confirm step
        setAttempts(0);
        setConfirming({ id: match.engineer_id, name: match.engineer_name });
      } else {
        // Wrong PIN
        const next = attempts + 1;
        setAttempts(next);
        setPin("");
        if (next >= MAX_ATTEMPTS) {
          setLockoutLeft(LOCKOUT_SECONDS);
          setError(`❌ Too many attempts. Please wait ${LOCKOUT_SECONDS} seconds.`);
        } else {
          setError(`❌ Incorrect PIN. Please try again. (${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next === 1 ? "" : "s"} left)`);
        }
      }
    } catch (err: any) {
      setError(`❌ ${err.message || "Verification failed. Contact your administrator."}`);
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirming) return;
    const engineer = confirming;
    setLoading(true);
    try {
      await onSuccess(engineer);
      toast.success("✅ PIN verified");
    } finally {
      setLoading(false);
      resetState();
      onOpenChange(false);
    }
  };

  const resetState = () => {
    setPin("");
    setError("");
    setConfirming(null);
    setAttempts(0);
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
            {confirming ? <UserCheck className="h-5 w-5 text-green-500" /> : <Lock className="h-5 w-5" />}
            {confirming ? "Confirm Identity" : title}
          </DialogTitle>
          <DialogDescription>
            {confirming ? "Verify this is the correct engineer." : description}
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Confirming as:</p>
              <p className="text-2xl font-bold text-primary">{confirming.name}</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4">
            <InputOTP maxLength={4} value={pin} onChange={setPin} disabled={isLocked || loading}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
            {error && (
              <div className="flex items-start gap-2 w-full rounded-md border border-destructive bg-destructive/10 p-3">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive font-medium">{error}</p>
              </div>
            )}
            {isLocked && (
              <p className="text-xs text-muted-foreground">Try again in {lockoutLeft}s</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          {confirming ? (
            <Button onClick={handleConfirm} className="bg-green-600 hover:bg-green-700">
              <UserCheck className="h-4 w-4 mr-2" /> Confirm
            </Button>
          ) : (
            <Button onClick={handleVerify} disabled={loading || pin.length < 4 || isLocked}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isLocked ? `Wait ${lockoutLeft}s` : "Verify"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
