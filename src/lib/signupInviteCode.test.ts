import { describe, it, expect, beforeEach } from "vitest";
import { readInviteCode, forgetInviteCode } from "@/lib/signupInviteCode";
import { signupQrPayload } from "@/lib/signupQr";

describe("readInviteCode", () => {
  beforeEach(() => sessionStorage.clear());

  it("lê o que o QR escreve — o par tem de fechar", () => {
    const qr = new URL(signupQrPayload("https://app.example", "AN-7KQ2PX"));
    expect(readInviteCode(qr.search)).toEqual({ code: "AN-7KQ2PX", fromLink: true });
  });

  it("aceita os nomes que um link feito à mão costuma usar", () => {
    expect(readInviteCode("?invite=AN-1").code).toBe("AN-1");
    sessionStorage.clear();
    expect(readInviteCode("?invite_code=%20AN-2%20").code).toBe("AN-2");
  });

  it("guarda-o no separador e devolve-o quando o endereço o perdeu", () => {
    readInviteCode("?code=AN-3");
    expect(readInviteCode("")).toEqual({ code: "AN-3", fromLink: true });
  });

  it("o endereço ganha ao que estava guardado", () => {
    readInviteCode("?code=AN-OLD");
    expect(readInviteCode("?code=AN-NEW").code).toBe("AN-NEW");
    expect(readInviteCode("").code).toBe("AN-NEW");
  });

  it("depois de registar, a próxima pessoa no mesmo telemóvel começa limpa", () => {
    readInviteCode("?code=AN-4");
    forgetInviteCode();
    expect(readInviteCode("")).toEqual({ code: "", fromLink: false });
  });
});
