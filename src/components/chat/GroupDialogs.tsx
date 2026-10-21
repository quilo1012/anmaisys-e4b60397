import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Search, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChatAvatar } from "@/components/chat/ChatAvatar";
import { usePresenceOf } from "@/hooks/useCommunicationPresence";
import {
  uploadWithProgress, useAddMembers, useCreateGroup, useEligibleMembers, useGroupPeople, useGroupScope,
  useRemoveMember, useSetMemberRole, useUpdateGroup, type ChatPerson, type GroupSummary,
} from "@/hooks/useChat";
import { avatarProblem, fileType } from "@/lib/chat";
import { cn } from "@/lib/utils";

/** The database's refusal, in the database's words — they are written for people. */
function say(e: unknown, fallback: string) {
  const m = (e as { message?: string })?.message;
  return m && !/^(JWT|fetch|Failed to fetch)/i.test(m) ? m : fallback;
}

function PeoplePicker({ people, loading, chosen, onToggle }: {
  people: ChatPerson[]; loading: boolean; chosen: Set<string>; onToggle: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const shown = people.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person" aria-label="Find a person" className="h-9 pl-8" />
      </div>
      <div className="max-h-56 overflow-y-auto rounded-md border">
        {loading ? (
          <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : shown.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{people.length ? "Nobody matches." : "Nobody else with a login in this department or crew."}</p>
        ) : (
          shown.map((p) => (
            <label key={p.user_id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/60">
              <Checkbox checked={chosen.has(p.user_id)} onCheckedChange={() => onToggle(p.user_id)} aria-label={p.name} />
              <ChatAvatar name={p.name} path={p.avatar_path} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.name}</span>
                {p.job && <span className="block truncate text-2xs text-muted-foreground">{p.job}</span>}
              </span>
            </label>
          ))
        )}
      </div>
      <p className="text-2xs text-muted-foreground">{chosen.size} chosen</p>
    </div>
  );
}

/**
 * A new department or team group. What it offers is what the database allows this
 * person: their own departments (all of them, for an admin), and the active people
 * of that department and crew. The database checks it all again.
 */
