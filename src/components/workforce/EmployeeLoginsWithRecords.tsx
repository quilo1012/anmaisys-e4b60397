import { useState, type ReactNode } from "react";
import { EmployeeDetailPanel } from "@/components/workforce/EmployeeDetailPanel";
import { EmployeeLoginsTable, type EmployeeLogin } from "@/components/users/EmployeeLoginsTable";
import { useEmployees } from "@/hooks/useWorkforce";

/**
 * User Management → Employees, with the employee records behind it.
 *
 * This is the only place User Management reads `employees`, and it lives here, with the
 * rest of the readers of that table, because the table is closed to everyone but
 * `workforce.view` (see theRosterFollowsItsScreen). The page mounts this ONLY for a role
 * that has it; anybody else gets the logins table with no record columns, never an empty
 * table that reads as "nobody has a record".
 */
export function EmployeeLoginsWithRecords({
  logins, canLinkRecords, canEditRecords, onEditLogin, rowExtras, emptyText, accountSection,
}: {
  logins: readonly EmployeeLogin[];
  canLinkRecords: boolean;
  canEditRecords: boolean;
  /** A login with no record behind it: the account dialog is all there is to edit. */
  onEditLogin: (login: EmployeeLogin) => void;
  rowExtras?: (login: EmployeeLogin) => ReactNode;
  emptyText: string;
  /** Account & Access content for the open record's sign-in. */
  accountSection: (userId: string | null, leave: (then: () => void) => void) => ReactNode;
}) {
  const { data: employees, isLoading, isError } = useEmployees();
  const [recordId, setRecordId] = useState<string | null>(null);
  const open = (employees ?? []).find((e) => e.id === recordId) ?? null;

  return (
    <>
      <EmployeeLoginsTable
        logins={logins}
        // A failed read is not "no records": the record columns are left out and it says so.
        employees={isError ? null : (employees ?? [])}
        canLinkRecords={canLinkRecords}
        canOpenRecords
        isLoadingRecords={isLoading}
        notice={isError ? "The employee records could not be loaded, so department and shift are not shown. Reload to try again." : undefined}
        emptyText={emptyText}
        rowExtras={rowExtras}
        onEdit={(login, record) => { if (record) setRecordId(record.id); else onEditLogin(login); }}
      />
      <EmployeeDetailPanel
        employee={open}
        open={!!open}
        onOpenChange={(v) => { if (!v) setRecordId(null); }}
        canEdit={canEditRecords}
        accountSection={(leave) => accountSection(open?.user_id ?? null, (then) => leave(() => { setRecordId(null); then(); }))}
      />
    </>
  );
}
