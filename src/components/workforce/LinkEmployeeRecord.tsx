import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { useLoginLinkMutations } from "@/hooks/useLoginLinks";
import { suggestEmployeeFor, type LinkableEmployee } from "@/lib/employeeAccounts";
import { Check, Link2, Loader2, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Which employee record a floor login is — set by the office.
 *
 * Every login has to resolve to one row of `employees` (`employees.user_id`), or the
 * person's own screens have nobody to show: My Overtime asks "Which badge is yours?",
 * no ask reaches them, and their answers have no one to belong to. The self-service
 * routes for that — the badge number (`link_me_by_employee_ref`) and the email
 * (`link_me_by_email`) — are migrations still waiting to be pasted, so in production
 * the badge box answers "Ask your supervisor to link your account". The screen told
 * people their supervisor could do it, and there was no screen for the supervisor.
 *
 * This is that screen. It links through `link_login_to_employee` and unlinks through
 * `unlink_login_from_employee` — the same two functions the Link accounts page calls,
 * so there is one way into `employees.user_id` and not two.
 *
 * It used to UPDATE the table itself, under `workforce.manage`. That path skipped every
 * rule the function holds: a login already linked to somebody could be given a second
 * person (and `my_employee_id()` would then pick one of the two at random), a shared
 * line tablet could be made into a person, and two supervisors could race. The audit
 * row is written by the function too, so this screen no longer writes its own.
 */
/** One read for the whole table, however many logins it has. */
function useLinkableEmployees() {
  return useQuery({
    queryKey: ["linkable-employees"],
    queryFn: async (): Promise<LinkableEmployee[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, employee_ref, email, department, user_id, active")
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as LinkableEmployee[];
    },
    staleTime: 60 * 1000,
  });
}

export function LinkEmployeeRecord({
  login,
}: {
  login: { id: string; email: string | null; name: string | null };
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: employees = [] } = useLinkableEmployees();
  const onChanged = () => {
    void qc.invalidateQueries({ queryKey: ["linkable-employees"] });
    // The board and the overtime roster read the same rows.
    void qc.invalidateQueries({ queryKey: ["headcount-roster-all"] });
    void qc.invalidateQueries({ queryKey: ["overtime_roster"] });
  };
  const [open, setOpen] = useState(false);
  const { link: linkLogin, unlink: unlinkLogin } = useLoginLinkMutations();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const linked = employees.find((e) => e.user_id === login.id) ?? null;
  const suggestion = useMemo(() => suggestEmployeeFor(login, employees), [login, employees]);
  const free = useMemo(
    () => employees.filter((e) => e.active && !e.user_id).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [employees],
  );

  const link = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      // The function refuses out loud — "already linked to …", "a shared line tablet",
      // "not allowed" — and those refusals are the messages shown.
      await linkLogin.mutateAsync({ userId: login.id, employeeId: chosen });
      const who = employees.find((e) => e.id === chosen)?.full_name ?? "that person";
      toast({ title: "Linked", description: `${login.name ?? login.email} is now ${who}.` });
      setOpen(false);
      onChanged();
    } catch (e) {
      toast({ title: "Could not link", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!linked) return;
    setBusy(true);
    try {
      await unlinkLogin.mutateAsync(linked.id);
      toast({ title: "Unlinked", description: `${linked.full_name} no longer has this login.` });
      onChanged();
    } catch (e) {
      toast({ title: "Could not unlink", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (linked) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-sm">
          {linked.full_name}
          {linked.employee_ref && <span className="ml-1 font-mono text-xs text-muted-foreground">{linked.employee_ref}</span>}
        </span>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Unlink this record" aria-label={`Unlink ${linked.full_name}`} onClick={unlink} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-8 gap-1"
        onClick={() => { setChosen(suggestion?.id ?? null); setOpen(true); }}
      >
        <Link2 className="h-3.5 w-3.5" /> Link record
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which employee is {login.name ?? login.email}?</DialogTitle>
            <DialogDescription>
              Their overtime, attendance and badge all hang off this. Only records without a login are listed.
            </DialogDescription>
          </DialogHeader>
          <Command className="rounded-md border">
            <CommandInput placeholder="Name or employee number" />
            <CommandList className="max-h-64">
              <CommandEmpty>No unlinked employee by that name.</CommandEmpty>
              {suggestion && (
                <CommandGroup heading="Same email or badge as this login">
                  <CommandItem value={`${suggestion.full_name} ${suggestion.employee_ref ?? ""} suggested`} onSelect={() => setChosen(suggestion.id)}>
                    <Check className={cn("mr-2 h-4 w-4", chosen === suggestion.id ? "opacity-100" : "opacity-0")} />
                    {suggestion.full_name}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{suggestion.employee_ref}</span>
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup heading="Employees without a login">
                {free.filter((e) => e.id !== suggestion?.id).map((e) => (
                  <CommandItem key={e.id} value={`${e.full_name} ${e.employee_ref ?? ""} ${e.department ?? ""}`} onSelect={() => setChosen(e.id)}>
                    <Check className={cn("mr-2 h-4 w-4", chosen === e.id ? "opacity-100" : "opacity-0")} />
                    <span>{e.full_name}</span>
                    <span className="ml-auto pl-2 text-right text-xs text-muted-foreground">
                      {e.department ?? ""} <span className="font-mono">{e.employee_ref ?? ""}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={link} disabled={!chosen || busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Link record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
