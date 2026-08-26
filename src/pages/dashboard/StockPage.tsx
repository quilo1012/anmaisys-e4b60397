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
import { Textarea } from "@/components/ui/textarea";
import { Package, Plus, Minus, Loader2, AlertTriangle, Pencil, Trash2, Tags, Search, FileText, FileSpreadsheet, ImageOff, Camera, SlidersHorizontal } from "lucide-react";
import { useProducts, useAddProduct, useUpdateProductStock, useUpdateProduct, useDeleteProduct, type Product } from "@/hooks/useStock";
import { usePartPhotoUrls, useUploadPartPhoto } from "@/hooks/usePartPhotos";
import { IdentifyPartDialog } from "@/components/IdentifyPartDialog";

import { useCategories, useAddCategory, useDeleteCategory } from "@/hooks/useCategories";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent, useStockAdjustmentHistory } from "@/hooks/useAuditLogs";
import { useQueryClient } from "@tanstack/react-query";
import { ConsoleStrip, ConsoleCell } from "@/components/ui/ConsoleStrip";
import { stockTotals, filterStock, isLowStock, stockState } from "@/lib/stockList";
import { exportStockPDF, exportStockExcel } from "@/lib/stockExports";
import { format } from "date-fns";
import { History } from "lucide-react";

// The anstockcontrol form carries a single identifier per part. `products` keeps two
// columns — `code` is the unique key, `name` is the label the work orders show — so the
// name is built here the way the 137 imported parts were: category, then model.
const derivedName = (category: string, code: string) =>
  [category.trim(), code.trim()].filter(Boolean).join(" ") || code.trim();

