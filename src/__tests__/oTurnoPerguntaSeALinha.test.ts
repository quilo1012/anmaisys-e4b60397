import { describe, it, expect } from "vitest";
import { buildRecord } from "../../supabase/functions/_shared/safetyculture/normalize";
import { normaliseShift, sessionInCharge } from "../../supabase/functions/_shared/safetyculture/leaderOnDuty";
import type { ScAction } from "../../supabase/functions/_shared/safetyculture/normalize";

/**
 * O turno de uma acção pergunta-se à linha antes de se perguntar ao relógio.
 *
 * 20260923090000 pôs turno em 123 acções que não tinham nenhum, lendo-o do instante
 * em que foram levantadas. Resolveu o ecrã em branco e deixou um erro mais caro no
 * lugar: o instante em que uma acção é ESCRITA não é aquele em que o problema
 * aconteceu.
 *
 * Medido no log a 01/10/2026, em acções da Linha 6:
 *
 *   "Missing pallet out time (L6/night shift)"               carimbada Day
 *   "Line started without bayonet be checked by QC (L6/…)"   carimbada Day
 *
 * O próprio título diz noite. O relógio diz dia, porque o QC escreveu a ocorrência de
 * manhã. E como o mesmo instante decide o líder, a acção vai para o líder do dia
 * também — duas respostas erradas que concordam uma com a outra, que é a forma mais
 * difícil de detectar um erro.
 *
 * `production_sessions` tem a resposta e ninguém lha perguntava: a sessão aberta na
 * linha naquele instante traz o turno escrito por quem abriu a linha. A mesma sessão
 * que já decide o líder desde 07/09.
 */

const SESSIONS = [
  // A noite de 29/09: aberta às 17:05 locais (16:05Z), corre até de manhã.
  { line: "Line 6", started_at: "2026-09-29T16:05:00Z", session_date: "2026-09-29", shift: "NIGHT", leader_name: "Ailton" },
  // O dia de 30/09: aberto às 06:02 locais (05:02Z).
  { line: "Line 6", started_at: "2026-09-30T05:02:00Z", session_date: "2026-09-30", shift: "DAY", leader_name: "Marcio" },
];

/** Uma acção do SafetyCulture reduzida ao que esta decisão usa. */
function action(createdAt: string): ScAction {
  return {
    id: `sc-${createdAt}`,
    title: "Missing pallet out time (L6/night shift)",
    description: null,
    // `resolveLine` lê o asset antes do título: "L6" sozinho não casa com "Line 6"
    // sem uma regra de alias, e a linha tem de resolver para a sessão ser procurada.
    asset: "Line 6",
    status: "TO_DO",
    created_at: createdAt,
    modified_at: createdAt,
    labels: [],
    assignees: [],
  } as unknown as ScAction;
}

/** O contexto como `loadContext` o monta, com a sessão a responder pelo turno. */
function optsWithSessions(sessions = SESSIONS) {
  return {
    lineNames: ["Line 6"],
    rules: [],
    leaderFor: () => null,
    leaderAt: (line: string, at?: string | null) => {
      const s = sessionInCharge(line, at ?? null, sessions);
      if (!s) return { leader: null, source: "none" as const, shift: null };
      return {
        leader: { id: "id", name: String(s.leader_name) },
        source: "session" as const,
        shift: normaliseShift(s.shift),
      };
    },
    now: "2026-10-01T09:00:00Z",
  };
}

/** O contexto de uma linha onde ninguém abriu sessão: só resta o relógio. */
const NO_SESSION = {
  lineNames: ["Line 6"],
  rules: [],
  leaderFor: () => null,
  leaderAt: () => ({ leader: null, source: "none" as const, shift: null }),
  now: "2026-10-01T09:00:00Z",
};

