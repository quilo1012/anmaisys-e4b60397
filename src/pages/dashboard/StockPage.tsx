import { PageHeader } from "@/components/ui/PageHeader";
import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Package, Plus, Loader2, AlertTriangle, Pencil, Trash2, Tags, Search, FileText, FileSpreadsheet, ImageOff } from "lucide-react";
import { useProducts, useAddProduct, useUpdateProductStock, useUpdateProduct, useDeleteProduct, type Product } from "@/hooks/useStock";
import { useCategories, useAddCategory, useDeleteCategory } from "@/hooks/useCategories";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent, useStockAdjustmentHistory } from "@/hooks/useAuditLogs";
import { useQueryClient } from "@tanstack/react-query";
import { ConsoleStrip, ConsoleCell } from "@/components/ui/ConsoleStrip";
import { stockTotals, filterStock, isLowStock } from "@/lib/stockList";
import { exportStockPDF, exportStockExcel } from "@/lib/stockExports";
import { format } from "date-fns";
import { History } from "lucide-react";

export default function StockPage() {
  const { role, profile } = useAuth();
  const { can } = useRole();
  const { data: products, isLoading } = useProducts();
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const addProduct = useAddProduct();
  const updateStock = useUpdateProductStock();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const addCategory = useAddCategory();
  const deleteCategory = useDeleteCategory();
  const { toast } = useToast();
  // Reads the permission matrix, not a list of roles written here.
  //
  // This screen used to hardcode admin/manager/maintenance_manager/supervisor, which
  // meant two things: production_office_admin held stock.manage in the matrix and got
  // nothing here, and an admin toggling stock.manage in Permissions changed nothing on
  // this page. A rule stated in two places is a rule that disagrees with itself.
  const isManager = can("stock.manage");
  // Seeing and setting a part's value is its own right — "See and edit part unit
  // prices and financial values" — and the matrix has said admin-only all along. It
  // governed nothing until 20260831090000; adjusting a quantity after a part is used
  // is the job most of these roles are here to do, valuing the part is not.
  const canPrice = can("stock.pricing");
  // Deleting a product is admin-only in RLS — don't offer it to the others.
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const { data: adjustmentHistory } = useStockAdjustmentHistory(10);

  // Edit/Delete state
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editLine, setEditLine] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editQty, setEditQty] = useState("");
  const [editMinStock, setEditMinStock] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editMachine, setEditMachine] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [productLine, setProductLine] = useState("");
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [minStock, setMinStock] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [machine, setMachine] = useState("");
  const [location, setLocation] = useState("");

  const [adjustId, setAdjustId] = useState("");
  const [adjustQty, setAdjustQty] = useState("");

  // Category management
  const [newCategoryName, setNewCategoryName] = useState("");

  // Finding one part among a hundred and thirty-seven.
  //
  // The screen was written for the two demo products it had. A warehouse list is not
  // read top to bottom — somebody arrives holding a broken bearing, or a reorder
  // report, and needs the row for it.
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("__all__");
  const [lowOnly, setLowOnly] = useState(false);

  /** A blank box means "nobody said", which is NULL — not an empty string that the
   *  search would happily match and the exports would print as a gap. */
  const orNull = (v: string) => (v.trim() ? v.trim() : null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(price);
    if (canPrice && (!Number.isFinite(priceNum) || priceNum <= 0)) {
      toast({ title: "Price is required", description: "Enter a unit price greater than £0.00.", variant: "destructive" });
      return;
    }
    try {
      const result = await addProduct.mutateAsync({ name, line: productLine, code, quantity: parseInt(qty) || 0, min_stock: parseInt(minStock) || 0, category: category || "spare", price: canPrice ? priceNum : undefined, description: orNull(description), machine: orNull(machine), location: orNull(location) });
      toast({ title: "Product added" });
      logAuditEvent("create", "product", (result as any)?.id, { name, code });
      setName(""); setProductLine(""); setCode(""); setQty(""); setMinStock(""); setCategory(""); setPrice(""); setDescription(""); setMachine(""); setLocation("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    const product = products?.find((p) => p.id === adjustId);
    if (!product) return;
    const delta = parseInt(adjustQty, 10);
    if (!Number.isFinite(delta)) {
      toast({ title: "Error", description: "Enter a valid quantity.", variant: "destructive" });
      return;
    }
    const newQty = product.quantity + delta;
    if (newQty < 0) {
      toast({ title: "Error", description: "Stock cannot go below 0.", variant: "destructive" });
      return;
    }
    try {
      await updateStock.mutateAsync({ id: adjustId, quantity: newQty });
      toast({ title: "Stock updated" });
      await logAuditEvent("adjust_stock", "product", adjustId, { adjustment: delta, new_quantity: newQty });
      queryClient.invalidateQueries({ queryKey: ["stock_adjustment_history"] });
      setAdjustId(""); setAdjustQty("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    setEditName(p.name);
    setEditLine(p.line || "");
    setEditCode(p.code);
    setEditQty(String(p.quantity));
    setEditMinStock(String(p.min_stock));
    setEditCategory(p.category);
    setEditPrice(String(p.price || 0));
    setEditDescription(p.description ?? "");
    setEditMachine(p.machine ?? "");
    setEditLocation(p.location ?? "");
  };

  const handleEdit = async () => {
    if (!editProduct) return;
    const priceNum = parseFloat(editPrice);
    if (canPrice && (!Number.isFinite(priceNum) || priceNum <= 0)) {
      toast({ title: "Price is required", description: "Enter a unit price greater than £0.00.", variant: "destructive" });
      return;
    }
    try {
      await updateProduct.mutateAsync({ id: editProduct.id, name: editName, line: editLine, code: editCode, quantity: parseInt(editQty) || 0, min_stock: parseInt(editMinStock) || 0, category: editCategory, price: canPrice ? priceNum : undefined, description: orNull(editDescription), machine: orNull(editMachine), location: orNull(editLocation) });
      toast({ title: "Product updated" });
      logAuditEvent("update", "product", editProduct.id, { name: editName });
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
      logAuditEvent("delete", "product", deleteId);
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      await addCategory.mutateAsync(newCategoryName.trim());
      toast({ title: "Category added" });
      logAuditEvent("create", "product_category", undefined, { name: newCategoryName.trim() });
      setNewCategoryName("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // One rule for what "low" means, in `stockList`, read by the counter, the banner
  // and every row badge alike — see `isLowStock`.
  const rows = useMemo<Product[]>(() => products ?? [], [products]);
  const totals = useMemo(() => stockTotals(rows), [rows]);
  const visible = useMemo(
    () => filterStock(rows, { query: search, category: catFilter, lowOnly }),
    [rows, search, catFilter, lowOnly],
  );
  const lowStockCount = totals.low;

  const categoryOptions = useMemo(() => categories ?? [], [categories]);
  // Every category actually on a part, not only the ones somebody declared: an import
  // brings categories with it, and a filter that cannot name them hides the rows.
  const filterCategories = useMemo(
    () => Array.from(new Set([...categoryOptions.map((c) => c.name), ...rows.map((r) => r.category)].filter(Boolean))).sort(),
    [categoryOptions, rows],
  );

  const runExport = async (kind: "pdf" | "excel", low: boolean) => {
    try {
      if (kind === "pdf") await exportStockPDF(rows, { lowOnly: low, generatedBy: profile?.name || undefined });
      else exportStockExcel(rows, { lowOnly: low });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title="Stock"
          description="View and manage inventory"
          icon={<Package className="h-5 w-5" />}
        />

        {/* The four figures of a warehouse, read together rather than as four cards. */}
        <ConsoleStrip>
          <ConsoleCell label="Parts" value={totals.parts} />
          <ConsoleCell label="In stock" value={totals.inStock.toLocaleString("en-GB")} />
          <ConsoleCell label="Low stock" value={totals.low} tone={totals.low > 0 ? "text-warning-strong" : undefined} />
          <ConsoleCell label="Out of stock" value={totals.out} tone={totals.out > 0 ? "text-destructive-strong" : undefined} />
        </ConsoleStrip>

        {lowStockCount > 0 && (
          <Card className="border-destructive">
            <CardContent className="pt-6 flex flex-wrap items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive-strong" />
              <p className="text-destructive-strong font-medium">
                {lowStockCount} {lowStockCount === 1 ? "part has" : "parts have"} reached the reorder point.
              </p>
              {/* The banner is also the way into the list it is about. */}
              <Button size="sm" variant="outline" onClick={() => { setLowOnly(true); setSearch(""); setCatFilter("__all__"); }}>
                Review now
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" /> Products
              {/* What is on screen, when it is not everything. */}
              {visible.length !== rows.length && (
                <span className="text-sm font-normal text-muted-foreground">{visible.length} of {rows.length}</span>
              )}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by model, description, machine, line or location"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search parts"
                />
              </div>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="w-[180px]" aria-label="Filter by category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All categories</SelectItem>
                  {filterCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant={lowOnly ? "default" : "outline"}
                onClick={() => setLowOnly((v) => !v)}
                aria-pressed={lowOnly}
              >
                <AlertTriangle className="mr-1 h-4 w-4" /> Low stock
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => runExport("pdf", false)}><FileText className="mr-1 h-4 w-4" /> PDF list</Button>
              <Button size="sm" variant="outline" onClick={() => runExport("pdf", true)}><FileText className="mr-1 h-4 w-4" /> PDF low</Button>
              <Button size="sm" variant="outline" onClick={() => runExport("excel", false)}><FileSpreadsheet className="mr-1 h-4 w-4" /> Excel list</Button>
              <Button size="sm" variant="outline" onClick={() => runExport("excel", true)}><FileSpreadsheet className="mr-1 h-4 w-4" /> Excel low</Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !rows.length ? (
              <p className="text-muted-foreground text-center py-8">No products in stock yet.</p>
            ) : !visible.length ? (
              // Nothing matched is not the same as nothing held — and the way out of
              // it has to be on screen, or the filters look like a broken page.
              <div className="py-8 text-center text-muted-foreground">
                <p>No part matches these filters.</p>
                <Button variant="link" onClick={() => { setSearch(""); setCatFilter("__all__"); setLowOnly(false); }}>Clear filters</Button>
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {visible.map((p) => {
                    const isLow = isLowStock(p);
                    return (
                      <div key={p.id} className={`rounded-lg border p-3 space-y-2 ${isLow ? "border-destructive/50 bg-destructive/5" : "bg-card"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{p.code}{p.line ? ` · ${p.line}` : ""}{p.location ? ` · ${p.location}` : ""}</p>
                            {p.description && <p className="truncate text-xs text-muted-foreground">{p.description}</p>}
                          </div>
                          {isLow ? (
                            <StatusBadge status="warning" label="Low Stock" />
                          ) : (
                            <StatusBadge status="success" label="In Stock" />
                          )}
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <p className={`text-3xl font-bold ${isLow ? "text-destructive-strong" : ""}`}>{p.quantity}</p>
                            <p className="text-xs text-muted-foreground">Min: {p.min_stock}</p>
                          </div>
                          <div className="text-right space-y-1">
                            <Badge variant="outline" className="capitalize">{p.category}</Badge>
                            {canPrice && <p className="text-sm font-medium">£{(p.price || 0).toFixed(2)}</p>}
                          </div>
                        </div>
                        {isManager && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="h-10 flex-1 touch-manipulation" onClick={() => openEdit(p)}>
                              <Pencil className="h-4 w-4 mr-1" /> Edit
                            </Button>
                            <Button size="sm" variant="destructive" className="h-10 flex-1 touch-manipulation" onClick={() => setDeleteId(p.id)}>
                              <Trash2 className="h-4 w-4 mr-1" /> Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                {/* Thirteen columns do not fit a laptop: the table scrolls inside its
                    own box rather than pushing the page sideways. */}
                <div className="hidden overflow-x-auto md:block">
                <Table>
                <TableHeader>
                 <TableRow>
                     <TableHead className="w-14">Photo</TableHead>
                     <TableHead>Model</TableHead>
                     <TableHead>Name</TableHead>
                     <TableHead>Category</TableHead>
                     <TableHead>Description</TableHead>
                     <TableHead>Machine</TableHead>
                     <TableHead>Line</TableHead>
                     <TableHead>Location</TableHead>
                     {canPrice && <TableHead className="text-right">Price</TableHead>}
                     <TableHead className="text-right">Qty</TableHead>
                     <TableHead className="text-right">Min</TableHead>
                     <TableHead>Status</TableHead>
                     {isManager && <TableHead>Actions</TableHead>}
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {visible.map((p) => {
                     const isLow = isLowStock(p);
                     return (
                       <TableRow key={p.id} className={isLow ? "bg-destructive/10" : ""}>
                        <TableCell>
                          {p.photo_url ? (
                            <img src={p.photo_url} alt="" className="h-9 w-9 rounded border object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded border border-dashed text-muted-foreground" aria-label="No photo">
                              <ImageOff className="h-4 w-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{p.code}</TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                        <TableCell className="max-w-[280px] truncate" title={p.description ?? undefined}>{p.description || "—"}</TableCell>
                        <TableCell>{p.machine || "—"}</TableCell>
                        <TableCell>{p.line || "—"}</TableCell>
                        <TableCell>{p.location || "—"}</TableCell>
                        {canPrice && <TableCell className="text-right">£{(p.price || 0).toFixed(2)}</TableCell>}
                        <TableCell className={`text-right ${isLow ? "text-destructive-strong font-bold" : ""}`}>{p.quantity}</TableCell>
                        <TableCell className="text-right">{p.min_stock}</TableCell>
                        <TableCell>
                          {isLow ? (
                            <StatusBadge status="warning" label="Low Stock" />
                          ) : (
                            <StatusBadge status="success" label="In Stock" />
                          )}
                        </TableCell>
                        {isManager && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" aria-label="Edit part" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                              {isAdmin && <Button size="icon" variant="ghost" aria-label="Delete part" className="text-destructive-strong" onClick={() => setDeleteId(p.id)}><Trash2 className="h-4 w-4" /></Button>}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {isManager && (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add Product</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={handleAdd} className="space-y-3" autoComplete="off">
                     <div className="space-y-1"><Label>Name <span className="text-destructive-strong">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
                     <div className="space-y-1"><Label>Line</Label><Input value={productLine} onChange={(e) => setProductLine(e.target.value)} placeholder="e.g. Line A1" /></div>
                     <div className="space-y-1"><Label>Code <span className="text-destructive-strong">*</span></Label><Input value={code} onChange={(e) => setCode(e.target.value)} required /></div>
                     <div className="space-y-1"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Deep groove ball bearing" /></div>
                     <div className="grid grid-cols-2 gap-3">
                       <div className="space-y-1"><Label>Machine</Label><Input value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="e.g. Blender 3" /></div>
                       <div className="space-y-1"><Label>Location</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. A1" /></div>
                     </div>
                     <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1"><Label>Initial Qty</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
                      <div className="space-y-1"><Label>Min Stock</Label><Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} /></div>
                      {canPrice && <div className="space-y-1"><Label>Price (£) <span className="text-destructive-strong">*</span></Label><Input type="number" step="0.01" min="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
                     </div>
                    <div className="space-y-1">
                      <Label>Category</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                        <SelectContent>
                          {categoryOptions.map((c) => (
                            <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                          ))}
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
                  <form onSubmit={handleAdjust} className="space-y-3" autoComplete="off">
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

            {/* Adjustment History — last 10 manual stock adjustments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Adjustment History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!adjustmentHistory || adjustmentHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No manual adjustments recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date / Time</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">Adjustment</TableHead>
                          <TableHead className="text-right">New Qty</TableHead>
                          <TableHead>User</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {adjustmentHistory.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap text-sm">
                              {format(new Date(row.created_at), "dd/MM/yyyy HH:mm")}
                            </TableCell>
                            <TableCell className="text-sm">{row.product_label}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={row.adjustment >= 0 ? "default" : "destructive"}>
                                {row.adjustment > 0 ? `+${row.adjustment}` : row.adjustment}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-sm">
                              {row.new_quantity ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm">{row.user_name}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Category Management */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Tags className="h-4 w-4" /> Manage Categories</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <form onSubmit={handleAddCategory} className="flex gap-2 flex-1" autoComplete="off">
                    <Input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="New category name" className="flex-1" />
                    <Button type="submit" size="sm" disabled={addCategory.isPending}>
                      {addCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    </Button>
                  </form>
                </div>
                {categoriesLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {categoryOptions.map((c) => (
                      <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
                        {c.name}
                        <Button size="icon" variant="ghost" className="h-4 w-4 p-0 text-destructive-strong hover:bg-transparent" onClick={() => deleteCategory.mutate(c.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Edit Product Dialog */}
        <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Product</DialogTitle><DialogDescription className="sr-only">Edit product details</DialogDescription></DialogHeader>
            <div className="space-y-3">
               <div className="space-y-1"><Label>Name</Label><Input value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
               <div className="space-y-1"><Label>Line</Label><Input value={editLine} onChange={(e) => setEditLine(e.target.value)} placeholder="e.g. Line A1" /></div>
               <div className="space-y-1"><Label>Code</Label><Input value={editCode} onChange={(e) => setEditCode(e.target.value)} /></div>
               <div className="space-y-1"><Label>Description</Label><Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} /></div>
               <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-1"><Label>Machine</Label><Input value={editMachine} onChange={(e) => setEditMachine(e.target.value)} /></div>
                 <div className="space-y-1"><Label>Location</Label><Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} /></div>
               </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label>Quantity</Label><Input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)} /></div>
                <div className="space-y-1"><Label>Min Stock</Label><Input type="number" value={editMinStock} onChange={(e) => setEditMinStock(e.target.value)} /></div>
                {canPrice && <div className="space-y-1"><Label>Price (£) <span className="text-destructive-strong">*</span></Label><Input type="number" step="0.01" min="0.01" required value={editPrice} onChange={(e) => setEditPrice(e.target.value)} /></div>}
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditProduct(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={updateProduct.isPending}>
                {updateProduct.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete product?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone. The product will be permanently removed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
