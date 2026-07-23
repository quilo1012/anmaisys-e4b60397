import { useState, useMemo, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Pencil, Trash2, Loader2, Cog, History, MapPin, QrCode } from "lucide-react";
import {
  useMachines,
  useAddMachine,
  useUpdateMachine,
  useDeleteMachine,
  useMoveMachine,
  useLines,
  useDistinctMachineValues,
  STATUS_OPTIONS,
  type Machine,
  type MachineSide,
} from "@/hooks/useMachines";
import { SideBadge } from "@/components/MachineSelector";
import { ComboboxInput } from "@/components/ComboboxInput";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { WAREHOUSE_LOCATIONS } from "@/lib/warehouseLocations";
import { supabase } from "@/integrations/supabase/client";

import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";

interface LineOption { id: string; name: string; has_sides: boolean }

// Sentinel prefix marking a value that is a new line name (to be created on save)
export const NEW_LINE_PREFIX = "__new__:";

function LineCombobox({
  value,
  onChange,
  lines,
}: {
  value: string;
  onChange: (id: string) => void;
  lines: LineOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = lines.find((l) => l.id === value);
  const pendingName = value.startsWith(NEW_LINE_PREFIX) ? value.slice(NEW_LINE_PREFIX.length) : "";

  const trimmed = query.trim();
  const exactMatch = lines.find((l) => l.name.toLowerCase() === trimmed.toLowerCase());
  const showCreate = trimmed.length > 0 && !exactMatch;

  const displayLabel = selected
    ? `${selected.name}${selected.has_sides ? " (A/B)" : ""}`
    : pendingName
      ? `${pendingName} (new)`
      : "Select or type to create...";

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && !pendingName && "text-muted-foreground")}>
            {displayLabel}
          </span>
          <span className="flex items-center gap-1">
            {(selected || pendingName) && (
              <X
                className="h-4 w-4 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search or type new line..."
            autoFocus
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {showCreate ? null : "No line found."}
            </CommandEmpty>
            <CommandGroup>
              {lines.map((l) => (
                <CommandItem
                  key={l.id}
                  value={l.name}
                  onSelect={() => {
                    onChange(l.id);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === l.id ? "opacity-100" : "opacity-0")} />
                  {l.name}
                  {l.has_sides ? " (A/B)" : ""}
                </CommandItem>
              ))}
              {showCreate && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={() => {
                    onChange(`${NEW_LINE_PREFIX}${trimmed}`);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create line "{trimmed}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function MachinesPage() {
  const { role } = useAuth();
  const isWarehouse = role === "warehouse";
  const { data: machines, isLoading } = useMachines();
  const { data: lines } = useLines();
  const { data: distinct } = useDistinctMachineValues();
  const addMachine = useAddMachine();
  const updateMachine = useUpdateMachine();
  const deleteMachine = useDeleteMachine();
  const moveMachine = useMoveMachine();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [showAdd, setShowAdd] = useState(false);
  const [editMachine, setEditMachine] = useState<Machine | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<Machine | null>(null);
  const [moveLocation, setMoveLocation] = useState("");
  const [qrMachine, setQrMachine] = useState<Machine | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  // Auto-generate next available machine code (MCH-XXX)
  const nextMachineCode = useMemo(() => {
    if (!machines) return "MCH-001";
    let max = 0;
    machines.forEach((m) => {
      const match = m.code?.match(/^MCH-(\d+)$/i);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > max) max = n;
      }
    });
    return `MCH-${String(max + 1).padStart(3, "0")}`;
  }, [machines]);

  const filteredMachines = useMemo(() => {
    if (!machines) return [];
    const q = search.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) =>
      [m.name, m.machine_type, m.line, m.current_location, m.code, m.sector]
        .some((f) => (f || "").toLowerCase().includes(q))
    );
  }, [machines, search]);

  // Pagination — 10 per page
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredMachines.length / PAGE_SIZE));
  // Reset to page 1 whenever the filter changes or pages shrink
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pagedMachines = useMemo(
    () => filteredMachines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredMachines, page]
  );

  const [name, setName] = useState("");
  const [lineId, setLineId] = useState<string>("");
  const [side, setSide] = useState<MachineSide>("common");
  const [sector, setSector] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [machineType, setMachineType] = useState("");
  const [currentLocation, setCurrentLocation] = useState("");

  const selectedLine = useMemo(() => lines?.find((l) => l.id === lineId), [lines, lineId]);
  const lineHasSides = !!selectedLine?.has_sides;

  // If a line without sides is selected, force side=common
  useEffect(() => {
    if (selectedLine && !selectedLine.has_sides && side !== "common") setSide("common");
  }, [selectedLine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setName("");
    setLineId("");
    setSide("common");
    setSector("");
    setCode("");
    setStatus("");
    setMachineType("");
    setCurrentLocation("");
    setErrors({});
  };

  const openEdit = (m: Machine) => {
    setEditMachine(m);
    setName(m.name);
    setLineId(m.line_id || "");
    setSide((m.side as MachineSide) || "common");
    setSector(m.sector || "");
    setCode(m.code || "");
    setStatus(m.status || "");
    setMachineType(m.machine_type || "");
    setCurrentLocation(m.current_location || "");
    setErrors({});
  };

  const validate = (isEdit = false): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Name is required";
    if (!machineType.trim()) e.machineType = "Machine type is required";
    if (lineHasSides && side !== "A" && side !== "B" && side !== "common") e.side = "Pick a side";
    if (code.trim() && machines) {
      const dup = machines.find((m) => m.code === code.trim() && (!isEdit || m.id !== editMachine?.id));
      if (dup) e.code = "Code already in use";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Resolve lineId: if it carries the NEW_LINE_PREFIX sentinel, insert a new line and return its id.
  const resolveLineId = async (): Promise<{ id: string | null; name: string }> => {
    if (!lineId) return { id: null, name: "" };
    if (lineId.startsWith(NEW_LINE_PREFIX)) {
      const newName = lineId.slice(NEW_LINE_PREFIX.length).trim();
      if (!newName) return { id: null, name: "" };
      const { data, error } = await (supabase as any)
        .from("lines")
        .insert({ name: newName })
        .select()
        .single();
      if (error) throw error;
      return { id: data.id, name: data.name };
    }
    return { id: lineId, name: selectedLine?.name || "" };
  };

  const buildPayload = (resolvedLine: { id: string | null; name: string }) => ({
    name: name.trim(),
    line: resolvedLine.name,
    line_id: resolvedLine.id,
    side,
    sector: sector.trim(),
    code: code.trim(),
    status,
    machine_type: machineType.trim(),
    current_location: currentLocation.trim(),
  });

  const handleAdd = async () => {
    if (!validate()) return;
    try {
      const resolved = await resolveLineId();
      const result = await addMachine.mutateAsync(buildPayload(resolved));
      toast({ title: "Machine added" });
      logAuditEvent("create", "machine", (result as any)?.id, { name: name.trim() });
      setShowAdd(false);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleEdit = async () => {
    if (!editMachine || !validate(true)) return;
    try {
      const resolved = await resolveLineId();
      await updateMachine.mutateAsync({ id: editMachine.id, ...buildPayload(resolved) });
      toast({ title: "Machine updated" });
      logAuditEvent("update", "machine", editMachine.id, { name: name.trim() });
      setEditMachine(null);
      resetForm();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMachine.mutateAsync(deleteId);
      toast({ title: "Machine deleted" });
      logAuditEvent("delete", "machine", deleteId);
      setDeleteId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleMove = async () => {
    if (!moveTarget || !moveLocation.trim()) return;
    try {
      await moveMachine.mutateAsync({
        machineId: moveTarget.id,
        fromLocation: moveTarget.current_location || "",
        toLocation: moveLocation.trim(),
      });
      toast({ title: "Machine moved", description: `${moveTarget.name} → ${moveLocation.trim()}` });
      logAuditEvent("move", "machine", moveTarget.id, { from: moveTarget.current_location, to: moveLocation.trim() });
      setMoveTarget(null);
      setMoveLocation("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const formContent = (
    <div className="space-y-5">
      {/* General Info */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">General Info</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blender 5A" />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MCH-001" className="font-mono" />
            {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
          </div>
        </div>
      </div>

      {/* Classification */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Classification</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Machine Type <span className="text-destructive">*</span></Label>
            <Input
              value={machineType}
              onChange={(e) => setMachineType(e.target.value)}
              placeholder="Conveyor, Filler, Capper..."
            />
            {errors.machineType && <p className="text-xs text-destructive">{errors.machineType}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Input
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="Active, Idle, Maintenance..."
            />
          </div>
        </div>
      </div>

      {/* Location & Hierarchy */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Location & Hierarchy
        </p>
        {isWarehouse ? (
          /* Warehouse admin: assets live in a warehouse, not on a production line */
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <ComboboxInput
                value={currentLocation}
                onChange={setCurrentLocation}
                suggestions={WAREHOUSE_LOCATIONS}
                placeholder="Select or type a warehouse"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sector</Label>
              <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. Packaging" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Line</Label>
                <LineCombobox
                  value={lineId}
                  onChange={setLineId}
                  lines={lines || []}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Side {lineHasSides ? <span className="text-destructive">*</span> : ""}</Label>
                {lineHasSides ? (
                  <div className="grid grid-cols-3 gap-1">
                    {(["A", "B", "common"] as MachineSide[]).map((s) => (
                      <Button
                        key={s}
                        type="button"
                        size="sm"
                        variant={side === s ? "default" : "outline"}
                        className={cn("h-10", side === s && "ring-2 ring-primary")}
                        onClick={() => setSide(s)}
                      >
                        {s === "common" ? "Shared" : s}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Input disabled value="Shared (line has no A/B)" className="text-muted-foreground" />
                )}
                {errors.side && <p className="text-xs text-destructive">{errors.side}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="space-y-1.5">
                <Label>Current Location</Label>
                <Input
                  value={currentLocation}
                  onChange={(e) => setCurrentLocation(e.target.value)}
                  placeholder="e.g. Building A, Floor 2"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sector</Label>
                <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="e.g. Packaging" />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const statusBadge = (s: string) => {
    const label = STATUS_OPTIONS.find((o) => o.value === s)?.label || s || "Active";
    const isActive = s === "active" || !s;
    if (isActive) {
      return <Badge className="bg-green-600 hover:bg-green-600 text-white border-transparent">{label}</Badge>;
    }
    const map: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
      in_use: "secondary",
      maintenance: "destructive",
      idle: "outline",
    };
    return <Badge variant={map[s] || "outline"}>{label}</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Cog className="h-6 w-6" /> Machines
            </h2>
            <p className="text-muted-foreground">Manage machines, lines, sides and types</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setCode(nextMachineCode);
              setShowAdd(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Add Machine
          </Button>
        </div>

        <div className="relative max-w-md">
          <Input
            placeholder="Search machines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !machines?.length ? (
              <p className="text-muted-foreground text-center py-8">No machines yet. Add one to get started.</p>
            ) : !filteredMachines.length ? (
              <p className="text-muted-foreground text-center py-8">No machines match "{search}".</p>
            ) : (
              <>
                {/* Mobile cards */}
                <div className="md:hidden space-y-3">
                  {pagedMachines.map((m) => (
                    <div key={m.id} className="rounded-lg border bg-card p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate">{m.name}</p>
                          <p className="text-xs text-muted-foreground">{m.machine_type || "—"}</p>
                        </div>
                        {statusBadge(m.status)}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        {m.line && <Badge variant="outline">{m.line}</Badge>}
                        <SideBadge side={m.side} />
                        {m.current_location && (
                          <Badge variant="outline" className="gap-1">
                            <MapPin className="h-3 w-3" />{m.current_location}
                          </Badge>
                        )}
                        {m.code && <span className="font-mono text-muted-foreground">{m.code}</span>}
                        {!m.machine_type && (
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Incomplete</Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <Button size="sm" variant="outline" className="h-11 touch-manipulation" onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}>
                          <History className="h-4 w-4 mr-1" /> History
                        </Button>
                        <Button size="sm" variant="outline" className="h-11 touch-manipulation" onClick={() => openEdit(m)}>
                          <Pencil className="h-4 w-4 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" className="h-11 touch-manipulation" onClick={() => setQrMachine(m)}>
                          <QrCode className="h-4 w-4 mr-1" /> QR
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Line</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Maint.</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedMachines.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">
                          {m.name}
                          {!m.machine_type && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-xs bg-yellow-50 text-yellow-700 border-yellow-200"
                            >
                              Incomplete
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{m.machine_type || "—"}</TableCell>
                        <TableCell>{m.line || "—"}</TableCell>
                        <TableCell>
                          <SideBadge side={m.side} />
                        </TableCell>
                        <TableCell>
                          {m.current_location ? (
                            <Badge variant="outline" className="gap-1">
                              <MapPin className="h-3 w-3" />
                              {m.current_location}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{m.code || "—"}</TableCell>
                        <TableCell>{statusBadge(m.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {m.last_maintenance_date ? format(new Date(m.last_maintenance_date), "dd/MM/yyyy") : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => navigate(`/dashboard/machines/${encodeURIComponent(m.name)}/history`)}
                                  aria-label="View History"
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View History</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setMoveTarget(m);
                                    setMoveLocation("");
                                  }}
                                  aria-label="Move Machine"
                                >
                                  <MapPin className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Move Machine</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" onClick={() => setQrMachine(m)} aria-label="QR Code">
                                  <QrCode className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>QR Code</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="icon" variant="ghost" onClick={() => openEdit(m)} aria-label="Edit Machine">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit Machine</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive"
                                  onClick={() => setDeleteId(m.id)}
                                  aria-label="Delete Machine"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Delete Machine</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </>
            )}
            {filteredMachines.length > 0 && (
              <div className="flex items-center justify-between gap-3 pt-4 flex-wrap">
                <div className="text-sm text-muted-foreground">
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredMachines.length)}
                  </span>{" "}
                  of <span className="font-medium text-foreground">{filteredMachines.length}</span> machines
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    Page {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add Dialog */}
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Machine</DialogTitle>
              <DialogDescription className="sr-only">Add a new machine</DialogDescription>
            </DialogHeader>
            {formContent}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd} disabled={addMachine.isPending}>
                {addMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog
          open={!!editMachine}
          onOpenChange={(o) => {
            if (!o) {
              setEditMachine(null);
              resetForm();
            }
          }}
        >
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Machine</DialogTitle>
              <DialogDescription className="sr-only">Edit machine details</DialogDescription>
            </DialogHeader>
            {formContent}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setEditMachine(null);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button onClick={handleEdit} disabled={updateMachine.isPending}>
                {updateMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Move Dialog */}
        <Dialog open={!!moveTarget} onOpenChange={(o) => !o && setMoveTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move Machine</DialogTitle>
              <DialogDescription>Move {moveTarget?.name} to a new location</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-sm text-muted-foreground">Current Location</Label>
                <p className="font-medium">{moveTarget?.current_location || "Not assigned"}</p>
              </div>
              <div className="space-y-2">
                <Label>New Location</Label>
                <Input
                  value={moveLocation}
                  onChange={(e) => setMoveLocation(e.target.value)}
                  placeholder="Enter new location"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMoveTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleMove} disabled={moveMachine.isPending || !moveLocation.trim()}>
                {moveMachine.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Move
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* QR Code Dialog */}
        <Dialog open={!!qrMachine} onOpenChange={(o) => !o && setQrMachine(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>QR Code — {qrMachine?.name}</DialogTitle>
              <DialogDescription>Scan to open machine history or create a Work Order</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 py-4">
              <QRCodeSVG
                value={`${window.location.origin}/dashboard/machines/${encodeURIComponent(qrMachine?.name || "")}/history`}
                size={200}
              />
              <p className="text-xs text-muted-foreground text-center">Points to machine history page</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQrMachine(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete machine?</AlertDialogTitle>
              <AlertDialogDescription>This will permanently remove this machine.</AlertDialogDescription>
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
