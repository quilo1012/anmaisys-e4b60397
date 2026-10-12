import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * As guardas do `link_me_by_employee_ref`, afirmadas onde se podem verificar.
 *
 * Esta função é a única porta por onde um login passa a ser uma pessoa — o BLOCO 81
 * revoga as outras duas de propósito (`overtime_unlinked_names` e
 * `link_me_to_employee`). Tudo o que está a jusante das horas extra pergunta quem
 * somos através do que ela escreve, por isso cada guarda aqui vale por si.
 *
 * O SQL não corre nos testes: nada neste repositório aplica migrações. O que isto
 * guarda é a migração não ser desarmada por distracção antes de ser colada — foi
 * encontrada por rever, a 12/10/2026, com dois defeitos que nunca chegaram a produção
 * só porque o bloco ainda estava por colar.
 */
const SQL = readFileSync(
  resolve(__dirname, "../..", "supabase/migrations/20261010100000_you_say_who_you_are_with_the_number_on_your_badge.sql"),
  "utf8",
);

describe("link_me_by_employee_ref", () => {
  it("recusa-se a correr sem sessão", () => {
    // Sem isto, `auth.uid()` nulo passa as verificações seguintes e a função devolve a
    // ficha do funcionário a quem a pediu.
    expect(SQL).toMatch(/if\s+auth\.uid\(\)\s+is\s+null\s+then/i);
  });

  it("recusa um tablet de linha", () => {
    expect(SQL).toMatch(/operator_line_accounts/);
  });

  it("recusa um login que já é alguém", () => {
    expect(SQL).toMatch(/my_employee_id\(\)\s+is\s+not\s+null/i);
  });

  /**
   * A razão de contar antes de escrever: `update ... returning * into` não se queixa
   * quando o WHERE apanha mais do que uma linha — escreve em todas e devolve a
   * primeira. Dois crachás que só diferem em maiúsculas ou num espaço tornam-se iguais
   * aqui, porque é isso que o `upper(trim(...))` faz.
   */
  it("conta antes de escrever e recusa-se a adivinhar entre duas", () => {
    expect(SQL).toMatch(/select\s+count\(\*\)\s+into\s+v_matches/i);
    expect(SQL).toMatch(/matches more than one record/i);
    expect(SQL.indexOf("count(*) into v_matches")).toBeLessThan(SQL.indexOf("update public.employees"));
  });

  it("só liga linhas activas e por reclamar", () => {
    const upd = SQL.slice(SQL.indexOf("update public.employees"));
    expect(upd.slice(0, 300)).toMatch(/and\s+active/i);
    expect(upd.slice(0, 300)).toMatch(/user_id\s+is\s+null/i);
  });

  /**
   * Uma mensagem só para todas as falhas. Separar "não existe" de "já está ocupado"
   * fazia disto uma forma de descobrir quem já se registou.
   */
  it("não distingue inexistente de ocupado", () => {
    // Só as mensagens que a pessoa lê. O comentário por cima delas EXPLICA a regra
    // nomeando o que não se diz, e um teste que lesse o ficheiro inteiro proibia a
    // explicação em vez do comportamento.
    const ditas = [...SQL.matchAll(/raise exception\s+'((?:''|[^'])*)'/gi)].map((m) => m[1]);
    expect(ditas).toContain("That badge number is not available. Check it, or ask your supervisor.");
    for (const frase of ditas) {
      expect(frase, `uma mensagem que distingue quem já se registou: ${frase}`)
        .not.toMatch(/already (taken|claimed|registered)|no such badge|does not exist/i);
    }
  });

  /**
   * O defeito encontrado a 12/10/2026: a janela de 24h valia na leitura e não na
   * escrita, por isso o contador nunca recomeçava e quem tivesse sido bloqueado uma
   * vez passava a ter UMA tentativa por dia, para sempre.
   */
  it("o contador recomeça quando a falha anterior está fora da janela", () => {
    const upsert = SQL.slice(SQL.indexOf("on conflict (user_id) do update"));
    expect(upsert).toMatch(/case\s+when\s+public\.identity_link_attempts\.last_fail\s*>\s*now\(\)\s*-\s*interval\s*'24 hours'/i);
    expect(upsert).toMatch(/else\s+1/i);
  });

  it("fecha as duas portas antigas, não só o atalho", () => {
    expect(SQL).toMatch(/revoke execute on function public\.overtime_unlinked_names\(\) from authenticated/i);
    expect(SQL).toMatch(/revoke execute on function public\.link_me_to_employee\(uuid\) from authenticated/i);
  });

  it("o contador não é legível por ninguém", () => {
    expect(SQL).toMatch(/revoke all on public\.identity_link_attempts from anon, authenticated/i);
    expect(SQL).toMatch(/enable row level security/i);
  });
});
