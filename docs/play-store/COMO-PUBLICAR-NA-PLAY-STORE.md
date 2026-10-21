# Como pôr o PMSystem na Google Play (TWA)

A app Android é um invólucro: abre `https://anpmsystem.co.uk` em ecrã inteiro. Todo o código
continua a ser este repositório; uma alteração publicada no site aparece na app sem nova versão
na loja. Só é preciso nova versão na loja se mudar o ícone, o nome ou o endereço.

## O que já está no repositório

- `public/site.webmanifest`: nome, descrição, `display: standalone`, ícones normais e **maskable**
  (192 e 512), categorias.
- `public/maskable-icon-*.png`: o ícone com margem de segurança para o Android o recortar.
- `/privacy`: página pública de privacidade (`src/pages/Privacy.tsx`). **Rever com quem responde
  pela proteção de dados antes de submeter.** O contacto está em `src/lib/privacyContact.ts`
  (hoje vazio: a página manda falar com o supervisor ou o administrador).
- `docs/play-store/assetlinks.template.json`: o ficheiro que liga o domínio à app (ver passo 4).

## Passos (só tu os podes fazer)

1. **Conta de programador** em https://play.google.com/console (taxa única de 25 USD). Contas de
   empresa pedem o número D-U-N-S. Uma conta pessoal nova tem de fazer um teste fechado com cerca de
   12 testadores durante 14 dias antes de poder publicar. Confirma estes requisitos na consola, que
   mudam.
2. **Gerar a app** em https://www.pwabuilder.com: escreve `https://anpmsystem.co.uk`, escolhe
   Android, e preenche
   - *Package ID*: por exemplo `uk.co.anpmsystem.app` (não se muda depois de publicar)
   - *App name*: AN Maintenance
   - deixa o PWABuilder criar a chave de assinatura e **guarda o ficheiro da chave e a palavra-passe
     fora do repositório** (sem ela não há atualizações).
   Descarrega o `.aab`.
3. **Criar a app na Play Console** e carregar o `.aab`. Ativa *Play App Signing*.
4. **Ligar o domínio à app (Digital Asset Links).** Na consola, Configuração → Integridade da app →
   *App signing* → copia a impressão digital **SHA-256**. Copia
   `docs/play-store/assetlinks.template.json` para `public/.well-known/assetlinks.json`, troca o
   package ID e a impressão digital, e faz PR. Depois de publicado, abre
   `https://anpmsystem.co.uk/.well-known/assetlinks.json` e confirma que devolve o JSON (e não a
   página da app). Sem isto a app mostra uma barra de endereço.
5. **Ficha da loja:** nome, descrição curta e longa, ícone 512x512, imagem de destaque 1024x500, pelo
   menos 2 capturas de ecrã de telemóvel, URL da política de privacidade
   (`https://anpmsystem.co.uk/privacy`), classificação de conteúdo e a declaração de *Data safety*
   (contas, dados de funcionário, mensagens, subscrição de notificações).
6. **Conta de teste para a revisão:** a loja pede um login que funcione. Cria um login de funcionário
   só para isso, e indica-o em *App access*. Esse login não pode dar acesso a dados reais.
7. **Notificações:** a app Android usa o mesmo Web Push do Chrome. O Android também pede permissão uma
   vez por pessoa; o aviso fixo do sistema ("Get your messages on this phone") trata disso.

## O que não resolve

- **iPhone** é outra conta (99 USD por ano) e a Apple recusa muitas vezes apps que são só um site.
  Para iPhone continua a servir a app no ecrã principal.
- Se um dia for preciso algo que o browser não dá (leitor de códigos nativo, notificações nativas
  FCM), a alternativa é o Capacitor, que obriga a publicar cada alteração nativa na loja.
