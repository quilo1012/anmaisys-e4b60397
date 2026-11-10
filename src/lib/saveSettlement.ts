/**
 * Saves what the TimeMoto import settled about one employee: the name the file uses, and,
 * when that name is fuller than the one on record, the name itself.
 *
 * The rename can collide with `employees_name_unique_idx`: the import only knows the active
 * roster, and the name may belong to an inactive record or have been taken since. The alias
 * is the part the next import needs, so a taken name is dropped and the alias saved on its
 * own, rather than losing both to one 23505.
 */
export interface Settlement { employeeId: string; sheet_aliases: string; full_name?: string }

type Update = (
  employeeId: string,
  patch: { sheet_aliases: string; full_name?: string },
) => Promise<{ error: { code?: string; message: string } | null }>;

export interface SettlementResult { ok: boolean; renamed: boolean; nameTaken: boolean; message?: string }

export async function saveSettlement(s: Settlement, update: Update): Promise<SettlementResult> {
  const patch = s.full_name ? { sheet_aliases: s.sheet_aliases, full_name: s.full_name } : { sheet_aliases: s.sheet_aliases };
  const { error } = await update(s.employeeId, patch);
  if (!error) return { ok: true, renamed: !!s.full_name, nameTaken: false };
  if (s.full_name && error.code === "23505") {
    const retry = await update(s.employeeId, { sheet_aliases: s.sheet_aliases });
    if (!retry.error) return { ok: true, renamed: false, nameTaken: true };
    return { ok: false, renamed: false, nameTaken: true, message: retry.error.message };
  }
  return { ok: false, renamed: false, nameTaken: false, message: error.message };
}
