import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  useSuppliers,
  useSupplierMutations,
  usePurchaseOrders,
  usePurchaseOrderMutations,
  type PurchaseOrder,
} from "@/hooks/useSuppliers";
import { useProducts } from "@/hooks/useStock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Plus, Trash2, PackagePlus, Send, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

type DraftItem = {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
};

const STATUS_BADGE: Record<PurchaseOrder["status"], { label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  sent: { label: "Sent", variant: "secondary" },
  received: { label: "Received", variant: "default" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export default function SuppliersPage() {
  const suppliersQ = useSuppliers();
  const supplierM = useSupplierMutations();
  const posQ = usePurchaseOrders();
  const poM = usePurchaseOrderMutations();
  const productsQ = useProducts();

  const lowStock = useMemo(
    () => (productsQ.data ?? []).filter((p) => p.quantity <= (p.min_stock ?? 0)),
    [productsQ.data],
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Truck className="h-6 w-6" /> Suppliers & Purchasing
          </h2>
          <p className="text-muted-foreground">Manage vendors and purchase orders.</p>
        </div>

        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <NewPoDialog
                suppliers={suppliersQ.data ?? []}
                products={productsQ.data ?? []}
                onCreate={(payload) =>
                  poM.create.mutateAsync(payload).then(() => toast.success("Purchase order created"))
                }
              />
              <Button
                variant="outline"
                disabled={!lowStock.length}
                onClick={async () => {
                  await poM.create.mutateAsync({
                    supplier_id: null,
                    notes: "Auto: low stock replenishment",
                    items: lowStock.map((p) => ({
                      product_id: p.id,
                      product_name: p.name,
                      quantity: Math.max(1, (p.min_stock ?? 0) * 2 - p.quantity),
                      unit_price: p.price ?? 0,
                    })),
                  });
                  toast.success(`Draft PO created with ${lowStock.length} item(s)`);
                }}
              >
                <PackagePlus className="h-4 w-4 mr-2" />
                Create PO for low stock ({lowStock.length})
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Recent Purchase Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(posQ.data ?? []).map((po) => {
                      const total = (po.items ?? []).reduce((s, i) => s + i.quantity * Number(i.unit_price ?? 0), 0);
                      const badge = STATUS_BADGE[po.status];
                      return (
                        <TableRow key={po.id}>
                          <TableCell className="text-xs">{new Date(po.created_at).toLocaleDateString()}</TableCell>
                          <TableCell>{po.supplier?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>{po.items?.length ?? 0}</TableCell>
                          <TableCell>€{total.toFixed(2)}</TableCell>
                          <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                          <TableCell className="text-right space-x-1">
                            {po.status === "draft" && (
                              <Button size="sm" variant="outline" onClick={() => poM.setStatus.mutate({ id: po.id, status: "sent" })}>
                                <Send className="h-3 w-3 mr-1" /> Send
                              </Button>
                            )}
                            {po.status === "sent" && (
                              <Button size="sm" onClick={() => poM.setStatus.mutate({ id: po.id, status: "received" })}>
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Receive
                              </Button>
                            )}
                            {po.status !== "received" && po.status !== "cancelled" && (
                              <Button size="sm" variant="ghost" onClick={() => poM.setStatus.mutate({ id: po.id, status: "cancelled" })}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm("Delete this purchase order?")) poM.remove.mutate(po.id);
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!posQ.data?.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          No purchase orders yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="suppliers" className="space-y-4">
            <SupplierForm onSubmit={async (s) => { await supplierM.create.mutateAsync(s); toast.success("Supplier added"); }} />
            <Card>
              <CardHeader>
                <CardTitle>Suppliers</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(suppliersQ.data ?? []).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{s.contact_name ?? "—"}</TableCell>
                        <TableCell>{s.email ?? "—"}</TableCell>
                        <TableCell>{s.phone ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Delete ${s.name}?`)) supplierM.remove.mutate(s.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!suppliersQ.data?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          No suppliers yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function SupplierForm({ onSubmit }: { onSubmit: (s: { name: string; contact_name?: string; email?: string; phone?: string }) => Promise<void> }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  return (
    <Card>
      <CardHeader><CardTitle>Add Supplier</CardTitle></CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-4">
          <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Contact</Label><Input value={contact} onChange={(e) => setContact(e.target.value)} /></div>
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        </div>
        <Button
          className="mt-3"
          disabled={!name.trim()}
          onClick={async () => {
            await onSubmit({ name: name.trim(), contact_name: contact || undefined, email: email || undefined, phone: phone || undefined });
            setName(""); setContact(""); setEmail(""); setPhone("");
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Add
        </Button>
      </CardContent>
    </Card>
  );
}

function NewPoDialog({
  suppliers,
  products,
  onCreate,
}: {
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; price: number }[];
  onCreate: (payload: { supplier_id: string | null; notes: string | null; items: DraftItem[] }) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  const addRow = () => setItems((r) => [...r, { product_id: null, product_name: "", quantity: 1, unit_price: 0 }]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-2" /> New Purchase Order</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>New Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Supplier</Label>
              <Select value={supplierId || "none"} onValueChange={(v) => setSupplierId(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No supplier</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-28">Unit €</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Select
                        value={it.product_id ?? "custom"}
                        onValueChange={(v) => {
                          const next = [...items];
                          if (v === "custom") {
                            next[idx] = { ...next[idx], product_id: null };
                          } else {
                            const p = products.find((x) => x.id === v);
                            next[idx] = { ...next[idx], product_id: v, product_name: p?.name ?? "", unit_price: p?.price ?? 0 };
                          }
                          setItems(next);
                        }}
                      >
                        <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom item…</SelectItem>
                          {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {!it.product_id && (
                        <Input
                          className="mt-2"
                          placeholder="Item description"
                          value={it.product_name}
                          onChange={(e) => {
                            const next = [...items];
                            next[idx].product_name = e.target.value;
                            setItems(next);
                          }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        value={it.quantity}
                        onChange={(e) => {
                          const next = [...items];
                          next[idx].quantity = Math.max(1, Number(e.target.value) || 1);
                          setItems(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        value={it.unit_price}
                        onChange={(e) => {
                          const next = [...items];
                          next[idx].unit_price = Number(e.target.value) || 0;
                          setItems(next);
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="p-2">
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="h-3 w-3 mr-1" /> Add item
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!items.length || items.some((i) => !i.product_name.trim())}
            onClick={async () => {
              await onCreate({
                supplier_id: supplierId || null,
                notes: notes || null,
                items,
              });
              setOpen(false);
              setSupplierId(""); setNotes(""); setItems([]);
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
