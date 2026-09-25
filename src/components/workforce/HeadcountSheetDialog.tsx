import { useEffect, useMemo, useRef, useState } from "react";
// The styled build: `writeFile` from plain `xlsx` drops every fill the workbook carries.
import XLSX from "xlsx-js-style";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { attendanceFromBoard } from "@/lib/attendanceFromBoard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Download, Upload, AlertTriangle, Loader2, ChevronsUpDown, Check, CloudDownload } from "lucide-react";
import { invokeFunction } from "@/lib/invokeFunction";
import { headcountApiToWorkbook, headcountApiSource, type HeadcountApiResponse } from "@/lib/headcountApi";
import {
  buildHeadcountWorkbook, parseHeadcountWorkbook, datesBetween, rowsToImport,
  type ImportPreview, type StandingLeader, type UnmatchedName,
} from "@/lib/headcountSheet";
import { useRotaCover } from "@/hooks/useHeadcount";
import type { HeadcountArea, HeadcountEmployee, Allocation, AllocStatus } from "@/hooks/useHeadcount";

/**
 * Who the sheet meant, chosen by somebody who knows.
 *
 * Searchable rather than a plain list, because "Pedro" offers two people and
 * "Crsitiano" offers two hundred and fifty, and the same control has to do both.
 */
