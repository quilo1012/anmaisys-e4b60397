import { describe, it, expect } from "vitest";
import { isFunctionUnreachable } from "./edgeFunctionUnreachable";

/**
 * Separar "a função recusou" de "a função não respondeu".
 *
 * A primeira traz uma frase que a pessoa pode seguir. A segunda traz
 * "Failed to send a request to the Edge Function", que não diz nada a ninguém — e é
 * isso que o chão de fábrica tem lido ao tentar criar conta com o crachá.
 */
describe("isFunctionUnreachable", () => {
  it("reconhece o erro do SDK pelo nome", () => {
    expect(isFunctionUnreachable({ name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" })).toBe(true);
  });

  it("reconhece-o pelo texto, porque o nome perde-se no spread do normalizador", () => {
    // `normalizeFunctionError` faz `{...error}`, e uma instância de classe perde o
    // `name` nesse espalhamento.
    expect(isFunctionUnreachable({ message: "Failed to send a request to the Edge Function" })).toBe(true);
    expect(isFunctionUnreachable({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isFunctionUnreachable({ message: "Load failed" })).toBe(true);   // Safari
    expect(isFunctionUnreachable({ message: "NetworkError when attempting to fetch resource." })).toBe(true);
  });

  it("não confunde uma recusa da função com silêncio", () => {
    // Estas têm corpo e dizem o que fazer — não podem ser engolidas por uma mensagem
    // genérica sobre a porta estar fechada.
    for (const message of [
      "That invite code isn't valid any more — it may have expired. Ask your supervisor.",
      "No active employee has ID E151. Check the number on your badge.",
      "ID E151 already has an account. Sign in with it instead.",
      "Edge Function returned a non-2xx status code",
      "Too many attempts. Try again in 5 minutes.",
    ]) {
      expect(isFunctionUnreachable({ message })).toBe(false);
    }
  });

  it("aguenta o que não é um erro", () => {
    for (const nada of [null, undefined, "texto", 42, {}, { message: 7 }]) {
      expect(isFunctionUnreachable(nada)).toBe(false);
    }
  });
});
