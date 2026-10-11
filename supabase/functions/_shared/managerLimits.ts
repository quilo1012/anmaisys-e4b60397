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
 * A ausência de `engineer`, `co_engineer`, `operator` e `employee` é deliberada e é o
 * que um manager gere no dia a dia — ver as regras de atribuição de papel no
 * `update-user` e no `create-user`, que deixam o manager atribuir exactamente esses.
 *
 * O `production_office_admin` esteve de fora até 11/10/2026, e não por decisão: foi
 * acrescentado ao enum da base depois desta lista ser escrita, e ninguém voltou aqui.
 * É quase um admin — tem tudo menos Users, Audit e System — e a consequência não era
 * um ecrã por preencher. O `update-user` deixa um manager pôr uma PALAVRA-PASSE nova
 * em qualquer conta que não esteja protegida; um manager podia escolher a de um
 * production_office_admin, entrar com ela, e ter o sistema quase todo. O
 * `delete-user` lê a mesma lista, por isso também lhe podia apagar a conta.
 */
export const ROLES_ONLY_ADMIN_MAY_TOUCH = [
  "admin",
  "manager",
  "production_office_admin",
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
  production_office_admin: "Production Office Admin",
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

/**
 * O resto do enum: os papéis que um manager gere sem pedir nada a ninguém.
 *
 * Existe para a soma das duas listas poder ser comparada com o enum `app_role`
 * inteiro — ver `umPapelNovoEntraEmTodasAsListas`. Sem ela, um papel novo cai no
 * lado permissivo em silêncio, que é exactamente como o `production_office_admin`
 * ficou desprotegido durante semanas. Com ela, o papel novo não pertence a lista
 * nenhuma e o teste falha no dia em que é acrescentado, que é o único dia em que
 * alguém está a olhar para isto.
 */
export const ROLES_A_MANAGER_MAY_TOUCH = [
  "engineer",
  "co_engineer",
  "operator",
  "employee",
] as const;
