import { describe, it, expect } from "vitest";
import { roleRejectedByDatabase, roleRejectedMessage } from "./roleNotInDatabase";

describe("roleRejectedByDatabase", () => {
  it("reconhece a recusa do enum e devolve o papel", () => {
    // A mensagem exacta que apareceu no ecrã a 11/10.
    expect(roleRejectedByDatabase({ message: 'invalid input value for enum app_role: "employee"' }))
      .toBe("employee");
    expect(roleRejectedByDatabase('invalid input value for enum app_role: "supervisor"'))
      .toBe("supervisor");
  });

  it("não reclama outros erros para si", () => {
    // Um ecrã que explicasse tudo com "falta a migração" estaria errado mais vezes do
    // que certo.
    for (const message of [
      "Only admins can assign Admin, Manager, Supervisor roles",
      "duplicate key value violates unique constraint \"profiles_email_key\"",
      "invalid input value for enum shift_kind: \"night\"",
      "Invalid role",
      "Failed to send a request to the Edge Function",
    ]) {
      expect(roleRejectedByDatabase({ message })).toBeNull();
    }
  });

  it("aguenta o que não é erro", () => {
    for (const nada of [null, undefined, {}, 42, { message: 7 }]) {
      expect(roleRejectedByDatabase(nada)).toBeNull();
    }
  });
});

describe("roleRejectedMessage", () => {
  it("nomeia o papel e diz o que fazer", () => {
    const m = roleRejectedMessage("employee");
    expect(m).toContain('"employee"');
    expect(m).toMatch(/migration/i);
    expect(m).toMatch(/another role/i);
    // Não repete a frase do Postgres.
    expect(m).not.toMatch(/invalid input value/i);
  });
});
