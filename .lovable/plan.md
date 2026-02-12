

# Login Profissional com Logo Applied Nutrition

## Objetivo

Substituir o icone generico (Wrench) pelo logo da Applied Nutrition e redesenhar a tela de login com aparencia profissional industrial. O stamp de impressao sera adicionado quando voce enviar a imagem separada.

## Alteracoes

### 1. Copiar o logo para o projeto
- Copiar `user-uploads://appliedlogo.jpeg` para `src/assets/appliedlogo.jpeg`
- Importar como modulo ES6 nos componentes que usam

### 2. Tela de Login (`src/pages/Login.tsx`)
- Substituir o icone Wrench pelo logo da Applied Nutrition (imagem grande, centralizada)
- Redesenhar com visual industrial profissional:
  - Fundo com gradiente escuro (azul industrial para preto)
  - Card com backdrop blur e borda sutil
  - Logo grande no topo (120px)
  - Titulo "Applied Nutrition" com subtitulo "Maintenance Portal"
  - Inputs com estilo mais limpo e icones internos (email, lock)
  - Botao de login com destaque (amarelo/accent)
  - Remover opcao de sign-up (apenas login, usuarios sao criados pelo admin)

### 3. Sidebar (`src/components/DashboardLayout.tsx`)
- Substituir o icone Wrench + texto "AN Maintenance" pelo logo da Applied Nutrition (versao menor, ~32px)
- Manter o texto "AN Maintenance" ao lado do logo

### 4. Titulo da pagina (`index.html`)
- Atualizar o titulo de "Lovable App" para "AN Maintenance"

## Detalhes Tecnicos

### Login redesenhado -- estrutura visual:

```text
+---------------------------------------+
|                                        |
|     [Fundo gradiente azul escuro]      |
|                                        |
|        +---------------------+         |
|        |                     |         |
|        |   [LOGO 120px]     |         |
|        |                     |         |
|        |  Applied Nutrition  |         |
|        |  Maintenance Portal |         |
|        |                     |         |
|        |  [Email input]      |         |
|        |  [Password input]   |         |
|        |                     |         |
|        |  [  Sign In  ]      |         |
|        |                     |         |
|        +---------------------+         |
|                                        |
+---------------------------------------+
```

### Arquivos modificados:

| Arquivo | Alteracao |
|---------|-----------|
| `src/assets/appliedlogo.jpeg` | Logo copiado do upload |
| `src/pages/Login.tsx` | Redesign completo com logo e visual industrial |
| `src/components/DashboardLayout.tsx` | Logo no sidebar |
| `index.html` | Titulo atualizado |

### Nota sobre o stamp de impressao
Quando voce enviar a imagem do stamp, ela sera adicionada ao `WorkOrderDetail.tsx` para aparecer no cabecalho ou rodape ao imprimir a ordem de servico.

