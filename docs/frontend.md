# Frontend

> O frontend agora e um monorepo de micro frontends: `apps/<zona>` para as telas
> de cada modulo e `packages/platform` para o que as zonas compartilham (o antigo
> `src/lib`, `src/api` e `src/components`). A organizacao e os ambientes estao
> em [deploy.md](deploy.md). O resto deste guia continua valendo.

A interface do SaaS multi-tenant. React, TypeScript e Vite, consumindo os cinco
modulos do backend pela mesma API publica que o `curl` usa: gateway na 8000,
`Authorization: Bearer` e `x-tenant-id` em cada requisicao, os mesmos 403 e 409
que qualquer outro cliente receberia.

Nao existe atalho aqui. Nenhuma consulta direta ao Postgres, nenhuma chave de
servico, nenhuma logica de autorizacao propria. O que a tela mostra e o que a
RLS e as permissoes deixaram passar.

---

## Rodando

Pela raiz do repositorio, com o stack ja de pe:

```bash
make up    # backend
make seed  # dois tenants de demonstracao
make web   # esta aplicacao, em http://localhost:3000
```

`make web` instala as dependencias na primeira vez, escreve o `.env.local` e
sobe o Vite. Na tela de entrada, clique em um dos quatro usuarios semeados para
preencher e-mail e senha.

Direto daqui, se preferir:

```bash
npm install
npm run dev      # servidor de desenvolvimento na porta 3000
npm run build    # type-check e bundle de producao em dist/
npm run check    # so o type-check
```

## Configuracao

Duas variaveis, ambas lidas em tempo de build pelo Vite:

| Variavel | Para que serve |
|---|---|
| `VITE_API_URL` | Endereco do gateway. Padrao `http://localhost:8000` |
| `VITE_ANON_KEY` | Chave `anon`, exigida pelo GoTrue em `/auth/v1/*` |

A `ANON_KEY` e um JWT assinado com o `JWT_SECRET` da sua maquina, gerado por
`make keys`. Ela nao esta no repositorio, e por isso existe o alvo `make web-env`
na raiz: ele le o `.env` e escreve o `.env.local` da raiz. Rode-o de novo sempre que
regerar as chaves.

A porta 3000 nao e casual: e o `SITE_URL` que o GoTrue conhece no `.env.example`.

## Como esta organizado

```
src/
  api/           um arquivo por modulo do backend, so chamadas e tipos
    types.ts     os DTOs de resposta, em camelCase, como o backend devolve
  lib/           o nucleo: HTTP, sessao, tenant, permissoes, erros, formatacao
  components/    o shell da aplicacao e um punhado de componentes de base
    ui/          botao, campo, dialogo, tabela, distintivo, estados
  routes/        uma pasta por modulo, um arquivo por tela
```

A regra e simples: `routes/` nao sabe montar uma requisicao, `api/` nao sabe
nada de React, e `lib/` e a unica camada que conhece as duas pontas.

## O nucleo

Cinco arquivos em `src/lib` sustentam tudo o mais.

### `http.ts` — o cliente

Monta a URL, injeta os cabecalhos, desembrulha o envelope `data` e converte erro
em uma classe `ApiError` com codigo, mensagem, detalhes, `requestId` e status.

Duas sutilezas que vieram do backend:

- **Parametro vazio e parametro ausente.** O validador do backend trata `""`
  como nao enviado, entao o cliente nem coloca na query string.
- **Corpo em `GET` e `DELETE` e ignorado**, e o cliente nao envia nenhum.

Quando uma chamada volta 401 e ha sessao, ele tenta o refresh uma unica vez e
repete a requisicao. Se o refresh tambem falhar, desloga. Chamadas concorrentes
compartilham a mesma promessa de refresh, senao uma invalidaria o token da outra.

O cliente nao usa hook nenhum: quem monta a sessao registra quatro funcoes nele
uma vez, no boot (`lib/session.ts`).

### `auth.tsx` — a sessao

Entrada pelo grant de senha do GoTrue, renovacao pelo `refresh_token`, tokens no
`localStorage`. O access token vale uma hora (`JWT_EXPIRY`), e a renovacao e
agendada para um minuto antes de vencer. Uma sessao guardada que venceu com a aba
fechada e renovada antes de a aplicacao pintar.

