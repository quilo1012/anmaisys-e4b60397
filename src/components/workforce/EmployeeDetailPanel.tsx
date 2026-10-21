import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { shiftPatternConflict } from "@/lib/employeeDirectory";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEPARTMENTS, POSITIONS } from "@/lib/orgNames";

const SHIFT_GROUPS = ["Day", "Night", "Weekend", "Warehouse Day", "Warehouse Weekend"];
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangle, ArrowRight, RotateCcw, Save, UserMinus } from "lucide-react";
import { similarNames } from "@/lib/similarNames";
import { personNameCase } from "@/lib/personName";
import { cn } from "@/lib/utils";
import {
  describeDays, describeSchedule, useEmployeeOvertime, useEmployees, useHeadcountAreas, useMovements,
  useOvertimeEverImported, useShiftPatterns, useShiftHistory, useEmployeeRecordHistory,
  useUpdateEmployee, type Employee,
} from "@/hooks/useWorkforce";

/**
 * One person, in three answers: who they are, where they have been, what they carry.
 *
 * The Details tab is editable because the import left real gaps — fourteen people
 * with no department and seventeen with no shift pattern — and the person who can
 * close those gaps is whoever has this panel open, not whoever next edits a
 * spreadsheet.
 */
export function EmployeeDetailPanel({
  employee, open, onOpenChange, canEdit, accountSection,
}: {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canEdit: boolean;
  /**
   * The Account & Access section's content, from a screen that manages sign-ins (User
   * Management). Without it the section only says whether a sign-in is linked — this
   * panel never shows or handles a password.
   */
  accountSection?: ReactNode | ((leave: (then: () => void) => void) => ReactNode);
}) {
  const { data: patterns } = useShiftPatterns();
  const { data: areas } = useHeadcountAreas();
  const { data: movements, isLoading: loadingMoves } = useMovements(employee?.id ?? null);
  const { data: overtime, isLoading: loadingOT } = useEmployeeOvertime(employee?.id ?? null);
  const { data: overtimeEverImported } = useOvertimeEverImported();
  const { data: colleagues } = useEmployees();
  const shiftHistory = useShiftHistory();
  const recordHistory = useEmployeeRecordHistory(employee?.id ?? null);
  const update = useUpdateEmployee();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [position, setPosition] = useState("");
  const [managerId, setManagerId] = useState<string>("__none__");
  const [employmentType, setEmploymentType] = useState("permanent");
  const [patternId, setPatternId] = useState<string>("__none__");
  const [shiftGroup, setShiftGroup] = useState<string>("__none__");
  const [areaId, setAreaId] = useState<string>("__none__");
  const [askDiscard, setAskDiscard] = useState(false);
  const [afterDiscard, setAfterDiscard] = useState<(() => void) | null>(null);
  const [startedOn, setStartedOn] = useState("");
  const [leftOn, setLeftOn] = useState(() => new Date().toISOString().slice(0, 10));

  // Reset when a different person is opened, so the form never shows the last one's
  // values against this one's name.
  useEffect(() => {
    setFullName(employee?.full_name ?? "");
    setEmail(employee?.email ?? "");
    setDepartment(employee?.department ?? "");
    setPosition(employee?.position ?? "");
    setManagerId(employee?.manager_id ?? "__none__");
    setEmploymentType(employee?.employment_type ?? "permanent");
    setPatternId(employee?.shift_pattern_id ?? "__none__");
    setShiftGroup(employee?.shift_group ?? "__none__");
    setAreaId(employee?.headcount_area_id ?? "__none__");
    setStartedOn(employee?.started_on ?? "");
    setLeftOn(employee?.left_on ?? new Date().toISOString().slice(0, 10));
  }, [
    employee?.id, employee?.full_name, employee?.email,
    employee?.department, employee?.shift_pattern_id, employee?.shift_group, employee?.headcount_area_id,
    employee?.started_on, employee?.left_on,
    employee?.position, employee?.manager_id, employee?.employment_type,
  ]);

  /**
   * Renomear tambem faz duplicados, e faz os piores.
   *
   * O "Add employee" ja pergunta — foi assim que o FELIPE DE ARAUJO e o FELIPE ARAUJO
   * se tornaram dois homens com metade do trabalho cada um. Corrigir um nome aqui
   * chega ao mesmo sitio pela porta do lado: escrever "Felipe Araujo" por cima de
   * "Felipe De Araujo" nao funde as duas fichas, poe o mesmo nome em duas. Mesmo
   * `similarNames`, mesma regra: avisa, nunca recusa, e conta os saidos porque um
   * regresso e uma ficha para reabrir.
   *
   * Acima do `return null` de proposito: um hook a seguir a uma saida antecipada deixa
   * de ser chamado assim que o painel fecha, e a ordem dos hooks muda entre renders.
   */
  const lookalikes = useMemo(() => {
    if (!employee || fullName.trim() === (employee.full_name ?? "").trim()) return [];
    return similarNames(fullName, (colleagues ?? []).filter((c) => c.id !== employee.id)).slice(0, 4);
  }, [fullName, colleagues, employee]);

  if (!employee) return null;

  const dirty =
    fullName !== (employee.full_name ?? "") ||
    email !== (employee.email ?? "") ||
    department !== (employee.department ?? "") ||
    patternId !== (employee.shift_pattern_id ?? "__none__") ||
    shiftGroup !== (employee.shift_group ?? "__none__") ||
    areaId !== (employee.headcount_area_id ?? "__none__") ||
    startedOn !== (employee.started_on ?? "") ||
    position !== (employee.position ?? "") ||
    managerId !== (employee.manager_id ?? "__none__") ||
    employmentType !== (employee.employment_type ?? "permanent");

  const startsAfterLeaving =
    startedOn !== "" && employee.left_on !== null && startedOn > employee.left_on;

  // `full_name` e NOT NULL e e por ele que a folha de headcount encontra a pessoa.
  // Um campo limpo por engano apagaria as duas coisas de uma vez.
  const nameIsBlank = fullName.trim() === "";

  /**
   * A grafia antiga guardada quando o nome muda.
   *
   * A folha de headcount que a fabrica carrega todos os meses encontra as pessoas pelo
   * nome, e o `parseHeadcountWorkbook` le `sheet_aliases` para as grafias que nao
   * batem certo. Corrigir "Dias" para "Rodrigo Dias" aqui, sem mais nada, fazia com
   * que a folha do mes seguinte deixasse de o encontrar e ele caisse em silencio —
   * exactamente os 61 nomes que ja se perderam uma vez por esta razao.
   *
   * Nao guarda nada quando a correccao e so de maiusculas ou de acentos: o
   * `normalise()` do import ja trata "FELIPE ARAUJO" e "Felipe Araújo" como o mesmo,
   * e um alias igual ao nome nao e um alias. Acrescenta, nunca substitui — a mesma
   * regra do dialogo de import, porque quem ja tem duas grafias nao pode perder uma
   * para ganhar a terceira.
   */
  const aliasesKeepingOldSpelling = (): string | undefined => {
    const was = (employee.full_name ?? "").trim();
    const now = fullName.trim();
    const key = (x: string) =>
      x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (was === "" || key(was) === key(now)) return undefined;

    const already = String(employee.sheet_aliases ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (already.some((a) => key(a) === key(was))) return undefined;
    return [...already, was].join(", ");
  };

  /** Cancel: every field back to what is saved. */
  const reset = () => {
    setFullName(employee.full_name ?? "");
    setEmail(employee.email ?? "");
    setDepartment(employee.department ?? "");
    setPosition(employee.position ?? "");
    setManagerId(employee.manager_id ?? "__none__");
    setEmploymentType(employee.employment_type ?? "permanent");
    setPatternId(employee.shift_pattern_id ?? "__none__");
    setShiftGroup(employee.shift_group ?? "__none__");
    setAreaId(employee.headcount_area_id ?? "__none__");
    setStartedOn(employee.started_on ?? "");
  };

  /** Closing with edits that are not saved asks first; closing a clean form does not. */
  const requestClose = (next: boolean) => {
    if (!next && canEdit && dirty) { setAskDiscard(true); return; }
    onOpenChange(next);
  };

  /** Leaves the panel for something else (the sign-in dialog), asking first if there are unsaved edits. */
  const leave = (then: () => void) => {
    if (canEdit && dirty) { setAfterDiscard(() => then); setAskDiscard(true); return; }
    then();
  };

  const patternChosen = (patterns ?? []).find((p) => p.id === patternId) ?? null;
  const shiftConflict = shiftPatternConflict(shiftGroup === "__none__" ? null : shiftGroup, patternChosen);

  const save = () => {
    const keptSpelling = aliasesKeepingOldSpelling();
    update.mutate(
      {
        id: employee.id,
        patch: {
          // Na forma única do nome — o ecrã de criar já a usava, o de editar não, e um
          // nome corrigido aqui com caps lock voltava a ficar "JOAO SPINELLI".
          full_name: personNameCase(fullName),
          // Vazio limpa: um email em branco e a verdade para 186 das 211 pessoas, e
          // uma cadeia vazia guardada no lugar de null le-se como um email que existe.
          email: email.trim() || null,
          ...(keptSpelling ? { sheet_aliases: keptSpelling } : {}),
          department: department.trim() || null,
          shift_pattern_id: patternId === "__none__" ? null : patternId,
          // O turno (Day/Night) e a outra metade da posicao; o painel nao o deixava
          // mudar, e uma pessoa movida de board ficava "Night" com rota de dias.
          shift_group: shiftGroup === "__none__" ? null : shiftGroup,
          // The production line saves with everything else — it used to save the moment
          // it was picked, which made it the one field that ignored Save and Cancel.
          headcount_area_id: areaId === "__none__" ? null : areaId,
          // Empty clears it back to null. A blank start date means nobody recorded
          // one, which is the truth for the fifty imported rows.
          started_on: startedOn || null,
          position: position.trim() || null,
          // Nobody manages themselves, and a chain that loops has no top.
          manager_id: managerId === "__none__" || managerId === employee.id ? null : managerId,
          employment_type: employmentType,
        },
      },
      {
        onSuccess: () =>
          toast.success(
            keptSpelling
              ? `Saved. The headcount sheet can still find them as "${(employee.full_name ?? "").trim()}".`
              : "Saved",
          ),
        onError: (e) => toast.error((e as Error).message || "Could not save"),
      },
    );
  };

  /**
   * Leaving is a soft change, and both fields move together.
   *
   * The row stays: employee_attendance and overtime_entries cascade on delete, so
   * removing someone would take their attendance and their payroll hours with them.
   * active and left_on are set in one patch because either one alone is half a
   * story — a date with the flag still true reads as someone who never left.
   */
  const setLeaver = (hasLeft: boolean) => {
    update.mutate(
      {
        id: employee.id,
        patch: hasLeft ? { active: false, left_on: leftOn } : { active: true, left_on: null },
      },
      {
        onSuccess: () =>
          toast.success(
            hasLeft
              ? `${employee.full_name} marked as left. History and overtime are kept.`
              : `${employee.full_name} is back on the active list.`,
          ),
        onError: (e) => toast.error((e as Error).message || "Could not save"),
      },
    );
  };

  const lineName = employee.headcount_area_id
    ? areas?.find((a) => a.id === employee.headcount_area_id)?.name ?? "—"
    : "Unassigned";
  const total = (overtime ?? []).reduce((s, o) => s + Number(o.hours), 0);

  return (
    <>
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{employee.full_name}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="text-2xs">{lineName}</Badge>
            {employee.source === "import_overtime" && (
              <Badge variant="outline" className="border-warning/40 bg-warning/10 text-2xs text-warning-strong">
                From overtime sheet
              </Badge>
            )}
            {!employee.active && <Badge variant="outline" className="text-2xs">Left</Badge>}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="details" className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="overtime">Overtime</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-4 pt-3">
            {/* Dito, em vez de deduzido dos campos cinzentos.
                Sem permissao, cada campo fica `disabled`, o botao Save desaparece e o
                bloco de saida tambem — e nada dizia porque. Um formulario inteiro
                apagado sem explicacao nao se le como "nao tens permissao", le-se como
                ecra partido, e foi assim que foi reportado. O board do Headcount ja
                diz a sua versao desta frase; esta e a mesma. */}
            {!canEdit && (
              <p className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
                Read-only view — you don't have permission to change employee records.
              </p>
            )}
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-personal">
              <legend id="sec-personal" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Personal & Employment Details</legend>
            <div>
              {/* O nome era so o titulo do painel, e nao havia mais nenhum sitio na app
                  para lhe tocar: o dialogo de "Add employee" pede-o, nenhum ecra o
                  corrige. Quinze dos 211 activos estao em MAIUSCULAS e vinte e tres tem
                  so um nome, todos vindos do import — e cada um deles so se podia
                  corrigir na base de dados. */}
              <Label className="text-xs" htmlFor="wf-name">Full name</Label>
              <Input
                id="wf-name"
                value={fullName}
                disabled={!canEdit}
                onChange={(e) => setFullName(e.target.value)}
                className="text-sm"
              />
              {nameIsBlank && (
                <p className="mt-1 text-2xs text-destructive-strong">
                  A name is required — it is how the headcount sheet finds this person.
                </p>
              )}
              {lookalikes.length > 0 && (
                <div className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-2.5">
                  <p className="flex items-start gap-1.5 text-2xs font-medium text-warning-strong">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {lookalikes[0].strength === "same"
                      ? "Somebody else is already on the record under this name."
                      : lookalikes[0].strength === "close"
                      ? "This is close to somebody else already on the record."
                      : "Somebody else on the record has this word in their name."}
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {lookalikes.map((m) => (
                      <li key={m.id} className="text-2xs">
                        <span className="font-medium">{m.full_name}</span>
                        <span className="text-muted-foreground">
                          {m.shift_group ? ` · ${m.shift_group}` : ""}
                          {m.department ? ` · ${m.department}` : ""}
                          {m.active ? "" : m.left_on ? ` · left ${m.left_on}` : " · left"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-2xs text-muted-foreground">
                    Renaming does not merge two records. If this is the same person twice,
                    the second one has to be marked as left, not renamed.
                  </p>
                </div>
              )}
            </div>
            <div>
              {/* Tambem editavel, pela mesma razao: 186 das 211 pessoas nao tem email
                  nesta tabela, e varias delas tem conta na app com o email a vista no
                  ecra de utilizadores. O campo mostrava "—" e nao havia como o encher. */}
              <Label className="text-xs" htmlFor="wf-email">Email</Label>
              <Input
                id="wf-email"
                type="email"
                value={email}
                disabled={!canEdit}
                placeholder="Not recorded"
                onChange={(e) => setEmail(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="wf-started">Start date</Label>
              <Input
                id="wf-started"
                type="date"
                value={startedOn}
                disabled={!canEdit}
                onChange={(e) => setStartedOn(e.target.value)}
                className="text-sm"
              />
              {startedOn === "" && (
                <p className="mt-1 text-2xs text-muted-foreground">
                  Not recorded — the imported list carried no start dates.
                </p>
              )}
              {startsAfterLeaving && (
                <p className="mt-1 text-2xs text-destructive-strong">
                  This is after the leaving date ({format(new Date(`${employee.left_on}T12:00:00`), "dd/MM/yyyy")}).
                </p>
              )}
            </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-dept">
              <legend id="sec-dept" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Department & Role</legend>
            <div>
              <Label className="text-xs">Department</Label>
              {/* The same seven the headcount areas carry, so a total can be taken
                  across the board and the people list. Free text had fifteen, of which
                  four were job titles — twenty people whose department was
                  "Team Leader" had no department at all while appearing to have one. */}
              <Select
                value={department || "__none__"}
                disabled={!canEdit}
                onValueChange={(v) => setDepartment(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="text-sm"><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Position</Label>
              {/* A list, not a box. Free text gave "Prodcution Operative" twenty-two
                  times against four spelled properly, and grouping by position counted
                  them as two different jobs. */}
              <Select
                value={position || "__none__"}
                disabled={!canEdit}
                onValueChange={(v) => setPosition(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="text-sm"><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not set</SelectItem>
                  {/* Um valor antigo fora da lista aparece na mesma, senao o campo mostrava outra coisa. */}
                  {position && !POSITIONS.includes(position as (typeof POSITIONS)[number]) && (
                    <SelectItem value={position}>{position}</SelectItem>
                  )}
                  {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-2xs text-muted-foreground">
                What they do. Separate from department, which is where they do it.
              </p>
            </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-shift">
              <legend id="sec-shift" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shift & Working Schedule</legend>
            <div>
              <Label className="text-xs">Shift</Label>
              <Select value={shiftGroup} onValueChange={setShiftGroup} disabled={!canEdit}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— not recorded —</SelectItem>
                  {[...new Set([...SHIFT_GROUPS, ...(employee.shift_group ? [employee.shift_group] : [])])].map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-2xs text-muted-foreground">
                Which board they work on. The shift pattern below says which days.
              </p>
              {shiftGroup === "__none__" && (
                <p className="mt-1 text-2xs text-warning-strong">Not set — overtime offers cannot be matched to this person's crew.</p>
              )}
            </div>
            <div>
              <Label className="text-xs">Shift pattern</Label>
              <Select value={patternId} onValueChange={setPatternId} disabled={!canEdit}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— none —</SelectItem>
                  {/* Every pattern is named after its own days, so printing them again
                      gave "Mon–Thu days · Mon, Tue, Wed, Thu" nine times over. The
                      day list is kept only where the name does not already carry it.
                      Ordered by how much of the week they cover, so the full-week and
                      four-day patterns — which is nearly everybody — come first. */}
                  {[...(patterns ?? [])]
                    .sort((a, b) => (b.days?.length ?? 0) - (a.days?.length ?? 0) || a.name.localeCompare(b.name))
                    .map((p) => {
                      const days = describeDays(p.days);
                      const named = days
                        .split(", ")
                        .every((d) => p.name.toLowerCase().includes(d.toLowerCase()));
                      // A rota whose Friday starts three hours later reads as an
                      // ordinary Tue–Fri from its name alone, so the hours are spelled
                      // out whenever a day differs from the rest.
                      const mixed = (p.dayOverrides ?? []).length > 0;
                      return (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {mixed ? ` · ${describeSchedule(p)}` : named ? "" : ` · ${days}`}
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              {patternChosen == null && (
                <p className="mt-1 text-2xs text-warning-strong">Not set — this person is due in every day until a rota is chosen.</p>
              )}
              {shiftConflict && (
                <p role="alert" className="mt-1 flex items-start gap-1.5 text-2xs text-warning-strong">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> Needs review: {shiftConflict}
                </p>
              )}
            </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-line">
              <legend id="sec-line" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production Assignment</legend>
            <div>
              <Label className="text-xs">Usual production line</Label>
              <Select value={areaId} onValueChange={setAreaId} disabled={!canEdit}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not assigned (not on the board)</SelectItem>
                  {(areas ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.kind === "support" ? " · support" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-2xs text-muted-foreground">
                Where the headcount board places them. A day's actual line is set on the board; one day on another
                line is not a change of usual line, and past overtime does not set this either.
              </p>
            </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-supervisor">
              <legend id="sec-supervisor" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Supervisor & Line Leader</legend>
            <div>
              <Label className="text-xs">Reports to</Label>
              <Select value={managerId} onValueChange={setManagerId} disabled={!canEdit}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Nobody recorded" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nobody recorded</SelectItem>
                  {(colleagues ?? [])
                    .filter((c) => c.id !== employee.id && c.active)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name}
                        {c.position && <span className="ml-2 text-2xs text-muted-foreground">{c.position}</span>}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-2xs text-muted-foreground">
              The responsible line leader is set per line, shift and date in User Management → Leaders, not on the
              employee, so it cannot disagree with the board.
            </p>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-account">
              <legend id="sec-account" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account & Access</legend>
            <div className="space-y-2 text-sm">
              {(typeof accountSection === "function" ? accountSection(leave) : accountSection) ?? (
                <p className="text-xs text-muted-foreground">
                  {employee.user_id
                    ? "This person has an app sign-in. Passwords, roles and sign-in status are managed in User Management → Employees."
                    : "No app sign-in is linked to this record. Link one in User Management → Employees."}
                </p>
              )}
            </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-lg border p-3" aria-labelledby="sec-extra">
              <legend id="sec-extra" className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional Information</legend>
            {/* Contract removed from the form: every one of the 194 people reads
                "permanent", so the field has never told anybody apart. The column and
                the value it holds are untouched — this only stops asking a question
                nobody was answering. The Agency count in the department panel reads
                from it and will stay at zero until there is a real way to set it. */}
            {employee.notes && (
              <p className="rounded border bg-muted/30 p-2 text-xs text-muted-foreground">{employee.notes}</p>
            )}
            <p className="text-2xs text-muted-foreground">Nothing else is recorded for this person.</p>
            </fieldset>
            {canEdit && (
              <div className="sticky bottom-0 -mx-1 flex items-center gap-2 border-t bg-background px-1 py-3">
                <Button size="sm" onClick={save} disabled={!dirty || nameIsBlank || startsAfterLeaving || update.isPending}>
                  <Save className="mr-1 h-4 w-4" /> {update.isPending ? "Saving…" : "Save Changes"}
                </Button>
                <Button size="sm" variant="outline" onClick={reset} disabled={!dirty || update.isPending}>
                  Cancel
                </Button>
                {dirty && <span className="text-2xs text-muted-foreground" aria-live="polite">Unsaved changes</span>}
              </div>
            )}

            {canEdit && (
              <div className="mt-2 space-y-2 rounded-lg border border-dashed p-3">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <UserMinus className="h-3.5 w-3.5" /> Leaving the company
                </div>
                {employee.active ? (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-2xs" htmlFor="wf-left-on">Last day</Label>
                        <Input
                          id="wf-left-on"
                          type="date"
                          value={leftOn}
                          onChange={(e) => e.target.value && setLeftOn(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setLeaver(true)}
                        disabled={update.isPending}
                      >
                        Mark as left
                      </Button>
                    </div>
                    <p className="text-2xs text-muted-foreground">
                      They come off the daily board and the headcount from then on, and stay in the
                      records they are already in — a month they worked keeps the days they worked.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label className="text-2xs" htmlFor="wf-left-on-edit">Leaving date</Label>
                        <Input
                          id="wf-left-on-edit"
                          type="date"
                          value={leftOn}
                          onChange={(e) => e.target.value && setLeftOn(e.target.value)}
                          className="h-9 text-sm"
                        />
                      </div>
                      {/* Correcting the date is not the same as bringing them back, so
                          it saves on its own without touching the active flag. */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending || leftOn === (employee.left_on ?? "")}
                        onClick={() =>
                          update.mutate(
                            { id: employee.id, patch: { left_on: leftOn } },
                            {
                              onSuccess: () => toast.success("Leaving date updated"),
                              onError: (e) => toast.error((e as Error).message || "Could not save"),
                            },
                          )
                        }
                      >
                        <Save className="mr-1 h-3.5 w-3.5" /> Save date
                      </Button>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setLeaver(false)} disabled={update.isPending}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reinstate
                    </Button>
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-2 pt-3">
            <h3 className="text-sm font-semibold">Position, shift and rota changes</h3>
            {recordHistory.isError || shiftHistory.isError ? (
              <div className="space-y-2 text-sm">
                <p>Employee history could not be loaded.</p>
                <Button variant="outline" onClick={() => { void recordHistory.refetch(); void shiftHistory.refetch(); }}>Retry</Button>
              </div>
            ) : recordHistory.isLoading || shiftHistory.isLoading ? <Skeleton className="h-24" /> : (
              <>
                {(recordHistory.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No position changes recorded yet.</p>}
                {(recordHistory.data ?? []).map((change) => (
                  <div key={change.id} className="space-y-1 rounded border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">{format(new Date(change.changed_at), "dd/MM/yyyy HH:mm")}</p>
                    {(["position", "shift_group", "shift_pattern_id"] as const).filter((field) => change.before_values[field] !== change.after_values[field]).map((field) => {
                      const label = field === "position" ? "Position" : field === "shift_group" ? "Shift" : "Shift pattern";
                      const show = (value: string | null) => !value ? "Not set" : field === "shift_pattern_id" ? patterns?.find((p) => p.id === value)?.name ?? "Previous rota (no longer listed)" : value;
                      return <p key={field}>{label}: {show(change.before_values[field])} → <strong>{show(change.after_values[field])}</strong></p>;
                    })}
                  </div>
                ))}
                <h3 className="pt-2 text-sm font-semibold">Dated shift and rota history</h3>
                {(shiftHistory.data ?? []).filter((h) => h.employee_id === employee.id).map((h) => (
                  <div key={h.effective_from} className="space-y-1 rounded border p-3 text-sm">
                    <p className="text-xs text-muted-foreground">From {format(new Date(`${h.effective_from}T12:00:00`), "dd/MM/yyyy")}</p>
                    <p>{h.shift_group ?? "No shift"} · {patterns?.find((p) => p.id === h.shift_pattern_id)?.name ?? "No rota listed"}</p>
                    {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
                  </div>
                ))}
              </>
            )}
            <h3 className="pt-2 text-sm font-semibold">Line movements</h3>
            {loadingMoves ? (
              <Skeleton className="h-24" />
            ) : (movements ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No moves recorded yet. History starts the first time someone is moved on the board.
              </p>
            ) : (
              (movements ?? []).map((m) => (
                <div key={m.id} className="flex items-center gap-2 rounded border p-2 text-xs">
                  <span className="whitespace-nowrap text-muted-foreground">
                    {format(new Date(m.moved_at), "dd/MM HH:mm")}
                  </span>
                  <span className="truncate">{m.from_line ?? "Unassigned"}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{m.to_line ?? "Unassigned"}</span>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="overtime" className="space-y-2 pt-3">
            {loadingOT ? (
              <Skeleton className="h-24" />
            ) : (overtime ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {overtimeEverImported === false
                  // Nao e sobre esta pessoa: a tabela esta vazia para toda a gente.
                  // Dizer "for this person" fazia parecer que os outros tinham.
                  ? "No payroll overtime has ever been imported, for anybody. This tab fills in once the office imports a period."
                  : "No overtime recorded for this person."}
              </p>
            ) : (
              <>
                <div className="rounded border p-2">
                  <div className="text-2xs uppercase text-muted-foreground">Across all periods</div>
                  <div className={cn("font-figure text-2xl font-bold", total < 0 && "text-destructive-strong")}>
                    {total}h
                  </div>
                </div>
                {(overtime ?? []).map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-2 rounded border p-2 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{o.period?.label ?? "—"}</div>
                      {o.note && <div className="truncate text-2xs text-muted-foreground">{o.note}</div>}
                    </div>
                    <span className={cn("shrink-0 font-figure font-bold", Number(o.hours) < 0 && "text-destructive-strong")}>
                      {Number(o.hours)}h
                    </span>
                  </div>
                ))}
                <p className="text-2xs text-muted-foreground">
                  A balance, not hours worked: sickness is written off against banked hours, so a negative
                  figure is real.
                </p>
                {/* Said on the screen, not only in a migration: this is a copy, and the
                    factory pays from the sheet it was copied from. */}
                {(overtime ?? [])[0]?.imported_at && (
                  <p className="rounded border bg-muted/40 p-2 text-2xs text-muted-foreground">
                    Imported from the payroll spreadsheet
                    {(overtime ?? [])[0]?.source_note ? ` — ${(overtime ?? [])[0]!.source_note}` : ""}
                    {" · "}
                    {format(new Date((overtime ?? [])[0]!.imported_at as string), "dd/MM/yyyy HH:mm")}.
                    Not calculated here, and not editable here.
                  </p>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
      <AlertDialog open={askDiscard} onOpenChange={(v) => { setAskDiscard(v); if (!v) setAfterDiscard(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have edits to {employee.full_name} that are not saved. Closing now loses them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setAskDiscard(false); reset(); const next = afterDiscard; setAfterDiscard(null); if (next) next(); else onOpenChange(false); }}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default EmployeeDetailPanel;
