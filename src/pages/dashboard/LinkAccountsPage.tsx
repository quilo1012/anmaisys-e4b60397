import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ModuleHeader } from "@/components/ui/ModuleHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  useLoginLinks, useLoginLinkMutations,
  type UnclaimedEmployee, type UnlinkedLogin, type LinkedEmployee,
} from "@/hooks/useLoginLinks";

const who = (e: UnclaimedEmployee) =>
  [e.full_name, e.employee_ref, e.department].filter(Boolean).join(" · ");

/**
 * Link a login to the person it belongs to.
 *
 * "Which badge is yours?" tells anybody stuck to ask their supervisor, who "has the
 * list". This is the list. A login is linked by a person choosing the record — never by
 * a name match — and the database refuses the cases a choice could still get wrong: a
 * line tablet, a login that is already somebody, a record already claimed. Every link
 * and unlink is in the audit log.
 */
export default function LinkAccountsPage() {
  const { data, isPending, isError, refetch } = useLoginLinks();
  const [filter, setFilter] = useState("");

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <ModuleHeader
          module="People"
          title="Link accounts"
          description="Tell the system which person a login belongs to, so they see their own overtime and attendance."
        />
        {isPending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : isError ? (
          <Card><CardContent className="space-y-3 p-4 text-sm">
            <p>The list could not be loaded.</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </CardContent></Card>
        ) : data.state === "notSetUp" ? (
          <Card><CardContent className="p-4 text-sm">
            Linking accounts is being set up. Once the update is finished, the logins waiting to be linked appear here.
          </CardContent></Card>
        ) : (
          <>
            <Input
              placeholder="Filter by name, email or badge"
              aria-label="Filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Logins not linked to anybody ({data.logins.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.logins.length === 0 && <p className="text-sm text-muted-foreground">Every login is linked.</p>}
                {data.logins
                  .filter((l) => matches(filter, [l.email, l.name]))
                  .map((l) => <LoginRow key={l.user_id} login={l} employees={data.employees} />)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Linked ({data.linked.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.linked
                  .filter((l) => matches(filter, [l.full_name, l.email, l.employee_ref]))
                  .map((l) => <LinkedRow key={l.employee_id} row={l} />)}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function matches(filter: string, fields: (string | null)[]): boolean {
  const f = filter.trim().toLowerCase();
  return !f || fields.some((x) => x?.toLowerCase().includes(f));
}

function LoginRow({ login, employees }: { login: UnlinkedLogin; employees: UnclaimedEmployee[] }) {
  const { link } = useLoginLinkMutations();
  const [chosen, setChosen] = useState<string>(login.suggested_employee_id ?? "");
  const [search, setSearch] = useState("");
  const suggested = employees.find((e) => e.id === login.suggested_employee_id) ?? null;
  const options = useMemo(() => {
    const f = search.trim().toLowerCase();
    const list = f ? employees.filter((e) => who(e).toLowerCase().includes(f)) : employees;
    // Keep the current choice selectable even when the search hides it.
    const current = employees.find((e) => e.id === chosen);
    return current && !list.includes(current) ? [current, ...list] : list;
  }, [employees, search, chosen]);

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="unlinked-login">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{login.name || login.email || "Unnamed login"}</div>
          <div className="text-xs text-muted-foreground">{login.email}</div>
        </div>
        <div className="flex gap-1">{login.roles.map((r) => <Badge key={r} variant="outline">{r}</Badge>)}</div>
      </div>
      {suggested && (
        <p className="text-xs text-muted-foreground">
          Suggested: {who(suggested)} — the only unclaimed record with this login's email or name. Check it is the same person.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input className="sm:w-48" placeholder="Search people" aria-label="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={chosen} onValueChange={setChosen}>
          <SelectTrigger className="flex-1" aria-label="Person"><SelectValue placeholder="Who is this?" /></SelectTrigger>
          <SelectContent>
            {options.slice(0, 200).map((e) => <SelectItem key={e.id} value={e.id}>{who(e)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button
          disabled={!chosen || link.isPending}
          onClick={() => link.mutate(
            { userId: login.user_id, employeeId: chosen },
            {
              onSuccess: () => toast.success("Linked"),
              onError: (e) => toast.error((e as Error).message || "Could not link"),
            },
          )}
        >
          Link
        </Button>
      </div>
    </div>
  );
}

function LinkedRow({ row }: { row: LinkedEmployee }) {
  const { unlink } = useLoginLinkMutations();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm" data-testid="linked-row">
      <div>
        <div className="font-medium">{row.full_name}{row.employee_ref ? ` · ${row.employee_ref}` : ""}</div>
        <div className="text-xs text-muted-foreground">{row.email}</div>
      </div>
      <Button
        variant={confirming ? "destructive" : "outline"} size="sm" disabled={unlink.isPending}
        onClick={() => {
          if (!confirming) { setConfirming(true); return; }
          unlink.mutate(row.employee_id, {
            onSuccess: () => toast.success("Unlinked"),
            onError: (e) => toast.error((e as Error).message || "Could not unlink"),
            onSettled: () => setConfirming(false),
          });
        }}
      >
        {confirming ? "Confirm unlink" : "Unlink"}
      </Button>
    </div>
  );
}
