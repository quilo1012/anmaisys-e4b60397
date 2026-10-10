/**
 * O QR do tablet é o que as pessoas lêem, e era o único sem o código.
 *
 * O `signupQrPayload` põe o invite code no link, e o formulário abre com a caixa
 * preenchida — provado em produção. Mas dos dois ecrãs que desenham o QR, só o cartão
 * do administrador passava um código. O do login passa nenhum, porque o
 * `signup_config` é `REVOKE ALL ... FROM anon` e uma página servida a toda a gente não
 * o consegue ler. Quem lê o QR do tablet aterra numa caixa "From your supervisor" às
 * seis da manhã.
 *
 * O que se fixa aqui: o cartão **nunca vai buscar** o código sozinho. Quem o passa
 * decide-se de fora, num sítio que se lê — senão o cartão levava-o para onde quer que
 * fosse colocado, incluindo o ecrã público de login.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const toDataURL = vi.fn(async (text: string, _opts?: unknown) => `data:image/png;base64,${btoa(text)}`);
vi.mock("qrcode", () => ({ default: { toDataURL: (t: string, o: unknown) => toDataURL(t, o) } }));

import { SignupQrCard } from "@/components/SignupQrCard";

/** O que o QR desenhado contém, lido de volta do data: URL que o duplo devolve. */
async function payload() {
  const img = await screen.findByRole("img", { name: /QR code/i });
  return atob((img as HTMLImageElement).src.split(",")[1]);
}

describe("SignupQrCard", () => {
  beforeEach(() => toDataURL.mockClear());

  it("sem código: aponta ao registo e avisa que o código será pedido", async () => {
    render(<SignupQrCard origin="https://x.app" />);
    expect(await payload()).toBe("https://x.app/signup");
    expect(screen.getByText(/invite code from the sign-up sheet/i)).toBeTruthy();
  });

  it("com código: leva-o no link e diz que não vai ser pedido", async () => {
    render(<SignupQrCard origin="https://x.app" inviteCode="AN-2026" />);
    expect(await payload()).toBe("https://x.app/signup?code=AN-2026");
    expect(screen.getByText(/already in this square/i)).toBeTruthy();
  });

  it("código vazio ou nulo é o mesmo que não ter — o caso do ecrã de login", async () => {
    for (const nada of [null, undefined, "", "   "]) {
      const { unmount } = render(<SignupQrCard origin="https://x.app" inviteCode={nada} />);
      expect(await payload()).toBe("https://x.app/signup");
      unmount();
    }
  });

  /**
   * A regra de segurança, presa por um teste em vez de por um comentário.
   *
   * Se o cartão alguma vez for buscar o código sozinho, passa a levá-lo para o ecrã de
   * login, que é público — e o código é o único portão do auto-registo, com
   * `self_signup_role = operator` do outro lado.
   */
  it("nunca vai buscar o código sozinho: sem prop, não há código, e ninguém é chamado", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const rpc = vi.spyOn(supabase, "rpc");
    render(<SignupQrCard origin="https://x.app" />);
    await waitFor(() => expect(toDataURL).toHaveBeenCalled());
    expect(rpc).not.toHaveBeenCalled();
    expect(await payload()).toBe("https://x.app/signup");
    rpc.mockRestore();
  });
});
