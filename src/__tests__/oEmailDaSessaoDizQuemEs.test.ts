import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * As guardas do `link_me_by_email`, afirmadas onde se podem verificar.
 *
 * Esta é a terceira porta por onde um login passa a ser uma pessoa, e a única que se
 * abre sozinha — corre quando a página abre, sem ninguém carregar em nada. Uma porta
 * automática merece ser lida com mais cuidado do que as outras duas, não menos.
 *
 * O SQL não corre nos testes: nada neste repositório aplica migrações. O que isto
 * guarda é a migração não ser desarmada por distracção entre agora e a colagem.
 */
const SQL = readFileSync(
  resolve(__dirname, "../..", "supabase/migrations/20261012140000_the_email_you_signed_in_with_says_who_you_are.sql"),
  "utf8",
);

describe("link_me_by_email", () => {
  /**
   * A guarda que decide tudo o resto.
   *
   * Com um argumento, isto era "escreve o email do teu colega e ficas com a ficha
   * dele". Sem argumento, o email vem do JWT que o GoTrue já verificou, e a única
   * forma de reclamar uma ficha é ter entrado com o email que está nela.
   */
  it("não aceita um email como argumento", () => {
    const assinatura = /create or replace function public\.link_me_by_email\(([^)]*)\)/i.exec(SQL);
    expect(assinatura).not.toBeNull();
    expect(assinatura![1].trim()).toBe("");
    expect(SQL).toMatch(/auth\.jwt\(\)\s*->>\s*'email'/);
  });

  it("recusa-se a correr sem sessão", () => {
    expect(SQL).toMatch(/if\s+auth\.uid\(\)\s+is\s+null\s+then/i);
  });

  it("recusa um tablet de linha", () => {
    expect(SQL).toMatch(/operator_line_accounts/);
  });

  it("recusa um login que já é alguém", () => {
    expect(SQL).toMatch(/my_employee_id\(\)\s+is\s+not\s+null/i);
  });

  /**
   * As contas de crachá nascem em `@employee.pmsystem.local`, um domínio onde ninguém
   * recebe nada e que ninguém escolheu. Não é prova de identidade de pessoa nenhuma, e
   * se uma ficha tivesse um endereço desses na coluna `email` isto ligava-os.
   */
  it("não aceita o domínio das contas de crachá", () => {
    expect(SQL).toMatch(/@employee\.pmsystem\.local/);
  });

  it("exige exactamente uma ficha, activa e por reclamar", () => {
    expect(SQL).toMatch(/select\s+count\(\*\)\s+into\s+v_matches/i);
    expect(SQL).toMatch(/v_matches\s*<>\s*1/);
    const upd = SQL.slice(SQL.indexOf("update public.employees"));
    expect(upd.slice(0, 300)).toMatch(/and\s+active/i);
    expect(upd.slice(0, 300)).toMatch(/user_id\s+is\s+null/i);
  });

  /**
   * Isto corre sozinho. Gastar uma das cinco tentativas do crachá por uma coisa que a
   * pessoa não fez era tirar-lhe o recurso de que vai precisar a seguir.
   */
  it("não gasta tentativas do contador do crachá", () => {
    expect(SQL).not.toMatch(/insert into public\.identity_link_attempts/i);
    // Limpar depois de ligar é outra coisa, e essa pode.
    expect(SQL).toMatch(/delete from public\.identity_link_attempts/i);
  });

  it("não é executável por anon", () => {
    expect(SQL).toMatch(/revoke all on function public\.link_me_by_email\(\) from public/i);
    expect(SQL).toMatch(/grant execute on function public\.link_me_by_email\(\) to authenticated/i);
  });
});

describe("as colunas do TimeMoto", () => {
  const COLS = readFileSync(
    resolve(__dirname, "../..", "supabase/migrations/20261012150000_timemoto_is_where_the_number_comes_from.sql"),
    "utf8",
  );

  it("acrescenta sem destruir", () => {
    expect(COLS).toMatch(/add column if not exists timemoto_user_id/i);
    expect(COLS).toMatch(/add column if not exists timemoto_username/i);
  });

  /**
   * Dois funcionários com o mesmo id de relógio é um erro de importação. É melhor que
   * a importação rebente do que ficar em silêncio com dois picares a apontar à mesma
   * ficha.
   */
  it("um id de relógio não serve duas pessoas", () => {
    expect(COLS).toMatch(/create unique index if not exists employees_timemoto_user_id_key/i);
    expect(COLS).toMatch(/where timemoto_user_id is not null/i);
  });

  /**
   * O preenchimento do `employee_ref` NÃO está na migração de propósito: posta aqui
   * corria uma vez, a zero linhas, antes de os dados existirem — e nunca mais.
   */
  it("não preenche nada antes de haver dados", () => {
    const semComentarios = COLS.replace(/^--.*$/gm, "");
    expect(semComentarios).not.toMatch(/update public\.employees/i);
  });
});
