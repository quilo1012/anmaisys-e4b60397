import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/ui/DateField";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ALL, audienceLabel, formFromInstant, formProblems, instantFromForm,
  type AnnouncementInput, type ManagedAnnouncement,
} from "@/lib/announcements";
import { isNotInstalled, useAnnouncementActions, useAudienceOptions, useAudiencePreview } from "@/hooks/useAnnouncements";

const errText = (e: unknown) => isNotInstalled(e)
  ? "Announcements are not switched on yet: BLOCO 164 has to be applied to the database first."
  : (e as { message?: string })?.message ?? "Something went wrong";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The announcement being edited; null for a new one. */
  editing?: ManagedAnnouncement | null;
}

/**
 * Create or edit an announcement. The department and shift lists are the values employees
 * already carry — nothing typed here creates a department or a shift. Once an announcement
 * has gone out, who it is for and when cannot change (the people it reached cannot be
 * un-reached); the form says so and leaves those fields read-only.
 */
export function AnnouncementFormDialog({ open, onClose, editing }: Props) {
  const options = useAudienceOptions(open);
  const { publish, update } = useAnnouncementActions();
  const sent = !!editing?.rung_at;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dept, setDept] = useState(ALL);
  const [shift, setShift] = useState(ALL);
  const [urgent, setUrgent] = useState(false);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("07:00");
  const [hasEnd, setHasEnd] = useState(false);
  const [endDay, setEndDay] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTried(false);
    if (editing) {
      setTitle(editing.title);
      setBody(editing.body);
      setDept(editing.audience_department ?? ALL);
      setShift(editing.audience_shift_group ?? ALL);
      setUrgent(editing.urgent);
      const scheduled = !editing.rung_at && new Date(editing.published_at) > new Date();
      setWhen(scheduled ? "later" : "now");
      const f = formFromInstant(editing.published_at);
      setDay(f.day); setTime(f.time || "07:00");
      setHasEnd(!!editing.expires_at);
      setEndDay(formFromInstant(editing.expires_at).day);
    } else {
      setTitle(""); setBody(""); setDept(ALL); setShift(ALL); setUrgent(false);
      setWhen("now"); setDay(""); setTime("07:00"); setHasEnd(false); setEndDay("");
    }
  }, [open, editing]);

  const department = dept === ALL ? null : dept;
  const shiftGroup = shift === ALL ? null : shift;
  const preview = useAudiencePreview(department, shiftGroup, open);

  const input: AnnouncementInput = useMemo(() => ({
    title, body, department, shiftGroup, urgent,
    publishAt: sent ? editing!.published_at : when === "later" ? instantFromForm(day, time) : null,
    // "Show until" a day: to the end of that day in London.
    expiresAt: hasEnd ? instantFromForm(endDay, "23:59") : null,
  }), [title, body, department, shiftGroup, urgent, sent, editing, when, day, time, hasEnd, endDay]);

  const problems = useMemo(() => {
    const p = formProblems(sent ? { ...input, publishAt: null } : input);
    if (!sent && when === "later" && !input.publishAt) p.unshift("Choose the date and time to publish.");
    if (hasEnd && !input.expiresAt) p.push("Choose the last day it shows, or turn off the end date.");
    return p;
  }, [input, sent, when, hasEnd]);

  const busy = publish.isPending || update.isPending;
  const submit = () => {
    setTried(true);
    if (problems.length) return;
    if (editing) {
      update.mutate({ id: editing.id, input }, {
        onSuccess: () => { toast.success("Announcement updated"); onClose(); },
        onError: (e) => toast.error(errText(e)),
      });
    } else {
      publish.mutate(input, {
        onSuccess: () => { toast.success(when === "later" ? "Announcement scheduled" : "Announcement published"); onClose(); },
        onError: (e) => toast.error(errText(e)),
      });
    }
  };

  const submitLabel = editing ? "Save changes" : when === "later" ? "SCHEDULE ANNOUNCEMENT" : "PUBLISH ANNOUNCEMENT";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit announcement" : "Create announcement"}</DialogTitle>
          <DialogDescription>
            Text only. It appears on the phone of every employee in the department and shift you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ann-title">Announcement title</Label>
            <Input id="ann-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)}
              placeholder="Company Closure – December 12" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ann-body">Message</Label>
            <Textarea id="ann-body" value={body} rows={6} maxLength={4000} onChange={(e) => setBody(e.target.value)}
              placeholder="Please be advised that the company will be closed on December 12." />
            <p className="text-right text-xs tabular-nums text-muted-foreground">{body.length} / 4000</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={dept} onValueChange={setDept} disabled={sent}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {(options.data?.departments ?? []).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Shift</Label>
              <Select value={shift} onValueChange={setShift} disabled={sent}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All shifts</SelectItem>
                  {(options.data?.shifts ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">{audienceLabel(department, shiftGroup)}</p>
              {preview.data && (
                <p className="text-muted-foreground">
                  {preview.data.with_login} {preview.data.with_login === 1 ? "person" : "people"} will receive it in the app.
                  {preview.data.without_login > 0 && ` ${preview.data.without_login} more in this group have no app login and will not see it.`}
                </p>
              )}
            </div>
          </div>
          {sent && (
            <p className="text-xs text-muted-foreground">
              Already sent, so who receives it and when cannot change. To reach different people, withdraw it and publish a new one.
            </p>
          )}

          {!sent && (
            <div className="space-y-2">
              <Label>When</Label>
              <RadioGroup value={when} onValueChange={(v) => setWhen(v as "now" | "later")} className="flex gap-4">
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="now" />Publish now</label>
                <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="later" />Schedule for later</label>
              </RadioGroup>
              {when === "later" && (
                <div className="grid grid-cols-2 gap-2">
                  <DateField value={day} onChange={(v) => setDay(v)} aria-label="Publish date" />
                  <Input type="time" aria-label="Publish time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Stop showing it after a date</span>
              <Switch checked={hasEnd} onCheckedChange={setHasEnd} />
            </label>
            {hasEnd && <DateField value={endDay} onChange={(v) => setEndDay(v)} aria-label="Last day shown" />}
          </div>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Mark as urgent
              <span className="block text-xs text-muted-foreground">Shown in red and sent as a high-priority notification.</span>
            </span>
            <Switch checked={urgent} onCheckedChange={setUrgent} />
          </label>

          {tried && problems.length > 0 && (
            <ul role="alert" className="list-disc space-y-0.5 rounded-lg border border-destructive/40 bg-destructive/5 py-2 pl-7 pr-3 text-sm text-destructive">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="font-semibold">{busy ? "Saving…" : submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
