/**
 * Até onde chega um manager — uma lista, não duas.
 *
 * O `update-user` e o `delete-user` tinham cada um a sua lista de papéis que um
 * manager não pode tocar, e tinham-nas diferentes: o `update-user` protegia oito
 * papéis, o `delete-user` protegia três. O resultado era que um manager a quem era
 * negado mudar o NOME de um quality_supervisor conseguia APAGAR-LHE a conta inteira.
 *
 * Duas listas da mesma regra divergem sempre. Esta é a regra; os dois sítios leem-na
 * daqui. Acrescentar um papel novo passa a ser uma linha, num sítio só.
 */

/**
 * Papéis cujas contas só um admin pode alterar ou apagar.
 *
 * A ausência de `engineer`, `co_engineer` e `operator` é deliberada e é o que um
 * manager gere no dia a dia — ver as regras de atribuição de papel no `update-user`
 * e no `create-user`, que deixam o manager atribuir exactamente esses três.
 */
export const ROLES_ONLY_ADMIN_MAY_TOUCH = [
  "admin",
  "manager",
  "maintenance_manager",
  "supervisor",
  "quality_supervisor",
  "planner",
  "warehouse",
  "viewer",
] as const;

export type ProtectedRole = (typeof ROLES_ONLY_ADMIN_MAY_TOUCH)[number];

/** Nomes por extenso, para a mensagem de erro não ser uma lista de identificadores. */
const LABELS: Record<ProtectedRole, string> = {
  admin: "Admin",
  manager: "Manager",
  maintenance_manager: "Maintenance Manager",
  supervisor: "Supervisor",
  quality_supervisor: "QC Supervisor",
  planner: "Planner",
  warehouse: "Warehouse",
  viewer: "Viewer",
};

export function isProtectedRole(role: string | null | undefined): boolean {
  return ROLES_ONLY_ADMIN_MAY_TOUCH.includes((role ?? "") as ProtectedRole);
}

/** "Managers cannot <verb> Admin, Manager, … users" — a mesma frase nos dois sítios. */
export function protectedRolesMessage(verb: string): string {
  return `Managers cannot ${verb} ${ROLES_ONLY_ADMIN_MAY_TOUCH.map((r) => LABELS[r]).join(", ")} users`;
}
