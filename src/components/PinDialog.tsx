import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, Lock, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

export function PinDialog({ open, onOpenChange, onSuccess, title = "Enter PIN", description = "Enter your engineer PIN to confirm this action." }: PinDialogProps) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<EngineerIdentity | null>(null);
  const { toast } = useToast();

  const handleVerify = async () => {
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await supabase.functions.invoke("verify-engineer-pin", { body: { pin } });
      if (res.error) throw new Error(res.error.message);
      if (res.data?.error) {
        setError(res.data.error);
        return;
      }
      if (res.data?.valid && res.data?.engineer_id) {
        // Show confirmation step
        setConfirming({ id: res.data.engineer_id, name: res.data.engineer_name });
      } else {
        setError("Incorrect PIN");
      }
    } catch (err: any) {
      setError(err.message || "Verification failed");
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
            <InputOTP maxLength={4} value={pin} onChange={setPin}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
            {error && <p className="text-sm text-destructive font-medium">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          {confirming ? (
            <Button onClick={handleConfirm} className="bg-green-600 hover:bg-green-700">
              <UserCheck className="h-4 w-4 mr-2" /> Confirm
            </Button>
          ) : (
            <Button onClick={handleVerify} disabled={loading || pin.length < 4}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Verify
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
