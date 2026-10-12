/**
 * O nome que o board mostra, e o que o separa de outro igual.
 *
 * O board mostrava o nome como a folha o escreve (`sheet_name`): "LUCAS GLOR",
 * "Gimenez", "Luis F". Lia-se bem para quem conhece a linha e mal para todos os outros,
 * e duas pessoas que a folha escreve da mesma maneira ficavam indistinguíveis no ecrã.
 * Agora mostra o nome do cadastro, que é um por pessoa, e a grafia da folha fica no
 * tooltip.
 *
 * Dois nomes de cadastro iguais no mesmo dia — há homónimos reais — levam o número de
 * funcionário ao lado. Sem número, o departamento; sem nenhum dos dois, o início do id,
 * que é feio mas é único: o que não pode acontecer é duas pessoas parecerem uma.
 */
export interface BoardPerson {
  id: string;
  full_name: string;
  employee_ref?: string | null;
  department?: string | null;
}

const key = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/** Por id: o que escrever ao lado do nome, ou null quando o nome chega sozinho. */
export function disambiguators(people: BoardPerson[]): Map<string, string | null> {
  const seen = new Map<string, Set<string>>();
  for (const p of people) {
    const k = key(p.full_name);
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(p.id);
  }
  const out = new Map<string, string | null>();
  for (const p of people) {
    const twins = seen.get(key(p.full_name))!;
    if (twins.size < 2) { out.set(p.id, null); continue; }
    const ref = p.employee_ref?.trim();
    out.set(p.id, ref ? `#${ref}` : p.department?.trim() || p.id.slice(0, 6));
  }
  return out;
}
