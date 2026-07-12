import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Users,
  Plus,
  KeyRound,
  Copy,
  Check,
  Pencil,
  Loader2,
  Eye,
  EyeOff,
  ShieldAlert,
  Wand2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLines } from "@/hooks/useMachines";
import {
  useOperatorAccounts,
  useCreateOperatorAccount,
  useUpdateOperatorAccountLines,
  useUpdateOperatorAccountEmail,
  useResetOperatorPassword,
  type OperatorLineAccount,
} from "@/hooks/useOperatorAccounts";
import { format } from "date-fns";
import { checkPasswordStrength, describePasswordError, generateStrongPassword } from "@/lib/passwordPolicy";
import { OperatorAccountFaviconCell } from "@/components/OperatorAccountFaviconCell";

const EMAIL_DOMAIN = "@anmaisys.local";

function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\+/g, "-plus-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function buildEmailFromLabel(label: string): string {
  const slug = slugifyLabel(label);
  return slug ? `operator.${slug}${EMAIL_DOMAIN}` : "";
}

interface LineCheckboxGridProps {
  lines: { id: string; name: string }[] | undefined;
  selected: Set<string>;
  onToggle: (id: string) => void;
}
function LineCheckboxGrid({ lines, selected, onToggle }: LineCheckboxGridProps) {
  if (!lines?.length) {
    return <p className="text-sm text-muted-foreground">No lines available.</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2 max-h-56 overflow-y-auto rounded-md border bg-muted/20 p-3">
      {lines.map((l) => (
        <Label
          key={l.id}
          className="flex items-center gap-2 cursor-pointer rounded-md p-2 hover:bg-accent transition-colors"
        >
          <Checkbox checked={selected.has(l.id)} onCheckedChange={() => onToggle(l.id)} />
          <span className="text-sm font-medium">{l.name}</span>
        </Label>
      ))}
    </div>
  );
}

interface Props {
  isAdmin: boolean;
}