function NamePicker({
  spelling, candidates, roster, value, onChange,
}: {
  spelling: string;
  candidates: { id: string; full_name: string }[];
  roster: HeadcountEmployee[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The shortlist when there is one — the people who actually answer to the name —
  // and everybody after it, because a sheet that spells somebody "Gimenez" is not
  // going to be on any shortlist.
  const shortlist = candidates.length ? candidates : [];
  const rest = roster
    .filter((e) => !shortlist.some((c) => c.id === e.id))
    .map((e) => ({ id: e.id, full_name: e.full_name }));
  const chosen = [...shortlist, ...rest].find((e) => e.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-56 justify-between px-2 text-2xs font-normal">
          <span className={chosen ? "" : "text-muted-foreground"}>
            {chosen ? chosen.full_name : "Who is this?"}
          </span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`“${spelling}” is…`} className="h-8 text-xs" />
          <CommandList className="max-h-56">
            <CommandEmpty>Nobody by that name.</CommandEmpty>
            {shortlist.length > 0 && (
              <CommandGroup heading="Answers to this name">
                {shortlist.map((e) => (
                  <CommandItem key={e.id} value={e.full_name} onSelect={() => { onChange(e.id); setOpen(false); }}>
                    <Check className={`mr-2 h-3 w-3 ${value === e.id ? "opacity-100" : "opacity-0"}`} />
                    {e.full_name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={shortlist.length ? "Everyone else" : "Everyone"}>
              {rest.map((e) => (
                <CommandItem key={e.id} value={e.full_name} onSelect={() => { onChange(e.id); setOpen(false); }}>
                  <Check className={`mr-2 h-3 w-3 ${value === e.id ? "opacity-100" : "opacity-0"}`} />
                  {e.full_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One row per spelling, not per cell: "Pedro" appears on nine days and is one question. */
function bySpelling(unmatched: UnmatchedName[]) {
  const out = new Map<string, { name: string; columns: Set<string>; times: number; otherShift: boolean; candidates: { id: string; full_name: string }[] }>();
  for (const u of unmatched) {
    const row = out.get(u.name) ?? { name: u.name, columns: new Set<string>(), times: 0, otherShift: false, candidates: u.candidates };
    if (u.reason === "otherShift") row.otherShift = true;
    row.columns.add(u.column);
    row.times += 1;
    if (u.candidates.length > row.candidates.length) row.candidates = u.candidates;
    out.set(u.name, row);
  }
  return [...out.values()].sort((a, b) => b.times - a.times);
}

/**
 * The board out to the factory's spreadsheet and back again, over a range of days.
 *
 * Import never writes on the strength of a guess. It shows what it matched and what
 * it could not, and waits — a name it cannot place is listed rather than dropped
 * silently, because a board that is quietly missing three people looks exactly like
 * a board that is right.
 */
export function HeadcountSheetDialog({
  open, onOpenChange, mode, date, shift, areas, roster, canManage, onImported, autoLoad = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "export" | "import";
  /** The day the board is on, used as the default range and the year for bare tabs. */
  date: string;
  shift: string;
  areas: HeadcountArea[];
  roster: HeadcountEmployee[];
  canManage: boolean;
  onImported: () => void;
  /** Opened by "Sync from SharePoint": read the day straight away, no second press. */
  autoLoad?: boolean;
}) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [busy, setBusy] = useState(false);
  // The workbook is kept, not just its first reading: settling one name or saying
  // what the Absence column means has to re-read the same file, and asking somebody
  // to choose the spreadsheet again after every answer is how a screen gets abandoned.
  const [book, setBook] = useState<XLSX.WorkBook | null>(null);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [absenceAs, setAbsenceAs] = useState<AllocStatus | null>(null);
  const [remember, setRemember] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  // Where the loaded sheet came from, when it came from SharePoint rather than a file.
  const [sourceLine, setSourceLine] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  // People created from the sheet in this sitting. The parent's roster query does not
  // know them yet, and a name settled onto somebody the parser cannot find is the same
  // as not settling it — so they are carried here until the screen reloads.
  const [created, setCreated] = useState<HeadcountEmployee[]>([]);
  const [creating, setCreating] = useState(false);
  const rotaCover = useRotaCover();
  const people = useMemo(() => [...roster, ...created], [roster, created]);

  // Which board the import writes to. It starts as the board that is open, and the
  // board that is open is the shift running NOW: before six in the morning that is
  // Night. The company's day sheet, imported first thing, was written onto the Night
  // board whole, and the only sign was "Night shift." at the end of a grey sentence.
  // The file cannot say which shift it is — the tabs are dates — so the dialog shows
  // the target where it cannot be missed, lets it be changed here, and checks it
  // against the people the sheet names (`crewMismatch` below).
  const [target, setTarget] = useState<"Day" | "Night">(shift === "Night" ? "Night" : "Day");
  const [anyway, setAnyway] = useState(false);
  useEffect(() => {
    if (open) { setTarget(shift === "Night" ? "Night" : "Day"); setAnyway(false); }
  }, [open, shift]);

  const preview: ImportPreview | null = useMemo(
    () => book ? parseHeadcountWorkbook(book, {
      areas, roster: people, shift: target, fallbackYear: Number(date.slice(0, 4)),
      assigned, absenceAs: absenceAs ?? undefined,
    }) : null,
    [book, areas, people, target, date, assigned, absenceAs],
  );

  // Most of the people this sheet names work the other shift: it is the other shift's
  // sheet. Import waits until the board is switched or somebody says they mean it.
  const other = target === "Day" ? "Night" : "Day";
  const crewMismatch = !!preview && preview.crews[other] > preview.crews[target];

  const close = () => {
    setBook(null); setAssigned({}); setAbsenceAs(null); setRemember(true); setSourceLine(null);
    setCreated([]);
    onOpenChange(false);
  };

  /**
   * The day/shift on the board, read out of the factory's SharePoint workbook by the
   * reader service and dropped into this same preview. Nothing is saved here: the
   * ordinary Confirm below still decides, so a saved board is never replaced quietly.
   *
   * A reader that is asleep, unreachable or has nothing for the day is said plainly
   * and leaves the manual path exactly as it was.
   */
  const loadFromSharePoint = async () => {
    if (pulling) return;
    setPulling(true);
    try {
      const { data, error } = await invokeFunction<any>("headcount-sharepoint", {
        mode: "date",
        date,
        shift: target === "Night" ? "night" : "day",
      });
      if (error) { toast.error(error.message ?? "Could not reach SharePoint"); return; }
      if (data?.error) { toast.warning(data.message ?? data.error); return; }
      const res = data?.headcount as HeadcountApiResponse | undefined;
      if (!res) { toast.warning("SharePoint returned no headcount for that day."); return; }
      setAssigned({}); setAbsenceAs(null);
      setBook(headcountApiToWorkbook(res));
      setSourceLine(headcountApiSource(res));
      toast.success("Loaded from SharePoint — check it and confirm to save.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPulling(false);
    }
  };

  // Opened straight from "Sync from SharePoint": read the day at once. Guarded by a ref
  // rather than by state, so a second render cannot ask the sleeping reader twice.
  const pulled = useRef(false);
  useEffect(() => {
    if (!open) { pulled.current = false; return; }
    if (!autoLoad || mode !== "import" || pulled.current) return;
    pulled.current = true;
    void loadFromSharePoint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoLoad, mode]);

  /**
   * The names the sheet has and the payroll does not, added as people.
   *
   * Asked for, never automatic: the sheet is typed by hand and a misspelling created as
   * a person is a duplicate somebody has to clean up. Created active, with no crew on
   * file, and settled onto the spelling that made them so the preview places them at
   * once.
   */
  const createMissing = async (names: string[]) => {
    if (!names.length || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("employees")
        .insert(names.map((n) => ({ full_name: n.trim(), active: true, source: "sheet" })) as never)
        .select("id,full_name,shift_group,department,shift_pattern_id,sheet_aliases");
      if (error) throw error;
      const made = (data ?? []) as unknown as HeadcountEmployee[];
      setCreated((prev) => [...prev, ...made]);
      setAssigned((prev) => {
        const next = { ...prev };
        for (const p of made) {
          const spelling = names.find((n) => n.trim() === p.full_name);
          if (spelling) next[spelling] = p.id;
        }
        return next;
      });
      toast.success(`Added ${made.length} ${made.length === 1 ? "person" : "people"} from the sheet`);
    } catch (e) {
      toast.error(`Could not add them: ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  const runExport = async () => {
    setBusy(true);
    try {
      const days = datesBetween(from, to);
      if (days.length === 0 || days.length > 62) {
        toast.error("Choose a range between one day and two months");
        return;
      }
      // Paged. Sixty-two days of a full board is over fifteen hundred rows and
      // PostgREST returns a thousand without a word, so an export of a long range
      // simply lost the last days — and an export that reads back cleanly is exactly
      // how nobody notices.
      const data = await fetchAllRows<any>({
        range: async (a, b) => await (supabase as any)
          .from("daily_allocations")
          .select("*")
          .gte("on_date", from).lte("on_date", to).eq("shift", shift)
          .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
          .range(a, b),
      });

      const byDay = new Map<string, Allocation[]>();
      for (const a of (data ?? []) as unknown as Allocation[]) {
        const key = `${a.on_date}|${a.shift}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key)!.push(a);
      }

      const wb = buildHeadcountWorkbook({
        days: days.map((d) => ({ date: d, shift })),
        areas,
        employeeById: new Map(roster.map((e) => [e.id, e])),
        allocationsFor: (d, s) => byDay.get(`${d}|${s}`) ?? [],
      });
      XLSX.writeFile(wb, `headcount-${shift.toLowerCase()}-${from}-to-${to}.xlsx`);
      toast.success(`Exported ${days.length} day${days.length === 1 ? "" : "s"}`);
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File) => {
    setBusy(true);
    try {
      setAssigned({}); setAbsenceAs(null); setSourceLine(null);
      setBook(XLSX.read(await file.arrayBuffer(), { type: "array" }));
    } catch (e) {
      toast.error(`Could not read the file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The spellings settled by hand, written onto the people they belong to.
   *
   * This is the whole point of asking. The factory's sheet calls Lucas Gloor
   * "LUCAS GLOR" every morning; answering that once and having it asked again next
   * month is the same as not asking. Appended, never replaced — somebody already has
   * two spellings and a third does not cost them the first two.
   */
  const rememberSpellings = async () => {
    const byEmployee = new Map<string, string[]>();
    for (const [spelling, id] of Object.entries(assigned)) {
      const person = roster.find((e) => e.id === id);
      if (!person) continue;
      const already = String(person.sheet_aliases ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const clean = (x: string) => x.trim().toLowerCase();
      if (already.some((a) => clean(a) === clean(spelling))) continue;
      if (clean(person.full_name) === clean(spelling)) continue;
      byEmployee.set(id, [...(byEmployee.get(id) ?? already), spelling]);
    }
    if (byEmployee.size === 0) return;
    const failed: string[] = [];
    for (const [id, aliases] of byEmployee) {
      const { error } = await supabase
        .from("employees")
        .update({ sheet_aliases: aliases.join(", ") } as never)
        .eq("id", id);
      if (error) failed.push(roster.find((e) => e.id === id)?.full_name ?? id);
    }
    if (failed.length) {
      // Said out loud rather than swallowed: the board is placed either way, but a
      // spelling that was answered and not kept will be asked for again next month,
      // and nobody would know why.
      toast.warning(`Imported, but the spelling was not remembered for ${failed.join(", ")} — that needs an admin.`);
    }
  };

  const commit = async () => {
    if (!preview || preview.matched.length === 0) return;
    setBusy(true);
    try {
      // Who leads a column on the days about to be written over.
      //
      // The import writes `area_id` and used to say nothing about the mark, so a sheet
      // that moved the leader of one line onto another carried the mark into a column
      // that already had one — and `daily_allocations_one_leader_per_area` refuses the
      // whole statement, so a month of board failed on a single square. `rowsToImport`
      // decides what each row keeps; this only reads what there is to keep.
      //
      // Paged for the same reason the export is: a two-month range of both boards runs
      // past the thousand rows PostgREST returns without a word, and a leader read off
      // the far side of the cut would look like somebody who leads nothing — which
      // silently takes their line off them.
      const days = [...new Set(preview.matched.map((m) => m.date))];
      const leaders = await fetchAllRows<StandingLeader>({
        range: async (a, b) => await supabase
          .from("daily_allocations")
          .select("on_date,shift,employee_id,area_id")
          .in("on_date", days)
          .eq("is_leader", true)
          .order("on_date", { ascending: true }).order("employee_id", { ascending: true })
          .range(a, b),
      });

      const rows = rowsToImport({ matched: preview.matched, cover: rotaCover, leaders });
      // Upsert on the day/shift/person key the table already enforces, so importing
      // the same sheet twice moves people rather than duplicating them. Anyone
      // already on the day and absent from the file is left alone — the file says
      // what it knows, not what is untrue.
      const { error } = await supabase
        .from("daily_allocations")
        .upsert(rows, { onConflict: "on_date,shift,employee_id" });
      if (error) throw error;

      // The board and the payroll record have to say the same thing.
      //
      // This wrote `daily_allocations` and stopped, so a month imported from the
      // factory's spreadsheet filled the board and left Annual Leave, Attendance and
      // the finance close reading an empty table — a hundred and thirty-five holidays
      // on the board and eleven in the record they are counted from. The dialog that
      // marks one person has always written both; the import that marks a thousand
      // did not, which is the wrong way round.
      // One row per person per day, and working beats being away — the rule lives in
      // `attendanceFromBoard` because it also runs when a single person is marked by
      // hand, and the two copies had already drifted apart twice.
      const attendance = attendanceFromBoard(
        // From `rows`, not the preview: the rota may have turned an assigned row into
        // overtime, and the two records must not disagree about the same day.
        rows.map((r) => ({ employeeId: r.employee_id, date: r.on_date, status: r.status })),
      );
      const { error: attErr } = await (supabase as any)
        .from("employee_attendance")
        .upsert(attendance, { onConflict: "employee_id,on_date" });
      // Not fatal, and said out loud rather than swallowed: the board placement is
      // what was asked for and must not be undone, but a screen quietly disagreeing
      // with the board is the failure this whole change exists to stop.
      if (attErr) {
        toast.warning(`Board imported, but the attendance record did not save: ${attErr.message}`);
      }

      if (remember) await rememberSpellings();

      toast.success(`Imported ${rows.length} allocation${rows.length === 1 ? "" : "s"} onto the ${target} board`);
      onImported();
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "export" ? "Export headcount" : "Import headcount"}</DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? `One sheet per day, in the factory's layout. ${shift} shift.`
              : "Reads the same layout back. Nothing is saved until you confirm."}
          </DialogDescription>
        </DialogHeader>

        {mode === "export" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1" />
              </div>
            </div>
            <Button onClick={runExport} disabled={busy || !from || !to} className="w-full">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export {datesBetween(from, to).length || 0} day(s)
            </Button>
          </div>
        )}

        {mode === "import" && (
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ""; }}
            />
            {!preview && (
              <div className="space-y-2">
                <Button onClick={loadFromSharePoint} disabled={busy || pulling} className="w-full">
                  {pulling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}
                  Load from SharePoint ({target} shift, {date})
                </Button>
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || pulling} className="w-full">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Choose a spreadsheet
                </Button>
                <p className="text-2xs text-muted-foreground">
                  SharePoint fills the preview only. Nothing is saved until you confirm, and the
                  reader can be slow to wake — give it a minute.
                </p>
              </div>
            )}

            {preview && sourceLine && (
              <p className="text-2xs text-muted-foreground">{sourceLine}</p>
            )}

            {preview && (
              <div className={`rounded-md border p-2.5 ${crewMismatch ? "border-destructive/50 bg-destructive/5" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold">Import onto the board of</div>
                  <div className="flex gap-1.5">
                    {(["Day", "Night"] as const).map((k) => (
                      <Button
                        key={k}
                        size="sm"
                        variant={target === k ? "default" : "outline"}
                        className="h-7 px-3 text-xs"
                        onClick={() => { setTarget(k); setAnyway(false); }}
                      >
                        {k} shift
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-2xs text-muted-foreground">
                  The people this sheet names: {preview.crews.Day} on the Day crew, {preview.crews.Night} on the Night crew.
                </p>
                {crewMismatch && (
                  <div className="mt-2 space-y-1.5 text-2xs">
                    <p className="font-semibold text-destructive">
                      This looks like the {other} sheet, and it is about to be written onto the {target} board.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" className="h-7 text-2xs" onClick={() => { setTarget(other); setAnyway(false); }}>
                        Import onto {other} instead
                      </Button>
                      <label className="flex items-center gap-1.5 text-muted-foreground">
                        <input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} />
                        No — these people really are working {target}
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {preview?.absenceColumnFound && (
              // One Absence column on the sheet, two answers on the board. Which one
              // it is belongs to payroll, so it is asked rather than picked quietly —
              // and until it is answered those names are held, not dropped.
              <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
                <div className="text-2xs font-semibold">This sheet has an “Absence” column</div>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  The board keeps sickness and unpaid leave apart. Nobody under that column is
                  imported until you say which it means.
                </p>
                <div className="mt-2 flex gap-2">
                  {(["sick", "unpaid"] as AllocStatus[]).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={absenceAs === k ? "default" : "outline"}
                      className="h-7 text-2xs"
                      onClick={() => setAbsenceAs(absenceAs === k ? null : k)}
                    >
                      {k === "sick" ? "Sickness" : "Unpaid leave"}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-success/40 text-success-strong">
                    {preview.matched.length} matched
                  </Badge>
                  <Badge variant="outline">{preview.days.length} day(s)</Badge>
                  {preview.unmatchedNames.length > 0 && (
                    <Badge variant="outline" className="border-warning/40 text-warning-strong">
                      {preview.unmatchedNames.length} not matched
                    </Badge>
                  )}
                </div>

                {(preview.unmatchedNames.length > 0 || preview.unknownColumns.length > 0 || preview.skippedSheets.length > 0 || preview.otherShiftSheets.length > 0) && (
                  <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border border-warning/30 bg-warning/5 p-2.5 text-2xs">
                    <div className="flex items-center gap-1.5 font-semibold text-warning-strong">
                      <AlertTriangle className="h-3.5 w-3.5" /> These will not be imported
                    </div>
                    {preview.unmatchedNames.length > 0 && (
                      <div>
                        <div className="font-semibold">Names the sheet spells its own way</div>
                        <p className="mt-0.5 text-muted-foreground">
                          Say who each one is and they go in with the rest. One row per spelling,
                          however many days it appears on.
                        </p>
                        <ul className="mt-1.5 space-y-1">
                          {bySpelling(preview.unmatchedNames).map((u) => (
                            <li key={u.name} className="flex items-center justify-between gap-2">
                              <span className="min-w-0 flex-1 truncate">
                                “{u.name}”
                                <span className="text-muted-foreground">
                                  {" "}— {[...u.columns].join(", ")}
                                  {u.times > 1 ? ` (×${u.times})` : ""}
                                </span>
                                {/* The one person who answers to it is on the other crew. Said,
                                    because the picker offering a single name looks like a formality
                                    and this is the row that put the night crew on the day board. */}
                                {u.otherShift && (
                                  <span className="ml-1 font-semibold text-warning-strong">
                                    · only match is on the {other} crew
                                  </span>
                                )}
                              </span>
                              <NamePicker
                                spelling={u.name}
                                candidates={u.candidates}
                                roster={roster}
                                value={assigned[u.name] ?? null}
                                onChange={(id) => setAssigned((prev) => {
                                  const next = { ...prev };
                                  if (id) next[u.name] = id; else delete next[u.name];
                                  return next;
                                })}
                              />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {preview.unknownColumns.length > 0 && (
                      <div>
                        <div className="font-semibold">Columns that are not an area</div>
                        <div className="text-muted-foreground">{preview.unknownColumns.join(", ")}</div>
                      </div>
                    )}
                    {preview.skippedSheets.length > 0 && (
                      <div>
                        <div className="font-semibold">Tabs with no readable date</div>
                        <div className="text-muted-foreground">{preview.skippedSheets.join(", ")}</div>
                      </div>
                    )}
                    {preview.otherShiftSheets.length > 0 && (
                      <div>
                        <div className="font-semibold">Tabs for the other shift</div>
                        <div className="text-muted-foreground">
                          {preview.otherShiftSheets.join(", ")} — switch to the {other} board above to
                          import them.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {preview.matched.length === 0 && preview.unmatchedNames.length === 0 && preview.days.length > 0
                  && preview.unknownColumns.length === 0 && !preview.absenceColumnFound && (
                  // "0 matched" and a disabled button said nothing about why. The usual
                  // reason is a sheet laid out another way: names down the side, or no
                  // row of area names above them.
                  <p className="rounded-md border p-2.5 text-2xs text-muted-foreground">
                    No row of area names was found. The import reads one tab per day, with the
                    areas across a row — “Line 1”, “Hygiene”… — and the names underneath each.
                    Export a day from here to see the layout it expects.
                  </p>
                )}

                {Object.keys(assigned).length > 0 && (
                  <label className="flex items-center gap-2 text-2xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-3 w-3 accent-[hsl(var(--primary))]"
                    />
                    Remember these spellings, so the next import does not ask again
                  </label>
                )}

                <p className="text-2xs text-muted-foreground">
                  Anyone already on these days who is not in the file keeps their place — the
                  file says what it knows, not what is untrue.
                </p>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setBook(null); setSourceLine(null); }} className="flex-1">
                    Start again
                  </Button>
                  <Button variant="outline" onClick={loadFromSharePoint} disabled={busy || pulling} className="flex-1">
                    {pulling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}
                    Refresh from SharePoint
                  </Button>
                  <Button onClick={commit} disabled={busy || !canManage || preview.matched.length === 0 || (crewMismatch && !anyway)} className="flex-1">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Import {preview.matched.length} onto {target}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
