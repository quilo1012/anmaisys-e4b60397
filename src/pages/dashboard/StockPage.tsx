import { useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Package, Plus, Loader2, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useProducts, useAddProduct, useUpdateProductStock, useUpdateProduct, useDeleteProduct, type Product } from "@/hooks/useStock";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export default function StockPage() {
  const { role } = useAuth();
  const { data: products, isLoading } = useProducts();
  const addProduct = useAddProduct();
  const updateStock = useUpdateProductStock();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const { toast } = useToast();
  const isManager = role === "admin";

  // Edit/Delete state
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editMinStock, setEditMinStock] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [minStock, setMinStock] = useState("");
  const [category, setCategory] = useState("spare");

  const [adjustId, setAdjustId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addProduct.mutateAsync({ name, code, quantity: parseInt(qty) || 0, min_stock: parseInt(minStock) || 0, category });
      toast({ title: "Product added" });
      setName(""); setCode(""); setQty(""); setMinStock(""); setCategory("spare");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    const product = products?.find((p) => p.id === adjustId);
    if (!product) return;
    const newQty = product.quantity + parseInt(adjustQty);
    if (newQty < 0) {
      toast({ title: "Error", description: "Stock cannot go below 0.", variant: "destructive" });
      return;
    }
    try {
      await updateStock.mutateAsync({ id: adjustId, quantity: newQty });
      toast({ title: "Stock updated" });
      setAdjustId(""); setAdjustQty("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setEditName(p.name);
    setEditCode(p.code);
    setEditQty(String(p.quantity));
    setEditMinStock(String(p.min_stock));
    setEditCategory(p.category);
  };

  const handleEdit = async () => {
    if (!editProduct) return;
    try {
      await updateProduct.mutateAsync({ id: editProduct.id, name: editName, code: editCode, quantity: parseInt(editQty) || 0, min_stock: parseInt(editMinStock) || 0, category: editCategory });
      toast({ title: "Product updated" });
      setEditProduct(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteProduct.mutateAsync(deleteId);
      toast({ title: "Product deleted" });
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Stock Management</h2>
          <p className="text-muted-foreground">View and manage inventory</p>
        </div>

        {lowStockCount > 0 && (
          <Card className="border-destructive">
            <CardContent className="pt-6 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-destructive font-medium">{lowStockCount} product(s) at or below minimum stock level</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Products</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !products?.length ? (
              <p className="text-muted-foreground text-center py-8">No products in stock yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Min Stock</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((p) => {
                    const isLow = p.quantity <= p.min_stock;
                    return (
                      <TableRow key={p.id} className={isLow ? "bg-destructive/10" : ""}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell>{p.code}</TableCell>
                        <TableCell><Badge variant="outline" className="capitalize">{p.category}</Badge></TableCell>
                        <TableCell className={isLow ? "text-destructive font-bold" : ""}>{p.quantity}</TableCell>
                        <TableCell>{p.min_stock}</TableCell>
                        <TableCell>
                          {isLow ? (
                            <Badge variant="destructive">Low</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {isManager && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add Product</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleAdd} className="space-y-3">
                  <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
                  <div className="space-y-1"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} required /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>Initial Qty</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Min Stock</Label><Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BFM">BFM</SelectItem>
                        <SelectItem value="spare">Spare</SelectItem>
                        <SelectItem value="consumable">Consumable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full" disabled={addProduct.isPending}>
                    {addProduct.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add Product
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Manual Stock Adjustment</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={handleAdjust} className="space-y-3">
                  <div className="space-y-1">
                    <Label>Product</Label>
                    <Select value={adjustId} onValueChange={setAdjustId}>
                      <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>
                        {products?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} ({p.code}) — Current: {p.quantity}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Adjustment (+/-)</Label>
                    <Input type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} placeholder="e.g. +10 or -5" required />
                  </div>
                  <Button type="submit" className="w-full" disabled={updateStock.isPending || !adjustId}>
                    {updateStock.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Apply Adjustment
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
