import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageThread, type UIMessage } from "@/components/chat/MessageThread";

/**
 * Uma mensagem retirada diz que esteve ali.
 *
 * Retirar nao e desaparecer. A linha fica, com `deleted_at` e sem conteudo, por duas
 * razoes: uma resposta que a citava continua a apontar para algo, e a conversa nao muda
 * de forma consoante quem a le. O que o ecra mostra e uma lapide, nao um buraco.
 *
 * O conteudo nao esta ca escondido — `chat_withdraw_direct_message` apaga-o das colunas e
 * guarda o original em `audit_logs`. Por isso estes testes dao `body: ""`: e o que o
 * servidor passa a devolver. Uma rasura que so o React respeitasse nao seria rasura.
 */

const base = (over: Partial<UIMessage> = {}): UIMessage => ({
  id: "m1",
  sender_id: "eu",
  sender_name: "Ana",
  body: "combinamos as 6",
  created_at: "2026-10-21T20:00:00Z",
  attachments: [],
  ...over,
});

const thread = (messages: UIMessage[], onWithdraw?: (m: UIMessage) => void) =>
  render(
    <MessageThread
      messages={messages}
      meId="eu"
      people={{}}
      isGroup={false}
      loading={false}
      error={null}
      onRetryLoad={() => {}}
      hasOlder={false}
      loadingOlder={false}
      onLoadOlder={() => {}}
      onRetrySend={() => {}}
      onWithdraw={onWithdraw}
      emptyText="vazio"
    />,
  );

describe("uma mensagem retirada", () => {
  it("diz que foi retirada, em vez de nao mostrar nada", () => {
    thread([base({ body: "", deleted_at: "2026-10-21T20:05:00Z" })]);
    expect(screen.getByText("You withdrew this message")).toBeInTheDocument();
  });

  it("do outro lado diz o mesmo sem dizer que fui eu", () => {
    thread([base({ sender_id: "outro", body: "", deleted_at: "2026-10-21T20:05:00Z" })]);
    expect(screen.getByText("This message was withdrawn")).toBeInTheDocument();
  });

  /** O que importa aqui: o que foi dito nao volta pelo ecra. */
  it("nao mostra o corpo, o audio nem os anexos de uma retirada", () => {
    thread([
      base({
        body: "combinamos as 6",
        audio_path: "a/b.webm",
        attachments: [{ id: "f1", storage_path: "x/y.pdf", file_name: "turno.pdf", content_type: "application/pdf", size_bytes: 10 }],
        deleted_at: "2026-10-21T20:05:00Z",
      }),
    ]);
    expect(screen.queryByText("combinamos as 6")).not.toBeInTheDocument();
    expect(screen.queryByText("turno.pdf")).not.toBeInTheDocument();
  });
});

describe("o botao de retirar", () => {
  it("aparece na propria mensagem", () => {
    thread([base()], vi.fn());
    expect(screen.getByLabelText("Withdraw this message")).toBeInTheDocument();
  });

  /** So o autor. Quem recebe nao reescreve a conversa de quem escreveu. */
  it("nao aparece na mensagem de outra pessoa", () => {
    thread([base({ sender_id: "outro" })], vi.fn());
    expect(screen.queryByLabelText("Withdraw this message")).not.toBeInTheDocument();
  });

  it("nao aparece numa que ja foi retirada", () => {
    thread([base({ body: "", deleted_at: "2026-10-21T20:05:00Z" })], vi.fn());
    expect(screen.queryByLabelText("Withdraw this message")).not.toBeInTheDocument();
  });

  /** Onde a accao nao se oferece, nao ha botao nenhum. */
  it("nao aparece quando o ecra nao passa a accao", () => {
    thread([base()]);
    expect(screen.queryByLabelText("Withdraw this message")).not.toBeInTheDocument();
  });
});
