import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Loader2, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EngineerChangePinDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setPin("");
    setConfirm("");
  };

  const handleSave = async () => {
    if (!user) {
      toast.error("Not signed in");
      return;
    }
    if (pin.length < 4) {
      toast.error("PIN must be 4 digits");
      return;
    }

    if (pin !== confirm) {
      toast.error("PINs do not match");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_engineer_pin", { _new_pin: pin, _user_id: user.id });
      if (error) throw error;
      toast.success("✅ PIN updated successfully");
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to update PIN");
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Change Your PIN
          </DialogTitle>
          <DialogDescription>
            Set a new 4-digit PIN. You'll use this to confirm work order actions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">New PIN</p>
            <InputOTP maxLength={4} value={pin} onChange={setPin}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Confirm PIN</p>
            <InputOTP maxLength={4} value={confirm} onChange={setConfirm}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
              </InputOTPGroup>
            </InputOTP>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || pin.length < 4 || confirm.length < 4}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