export default function StockPage() {
  const { role, profile } = useAuth();
  const { can } = useRole();
  const { data: products, isLoading } = useProducts();
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const addProduct = useAddProduct();
  const updateStock = useUpdateProductStock();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const uploadPhoto = useUploadPartPhoto();
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
  // Both were cards sitting under the table, pushing the list down on every visit for
  // the sake of two forms that are used now and then. They are dialogs now.
  const [addOpen, setAddOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // Named here so the adjustment dialog can show where the count lands before anyone
  // commits to it: "-5" on a shelf of 4 is a mistake worth catching before saving.
  const adjustTarget = products?.find((pr) => pr.id === adjustId);
  const adjustDelta = Number.parseInt(adjustQty, 10);
  const adjustResult =
    adjustTarget && Number.isFinite(adjustDelta) ? adjustTarget.quantity + adjustDelta : null;

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
  // "Seven parts at zero" is a figure somebody then wants to see the names of.
  const [outOnly, setOutOnly] = useState(false);
  // Searching by camera. Reading, not editing — open to anyone who can see this screen.
  const [photoSearchOpen, setPhotoSearchOpen] = useState(false);
  // Which row is mid-adjustment, so its two one-unit buttons cannot be double-tapped.
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [removingPhoto, setRemovingPhoto] = useState(false);



  /** A blank box means "nobody said", which is NULL — not an empty string that the
   *  search would happily match and the exports would print as a gap. */
  const orNull = (v: string) => (v.trim() ? v.trim() : null);

  /**
   * What a price box means when it is empty.
   *
   * `20260831090000` lets a part be catalogued without being valued — the trigger
   * allows `price IS NULL OR price = 0` precisely so the five roles that catalogue
   * parts are not forced to invent a figure. The screen used to demand one anyway,
   * which left the 134 imported warehouse parts, all at £0.00, impossible to edit at
   * all: correcting a location meant first making up a price.
   *
   * Blank now means "not my business" and the key is dropped, the same statement
   * `productWritePayload` makes. A typed 0 is still a real 0.
   */
  const priceToSend = (raw: string): number | undefined => {
    if (!canPrice || !raw.trim()) return undefined;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const priceIsGibberish = (raw: string) => {
    if (!canPrice || !raw.trim()) return false;
    const n = Number.parseFloat(raw);
    return !Number.isFinite(n) || n < 0;
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (priceIsGibberish(price)) {
      toast({ title: "Price is not a figure", description: "Leave it blank, or enter £0.00 or more.", variant: "destructive" });
      return;
    }
    try {
      const result = await addProduct.mutateAsync({ name: derivedName(category, code), line: productLine, code, quantity: parseInt(qty) || 0, min_stock: parseInt(minStock) || 0, category: category || "spare", price: priceToSend(price), description: orNull(description), machine: orNull(machine), location: orNull(location) });
      toast({ title: "Part added" });
      logAuditEvent("create", "product", (result as any)?.id, { code });
      setProductLine(""); setCode(""); setQty(""); setMinStock(""); setCategory(""); setPrice(""); setDescription(""); setMachine(""); setLocation("");
      setAddOpen(false);
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
      setAdjustOpen(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
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
    if (priceIsGibberish(editPrice)) {
      toast({ title: "Price is not a figure", description: "Leave it blank, or enter £0.00 or more.", variant: "destructive" });
      return;
    }
    try {
      await updateProduct.mutateAsync({ id: editProduct.id, name: derivedName(editCategory, editCode), line: editLine, code: editCode, quantity: parseInt(editQty) || 0, min_stock: parseInt(editMinStock) || 0, category: editCategory, price: priceToSend(editPrice), description: orNull(editDescription), machine: orNull(editMachine), location: orNull(editLocation), photo_url: editProduct.photo_url ?? null });
      toast({ title: "Part updated" });
      logAuditEvent("update", "product", editProduct.id, { code: editCode });
      setEditProduct(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editProduct) return;
    try {
      const path = await uploadPhoto.mutateAsync({ productId: editProduct.id, file });
      setEditProduct({ ...editProduct, photo_url: path });
      toast({ title: "Photo saved" });
      logAuditEvent("update", "product", editProduct.id, { photo: true });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  };

  /**
   * One unit off the shelf, or one back on it, without opening a form.
   *
   * The most repeated gesture in a warehouse. It writes the same audit entry the
   * adjustment form writes — `adjust_stock`, with the delta and the new figure — so
   * the Adjustment History below tells the whole story either way. Never below zero.
   */
  const adjustOne = async (p: Product, delta: 1 | -1) => {
    const newQty = p.quantity + delta;
    if (newQty < 0) {
      toast({ title: "Stock cannot go below 0", variant: "destructive" });
      return;
    }
    setAdjustingId(p.id);
    try {
      await updateStock.mutateAsync({ id: p.id, quantity: newQty });
      await logAuditEvent("adjust_stock", "product", p.id, { adjustment: delta, new_quantity: newQty });
      queryClient.invalidateQueries({ queryKey: ["stock_adjustment_history"] });
      toast({ title: `${p.code}: ${p.quantity} → ${newQty}` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAdjustingId(null);
    }
  };

  const handlePhotoRemove = async () => {
    if (!editProduct) return;
    setRemovingPhoto(true);
    try {
      await updateProduct.mutateAsync({
        id: editProduct.id,
        name: derivedName(editCategory, editCode),
        line: editLine,
        code: editCode,
        quantity: parseInt(editQty) || 0,
        min_stock: parseInt(editMinStock) || 0,
        category: editCategory,
        price: canPrice ? parseFloat(editPrice) : undefined,
        description: orNull(editDescription),
        machine: orNull(editMachine),
        location: orNull(editLocation),
        photo_url: null,
      });
      setEditProduct({ ...editProduct, photo_url: null });
      toast({ title: "Photo removed" });
      logAuditEvent("update", "product", editProduct.id, { photo: false });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setRemovingPhoto(false);
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
  // "Out of stock" narrows on top of the rest rather than replacing it, and it asks
  // `stockList` what empty means instead of re-deciding it here — a second copy of the
  // rule is how the counter and the list start disagreeing.
  const visible = useMemo(
    () => filterStock(rows, { query: search, category: catFilter, lowOnly, outOnly }),
    [rows, search, catFilter, lowOnly, outOnly],
  );

  const lowStockCount = totals.low;

  // The bucket is private: the stored path is not an address. Sign the few paths that
  // exist, in one request, and show the usual empty square when a signature is missing.
  const photoPaths = useMemo(
    () => rows.map((r) => r.photo_url).filter((v): v is string => !!v),
    [rows],
  );
  const { data: photoUrls } = usePartPhotoUrls(photoPaths);
  const photoSrc = (p: Product) => (p.photo_url ? photoUrls?.[p.photo_url] : undefined);

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
          <ConsoleCell
            label="Out of stock"
            value={totals.out}
            tone={totals.out > 0 ? "text-destructive-strong" : undefined}
            active={outOnly}
            title={outOnly ? "Show all parts" : "Show only parts at zero"}
            onClick={() => setOutOnly((v) => !v)}
          />

        </ConsoleStrip>

        {lowStockCount > 0 && (
          <Card className="border-destructive">
            <CardContent className="pt-6 flex flex-wrap items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive-strong" />
              <p className="text-destructive-strong font-medium">
                {lowStockCount} {lowStockCount === 1 ? "part has" : "parts have"} reached the reorder point.
              </p>
              {/* The banner is also the way into the list it is about. */}
              <Button size="sm" variant="outline" onClick={() => { setLowOnly(true); setSearch(""); setCatFilter("__all__"); setOutOnly(false); }}>
                Review now
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="space-y-4">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" /> Spare parts stock
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
              {/* Another way to search the same list: a part in the hand, no code on it. */}
              <Button variant="outline" onClick={() => setPhotoSearchOpen(true)}>
                <Camera className="mr-1 h-4 w-4" /> Find by photo
              </Button>
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
              {/* Exports describe the list; these two change it. Same row because that is
                  where the hand already is, but set apart so six buttons do not read as
                  six of the same kind. */}
              {isManager && (
                <>
                  <span aria-hidden className="mx-1 hidden w-px self-stretch bg-border sm:block" />
                  <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
                    <SlidersHorizontal className="mr-1 h-4 w-4" /> Stock adjustment
                  </Button>
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Add product
                  </Button>
                </>
              )}
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
                <Button variant="link" onClick={() => { setSearch(""); setCatFilter("__all__"); setLowOnly(false); setOutOnly(false); }}>Clear filters</Button>
              </div>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {visible.map((p) => {
                    const state = stockState(p);
                    const isLow = state !== "ok";
                    return (
                      <div key={p.id} className={`rounded-lg border p-3 space-y-2 ${isLow ? "border-destructive/50 bg-destructive/5" : "bg-card"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{p.code}{p.line ? ` · ${p.line}` : ""}{p.location ? ` · ${p.location}` : ""}</p>
                            {p.description && <p className="truncate text-xs text-muted-foreground">{p.description}</p>}
                          </div>
                          {state === "out" ? (
                            <StatusBadge status="error" label="Out of Stock" />
                          ) : state === "low" ? (
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
                {/* Eleven columns do not fit a laptop: the table scrolls inside its
                    own box rather than pushing the page sideways. */}
                <div className="hidden overflow-x-auto rounded-md border md:block">
                {/* Ruled like the anstockcontrol list: a line between every column,
                    not just between rows. */}
                <Table className="[&_td]:border-r [&_th]:border-r [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
                <TableHeader>
                 <TableRow>
                     <TableHead className="w-14">Photo</TableHead>
                     <TableHead>Model</TableHead>
                     <TableHead>Category</TableHead>
                     <TableHead>Description</TableHead>
                     <TableHead>Machine</TableHead>
                     <TableHead>Line</TableHead>
                     <TableHead>Location</TableHead>
                     {canPrice && <TableHead className="text-right">Price</TableHead>}
                     <TableHead className="text-right">Qty</TableHead>
                     <TableHead className="text-right">Min</TableHead>
                     {isManager && <TableHead>Actions</TableHead>}
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {visible.map((p) => {
                     const state = stockState(p);
                     const isLow = state !== "ok";
                     const thumb = photoSrc(p) ? (
                       <img src={photoSrc(p)} alt="" className="h-9 w-9 rounded border object-cover" loading="lazy" />
                     ) : (
                       <div className="flex h-9 w-9 items-center justify-center rounded border border-dashed text-muted-foreground" aria-label="No photo">
                         <ImageOff className="h-4 w-4" />
                       </div>
                     );
                     return (
                       <TableRow key={p.id} className={isLow ? "bg-destructive/10" : ""}>
                        <TableCell>
                          {/* The picture is the way to the picture: for whoever may
                              manage stock, the cell opens the form ready for a photo. */}
                          {isManager ? (
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              aria-label={p.photo_url ? `Change photo of ${p.code}` : `Add photo to ${p.code}`}
                              className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {thumb}
                            </button>
                          ) : thumb}
                        </TableCell>
                        <TableCell className="font-mono font-medium">{p.code}</TableCell>
                        <TableCell><Badge variant="outline">{p.category}</Badge></TableCell>
                        <TableCell className="max-w-[280px] truncate" title={p.description ?? undefined}>{p.description || "—"}</TableCell>
                        <TableCell>{p.machine || "—"}</TableCell>
                        <TableCell>{p.line || "—"}</TableCell>
                        <TableCell>{p.location || "—"}</TableCell>
                        {canPrice && <TableCell className="text-right">£{(p.price || 0).toFixed(2)}</TableCell>}
                        <TableCell className={`text-right ${isLow ? "text-destructive-strong font-bold" : ""}`}>{p.quantity}</TableCell>
                        <TableCell className="text-right">{p.min_stock}</TableCell>
                        {isManager && (
                          <TableCell>
                            <div className="flex gap-1">
                              {/* The gesture that repeats: one off the shelf, one back on,
                                  logged in the audit like any other adjustment. */}
                              <Button size="icon" variant="ghost" aria-label={`Take one ${p.code} out of stock`} disabled={p.quantity <= 0 || adjustingId === p.id} onClick={() => adjustOne(p, -1)}><Minus className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" aria-label={`Add one ${p.code} to stock`} disabled={adjustingId === p.id} onClick={() => adjustOne(p, 1)}><Plus className="h-4 w-4" /></Button>
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

        {/* Add part — the same fields, and in the same order, as Edit part. */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-[680px]">
            <DialogHeader>
              <DialogTitle className="uppercase tracking-wide">Add part</DialogTitle>
              <DialogDescription>
                Keep model, quantity and minimum stock accurate to get reliable alerts.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} autoComplete="off">
              <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                <div className="space-y-1"><Label>Model / Name <span className="text-destructive-strong">*</span></Label><Input value={code} onChange={(e) => setCode(e.target.value)} required /></div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Deep groove ball bearing" />
                </div>
                <div className="grid grid-cols-2 gap-3">
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
                  <div className="space-y-1"><Label>Location (where it is used / stored)</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. A1" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Machine</Label><Input value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="e.g. Blender 3" /></div>
                  <div className="space-y-1"><Label>Line</Label><Input value={productLine} onChange={(e) => setProductLine(e.target.value)} placeholder="e.g. Line A1" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Quantity in stock</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
                  {canPrice && <div className="space-y-1"><Label>Price (£)</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span><Input className="pl-7" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></div></div>}
                </div>
                <div className="space-y-1">
                  <Label>Minimum stock (reorder point)</Label>
                  <Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={addProduct.isPending}>
                  {addProduct.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add part
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Manual stock adjustment — for a count that a plus and a minus will not fix:
            a stocktake, a delivery, a box found at the back of the shelf. */}
        <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Stock adjustment</DialogTitle>
              <DialogDescription>
                For corrections a single step will not cover — a stocktake, a delivery. Every adjustment is recorded.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdjust} autoComplete="off">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Product</Label>
                  <Select value={adjustId} onValueChange={setAdjustId}>
                    <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>
                      {products?.map((pr) => (
                        <SelectItem key={pr.id} value={pr.id}>{pr.code} — {pr.name} (have {pr.quantity})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Adjustment</Label>
                  <Input type="number" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} placeholder="e.g. 10 to add, -5 to remove" required />
                </div>
                {adjustTarget && (
                  <p className={`text-sm ${adjustResult !== null && adjustResult < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {adjustResult === null
                      ? `${adjustTarget.code} currently has ${adjustTarget.quantity}.`
                      : adjustResult < 0
                        ? `That would leave ${adjustResult}. Stock cannot go below zero.`
                        : `${adjustTarget.quantity} → ${adjustResult}`}
                  </p>
                )}
              </div>
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateStock.isPending || !adjustId || adjustResult === null || adjustResult < 0}>
                  {updateStock.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Apply adjustment
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit part — the same fields, and in the same order, as Add part. */}
        <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
          <DialogContent className="sm:max-w-[680px]">
            <DialogHeader>
              <DialogTitle className="uppercase tracking-wide">Edit part</DialogTitle>
              <DialogDescription>
                Keep model, quantity and minimum stock accurate to get reliable alerts.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
               <div className="space-y-1"><Label>Model / Name <span className="text-destructive-strong">*</span></Label><Input value={editCode} onChange={(e) => setEditCode(e.target.value)} /></div>
               <div className="space-y-1">
                 <Label>Description</Label>
                 <Textarea rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
               </div>
               <div className="grid grid-cols-2 gap-3">
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
                 <div className="space-y-1"><Label>Location (where it is used / stored)</Label><Input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} /></div>
               </div>
               <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-1"><Label>Machine</Label><Input value={editMachine} onChange={(e) => setEditMachine(e.target.value)} /></div>
                 <div className="space-y-1"><Label>Line</Label><Input value={editLine} onChange={(e) => setEditLine(e.target.value)} placeholder="e.g. Line A1" /></div>
               </div>
               <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-1"><Label>Quantity in stock</Label><Input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)} /></div>
                 {canPrice && <div className="space-y-1"><Label>Price (£)</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">£</span><Input className="pl-7" type="number" step="0.01" min="0" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} placeholder="0.00" /></div></div>}
               </div>
               <div className="space-y-1">
                 <Label>Minimum stock (reorder point)</Label>
                 <Input type="number" value={editMinStock} onChange={(e) => setEditMinStock(e.target.value)} />
               </div>
              {/* Photo: same right as Edit and Delete — `stock.manage`, nothing new. */}
              {isManager && editProduct && (
                <div className="space-y-1">
                  <Label>Photo</Label>
                  <div className="flex flex-wrap items-center gap-3">
                    {photoSrc(editProduct) ? (
                      <img src={photoSrc(editProduct)} alt="" className="h-14 w-14 rounded border object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed text-muted-foreground">
                        <ImageOff className="h-5 w-5" />
                      </div>
                    )}
                    <label className="inline-flex">
                      <Button asChild variant="outline" size="sm" disabled={uploadPhoto.isPending}>
                        <span className="cursor-pointer">
                          {uploadPhoto.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                          {editProduct.photo_url ? "Replace photo" : "Take / upload photo"}
                        </span>
                      </Button>
                      {/* `capture` opens the camera on a phone — this is done standing
                          in the warehouse with the part in hand. */}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={handlePhotoPick}
                      />
                    </label>
                  </div>
                  {/* Replacing was possible, clearing was not. */}
                  {editProduct.photo_url && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto px-0 text-destructive-strong"
                      onClick={handlePhotoRemove}
                      disabled={removingPhoto}
                    >
                      {removingPhoto ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Remove photo
                    </Button>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditProduct(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={updateProduct.isPending}>
                {updateProduct.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Photo search: picking a candidate drops its code into the same search box. */}
        <IdentifyPartDialog
          open={photoSearchOpen}
          onOpenChange={setPhotoSearchOpen}
          onPick={(code) => { setSearch(code); setCatFilter("__all__"); setLowOnly(false); setOutOnly(false); }}
        />


        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete part?</AlertDialogTitle>
              <AlertDialogDescription>This action cannot be undone. The part will be permanently removed.</AlertDialogDescription>
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
