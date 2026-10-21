import { useCallback, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAppUpdater } from "@/hooks/useAppUpdater";

/**
 * "Check for updates", à ordem.
 *
 * A deteção automática já existe e funciona, mas tem um ritmo: 15 s depois de abrir,
 * depois de 2 em 2 minutos, e sempre que a app volta ao primeiro plano. Para quem está à
 * espera de uma correcção que acabou de ser publicada, dois minutos é tempo a mais — e
 * sem forma de forçar, a única saída era fechar a app e voltar a abrir, que num tablet de
 * linha ou num telemóvel com a app instalada não é óbvio nem rápido.
 *
 * Por isso o botão não "limpa a cache" nem faz nada de especial: faz a MESMA pergunta que
 * o temporizador faz — o `index.html` servido agora nomeia o mesmo bundle que esta página
 * está a correr? — só que já, e diz a resposta.
 *
 * Dizer "já estás na versão mais recente" é metade do ponto. Um botão que não responde
 * nada quando não há nada a fazer parece avariado, e a pessoa carrega outra vez.
 */
export function useCheckForUpdates() {
  const { checkNow } = useAppUpdater();
  // Num ref e nao so em estado: dois toques no mesmo tick — que e o que um tablet de
  // linha faz quando a resposta tarda — leem ambos o estado ANTERIOR e passavam os dois.
  // O estado continua, mas so para o rotulo e o `disabled`.
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await checkNow();
      if (result === "updated") {
        // A página está a recarregar; o aviso é só para o instante entre as duas.
        toast.success("New version found — reloading");
        return;
      }
      if (result === "current") {
        toast.success("You are on the latest version");
        return;
      }
      toast.error("Could not check for updates", {
        description: "The server could not be reached. Try again in a moment.",
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [checkNow]);

  return { run, busy };
}

/** A forma que o menu lateral usa, a par do Sign Out. */
export function CheckForUpdatesButton({ className }: { className?: string }) {
  const { run, busy } = useCheckForUpdates();
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      title="Check for updates"
      className={className}
    >
      <RefreshCw className={`h-4 w-4 group-data-[collapsible=icon]:mr-0 mr-2 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />
      <span className="group-data-[collapsible=icon]:hidden">
        {busy ? "Checking…" : "Check for updates"}
      </span>
    </button>
  );
}
