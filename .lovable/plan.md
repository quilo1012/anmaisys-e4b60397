# Presença e disponibilidade no Communication Hub

## Resultado

Adicionar ao Communication Hub existente os seis estados do documento: **Online**, **Busy**, **Do Not Disturb**, **Away**, **Offline** e **On Holiday**. Mostrar indicadores com símbolos e texto junto das pessoas na pesquisa, contactos, conversas privadas, participantes dos grupos e resumo do perfil. Não atribuir estado a um grupo como se fosse uma pessoa.

O seletor fica no menu de perfil existente, sem criar uma página de configurações duplicada. Mensagens, anexos e notificações continuam com as permissões e comportamento atuais; Do Not Disturb não bloqueia mensagens nem introduz uma nova regra de notificações.

## Regras propostas, antes da implementação

1. **Férias aprovadas em vigor → On Holiday**, mesmo sem ligação. Usar apenas a ligação existente entre login e funcionário e férias aprovadas; não usar o Headcount nem o ponto como substitutos de férias. Considerar o intervalo inclusivo de datas do calendário de Londres, sem antecipar o regresso nos dias de folga. Não divulgar tipo, motivo, notas nem datas da ausência aos contactos.
2. **On Holiday escolhido manualmente → On Holiday**, até a pessoa mudar a escolha. Permitir esta escolha também a quem não tem ficha de funcionário ligada.
3. **Offline escolhido manualmente → Offline**, mesmo com a aplicação aberta; a pessoa mantém acesso normal às mensagens.
4. **Nenhuma sessão ativa depois da tolerância → Offline**. A preferência Busy, Do Not Disturb ou Away fica guardada e reaparece quando a pessoa volta a ligar-se.
5. **Pelo menos uma sessão ativa → preferência guardada**, com Online por omissão. Ligar/desligar não altera a preferência. Férias aprovadas prevalecem durante o respetivo intervalo; a escolha anterior regressa depois.

Não acrescentar On Break, estados adicionais nem deteção automática de inatividade nesta entrega.

## Ligação e interrupções

- Identificar separadamente cada sessão de browser/dispositivo, sem guardar ou transmitir tokens de autenticação.
- Renovar uma presença curta a cada **60 segundos** enquanto a sessão autenticada estiver ativa. Considerar uma sessão expirada após **180 segundos** sem renovação; interrupções curtas não tornam a pessoa Offline imediatamente.
- Fechar uma aba não desconecta as restantes. Após fecho, suspensão prolongada no telemóvel ou perda de ligação, a última presença expira dentro da tolerância.
- Renovar imediatamente ao regressar à aplicação ou recuperar a ligação; parar as renovações ao terminar a sessão.
- Separar estado desconhecido/erro de Offline: falhas de leitura mostram indisponibilidade da informação e opção de tentar novamente, não uma falsa lista de pessoas desligadas.

## Segurança e armazenamento

- Reutilizar a identidade e as regras existentes de contactos, supervisor, conversas autorizadas e membros atuais dos grupos. Não alargar permissões do chat.
- Guardar apenas preferência de disponibilidade e presença mínima necessária, sem alterar fichas de funcionários, férias, contas ou a tabela de perfis com dados sensíveis.
- As alterações de estado usam identidade validada no servidor: ninguém pode escolher o utilizador cuja disponibilidade altera.
- RLS e autenticação obrigatórias; nenhuma leitura anónima. Os contactos recebem apenas o estado final necessário, não detalhes de sessões/dispositivos ou de férias.
- Confirmar o estado atual da **produção PMSYSTEM** antes de aplicar qualquer alteração. O documento de mapa de bases referido pelo projeto não está neste checkout e o acesso de inspeção exigido ainda não está disponível nas ferramentas desta sessão; não tirar conclusões sobre produção a partir de outras bases.

## Detalhes técnicos

- Criar um módulo partilhado de presença montado uma vez por sessão autenticada; reutilizar os pontos existentes do perfil e do Hub.
- Avaliar Realtime Presence existente: o canal dos engineers usa um tópico diferente por montagem e não serve como presença partilhada do Hub. Não corrigir nem substituir esse painel nesta tarefa.
- Preferir dados mínimos em tabelas próprias protegidas e atualizações Realtime com RLS, complementadas por expiração calculada e recuperação após reconexão. Validar identidade, relógio e preferência no servidor; não aceitar disponibilidade ou tempo de ligação inventados pelo cliente.
- Evitar transmitir sessões privadas: a leitura autorizada devolve presença agregada por pessoa. Selecionar o mecanismo Realtime definitivo após confirmar as políticas atuais, sem alterações a schemas geridos.
- Aplicar alterações aditivas através de migrações versionadas e do procedimento do projeto, com GRANT explícito e RLS. Respeitar o requisito existente de revisão por pull request para `main`; não publicar nem alterar o endereço da fábrica.
- Usar componentes e cores semânticas existentes; indicadores acessíveis com texto, ícones e identificação clara de On Holiday versus Do Not Disturb.

## Verificação e conclusão

1. Testes concretos das seis opções e da precedência, tolerância de 180 segundos, múltiplas sessões, limites das férias e falhas de gravação.
2. Testes de permissões: anónimo recusado, tentativa de mudar outra pessoa recusada, presença restrita aos contactos/conversas autorizados, ausência de detalhes privados de férias.
3. Testes no Hub com **duas contas reais autorizadas**: escolha de estados, atualizações sem refresh, interrupção breve, fecho/expiração, duas abas e dois dispositivos. Não criar funcionários ou alterar férias reais para fabricar cenários.
4. Verificar pesquisa, contactos, conversas privadas, participantes dos grupos e perfil em desktop e mobile; confirmar mensagens, anexos e notificações sem regressões.
5. Entregar o resumo pedido com alterações, migrações, regras, testes reais e limitações. Não declarar a funcionalidade concluída se faltar acesso a uma segunda conta ou algum teste central.

**Estado atual:** documento e arquitetura existente analisados; Hub aberto com a sessão existente, sem enviar mensagens. Nenhum código da aplicação, registo ou permissão de produção foi alterado.