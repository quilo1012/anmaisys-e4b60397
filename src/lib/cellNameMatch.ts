/**
 * Quem pode ser o nome que alguém está a escrever numa célula do board.
 *
 * Como na folha, escreve-se o nome na célula — mas aqui o que se escreve é uma
 * pesquisa, nunca um texto livre: a célula só aceita uma pessoa que existe no cadastro.
 * Um nome escrito à mão e gravado como texto é o "Luis F" que depois ninguém consegue
 * ligar a ninguém.
 *
 * Procura em cada palavra do nome (escrever "gloor" encontra Lucas Gloor), nas grafias
 * da folha (`sheet_aliases`) e no número de funcionário. Os que começam pelo que foi
 * escrito vêm primeiro.
 */
export interface CellCandidate {
  id: string;
  full_name: string;
  employee_ref?: string | null;
  sheet_aliases?: string | null;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function matchCellName<T extends CellCandidate>(typed: string, people: T[], limit = 6): T[] {
  const q = norm(typed);
  if (!q) return [];
  const scored: { p: T; score: number }[] = [];
  for (const p of people) {
    const name = norm(p.full_name);
    const aliases = (p.sheet_aliases ?? "").split(",").map(norm).filter(Boolean);
    const ref = norm(p.employee_ref ?? "");
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 1;
    else if (aliases.some((a) => a.startsWith(q) || a.split(" ").some((w) => w.startsWith(q)))) score = 2;
    else if (ref && ref.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 4;
    if (score >= 0) scored.push({ p, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.p.full_name.localeCompare(b.p.full_name))
    .slice(0, limit)
    .map((x) => x.p);
}
