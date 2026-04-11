import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProducts, useRegisterPartsUsed } from "@/hooks/useStock";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PartsUsedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  engineerName?: string;
}

export function PartsUsedDialog({ open, onOpenChange, workOrderId, engineerName }: PartsUsedDialogProps) {
  const { data: products, isLoading } = useProducts();
  const registerParts = useRegisterPartsUsed();
  const { toast } = useToast();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId || !quantity || parseInt(quantity) <= 0) return;

    const product = products?.find((p) => p.id === productId);
    if (product && parseInt(quantity) > product.quantity) {
      toast({ title: "Insufficient stock", description: `Only ${product.quantity} available.`, variant: "destructive" });
      return;
    }

    try {
      await registerParts.mutateAsync({ work_order_id: workOrderId, product_id: productId, quantity: parseInt(quantity), engineer_name: engineerName });
      toast({ title: "Parts registered", description: "Stock updated automatically." });
      setProductId("");
      setQuantity("");
      onOpenChange(false);
    } catch {
      toast({ title: "Error", description: "Failed to register parts.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Register Parts Used</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div className="space-y-2">
              <Label htmlFor="product">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.code}) — Line: {p.line || "N/A"} — Stock: {p.quantity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="qty">Quantity</Label>
              <Input id="qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Enter quantity" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={registerParts.isPending || !productId || !quantity}>
                {registerParts.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Register
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