export function CreateGroupDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void;
}) {
  const scope = useGroupScope(open);
  const [kind, setKind] = useState<"department" | "team">("department");
  const [department, setDepartment] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const create = useCreateGroup();
  const eligible = useEligibleMembers(department, kind === "team" ? team : null);
  const teams = scope.data?.find((s) => s.department === department)?.teams ?? [];

  useEffect(() => {
    if (!open) return;
    setKind("department"); setTeam(null); setName(""); setDescription(""); setChosen(new Set());
    setDepartment(null);
  }, [open]);
  useEffect(() => {
    if (!department && scope.data?.length === 1) setDepartment(scope.data[0].department);
  }, [scope.data, department]);
  useEffect(() => { setChosen(new Set()); }, [department, team, kind]);
  useEffect(() => {
    if (!name || name === department || teams.some((t) => name === `${department} · ${t}`)) {
      setName(department ? (kind === "team" && team ? `${department} · ${team}` : department) : "");
    }
  }, [department, team, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!department && name.trim().length >= 2 && (kind === "department" || !!team);
  const submit = async () => {
    try {
      const id = await create.mutateAsync({
        kind, name: name.trim(), department: department!, team: kind === "team" ? team : null,
        description, members: [...chosen],
      });
      toast.success(`${name.trim()} created`);
      onOpenChange(false);
      onCreated(id);
    } catch (e) {
      toast.error(say(e, "The group could not be created"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>For a department you run, or one crew of it.</DialogDescription>
        </DialogHeader>
        {scope.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        ) : (scope.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No department is on file as yours. Your login needs an employee record with a department, or people
            whose Manager is you. Ask the office to set it.
          </p>
        ) : (
          <div className="space-y-4">
            <div role="radiogroup" aria-label="Group type" className="grid grid-cols-2 gap-2">
              {(["department", "team"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                  className={cn("rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    kind === k ? "border-primary bg-primary/5" : "hover:bg-muted/60")}>
                  <span className="block font-medium">{k === "department" ? "Department" : "Team"}</span>
                  <span className="block text-2xs text-muted-foreground">{k === "department" ? "Everyone in a department" : "One crew of a department"}</span>
                </button>
              ))}
            </div>
            <div className={cn("grid gap-3", kind === "team" && "sm:grid-cols-2")}>
              <div className="space-y-1.5">
                <Label htmlFor="grp-dept">Department</Label>
                <Select value={department ?? undefined} onValueChange={setDepartment}>
                  <SelectTrigger id="grp-dept"><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>{scope.data!.map((s) => <SelectItem key={s.department} value={s.department}>{s.department}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {kind === "team" && (
                <div className="space-y-1.5">
                  <Label htmlFor="grp-team">Crew</Label>
                  <Select value={team ?? undefined} onValueChange={setTeam} disabled={!department || teams.length === 0}>
                    <SelectTrigger id="grp-team"><SelectValue placeholder={department && teams.length === 0 ? "No crews on file" : "Choose"} /></SelectTrigger>
                    <SelectContent>{teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grp-name">Name</Label>
              <Input id="grp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grp-desc">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="grp-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
            </div>
            {department && (kind === "department" || team) && (
              <div className="space-y-1.5">
                <Label>Members</Label>
                <PeoplePicker people={eligible.data ?? []} loading={eligible.isLoading} chosen={chosen}
                  onToggle={(id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || create.isPending}>
            {create.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who is in a group, and — for its managers — adding, removing, renaming, its photo. */
export function GroupInfoSheet({ group, open, onOpenChange, meId, isAdmin }: {
  group: GroupSummary; open: boolean; onOpenChange: (o: boolean) => void; meId: string; isAdmin: boolean;
}) {
  const people = useGroupPeople(open ? group.id : null);
  // Shown, never enforced: members are written to whatever their status says.
  const { statuses: presence } = usePresenceOf((people.data ?? []).map((p) => p.user_id));
  const manages = isAdmin || group.my_role === "manager";
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const eligible = useEligibleMembers(open && adding ? group.department : null, group.team);
  const add = useAddMembers();
  const remove = useRemoveMember();
  const setRole = useSetMemberRole();
  const update = useUpdateGroup();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const photo = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { setName(group.name); setDescription(group.description ?? ""); setAdding(false); setChosen(new Set()); }, [group.id, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const inGroup = useMemo(() => new Set((people.data ?? []).map((p) => p.user_id)), [people.data]);
  const addable = (eligible.data ?? []).filter((p) => !inGroup.has(p.user_id));

  const changePhoto = async (f: File | undefined) => {
    if (!f) return;
    const problem = avatarProblem(f);
    if (problem) { toast.error(problem); return; }
    setUploading(true);
    try {
      const ext = fileType(f) === "image/png" ? "png" : fileType(f) === "image/webp" ? "webp" : "jpg";
      const path = `groups/${group.id}/${crypto.randomUUID()}.${ext}`;
      await uploadWithProgress("avatars", path, f, () => {});
      await update.mutateAsync({ groupId: group.id, name: group.name, description: group.description ?? "", avatarPath: path });
      toast.success("Group photo changed");
    } catch (e) {
      toast.error(say(e, "The photo could not be changed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5 text-left">
          <div className="flex items-center gap-4">
            <div className="relative">
              <ChatAvatar name={group.name} path={group.avatar_path} size="lg" group />
              {manages && (
                <>
                  <input ref={photo} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { changePhoto(e.target.files?.[0]); e.target.value = ""; }} />
                  <button type="button" onClick={() => photo.current?.click()} disabled={uploading}
                    className="absolute -bottom-1 -right-1 rounded-full border bg-background p-1.5 shadow-sm hover:bg-muted" aria-label="Change group photo">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  </button>
                </>
              )}
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate">{group.name}</SheetTitle>
              <SheetDescription>
                {group.kind === "team" ? `Team · ${group.department} · ${group.team}` : `Department · ${group.department}`}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {manages && (
          <div className="space-y-3 border-b p-5">
            <div className="space-y-1.5">
              <Label htmlFor="gi-name">Name</Label>
              <Input id="gi-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gi-desc">Description</Label>
              <Textarea id="gi-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
            </div>
            <Button size="sm" variant="outline"
              disabled={update.isPending || name.trim().length < 2 || (name === group.name && description === (group.description ?? ""))}
              onClick={async () => {
                try {
                  await update.mutateAsync({ groupId: group.id, name: name.trim(), description, avatarPath: group.avatar_path });
                  toast.success("Saved");
                } catch (e) { toast.error(say(e, "Could not save")); }
              }}>
              Save details
            </Button>
          </div>
        )}
        {!manages && group.description && <p className="border-b p-5 text-sm text-muted-foreground">{group.description}</p>}

        <div className="flex-1 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{people.data?.length ?? group.member_count} members</h3>
            {manages && !adding && (
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setAdding(true)}><UserPlus className="h-3.5 w-3.5" /> Add</Button>
            )}
          </div>
          {adding && (
            <div className="mb-4 space-y-2 rounded-md border p-3">
              <PeoplePicker people={addable} loading={eligible.isLoading} chosen={chosen}
                onToggle={(id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setChosen(new Set()); }}>Cancel</Button>
                <Button size="sm" disabled={chosen.size === 0 || add.isPending} onClick={async () => {
                  try {
                    await add.mutateAsync({ groupId: group.id, members: [...chosen] });
                    toast.success(`${chosen.size} added`);
                    setAdding(false); setChosen(new Set());
                  } catch (e) { toast.error(say(e, "Could not add them")); }
                }}>Add {chosen.size || ""}</Button>
              </div>
            </div>
          )}
          {people.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : people.isError ? (
            <p className="text-sm text-muted-foreground">Members could not be loaded. <button className="underline" onClick={() => people.refetch()}>Try again</button></p>
          ) : (
            <ul className="space-y-1">
              {(people.data ?? []).map((p) => (
                <li key={p.user_id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                  <ChatAvatar name={p.name} path={p.avatar_path} size="sm" status={presence.get(p.user_id) ?? null} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{p.name}{p.user_id === meId && <span className="text-muted-foreground"> (you)</span>}</span>
                    {p.job && <span className="block truncate text-2xs text-muted-foreground">{p.job}</span>}
                  </span>
                  {p.role === "manager" && <span className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary"><ShieldCheck className="h-3 w-3" /> Manager</span>}
                  {isAdmin && p.user_id !== meId && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-2xs" disabled={setRole.isPending}
                      onClick={async () => {
                        try { await setRole.mutateAsync({ groupId: group.id, userId: p.user_id, role: p.role === "manager" ? "member" : "manager" }); }
                        catch (e) { toast.error(say(e, "Could not change the role")); }
                      }}>
                      {p.role === "manager" ? "Make member" : "Make manager"}
                    </Button>
                  )}
                  {manages && p.user_id !== meId && (isAdmin || p.role !== "manager") && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Remove ${p.name}`} disabled={remove.isPending}
                      onClick={async () => {
                        try { await remove.mutateAsync({ groupId: group.id, userId: p.user_id }); toast.success(`${p.name} removed`); }
                        catch (e) { toast.error(say(e, "Could not remove them")); }
                      }}>
                      <UserMinus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-2xs text-muted-foreground">
            Someone removed stops seeing this group, its earlier messages included. Adding them back restores it.
            Changes to who is in the group are recorded.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