describe("o turno de uma acção importada", () => {
  it("fica com a noite que passou das 06:00, onde o relógio já dizia dia", () => {
    // 06:30 locais de 30/09. A noite abriu às 17:05 e ninguém abriu ainda o dia — a
    // linha ainda está a correr a noite. O relógio responderia DAY porque já passa
    // das seis; a sessão responde NIGHT porque é a que está aberta.
    //
    // Este é o caso que a sessão resolve e o relógio nunca poderia: uma viragem de
    // turno não acontece ao segundo, e `finished_at` é null em todas as sessões,
    // portanto a única coisa que sabe que a noite ainda não acabou é não existir
    // ainda uma sessão de dia.
    const { draft } = buildRecord(
      action("2026-09-30T05:30:00Z"),
      optsWithSessions([SESSIONS[0]]),
    );

    expect(draft.shift).toBe("NIGHT");
    expect(draft.shift_source).toBe("session");
    // A prova de que as duas respostas deixaram de poder discordar: o turno e o
    // líder saem agora da mesma linha da mesma tabela.
    expect(draft.leader_name).toBe("Ailton");
  });

  it("não inventa uma noite quando a sessão do dia já abriu", () => {
    // 10:30 locais. A sessão do dia abriu às 06:02 e é a mais recente antes deste
    // instante, portanto o relógio e a sessão concordam — e têm de concordar.
    const { draft } = buildRecord(action("2026-09-30T09:30:00Z"), optsWithSessions());

    expect(draft.shift).toBe("DAY");
    expect(draft.shift_source).toBe("session");
    expect(draft.leader_name).toBe("Marcio");
  });

  /**
   * O que esta mudança NÃO resolve, escrito como teste para que ninguém volte a
   * assumir que resolve.
   *
   * Uma falha apanhada às 02:00 e escrita às 07:15 continua a sair DAY. Antes era o
   * relógio a dizê-lo; agora é a sessão do dia, que já abriu às 06:02 e é
   * legitimamente a sessão em curso àquele instante. `sessionInCharge` escolhe a
   * última sessão aberta antes do momento, e a esse momento quem está na linha é
   * mesmo o turno do dia.
   *
   * Nenhuma derivação sobre `created_at` consegue fazer melhor, porque a informação
   * em falta não está em lado nenhum do registo: `created_at` é quando se escreveu,
   * e quando aconteceu ninguém escreveu. Só há duas saídas, e as duas são fora deste
   * ficheiro:
   *
   *   - um campo de turno (ou de hora da ocorrência) no template do SafetyCulture,
   *     que torna o turno um facto em vez de uma dedução;
   *   - a correcção à mão, que esta mudança passou a proteger — `shift_source` a
   *     'manual' e a sync nunca lhe toca. Ver `keepsItsShift` em applyActions.
   */
  it("continua a não saber o que ninguém escreveu: a ocorrência da noite registada de manhã", () => {
    // 07:15 locais de 30/09, sobre um problema da noite de 29 — o título di-lo.
    const { draft } = buildRecord(action("2026-09-30T06:15:00Z"), optsWithSessions());

    expect(draft.title).toContain("night shift");
    expect(draft.shift).toBe("DAY");
    // E é por isto que a proveniência tem de ser escrita: 'session' aqui é uma
    // dedução defensável e mesmo assim errada, e só uma pessoa a pode corrigir.
    expect(draft.shift_source).toBe("session");
  });

  it("cai no relógio quando ninguém abriu sessão na linha", () => {
    // O comportamento antigo continua a valer onde não há nada melhor. Não deixar
    // turno nenhum seria pior do que um palpite: um `shift` NULL desaparece de todos
    // os ecrãs que filtram `.eq("shift", …)`, que foi o bug de 23/09.
    const dia = buildRecord(action("2026-09-30T09:30:00Z"), NO_SESSION).draft;
    const noite = buildRecord(action("2026-09-29T22:40:00Z"), NO_SESSION).draft;

    expect(dia.shift).toBe("DAY");
    expect(dia.shift_source).toBe("clock");
    expect(noite.shift).toBe("NIGHT");
    expect(noite.shift_source).toBe("clock");
  });

  it("diz sempre qual das duas respondeu", () => {
    // `shift_source` é o que permite a uma correcção à mão valer mais do que ambas.
    // Um turno sem proveniência é indistinguível de um escrito por uma pessoa, e a
    // sync apagaria a correcção na próxima vez que o SafetyCulture mexesse na acção.
    const comSessao = buildRecord(action("2026-09-30T09:30:00Z"), optsWithSessions()).draft;
    const semSessao = buildRecord(action("2026-09-30T09:30:00Z"), NO_SESSION).draft;

    expect(comSessao.shift_source).toBe("session");
    expect(semSessao.shift_source).toBe("clock");
    // Nunca 'manual'. Este módulo não pergunta a ninguém.
    expect([comSessao.shift_source, semSessao.shift_source]).not.toContain("manual");
  });

  it("não deixa a sessão de ontem reclamar a ocorrência de hoje", () => {
    // sessionInCharge tem uma janela de 16 horas porque `finished_at` é null em todas
    // as sessões. Sem ela, a noite de 29/09 seria a sessão aberta para sempre.
    const tarde = buildRecord(action("2026-09-30T14:00:00Z"), optsWithSessions([SESSIONS[0]])).draft;

    expect(tarde.shift_source).toBe("clock");
    expect(tarde.shift).toBe("DAY");
  });
});

describe("normaliseShift", () => {
  it("aceita o que as tabelas de produção escrevem", () => {
    expect(normaliseShift("DAY")).toBe("DAY");
    expect(normaliseShift("NIGHT")).toBe("NIGHT");
  });

  it("perdoa caixa e espaços, que é o que uma importação traz", () => {
    expect(normaliseShift(" day ")).toBe("DAY");
    expect(normaliseShift("Night")).toBe("NIGHT");
  });

  it("recusa tudo o resto, em vez de o escrever na coluna", () => {
    // Um terceiro valor em `quality_actions.shift` é uma linha que nenhum ecrã
    // consegue filtrar — invisível, e sem nada a dizer porquê.
    expect(normaliseShift("MANHA")).toBeNull();
    expect(normaliseShift("")).toBeNull();
    expect(normaliseShift(null)).toBeNull();
    expect(normaliseShift(undefined)).toBeNull();
  });
});