`sub` e `email` saem do proprio JWT, e nao do corpo do GoTrue, para o front nao
depender do formato de resposta dele.

### `tenant.tsx` — o tenant corrente

Lista os tenants do usuario, guarda o escolhido e alimenta o `x-tenant-id`.
Escolhe sozinho quando so ha um, e descarta uma escolha antiga que nao pertence
mais ao usuario.

Trocar de tenant **limpa o cache de consultas**. Sem isso, dados de um tenant
ficariam na tela do outro ate as consultas voltarem — exatamente o que um sistema
multi-tenant nao pode deixar acontecer, nem por um instante.

### `permissions.tsx` — a autorizacao na tela

Um hook sobre `GET /iam/whoami`, que devolve o papel e a lista efetiva de
permissoes para o tenant corrente. Dai saem o `useCan("crm.deal.write")`, o
componente `<Can>` e o `<PermissionButton>`.

O padrao e **travar, nao esconder**. Um botao fora do seu alcance fica
desabilitado com a permissao que falta no titulo. Entrando como
`diego@globex.test`, que e `member`, da para percorrer a aplicacao inteira e ver
onde o modelo morde — o que some da tela nao ensina nada.

O `owner` recebe tudo por atalho na propria funcao de autorizacao do backend, e o
`can()` daqui reproduz esse atalho para nao divergir dele.

### `toast.tsx` — o erro virando tela

Cada codigo do envelope tem uma leitura propria:

| Codigo | Como aparece |
|---|---|
| `VALIDATION_ERROR` | Erro por campo, no proprio formulario, a partir de `details.fields` |
| `BUSINESS_RULE_VIOLATION` | Aviso com a tabela de violacoes: recurso, limite, atual |
| `FORBIDDEN` | Estado vazio explicado, nomeando as permissoes de `details.missing` |
| `NOT_FOUND` / `CONFLICT` | Aviso curto com a mensagem do backend |
| `NETWORK_ERROR` | "A API esta no ar? (make up)", com o endereco configurado |

Todo aviso de erro carrega o `requestId`, que e o mesmo da linha correspondente
em `make logs`. Achar o rastro de um erro no servidor leva um `grep`.

## Como uma escrita atravessa a aplicacao

Criar um negocio, do clique ao banco:

```
DealFormDialog          coleta os campos, reais viram centavos inteiros
useApiMutation          contorno unico de toda escrita: chama, invalida, avisa
crmApi.createDeal       monta o corpo conforme CreateDealSchema
api.post                injeta Authorization e x-tenant-id, serializa
  ── rede ──
EdgeFunction            confere a assinatura do JWT
ContextFactory          resolve tenant, vinculo e permissoes
CreateDealUseCase       exige crm.deal.write e tenant ativo
Deal.create()           invariantes do dominio
DealRepository          grava passando pela RLS
  ── volta ──
api.post                desembrulha `data`, ou lanca ApiError
useApiMutation          invalida ["deals"] e ["pipeline"], mostra o aviso
```

O `useApiMutation` existe porque toda escrita faz as mesmas quatro coisas.
Cada tela so diz o que chamar, o que invalidar e o que dizer quando der certo.

## As telas

**Entrada e tenant.** Login com os quatro usuarios semeados em um clique. Quem
nao pertence a nenhum tenant cai na tela de criacao. Aceite de convite le o token
da URL e entra direto.

**tenancy.** Membros com troca de papel e remocao. Convites com o token exibido
uma unica vez — o banco guarda so o hash SHA-256, entao fechar o dialogo perde o
token de vez. Ajustes com suspender e reativar.

**iam.** O catalogo das 37 permissoes marcando o que voce alcanca. Papeis com um
editor onde permissao que voce nao possui aparece travada, que e a regra de
escalonamento do dominio. Chaves de API com o segredo mostrado uma vez.

