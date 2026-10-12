import { Card, CardContent } from "@/components/ui/card";
import { SignupQrCard } from "@/components/SignupQrCard";
import { useSignupInviteCode } from "@/hooks/useSignupInvite";

/**
 * O que o tablet da linha mostra: um aviso e um código. Nada mais.
 *
 * Até 12/10/2026 esta página listava também as horas extra em aberto, e o comentário
 * de então dizia porquê — "o tablet é por onde as pessoas passam, e 'faltam quinze na
 * sexta de manhã' vale a pena ler seja quem for".
 *
 * Deixou de ser assim por decisão de quem gere a linha. A razão é a que o próprio
 * aviso já dava e a lista contrariava: **daqui não se responde**. Uma lista de turnos
 * por cima de um aviso a dizer que não se pode responder a nenhum deles é uma
 * promessa que o ecrã não pode cumprir — a pessoa lê "sexta, 06:00–18:00, faltam
 * cinco", procura o botão, não há botão, e o que fica é que o sistema está avariado.
 * Com o código sozinho, o ecrã faz um pedido só: cria a tua conta no teu telemóvel.
 *
 * Quem quiser afixar os turnos tem a folha impressa do Users → Self sign-up, que é
 * papel e não promete botão nenhum.
 *
 * NÃO VAI BUSCAR OS PEDIDOS À BASE. Não é só não os desenhar: uma conta partilhada
 * por um turno inteiro deixa de ler quem é preciso onde e quando, que não é coisa que
 * um posto da fábrica precise de ter em memória.
 */
export function TabletOvertimeNotice() {
  // Null quando o registo está fechado ou o bloco ainda não foi colado; o cartão
  // desenha o QR sem código, que é o que a página de entrada já faz.
  const inviteCode = useSignupInviteCode();

  return (
    <div className="space-y-3">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-4 text-sm">
          <p className="font-medium">This is the line's tablet, not your phone.</p>
          <p className="mt-1 text-muted-foreground">
            Everyone here signs in as the same account, so overtime can't be answered from it.
            Scan the code below to answer on your own phone — it takes a minute, once.
          </p>
        </CardContent>
      </Card>

      <SignupQrCard tone="page" inviteCode={inviteCode} />
    </div>
  );
}
