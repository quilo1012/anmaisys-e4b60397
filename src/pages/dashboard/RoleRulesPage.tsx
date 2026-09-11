/**
 * Role rules — the sheet a manager hands an auditor.
 *
 * EVERYTHING ON THIS PAGE IS DERIVED FROM THE LIVE MATRIX, NEVER TYPED TWICE. The
 * "Pode" and "Não pode" columns are computed through `roleHolds(role, action)` over
 * `ALL_ACTIONS` / `ACTION_GROUPS` at render time, so the page reflects the matrix as
 * it is right now, including any override loaded from `role_permission_overrides`.
 * A hand-written list of rules would be right the day it is written and a lie the
 * first time somebody edits the matrix. The only hand-written text is `ROLE_SUMMARY`
 * and `ACTION_DESCRIPTIONS` in `permissions.ts`.
 *
 * No editing lives here. Changing something is done on /dashboard/permissions, which
 * only `permissions.manage` reaches; reading this page needs `users.view`, so a
 * manager can show a person what their own profile allows.
 *
 * `?role=engineer` opens that role alone — one sheet for one person.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/DashboardLayout";
import { routeTitles } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { Check, Minus, Printer, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  ACTIVE_ROLES,
  ROLE_SUMMARY,
  can,
  roleDashMap,
  roleTitle,
  subscribeDeviceHidden,
  subscribePermissionOverrides,
  type Role,
} from "@/lib/permissions";
import { countAllowed, deriveRoleRules, type RoleRules, type RuleEntry } from "@/lib/roleRules";

const FACTORY = "Applied Nutrition";

function deviceNote(e: RuleEntry): string | null {
  if (e.hiddenOnTablet && e.hiddenOnMobile) return "só no computador";
  if (e.hiddenOnMobile) return "não no telemóvel";
  if (e.hiddenOnTablet) return "não no tablet";
  return null;
}

function ActionLine({ entry, allowed }: { entry: RuleEntry; allowed: boolean }) {
  const note = deviceNote(entry);
  return (
    <li className="flex items-start gap-2 py-0.5 text-sm print:text-[9.5pt]">
      {allowed ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success print:text-black" aria-hidden />
      ) : (
        <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 print:text-black" aria-hidden />
      )}
      <span className={allowed ? "text-foreground print:text-black" : "text-muted-foreground print:text-black"}>
        {entry.description}
        {entry.customised && (
          <>
            <Badge
              variant="outline"
              className="ml-2 h-4 px-1 align-middle text-[10px] font-semibold uppercase print:border-black print:text-black"
            >
              regra alterada
            </Badge>
            <span className="ml-1.5 text-xs text-muted-foreground print:text-black">
              (por defeito: {entry.defaultAllowed ? "pode" : "não pode"})
            </span>
          </>
        )}
        {allowed && note && <span className="ml-2 text-xs text-muted-foreground print:text-black">({note})</span>}
      </span>
    </li>
  );
}

function RuleColumn({ rules, allowed }: { rules: RoleRules; allowed: boolean }) {
  return (
    <div>
      <h4
        className={
          allowed
            ? "mb-2 text-sm font-semibold uppercase tracking-wide text-success print:text-black"
            : "mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground print:text-black"
        }
      >
        {allowed ? "Pode" : "Não pode"}
      </h4>
      <div className="space-y-3">
        {rules.groups.map((g) => {
          if (!allowed && g.noAccessAtAll) {
            // A group the role holds nothing in is one line, not twenty denials.
            return (
              <div key={g.key} className="text-sm text-muted-foreground print:text-black">
                {g.label} — sem qualquer acesso
              </div>
            );
          }
          const items = allowed ? g.allowed : g.denied;
          if (items.length === 0) return null;
          return (
            <div key={g.key}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground print:text-black">
                {g.label}
              </div>
              <ul className="mt-1">
                {items.map((e) => (
                  <ActionLine key={e.action} entry={e} allowed={allowed} />
                ))}
              </ul>
            </div>
          );
        })}
        {allowed && rules.allowed.length === 0 && (
          <p className="text-sm text-muted-foreground print:text-black">Este perfil não tem qualquer permissão.</p>
        )}
      </div>
    </div>
  );
}

function SignatureBlock() {
  return (
    <div className="hidden print:block mt-6 border-t border-black pt-4 text-[9.5pt] text-black">
      <div className="grid grid-cols-3 gap-6">
        {["Preparado por", "Aprovado por", "Data"].map((label) => (
          <div key={label}>
            <div className="h-8 border-b border-black" />
            <div className="mt-1">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleSheet({ role, generatedOn }: { role: Role; generatedOn: string }) {
  // Derived on every render on purpose: an override arriving after login must move a
  // line from one column to the other without a memo holding yesterday's answer.
  const rules = deriveRoleRules(role);
  const landing = roleDashMap[role];

  return (
    <Card className="print:break-inside-auto print:break-after-page print:border-0 print:shadow-none">
      <CardContent className="space-y-4 p-4 print:p-0">
        <ReportPrintHeader
          title={`Regras do perfil — ${roleTitle[role]}`}
          periodLabel={generatedOn}
          brand={FACTORY}
          className="print-keep"
        />

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl font-bold print:text-black">{roleTitle[role]}</h3>
            <Badge variant="secondary" className="print:border print:border-black print:bg-transparent print:text-black">
              {rules.allowed.length} permissões
            </Badge>
            {rules.customisedCount > 0 && (
              <Badge variant="outline" className="print:border-black print:text-black">
                {rules.customisedCount} regra{rules.customisedCount === 1 ? "" : "s"} alterada
                {rules.customisedCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground print:text-black">{ROLE_SUMMARY[role]}</p>
          <p className="mt-1 text-sm print:text-black">
            <span className="font-medium">Entra em:</span> {routeTitles[landing] ?? landing}
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 print:grid-cols-2">
          <RuleColumn rules={rules} allowed />
          <RuleColumn rules={rules} allowed={false} />
        </div>

        <SignatureBlock />
      </CardContent>
    </Card>
  );
}

export default function RoleRulesPage() {
  const { role: myRole } = useAuth();
  const [params] = useSearchParams();
  const requested = params.get("role");
  const single = ACTIVE_ROLES.includes(requested as Role) ? (requested as Role) : null;
  const shown = single ? [single] : ACTIVE_ROLES;

  // The matrix can change under the page (overrides arrive after login); re-derive.
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const a = subscribePermissionOverrides(bump);
    const b = subscribeDeviceHidden(bump);
    return () => { a(); b(); };
  }, []);


  const generatedOn = format(new Date(), "dd/MM/yyyy");
  const canEdit = can(myRole as Role | null, "permissions.manage");

  return (
    <DashboardLayout>
      <div className="print-content space-y-6 p-4 sm:p-6 print:p-0">
        <div className="print:hidden">
          <BackButton />
        </div>

        <PageHeader
          module="Sistema · Acessos"
          title="Regras dos perfis"
          description="O que cada perfil pode e não pode fazer. Gerado a partir da matriz de permissões em vigor — muda quando a matriz muda."
          icon={<ShieldCheck className="h-5 w-5" />}
          actions={
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" /> Imprimir
              </Button>
              {canEdit && (
                <Button variant="outline" size="sm" asChild>
                  <Link to="/dashboard/permissions">
                    <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Editar permissões
                  </Link>
                </Button>
              )}
            </div>
          }
        />

        {/* The sentence an auditor is owed: this is not a screen-only courtesy. */}
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground print:border-black print:bg-transparent print:text-black">
          Estas regras são aplicadas no ecrã <strong>e na base de dados</strong> (RLS e funções do servidor):
          esconder um botão não é o que trava a acção. Onde uma regra foi alterada localmente em relação ao
          que o sistema traz de origem, a linha leva a marca <em>regra alterada</em> e mostra o valor por defeito.
          Folha de {FACTORY}, produzida a {generatedOn}.
        </p>

        {/* Role chooser — a link per role, so a single sheet has its own URL. */}
        <div className="flex flex-wrap gap-1.5 print:hidden" aria-label="Perfis">
          <Button variant={single ? "outline" : "secondary"} size="sm" asChild>
            <Link to="/dashboard/roles">Todos</Link>
          </Button>
          {ACTIVE_ROLES.map((r) => (
            <Button key={r} variant={single === r ? "secondary" : "outline"} size="sm" asChild>
              <Link to={`/dashboard/roles?role=${r}`}>
                {roleTitle[r]}
                <span className="ml-1.5 text-xs text-muted-foreground">{countAllowed(r)}</span>
              </Link>
            </Button>
          ))}
        </div>

        <div className="space-y-6">
          {shown.map((r) => (
            <RoleSheet key={r} role={r} generatedOn={generatedOn} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