**crm.** O quadro do funil e a tela principal: arrastar um cartao chama a rota de
mudanca de estagio e o negocio adota a probabilidade do destino. Soltar em
"Ganho" ou "Perdido" nao passa por `/stage` — sao estados terminais com rotas
proprias, e a perda abre um dialogo que captura o motivo. Ao lado, lista e
detalhe com linha do tempo de atividades, mais empresas e contatos.

**projects.** Projetos com marcos, resumo e arquivamento. Tarefas com subtarefas,
comentarios e apontamento de horas. Quando a tarefa tem subtarefa em aberto, a
tela avisa antes de o dominio recusar a conclusao.

**billing.** Assinatura com o rateio detalhado da troca de plano, e a recusa
listando o que excedeu. Consumo com barras contra os limites. Faturas com linhas,
totais derivados, pagar e anular.

## Decisoes

**Sem biblioteca de componentes.** Uns dez componentes proprios em
`components/ui` cobrem tudo o que estas telas precisam. Trazer um design system
inteiro para isso custaria mais em peso e em regras a contornar do que economiza.

**TanStack Query para todo estado de servidor.** Cache, invalidacao e estados de
carregamento vem prontos. Um 4xx nao e repetido: o 401 ja passou pelo refresh, e
403, 404 e 422 sao respostas legitimas, nao falhas de rede.

**Dinheiro em centavos inteiros.** O backend devolve os centavos e, junto, a
versao ja formatada em pt-BR. A interface mostra a versao formatada dele e so
formata sozinha os totais que ela mesma soma.

**Datas de dia inteiro nao passam por fuso.** Campos como `dueDate` e
`expectedCloseDate` chegam como `"YYYY-MM-DD"` e sao exibidos por manipulacao de
texto. Passar por `new Date()` mudaria o dia para quem esta a oeste de Greenwich.

**Campo vazio vira `undefined`.** O validador do backend trata `""` e `null` como
ausentes, e um opcional enviado assim seria recusado. O helper `optional()` faz
essa traducao em todo formulario.

## Peculiaridades do backend que o cliente contorna

Nada aqui e defeito da interface; sao formas do backend que valem registrar.

- **`DELETE /iam/roles/:slug/permissions` responde 200 e nao revoga nada.** O
  backend nao le corpo em `DELETE`, entao a lista de permissoes a remover se
  perde no caminho e o papel volta intacto. Revogar vai por
  `PATCH /roles/:slug`, mandando o conjunto final inteiro — o que tambem e
  atomico do lado do banco. Verificado contra o stack: com a rota de `DELETE`, o
  papel continuou com as duas permissoes; com o `PATCH`, ficou com uma.
- **Nem toda listagem pagina.** `GET /tenancy/tenants`, `GET /iam/roles` e
  `GET /billing/plans` devolvem um vetor puro; `GET /iam/permissions`,
  `GET /crm/pipeline` e `GET /billing/usage` devolvem objetos proprios. Os tipos
  em `api/types.ts` refletem cada caso.
- **`sort` e nome de coluna, em snake_case**, enquanto as respostas vem em
  camelCase. Uma coluna inexistente vira 500, nao 422.
- **`null` nao limpa campo.** Nao ha como apagar um campo opcional pela API: o
  validador le `null` como ausente e o mantem como estava.
- **Nao existe `DELETE /crm/deals/:id`.** Negocio se encerra ganhando ou
  perdendo, nao apagando.
- **`GET /<modulo>/` devolve a lista de rotas vivas daquele modulo.** Util para
  conferir o contrato durante o desenvolvimento.

## Quando alguma coisa nao funciona

**"A API esta no ar? (make up)"** — o gateway nao respondeu. Confira com
`curl http://localhost:8000/health` e, se preciso, `make up`.

**Entra e volta para a tela de login** — a `VITE_ANON_KEY` provavelmente esta
vazia ou de uma geracao antiga de chaves. Rode `make web-env` na raiz e recarregue.

**Toda tela responde 403** — voce esta sem tenant escolhido, ou o papel do
usuario nao le aquele modulo. O rodape da barra lateral mostra o papel corrente e
quantas permissoes ele tem; a tela de permissoes mostra quais.

**Mudou o `JWT_SECRET`** — as chaves anteriores param de valer. `make keys`,
depois `make web-env`, depois recarregue a pagina.
