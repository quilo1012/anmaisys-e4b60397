import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  audiences, expandOccurrences, formProblems, londonInstant, dayKeyOf, timeOf,
  type InvitablePerson, type MeetingForm, type MyMeeting, type Recurrence, type Scope,
} from "@/lib/meetings";
import { useInvitablePeople, useMeetingActions, useMeetingParticipants, type MeetingInput } from "@/hooks/useMeetings";
import { ScopeDialog } from "./MeetingDetails";

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";
const PRESETS = [15, 30, 60];

interface Props {
  open: boolean;
  onClose: () => void;
  myId: string;
  /** Prefill for a new meeting (an empty slot was clicked). */
  slot?: { day: string; time: string } | null;
  /** The occurrence being edited. */
  editing?: MyMeeting | null;
}

export function MeetingFormDialog({ open, onClose, myId, slot, editing }: Props) {
  const people = useInvitablePeople(open);
  const existing = useMeetingParticipants(open && editing ? editing.id : null);
  const { create, update } = useMeetingActions();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState<string>("30");
  const [customMin, setCustomMin] = useState("45");
  const [location, setLocation] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [until, setUntil] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [askScope, setAskScope] = useState(false);

  // Fill the form each time it opens.
  useEffect(() => {
    if (!open) return;
    setTried(false);
    if (editing) {
      const mins = Math.round((new Date(editing.ends_at).getTime() - new Date(editing.starts_at).getTime()) / 60_000);
      setTitle(editing.title); setDescription(editing.description ?? "");
      setDay(dayKeyOf(editing.starts_at)); setTime(timeOf(editing.starts_at));
      setDuration(PRESETS.includes(mins) ? String(mins) : "custom"); setCustomMin(String(mins));
      setLocation(editing.location ?? ""); setVideoLink(editing.video_link ?? "");
      setRecurrence(editing.recurrence); setUntil(editing.recurrence_until ?? "");
      setPicked([]);
    } else {
      setTitle(""); setDescription(""); setDay(slot?.day ?? dayKeyOf(new Date())); setTime(slot?.time ?? "09:00");
      setDuration("30"); setCustomMin("45"); setLocation(""); setVideoLink("");
      setRecurrence("none"); setUntil(""); setPicked([]);
    }
  }, [open, editing, slot]);

  // The people already in the meeting being edited, without the admin themselves.
  useEffect(() => {
    if (editing && existing.data) setPicked(existing.data.map((p) => p.user_id).filter((id) => id !== myId));
  }, [editing, existing.data, myId]);

  // Someone already invited who has since left the people list still has a name on the chip.
  const allPeople = useMemo(() => {
    const list = [...(people.data ?? [])];
    const known = new Set(list.map((p) => p.user_id));
    for (const p of existing.data ?? []) {
      if (!known.has(p.user_id)) list.push({ user_id: p.user_id, name: p.name, department: null, crew: null, job: null });
    }
    return list;
  }, [people.data, existing.data]);

  const durationMin = duration === "custom" ? Number(customMin) : Number(duration);
  const form: MeetingForm = { title, day, time, durationMin, recurrence, until, participants: picked, videoLink };
  const problems = formProblems(form);
  const occurrences = !editing && problems.length === 0 ? expandOccurrences(day, time, durationMin, recurrence, recurrence === "none" ? null : until).length : null;

  const input = (): MeetingInput => {
    const start = londonInstant(day, time);
    return {
      title: title.trim(), description, location, video_link: videoLink.trim(),
      starts_at: start.toISOString(), ends_at: new Date(start.getTime() + durationMin * 60_000).toISOString(),
      recurrence, recurrence_until: recurrence === "none" ? null : until, participants: picked,
    };
  };

  const save = (scope?: Scope) => {
    setTried(true);
    if (problems.length) return;
    if (editing) {
      if (editing.recurrence !== "none" && !scope) { setAskScope(true); return; }
      update.mutate({ id: editing.id, scope: scope ?? "one", m: input() }, {
        onSuccess: (n) => { toast.success(n > 1 ? `${n} meetings updated` : "Meeting updated"); onClose(); },
        onError: (e) => toast.error(errText(e)),
      });
    } else {
      create.mutate(input(), {
        onSuccess: () => { toast.success(occurrences && occurrences > 1 ? `${occurrences} meetings scheduled` : "Meeting scheduled"); onClose(); },
        onError: (e) => toast.error(errText(e)),
      });
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit meeting" : "New meeting"}</DialogTitle>
          <DialogDescription>Times are UK time (Europe/London).</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mt-title">Title</Label>
            <Input id="mt-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mt-desc">Description</Label>
            <Textarea id="mt-desc" rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mt-day">Date</Label>
              <Input id="mt-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mt-time">Start</Label>
              <Input id="mt-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label>Duration</Label>
              <div className="flex gap-2">
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="60">1 hour</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
                {duration === "custom" && (
                  <Input aria-label="Minutes" type="number" min={5} max={1440} step={5} className="w-20" value={customMin} onChange={(e) => setCustomMin(e.target.value)} />
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mt-loc">Location</Label>
              <Input id="mt-loc" value={location} maxLength={300} placeholder="Office, canteen…" onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mt-link">Video link</Label>
              <Input id="mt-link" type="url" value={videoLink} placeholder="https://teams.microsoft.com/…" onChange={(e) => setVideoLink(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Repeat</Label>
              <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)} disabled={!!editing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Does not repeat</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {recurrence !== "none" && (
              <div className="grid gap-1.5">
                <Label htmlFor="mt-until">Repeat until</Label>
                <Input id="mt-until" type="date" value={until} min={day} disabled={!!editing} onChange={(e) => setUntil(e.target.value)} />
              </div>
            )}
          </div>
          {editing && editing.recurrence !== "none" && (
            <p className="text-xs text-muted-foreground">The repeat pattern is set when the series is created. To change it, cancel the following meetings and schedule a new series.</p>
          )}

          <ParticipantPicker people={allPeople} loading={people.isLoading} error={!!people.error} myId={myId} picked={picked} onChange={setPicked} />

          {tried && problems.length > 0 && (
            <ul className="space-y-0.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive" role="alert">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {occurrences !== null && occurrences > 1 && (
            <p className="text-sm text-muted-foreground">This schedules {occurrences} meetings{occurrences === 366 ? " (the most one series can hold)" : ""}.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => save()} disabled={busy || (tried && problems.length > 0)}>
            {busy ? "Saving…" : editing ? "Save changes" : "Schedule"}
          </Button>
        </DialogFooter>

        <ScopeDialog open={askScope} verb="Change" onCancel={() => setAskScope(false)} onChoose={(s) => { setAskScope(false); save(s); }} />
      </DialogContent>
    </Dialog>
  );
}

function ParticipantPicker({ people, loading, error, myId, picked, onChange }: {
  people: InvitablePerson[];
  loading: boolean;
  error: boolean;
  myId: string;
  picked: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const others = useMemo(() => people.filter((p) => p.user_id !== myId), [people, myId]);
  const byId = useMemo(() => new Map(people.map((p) => [p.user_id, p])), [people]);
  const groups = useMemo(() => audiences(others), [others]);
  const matches = q.trim().length === 0 ? [] : others
    .filter((p) => !picked.includes(p.user_id) && p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);

  const add = (ids: string[]) => onChange([...new Set([...picked, ...ids.filter((id) => id !== myId)])]);

  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Participants</legend>
      {error && <p className="text-sm text-destructive">Could not load the people list.</p>}
      <div className="relative">
        <Input aria-label="Search people by name" placeholder={loading ? "Loading people…" : "Search by name"} value={q} onChange={(e) => setQ(e.target.value)} />
        {matches.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
            {matches.map((p) => (
              <li key={p.user_id}>
                <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { add([p.user_id]); setQ(""); }}>
                  <span className="font-medium">{p.name}</span>
                  {p.job && <span className="ml-2 text-xs text-muted-foreground">{p.job}{p.department ? ` · ${p.department}` : ""}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <AddGroup label="Add a department" items={groups.departments} onAdd={add} />
        <AddGroup label="Add a team" items={groups.teams} onAdd={add} />
        <AddGroup label="Add a whole crew" items={groups.crews} onAdd={add} />
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{picked.length} {picked.length === 1 ? "person" : "people"} invited</span>
        {picked.length > 0 && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange([])}>Remove all</button>}
      </div>
      {picked.length > 0 && (
        <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {picked.map((id) => (
            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs">
              {byId.get(id)?.name ?? "…"}
              <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? "person"}`} className="rounded-full p-0.5 hover:bg-background" onClick={() => onChange(picked.filter((x) => x !== id))}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">You are included automatically, as accepted. A team or crew adds the people in it today; anyone who joins later is not added.</p>
    </fieldset>
  );
}

function AddGroup({ label, items, onAdd }: { label: string; items: { key: string; label: string; people: string[] }[]; onAdd: (ids: string[]) => void }) {
  const [value, setValue] = useState<string>("");
  return (
    <Select value={value} onValueChange={(k) => { const g = items.find((i) => i.key === k); if (g) onAdd(g.people); setValue(""); }} disabled={items.length === 0}>
      <SelectTrigger aria-label={label}><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        {items.map((i) => <SelectItem key={i.key} value={i.key}>{i.label} ({i.people.length})</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
