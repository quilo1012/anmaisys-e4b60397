import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { LoggingShiftProvider, useLoggingShift } from "@/contexts/LoggingShiftContext";

/**
 * The answer the whole logging screen files under.
 *
 * The bug this replaces was silent: at 18:05 the screen picked the shift from the
 * clock, got NIGHT, and wrote the day crew's last quantity there. Nothing errored —
 * the day came up short and the night came up long, and both looked like real numbers.
 * So these tests are about which shift comes out, not about whether anything throws.
 *
 * Agosto é BST: as 18:00 de Londres são as 17:00 UTC.
 */

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LoggingShiftProvider>{children}</LoggingShiftProvider>
);

const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLoggingShift", () => {
  it("a meio do turno não pergunta nada", () => {
    at("2026-08-12T11:00:00Z"); // 12:00 Londres
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    expect(result.current.shift).toBe("DAY");
    expect(result.current.sessionDate).toBe("2026-08-12");
    expect(result.current.needsChoice).toBe(false);
    expect(result.current.handoverOpen).toBe(false);
    expect(result.current.isCarriedOver).toBe(false);
  });

  it("às 18:05 pergunta, e até haver resposta não muda nada", () => {
    at("2026-08-12T17:05:00Z");
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    expect(result.current.handoverOpen).toBe(true);
    expect(result.current.needsChoice).toBe(true);
    // A omissão é o turno a correr — o mesmo que o ecrã fazia antes disto existir, para
    // que um diálogo fechado por engano não deixe as coisas piores do que estavam.
    expect(result.current.shift).toBe("NIGHT");
  });

  it("escolher o turno que acabou põe a produção no turno certo", () => {
    at("2026-08-12T17:05:00Z");
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    act(() => result.current.choose("outgoing"));
    expect(result.current.shift).toBe("DAY");
    expect(result.current.sessionDate).toBe("2026-08-12");
    expect(result.current.isCarriedOver).toBe(true);
    expect(result.current.needsChoice).toBe(false);
    // 18:30 de Londres — o mesmo instante em que a base de dados fecha a porta.
    expect(result.current.deadline.toISOString()).toBe("2026-08-12T17:30:00.000Z");
  });

  it("quem entra escolhe o turno que começou e fica sem faixa nenhuma", () => {
    at("2026-08-12T17:05:00Z");
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    act(() => result.current.choose("incoming"));
    expect(result.current.shift).toBe("NIGHT");
    expect(result.current.isCarriedOver).toBe(false);
    expect(result.current.needsChoice).toBe(false);
  });

  it("a resposta sobrevive a um recarregamento do tablet", () => {
    at("2026-08-12T17:05:00Z");
    const first = renderHook(() => useLoggingShift(), { wrapper });
    act(() => first.result.current.choose("outgoing"));
    first.unmount();

    const second = renderHook(() => useLoggingShift(), { wrapper });
    expect(second.result.current.shift).toBe("DAY");
    expect(second.result.current.needsChoice).toBe(false);
  });

  it("a resposta de uma passagem não transita para a seguinte", () => {
    at("2026-08-12T17:05:00Z");
    const evening = renderHook(() => useLoggingShift(), { wrapper });
    act(() => evening.result.current.choose("outgoing"));
    evening.unmount();

    // Doze horas depois, na passagem da manhã. Uma resposta guardada sem chave de
    // passagem poria a produção do dia na noite que acabou de sair.
    at("2026-08-13T05:05:00Z"); // 06:05 Londres
    const morning = renderHook(() => useLoggingShift(), { wrapper });
    expect(morning.result.current.needsChoice).toBe(true);
    expect(morning.result.current.shift).toBe("DAY");
  });

  it("na manhã, o turno que acabou é a noite de ONTEM", () => {
    at("2026-08-13T05:05:00Z");
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    act(() => result.current.choose("outgoing"));
    expect(result.current.shift).toBe("NIGHT");
    expect(result.current.sessionDate).toBe("2026-08-12");
  });

  it("mudar para o turno a correr desfaz a escolha anterior", () => {
    at("2026-08-12T17:05:00Z");
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    act(() => result.current.choose("outgoing"));
    act(() => result.current.choose("incoming"));
    expect(result.current.shift).toBe("NIGHT");
    expect(result.current.isCarriedOver).toBe(false);
  });

  it("quando a janela fecha, o ecrã volta sozinho ao turno a correr", () => {
    at("2026-08-12T17:05:00Z");
    const { result } = renderHook(() => useLoggingShift(), { wrapper });
    act(() => result.current.choose("outgoing"));
    expect(result.current.shift).toBe("DAY");

    // 18:31. Um tablet deixado aberto não pode continuar a oferecer um turno que a
    // base de dados já recusa — foi assim que o operador da Linha 4 descobriu o
    // prazo da última vez, com sete recusas em cinco minutos.
    act(() => {
      vi.advanceTimersByTime(26 * 60_000);
    });
    expect(result.current.handoverOpen).toBe(false);
    expect(result.current.isCarriedOver).toBe(false);
    expect(result.current.shift).toBe("NIGHT");
  });
});
