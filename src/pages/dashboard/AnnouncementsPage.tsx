import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3, Megaphone, MoreVertical, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL, audienceLabel, isRead, percentOf, statusOf, whenLabel,
  type AnnouncementStatus, type ManagedAnnouncement,
} from "@/lib/announcements";
import { isNotInstalled, useAnnouncementActions, useManagedAnnouncements, useMyAnnouncements } from "@/hooks/useAnnouncements";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { AnnouncementFormDialog } from "@/components/announcements/AnnouncementFormDialog";
import { AnnouncementReportDialog } from "@/components/announcements/AnnouncementReportDialog";

const errText = (e: unknown) => isNotInstalled(e)
  ? "Announcements are not switched on yet: BLOCO 164 has to be applied to the database first."
  : (e as { message?: string })?.message ?? "Something went wrong";

const STATUS_TONE: Record<AnnouncementStatus, string> = {
  scheduled: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  live: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  expired: "bg-muted text-muted-foreground",
  withdrawn: "bg-muted text-muted-foreground line-through",
};

/**
 * Employee Announcements (BLOCO 164), at /dashboard/updates — the address the bell rows
 * already carry. Everybody sees the announcements addressed to their department and shift
 * and confirms them; whoever holds `announcements.publish` also gets the Manage tab:
 * create, schedule, edit, withdraw, delete, and the read report.
 */
export default function AnnouncementsPage() {
  const { role } = useAuth();
  const canPublish = can(role, "announcements.publish");
  const [params] = useSearchParams();
  const linked = params.get("a");
  const [tab, setTab] = useState(canPublish && !linked ? "manage" : "mine");

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <PageHeader
          title="Announcements"
          module="Communication"
          icon={<Megaphone className="h-5 w-5" />}
          description={canPublish ? "Send a notice to one department, one shift, or everyone, and see who has read it." : "Notices from the company for your department and shift."}
        />
        {canPublish ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
              <TabsTrigger value="manage">Manage</TabsTrigger>
              <TabsTrigger value="mine">For me</TabsTrigger>
            </TabsList>
            <TabsContent value="manage" className="mt-4"><ManagePanel /></TabsContent>
            <TabsContent value="mine" className="mt-4"><MyList linked={linked} /></TabsContent>
          </Tabs>
        ) : (
          <MyList linked={linked} />
        )}
      </div>
    </DashboardLayout>
  );
}

/** The employee's list: unread first, then read, newest first within each. */
function MyList({ linked }: { linked: string | null }) {
  const q = useMyAnnouncements();
  const list = useMemo(() => {
    const all = q.data ?? [];
    return [...all.filter((a) => !isRead(a)), ...all.filter(isRead)];
  }, [q.data]);
  const linkedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (linked && linkedRef.current) linkedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linked, q.data]);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-sm text-destructive">Could not load the announcements. They will retry on their own.</p>;
  if (list.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        <Megaphone className="mx-auto mb-2 h-6 w-6" aria-hidden />
        No announcements for you right now.
      </div>
    );
  }
  const unread = list.filter((a) => !isRead(a)).length;
  return (
    <div className="space-y-3">
      {unread > 0 && <p className="text-sm font-medium">{unread} new {unread === 1 ? "announcement" : "announcements"} to read</p>}
      {list.map((a) => (
        <AnnouncementCard key={a.id} announcement={a} highlighted={a.id === linked}
          ref={a.id === linked ? (el) => { linkedRef.current = el; } : undefined} />
      ))}
    </div>
  );
}

function ManagePanel() {
  const q = useManagedAnnouncements(true);
  const { withdraw, remove } = useAnnouncementActions();
  const [form, setForm] = useState<{ editing: ManagedAnnouncement | null } | null>(null);
  const [report, setReport] = useState<ManagedAnnouncement | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "withdraw" | "delete"; a: ManagedAnnouncement } | null>(null);

  const doConfirm = () => {
    if (!confirm) return;
    const m = confirm.kind === "withdraw" ? withdraw : remove;
    m.mutate(confirm.a.id, {
      onSuccess: () => { toast.success(confirm.kind === "withdraw" ? "Announcement withdrawn" : "Announcement deleted"); setConfirm(null); },
      onError: (e) => toast.error(errText(e)),
    });
  };

  return (
    <div className="space-y-3">
      <Button onClick={() => setForm({ editing: null })} className="h-11 w-full font-semibold sm:w-auto">
        <Plus className="mr-1.5 h-4 w-4" />Create announcement
      </Button>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && <p className="text-sm text-destructive">Could not load the announcements.</p>}
      {q.data && q.data.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing published yet.</p>
      )}

      <ul className="space-y-3">
        {(q.data ?? []).map((a) => {
          const st = statusOf(a);
          const pct = percentOf(a.acknowledged, a.targeted);
          const noLogin = a.targeted - a.reachable;
          return (
            <li key={a.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[st])}>{STATUS_LABEL[st]}</span>
                    {a.urgent && <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground">Urgent</span>}
                    <span className="text-xs text-muted-foreground">{audienceLabel(a.audience_department, a.audience_shift_group)}</span>
                  </div>
                  <h3 className="font-semibold leading-snug">{a.title}</h3>
                  <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {st === "scheduled" ? "Goes out" : "Published"} {whenLabel(a.published_at)} · by {a.author_name}
                    {a.expires_at && ` · shown until ${whenLabel(a.expires_at)}`}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${a.title}`}><MoreVertical className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setReport(a)}><BarChart3 className="mr-2 h-4 w-4" />Read report</DropdownMenuItem>
                    {st !== "withdrawn" && <DropdownMenuItem onSelect={() => setForm({ editing: a })}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
                    {st !== "withdrawn" && <DropdownMenuItem onSelect={() => setConfirm({ kind: "withdraw", a })}><Undo2 className="mr-2 h-4 w-4" />Withdraw</DropdownMenuItem>}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirm({ kind: "delete", a })}>
                      <Trash2 className="mr-2 h-4 w-4" />Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {st !== "scheduled" && (
                <button type="button" onClick={() => setReport(a)} className="mt-3 block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="mb-1 flex items-baseline justify-between text-xs tabular-nums">
                    <span><span className="font-semibold">{a.acknowledged}</span> of {a.targeted} read · {a.targeted - a.acknowledged} unread</span>
                    <span className="font-semibold">{pct}%</span>
                  </div>
                  <Progress value={pct} className="h-2" aria-label={`${pct}% acknowledged`} />
                  {noLogin > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{noLogin} targeted without an app login</p>}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <AnnouncementFormDialog open={!!form} editing={form?.editing ?? null} onClose={() => setForm(null)} />
      <AnnouncementReportDialog announcement={report} onClose={() => setReport(null)} />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === "withdraw" ? "Withdraw this announcement?" : "Delete this announcement?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "withdraw"
                ? "It disappears from employees' phones straight away. It stays here, with its read report, marked Withdrawn."
                : "It disappears from employees' phones and from this list for good, and so does the record of who read it. To keep that record, withdraw it instead."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); doConfirm(); }}
              className={confirm?.kind === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}>
              {confirm?.kind === "withdraw" ? "Withdraw" : "Delete for good"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