export function OperatorAccountsSection({ isAdmin }: Props) {
  const { toast } = useToast();
  const { data: lines } = useLines();
  const { data: accounts, isLoading } = useOperatorAccounts();
  const createAcc = useCreateOperatorAccount();
  const updateAcc = useUpdateOperatorAccountLines();
  const updateEmail = useUpdateOperatorAccountEmail();
  const resetPwd = useResetOperatorPassword();

  // ── Create dialog ────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [cLabel, setCLabel] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cEmailManuallyEdited, setCEmailManuallyEdited] = useState(false);
  const [cPassword, setCPassword] = useState("");
  const [cShowPwd, setCShowPwd] = useState(false);
  const [cLineSet, setCLineSet] = useState<Set<string>>(new Set());
  const [cPasswordError, setCPasswordError] = useState<string | null>(null);

  const resetCreateForm = () => {
    setCLabel("");
    setCEmail("");
    setCEmailManuallyEdited(false);
    setCPassword("");
    setCShowPwd(false);
    setCPasswordError(null);
    setCLineSet(new Set());
  };

  const handleLabelChange = (v: string) => {
    setCLabel(v);
    if (!cEmailManuallyEdited) setCEmail(buildEmailFromLabel(v));
  };

  const toggleCreateLine = (id: string) =>
    setCLineSet((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const handleCreate = async () => {
    if (!cLabel.trim() || !cEmail.trim() || cLineSet.size === 0) {
      toast({
        title: "Missing info",
        description: "Label, email and ≥1 line are required.",
        variant: "destructive",
      });
      return;
    }
    const strength = checkPasswordStrength(cPassword);
    if (!strength.ok) {
      setCPasswordError(strength.reason ?? "Use a stronger password.");
      toast({ title: "Weak password", description: strength.reason, variant: "destructive" });
      return;
    }
    setCPasswordError(null);
    try {
      await createAcc.mutateAsync({
        email: cEmail.trim(),
        password: cPassword,
        label: cLabel.trim(),
        line_ids: Array.from(cLineSet),
      });
      toast({
        title: "Operator account created",
        description: `${cEmail.trim()} — ${cLineSet.size} line(s).`,
      });
      resetCreateForm();
      setCreateOpen(false);
    } catch (e: any) {
      setCPasswordError(describePasswordError(e?.message));
      toast({
        title: "Create failed",
        description: describePasswordError(e?.message),
        variant: "destructive",
      });
    }
  };

  // ── Edit dialog ──────────────────────────────────────────
  const [editing, setEditing] = useState<OperatorLineAccount | null>(null);
  const [eLabel, setELabel] = useState("");
  const [eEmail, setEEmail] = useState("");
  const [eEmailError, setEEmailError] = useState<string | null>(null);
  const [eLineSet, setELineSet] = useState<Set<string>>(new Set());

  const openEdit = (acc: OperatorLineAccount) => {
    setEditing(acc);
    setELabel(acc.label);
    setEEmail(acc.email);
    setEEmailError(null);
    setELineSet(new Set(acc.line_ids));
  };

  const toggleEditLine = (id: string) =>
    setELineSet((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const handleSaveEdit = async () => {
    if (!editing) return;
    const trimmedEmail = eEmail.trim().toLowerCase();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
    if (!eLabel.trim() || eLineSet.size === 0 || !trimmedEmail) {
      toast({
        title: "Missing info",
        description: "Label, email and at least one line are required.",
        variant: "destructive",
      });
      return;
    }
    if (!emailValid) {
      setEEmailError("Enter a valid email address.");
      toast({ title: "Invalid email", description: "Enter a valid email address.", variant: "destructive" });
      return;
    }
    setEEmailError(null);
    try {
      // 1) Update label + lines
      await updateAcc.mutateAsync({
        id: editing.id,
        label: eLabel.trim(),
        line_ids: Array.from(eLineSet),
      });
      // 2) Update email if it changed
      if (trimmedEmail !== editing.email.toLowerCase()) {
        await updateEmail.mutateAsync({ id: editing.id, email: trimmedEmail });
      }
      toast({ title: "Account updated", description: eLabel.trim() });
      setEditing(null);
    } catch (e: any) {
      const msg = e?.message ?? "Update failed";
      setEEmailError(msg);
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    }
  };

  // ── Reset single password ────────────────────────────────
  const [resetTarget, setResetTarget] = useState<OperatorLineAccount | null>(null);
  const [rPwd, setRPwd] = useState("");
  const [rPwd2, setRPwd2] = useState("");
  const [rShow, setRShow] = useState(false);
  const [rPasswordError, setRPasswordError] = useState<string | null>(null);

  const closeReset = () => {
    setResetTarget(null);
    setRPwd("");
    setRPwd2("");
    setRShow(false);
    setRPasswordError(null);
  };

  const handleResetSingle = async () => {
    if (!resetTarget) return;
    const strength = checkPasswordStrength(rPwd);
    if (!strength.ok) {
      setRPasswordError(strength.reason ?? "Use a stronger password.");
      toast({ title: "Weak password", description: strength.reason, variant: "destructive" });
      return;
    }
    if (rPwd !== rPwd2) {
      setRPasswordError("Please retype the same password in both fields.");
      toast({
        title: "Passwords don't match",
        description: "Please retype the same password in both fields.",
        variant: "destructive",
      });
      return;
    }
    setRPasswordError(null);
    try {
      const res = await resetPwd.mutateAsync({ password: rPwd, user_id: resetTarget.user_id });
      toast({
        title: "Password reset",
        description: `${resetTarget.email} (${res.updated}/${res.total}).`,
      });
      closeReset();
    } catch (e: any) {
      setRPasswordError(describePasswordError(e?.message));
      toast({
        title: "Reset failed",
        description: describePasswordError(e?.message),
        variant: "destructive",
      });
    }
  };

  // ── Reset ALL passwords (admin only) ─────────────────────
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [aPwd, setAPwd] = useState("");
  const [aPwd2, setAPwd2] = useState("");
  const [aConfirm, setAConfirm] = useState(false);
  const [aShow, setAShow] = useState(false);
  const [aPasswordError, setAPasswordError] = useState<string | null>(null);

  const closeResetAll = () => {
    setResetAllOpen(false);
    setAPwd("");
    setAPwd2("");
    setAConfirm(false);
    setAShow(false);
    setAPasswordError(null);
  };

  const handleResetAll = async () => {
    const strength = checkPasswordStrength(aPwd);
    if (!strength.ok) {
      setAPasswordError(strength.reason ?? "Use a stronger password.");
      toast({ title: "Weak password", description: strength.reason, variant: "destructive" });
      return;
    }
    if (aPwd !== aPwd2) {
      setAPasswordError("Please retype the same password in both fields.");
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (!aConfirm) {
      toast({
        title: "Confirmation required",
        description: "Please tick the confirmation checkbox.",
        variant: "destructive",
      });
      return;
    }
    setAPasswordError(null);
    try {
      const res = await resetPwd.mutateAsync({ password: aPwd });
      toast({
        title: "All passwords reset",
        description: `${res.updated}/${res.total} operator account(s) updated.`,
      });
      closeResetAll();
    } catch (e: any) {
      setAPasswordError(describePasswordError(e?.message));
      toast({
        title: "Reset failed",
        description: describePasswordError(e?.message),
        variant: "destructive",
      });
    }
  };

  // ── Copy email to clipboard ──────────────────────────────
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopyEmail = async (acc: OperatorLineAccount) => {
    await navigator.clipboard.writeText(acc.email);
    setCopiedId(acc.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Map line_id → name
  const lineNameMap = useMemo(() => {
    const m = new Map<string, string>();
    lines?.forEach((l) => m.set(l.id, l.name));
    return m;
  }, [lines]);

  const fillGeneratedPassword = async (target: "create" | "single" | "all") => {
    const next = generateStrongPassword();
    if (target === "create") {
      setCPassword(next);
      setCPasswordError(null);
      setCShowPwd(true);
    } else if (target === "single") {
      setRPwd(next);
      setRPwd2(next);
      setRPasswordError(null);
      setRShow(true);
    } else {
      setAPwd(next);
      setAPwd2(next);
      setAPasswordError(null);
      setAShow(true);
    }

    try {
      await navigator.clipboard.writeText(next);
      toast({ title: "Strong password generated", description: "Copied to clipboard." });
    } catch {
      toast({ title: "Strong password generated", description: "Copy it before closing this dialog." });
    }
  };

  // ── Auto-create missing tablets (one per line) ───────────
  const DEFAULT_TABLET_PASSWORD = "Tablet@AN2026!";
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoResults, setAutoResults] = useState<
    { line_name: string; email: string; status: "created" | "skipped" | "failed"; reason?: string }[]
  >([]);

  const linesWithoutTablet = useMemo(() => {
    if (!lines || !accounts) return [];
    const covered = new Set<string>();
    accounts.forEach((a) => a.line_ids.forEach((id) => covered.add(id)));
    return lines.filter((l) => !covered.has(l.id));
  }, [lines, accounts]);

  const handleAutoCreate = async () => {
    if (linesWithoutTablet.length === 0) return;
    setAutoRunning(true);
    setAutoResults([]);
    const results: typeof autoResults = [];

    for (const line of linesWithoutTablet) {
      const email = buildEmailFromLabel(line.name);
      try {
        await createAcc.mutateAsync({
          email,
          password: DEFAULT_TABLET_PASSWORD,
          label: line.name,
          line_ids: [line.id],
        });
        results.push({ line_name: line.name, email, status: "created" });
      } catch (e: any) {
        const msg = describePasswordError(e?.message ?? "Unknown error");
        const skipped = /already|exists|duplicate/i.test(msg);
        results.push({
          line_name: line.name,
          email,
          status: skipped ? "skipped" : "failed",
          reason: msg,
        });
      }
      setAutoResults([...results]);
    }
    setAutoRunning(false);
    const created = results.filter((r) => r.status === "created").length;
    toast({
      title: "Auto-create finished",
      description: `${created}/${results.length} tablet account(s) created.`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Tablet Stations
            </CardTitle>
            <CardDescription>
              One station per tablet (or tablet group). Each station covers one or more production
              lines and shares the same login across shifts.
            </CardDescription>
            <p className="mt-2 text-xs text-muted-foreground italic">
              Operators don't type an email — they pick their tablet from a dropdown on the login screen.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {linesWithoutTablet.length > 0 && (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setAutoResults([]);
                  setAutoOpen(true);
                }}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Auto-create {linesWithoutTablet.length} missing tablet
                {linesWithoutTablet.length === 1 ? "" : "s"}
              </Button>
            )}
            {isAdmin && accounts && accounts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetAllOpen(true)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <ShieldAlert className="h-4 w-4 mr-2" />
                Reset All Passwords
              </Button>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Account
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !accounts?.length ? (
          <div className="rounded-md border border-dashed py-10 text-center">
            <Users className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
            <p className="text-sm text-muted-foreground">
              No operator accounts yet. Create one to assign a tablet to specific lines.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Icon</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Lines covered</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => (
                <TableRow key={acc.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="py-3">
                    <OperatorAccountFaviconCell acc={acc} />
                  </TableCell>
                  <TableCell className="py-3 font-medium">{acc.label}</TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-wrap gap-1">
                      {acc.line_ids.length === 0 ? (
                        <Badge variant="outline">None</Badge>
                      ) : (
                        acc.line_ids.map((id) => (
                          <Badge
                            key={id}
                            variant={acc.line_ids.length > 1 ? "default" : "secondary"}
                          >
                            {lineNameMap.get(id) ?? "Unknown"}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {format(new Date(acc.created_at), "PP")}
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Copy login email (used by the tablet)"
                        onClick={() => handleCopyEmail(acc)}
                      >
                        {copiedId === acc.id ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Reset password"
                        onClick={() => setResetTarget(acc)}
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit lines"
                        onClick={() => openEdit(acc)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* ── Create Dialog ────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (!o) {
            resetCreateForm();
            setCreateOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" /> Create Operator Account
            </DialogTitle>
            <DialogDescription>
              One account per tablet (or tablet/line group). Use the same operator password across
              all tablets for simplicity.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Label
              </Label>
              <Input
                placeholder="e.g. Tablet 5A+5B"
                value={cLabel}
                onChange={(e) => handleLabelChange(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Email
              </Label>
              <Input
                placeholder="operator.tablet-5a-5b@anmaisys.local"
                value={cEmail}
                onChange={(e) => {
                  setCEmail(e.target.value);
                  setCEmailManuallyEdited(true);
                }}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Auto-generated from label. You can edit it manually before creating.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Password
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fillGeneratedPassword("create")}
                className="w-full justify-start"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                Generate strong password
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type={cShowPwd ? "text" : "password"}
                  placeholder="At least 8 chars, not a common word"
                  value={cPassword}
                  onChange={(e) => {
                    setCPassword(e.target.value);
                    setCPasswordError(null);
                  }}
                  aria-invalid={!!cPasswordError}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCShowPwd((s) => !s)}
                >
                  {cShowPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {cPasswordError && <p className="text-xs text-destructive">{cPasswordError}</p>}
              <p className="text-xs text-muted-foreground">
                Avoid common words like line1, tablet5a, operator123 or reused passwords.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Lines covered ({cLineSet.size} selected)
              </Label>
              <LineCheckboxGrid lines={lines} selected={cLineSet} onToggle={toggleCreateLine} />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetCreateForm();
                setCreateOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createAcc.isPending}>
              {createAcc.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Dialog ──────────────────────────────────── */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" /> Edit Operator Account
            </DialogTitle>
            <DialogDescription>
              Update the label, login email and the lines this tablet account is allowed to operate.
              Changing the email will force any tablet currently logged in with the old email to log
              in again.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Login email
                </Label>
                <Input
                  type="email"
                  value={eEmail}
                  onChange={(e) => {
                    setEEmail(e.target.value);
                    setEEmailError(null);
                  }}
                  className="font-mono text-sm"
                  placeholder="operator.line1@anmaisys.local"
                  aria-invalid={!!eEmailError}
                />
                {eEmailError && <p className="text-xs text-destructive">{eEmailError}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Label
                </Label>
                <Input value={eLabel} onChange={(e) => setELabel(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Lines covered ({eLineSet.size} selected)
                </Label>
                <LineCheckboxGrid lines={lines} selected={eLineSet} onToggle={toggleEditLine} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateAcc.isPending || updateEmail.isPending}
            >
              {(updateAcc.isPending || updateEmail.isPending) && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Single Password Dialog ─────────────────── */}
      <Dialog open={resetTarget !== null} onOpenChange={(o) => !o && closeReset()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Reset Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for{" "}
              <span className="font-mono text-xs">{resetTarget?.email}</span>. Remember to update
              the tablet using this account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                New password
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fillGeneratedPassword("single")}
                className="w-full justify-start"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                Generate strong password
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type={rShow ? "text" : "password"}
                  value={rPwd}
                  onChange={(e) => {
                    setRPwd(e.target.value);
                    setRPasswordError(null);
                  }}
                  placeholder="At least 8 chars, not a common word"
                  aria-invalid={!!rPasswordError}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setRShow((s) => !s)}
                >
                  {rShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {rPasswordError && <p className="text-xs text-destructive">{rPasswordError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Confirm new password
              </Label>
              <Input
                type={rShow ? "text" : "password"}
                value={rPwd2}
                onChange={(e) => {
                  setRPwd2(e.target.value);
                  setRPasswordError(null);
                }}
                placeholder="Retype password"
                aria-invalid={!!rPasswordError}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeReset}>
              Cancel
            </Button>
            <Button onClick={handleResetSingle} disabled={resetPwd.isPending}>
              {resetPwd.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset ALL Passwords AlertDialog ──────────────── */}
      <AlertDialog open={resetAllOpen} onOpenChange={(o) => !o && closeResetAll()}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" /> Reset ALL Operator Passwords
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will update the password for{" "}
              <strong>every operator account</strong> ({accounts?.length ?? 0} total). All paired
              tablets will need to log in again with the new password.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                New password
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fillGeneratedPassword("all")}
                className="w-full justify-start"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                Generate strong password
              </Button>
              <div className="flex items-center gap-2">
                <Input
                  type={aShow ? "text" : "password"}
                  value={aPwd}
                  onChange={(e) => {
                    setAPwd(e.target.value);
                    setAPasswordError(null);
                  }}
                  placeholder="At least 8 chars, not a common word"
                  aria-invalid={!!aPasswordError}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setAShow((s) => !s)}
                >
                  {aShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {aPasswordError && <p className="text-xs text-destructive">{aPasswordError}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Confirm new password
              </Label>
              <Input
                type={aShow ? "text" : "password"}
                value={aPwd2}
                onChange={(e) => {
                  setAPwd2(e.target.value);
                  setAPasswordError(null);
                }}
                placeholder="Retype password"
                aria-invalid={!!aPasswordError}
              />
            </div>
            <Label className="flex items-start gap-2 cursor-pointer rounded-md border bg-muted/20 p-3">
              <Checkbox
                checked={aConfirm}
                onCheckedChange={(v) => setAConfirm(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs">
                I understand this will reset the password for ALL operator accounts and I will
                update each tablet manually.
              </span>
            </Label>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeResetAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleResetAll();
              }}
              disabled={resetPwd.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetPwd.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Reset All Passwords
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Auto-create missing tablets Dialog ───────────── */}
      <Dialog
        open={autoOpen}
        onOpenChange={(o) => {
          if (autoRunning) return;
          setAutoOpen(o);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-amber-500" /> Auto-create Tablet Stations
            </DialogTitle>
            <DialogDescription>
              One tablet account will be created per production line that doesn't have one yet,
              using the same default password. Change each password individually afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium mb-1">Default password (same for all):</div>
              <code className="font-mono text-xs bg-background px-2 py-1 rounded border">
                {DEFAULT_TABLET_PASSWORD}
              </code>
              <p className="text-xs text-muted-foreground mt-2">
                Write it down — you'll need it to log in on each tablet. Then use{" "}
                <strong>Reset password</strong> per station to change it.
              </p>
            </div>

            {autoResults.length === 0 ? (
              <>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Lines without a tablet ({linesWithoutTablet.length})
                </Label>
                <div className="rounded-md border max-h-64 overflow-y-auto divide-y">
                  {linesWithoutTablet.map((l) => (
                    <div key={l.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm font-medium">{l.name}</span>
                      <code className="font-mono text-xs text-muted-foreground">
                        {buildEmailFromLabel(l.name)}
                      </code>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Results
                </Label>
                <div className="rounded-md border max-h-64 overflow-y-auto divide-y">
                  {autoResults.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{r.line_name}</div>
                        <code className="font-mono text-xs text-muted-foreground truncate block">
                          {r.email}
                        </code>
                        {r.reason && r.status === "failed" && (
                          <p className="text-xs text-destructive mt-0.5">{r.reason}</p>
                        )}
                      </div>
                      <Badge
                        variant={
                          r.status === "created"
                            ? "default"
                            : r.status === "skipped"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                  ))}
                  {autoRunning && autoResults.length < linesWithoutTablet.length && (
                    <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating remaining accounts…
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAutoOpen(false)}
              disabled={autoRunning}
            >
              {autoResults.length > 0 ? "Close" : "Cancel"}
            </Button>
            {autoResults.length === 0 && (
              <Button
                onClick={handleAutoCreate}
                disabled={autoRunning || linesWithoutTablet.length === 0}
                className="bg-amber-500 hover:bg-amber-600 text-white"
              >
                {autoRunning && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Create {linesWithoutTablet.length} account
                {linesWithoutTablet.length === 1 ? "" : "s"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
