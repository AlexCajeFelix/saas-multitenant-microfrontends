# SaaS multi-tenant — Supabase, Edge Functions e arquitetura hexagonal

SaaS de gestao completo, do banco a tela. Cinco modulos de negocio publicados
como Edge Functions em Deno, sobre um Postgres multi-tenant com Row Level
Security, mais uma interface em React que consome a API inteira. Roda tudo no
Docker, na sua maquina, sem o Supabase CLI.

```
React + Vite :3000  →  nginx :8000  →  GoTrue      (/auth/v1)
                                    →  PostgREST   (/rest/v1)
                                    →  edge-runtime(/functions/v1) → tenancy iam crm projects billing
                                                                            ↓
                                                                Postgres com RLS por tenant
```

O backend esta em `supabase/functions/`, um diretorio por modulo. O frontend
esta em `web/`, com [README proprio](web/README.md) explicando como ele fala com
a API e por que foi montado assim.

---

## Comecando

Precisa apenas de Docker, Docker Compose e Node (para gerar as chaves JWT).

```bash
make up      # gera o .env, sobe tudo e aplica as migrations
make seed    # cria 4 usuarios e popula dois tenants de demonstracao
make web     # sobe a interface em http://localhost:3000
```

Abra `http://localhost:3000`, clique em um dos usuarios de demonstracao no
rodape da tela de entrada e voce ja esta dentro de um tenant populado.

A API fica em `http://localhost:8000` e o Postgres em `localhost:54322`
(usuario `postgres`, senha do `.env`; a porta 5432 costuma estar ocupada).

Para conferir que esta tudo de pe:

```bash
make smoke      # 53 verificacoes ponta a ponta nos cinco modulos
make test       # 38 testes de dominio e de aplicacao, sem banco
make web-build  # type-check e build de producao do frontend
```

`make help` lista os demais alvos: `down`, `reset`, `migrate`, `logs`, `psql`,
`check`, `restart-functions`, `web-env`.

Usuarios criados por `make seed`, todos com a senha `Password123!`:

| E-mail | Papel | Tenant |
|---|---|---|
| alice@acme.test | owner | acme |
| bruno@acme.test | manager | acme |
| carla@globex.test | owner | globex |
| diego@globex.test | member | globex |

### Uma primeira chamada

```bash
source .env
API=http://localhost:8000

TOKEN=$(curl -s -X POST "$API/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"alice@acme.test","password":"Password123!"}' | jq -r .access_token)

TENANT=$(curl -s "$API/functions/v1/tenancy/tenants" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

curl -s "$API/functions/v1/crm/pipeline" \
  -H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" | jq
```

A pasta `http/` traz a colecao completa de requisicoes, um arquivo por modulo,
para usar no REST Client do VS Code ou no cliente HTTP do JetBrains.

---

## Como o multi-tenant funciona

Banco compartilhado, schema compartilhado, coluna `tenant_id` em toda tabela de
negocio. O tenant corrente viaja no header `x-tenant-id` de cada requisicao.

Sao **tres barreiras**, e todas precisam passar:

**1. RLS no Postgres.** Cada tabela recebe quatro politicas geradas por
`core.enable_tenant_rls(schema, tabela, permissao_de_leitura, permissao_de_escrita)`.
Elas chamam `core.has_permission(tenant_id, '<permissao>')`, que resolve o
vinculo do usuario com o tenant e as permissoes do papel dele. Sao 25 tabelas e
89 politicas.

**2. Cliente escopado no usuario.** As Edge Functions conversam com o PostgREST
usando a chave `anon` mais o JWT de quem chamou, e nao a chave de servico. Por
isso a RLS realmente e exercida: o banco decide, nao o codigo. A chave de
servico aparece em quatro lugares, todos justificados por nao existir ainda um
vinculo que a RLS pudesse avaliar:

- criar um tenant (o usuario ainda nao e membro de nada);
- aceitar um convite (idem, e o token e a credencial);
- resolver o contexto de acesso (`core.access_context`);
- gravar auditoria e eventos de dominio.

**3. Filtro explicito por `tenant_id`** em todo repositorio, herdado de
`SupabaseRepository`. Redundante de proposito.

O efeito e o esperado mesmo fora das funcoes. Indo direto ao PostgREST com o
token de um usuario de outro tenant, a resposta vem sem nenhuma linha alheia,
por mais que o `x-tenant-id` peca:

```bash
curl "$API/rest/v1/deals?select=title,tenant_id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $TOKEN_DA_CARLA" \
  -H 'Accept-Profile: crm' -H "x-tenant-id: $TENANT_DA_ALICE"
# devolve apenas os negocios do tenant da Carla
```

### Papeis e permissoes

Permissoes tem a forma `modulo.recurso.acao` (37 no catalogo). Papeis agrupam
permissoes; os de sistema (`owner`, `admin`, `manager`, `member`, `viewer`) tem
`tenant_id` nulo e valem para todos, e cada tenant pode criar os seus, que tem
precedencia sobre o de mesmo nome. `owner` recebe tudo por atalho na propria
funcao de autorizacao, entao permissoes criadas depois ja o alcancam.

Duas regras de escalonamento vivem no dominio do IAM: ninguem concede a um
papel, nem a uma chave de API, permissao que nao possui; e so um dono nomeia
outro dono.

---

## Arquitetura hexagonal

Cada modulo tem quatro camadas, e as dependencias apontam sempre para dentro.

```
infrastructure/http/   controllers          adaptadores de entrada
        ↓
application/           casos de uso, DTOs   portas de entrada
        ↓
domain/                agregados, VOs,      o negocio, sem framework
                       eventos, servicos
        ↑
domain/ports.ts        interfaces           portas de saida
        ↑
infrastructure/persistence/  repositorios   adaptadores de saida
```

O dominio nao importa Supabase, nem HTTP, nem Deno. Quem materializa as portas
e o `container.ts` de cada modulo, montado por requisicao.

```
supabase/functions/<modulo>/
  index.ts                          composicao: EdgeFunction + rotas
  container.ts                      injecao de dependencias, getters preguicosos
  domain/
    entities.ts                     agregados e entidades filhas
    value-objects.ts                Money, DealStatus, PlanLimits, ...
    events.ts                       eventos de dominio
    ports.ts                        interfaces de repositorio
    services.ts                     regras entre agregados
  application/
    dto.ts                          schemas de entrada e presenters de saida
    use-cases/*.ts                  um objeto por operacao de negocio
  infrastructure/
    persistence/mappers.ts          agregado ↔ linha da tabela
    persistence/repositories.ts     adaptadores sobre o PostgREST
    http/controllers.ts             traducao HTTP → caso de uso
```

### O kernel compartilhado

`supabase/functions/_shared/` guarda o que os cinco modulos reaproveitam. Nao
depende de nada alem de `@supabase/supabase-js`; ate o validador e proprio.

| Arquivo | O que traz |
|---|---|
| `domain/core.ts` | `Guard`, `ValueObject`, `Entity`, `AggregateRoot`, `DomainEvent` |
| `domain/errors.ts` | `DomainError` e as sete subclasses, cada uma com codigo e status |
| `domain/value-objects.ts` | `Money`, `Email`, `Slug`, `Quantity`, `DateRange`, identificadores |
| `application/context.ts` | `RequestContext`: identidade, tenant e permissoes da requisicao |
| `application/use-case.ts` | `BaseUseCase`, que checa permissao antes de executar |
| `application/ports.ts` | `Logger`, `Clock`, `IdGenerator`, `EventPublisher`, `Page` |
| `application/validation.ts` | validador orientado a objetos, componivel, sem dependencia |
| `infrastructure/supabase.ts` | `SupabaseConnection`, `SupabaseRepository`, traducao de erro |
| `infrastructure/services.ts` | logger, relogio, hash, outbox, auditoria, diretorio de membros |
| `http/*` | `HttpRequest`, `HttpResponse`, `Router`, `EdgeFunction`, `JwtVerifier` |

### Um caso de uso, do inicio ao fim

```
POST /functions/v1/crm/deals
  EdgeFunction          monta requestId, verifica a assinatura do JWT
  ContextFactory        resolve tenant, vinculo e permissoes (core.access_context)
  CrmContainer          monta o grafo de dependencias desta requisicao
  DealController        valida o corpo com CreateDealSchema
  CreateDealUseCase     BaseUseCase confere crm.deal.write e tenant ativo
      PipelineRepository    carrega o funil configurado pelo tenant
      Deal.create()         invariantes: estagio valido, valor, data prevista
      DealRepository        grava passando pela RLS
      EventPublisher        enfileira crm.deal.created no outbox
      AuditTrail            registra quem fez o que
  DealPresenter         agregado → JSON
```

### Eventos e auditoria

Os agregados acumulam eventos e nao sabem o que acontece com eles. O
`OutboxEventPublisher` grava em `core.domain_events`, de onde um consumidor
externo pode ler. Toda operacao de escrita tambem deixa registro em
`core.audit_logs`, com ator, recurso e `request_id`.

---

## Os cinco modulos

### tenancy
Tenants, membros e convites. Criar um tenant provisiona o dono, o funil padrao
do CRM e a assinatura inicial, tudo por uma porta que esconde os outros modulos.
Convites carregam token de uso unico, guardado como hash SHA-256, e so sao
aceitos pelo e-mail convidado. O ultimo dono ativo nao pode ser removido nem
rebaixado, e ninguem se remove sozinho.

`POST|GET /tenants` · `GET|PATCH /tenants/:id` · `POST /tenants/:id/suspend|activate`
`GET /members` · `PATCH|DELETE /members/:userId`
`POST|GET /invitations` · `POST /invitations/accept` · `DELETE /invitations/:id`

### iam
Catalogo de permissoes, papeis do tenant, atribuicao a membros e chaves de API.
O segredo da chave aparece uma unica vez, na resposta da emissao. Trocar o
conjunto de permissoes de um papel e atomico, pela funcao
`iam.replace_role_permissions`.

`GET /permissions` · `GET /whoami` · `POST|GET /roles` · `GET|PATCH|DELETE /roles/:slug`
`POST|DELETE /roles/:slug/permissions` · `POST /assignments`
`POST|GET /api-keys` · `DELETE /api-keys/:id`

### crm
Empresas, contatos e o agregado `Deal`, que concentra a maquina de estados do
funil. Cada tenant configura seus estagios; o negocio adota a probabilidade do
estagio de destino; ganho e perda sao terminais e passam por rotas proprias,
que gravam data de fechamento e motivo. Atividades entram pelo agregado.

`POST|GET /companies` · `GET|PATCH|DELETE /companies/:id` · idem `/contacts`
`POST|GET /deals` · `GET|PATCH /deals/:id` · `POST /deals/:id/stage|win|lose`
`POST /deals/:id/activities` · `GET /pipeline`

### projects
Projetos com marcos, e tarefas com subtarefas, comentarios e apontamento de
horas. Uma tarefa nao e concluida enquanto tiver subtarefa em aberto; projeto
arquivado nao aceita trabalho novo; o responsavel precisa ser membro ativo do
tenant, verificado pela porta `MembershipDirectory`.

`POST|GET /projects` · `GET|PATCH /projects/:id` · `POST /projects/:id/status|archive|milestones`
`GET /projects/:id/summary`
`POST|GET /tasks` · `GET|PATCH /tasks/:id` · `POST /tasks/:id/assign|status|comments|time-entries`

### billing
Planos, assinaturas com rateio, consumo medido e faturas. Trocar de plano no
meio do periodo credita o que sobrou do antigo e cobra a mesma fracao do novo.
Descer de plano e recusado quando o consumo atual nao cabe nos novos limites,
regra do servico de dominio `PlanLimitPolicy`. Os totais da fatura sao sempre
derivados das linhas, e fatura paga e imutavel.

`GET /plans` · `POST /subscriptions` · `GET /subscriptions/current`
`POST /subscriptions/change-plan|cancel` · `POST|GET /usage`
`POST|GET /invoices` · `GET /invoices/:id` · `POST /invoices/:id/pay|void`

---

## Contrato da API

Toda resposta bem-sucedida vem envelopada em `data`:

```json
{ "data": { "id": "...", "title": "Sistema de PDV" } }
```

Listagens paginadas trazem a pagina junto:

```json
{ "data": { "items": [], "page": 1, "pageSize": 25, "total": 0,
            "totalPages": 0, "hasNext": false } }
```

Erros carregam codigo, mensagem e detalhes acionaveis:

```json
{ "error": { "code": "BUSINESS_RULE_VIOLATION",
             "message": "O consumo atual excede os limites do plano free",
             "details": { "violations": [{ "resource": "projects", "limit": 2, "current": 3 }] } },
  "requestId": "8049b28a-..." }
```

| Codigo | HTTP | Quando |
|---|---|---|
| `VALIDATION_ERROR` | 422 | corpo malformado ou invariante de value object |
| `UNAUTHORIZED` | 401 | sem token, token invalido ou expirado |
| `FORBIDDEN` | 403 | sem permissao, ou tenant que nao e seu |
| `NOT_FOUND` | 404 | nao existe, ou existe em outro tenant |
| `CONFLICT` | 409 | duplicidade |
| `BUSINESS_RULE_VIOLATION` | 409 | entrada correta, regra de negocio recusou |
| `INFRASTRUCTURE_ERROR` | 500 | falha do adaptador |

Cabecalhos de toda requisicao autenticada:

```
Authorization: Bearer <access_token do GoTrue>
x-tenant-id:   <uuid do tenant>
```

Parametros de listagem: `page`, `pageSize` (ate 100), `sort`, `order`, mais os
filtros proprios de cada rota.

---

## O frontend

Uma aplicacao React em `web/`, que consome os cinco modulos pela mesma API
publica documentada acima. Nao ha atalho: ela fala HTTP com o gateway, manda o
`Authorization` e o `x-tenant-id` como qualquer outro cliente, e apanha os
mesmos 403 que o `curl` apanharia.

```bash
make web        # instala, escreve web/.env.local e sobe o Vite na porta 3000
make web-build  # type-check e build de producao
```

A `ANON_KEY` e gerada por maquina a partir do seu `JWT_SECRET`, entao ela nao
mora no repositorio. O alvo `make web-env` copia a chave do `.env` da raiz para
`web/.env.local`; `make web` faz isso antes de subir.

### O que da para fazer nele

| Tela | O que ela exercita |
|---|---|
| Entrada | Grant de senha do GoTrue, com os quatro usuarios semeados em um clique |
| Tenants | `GET`/`POST /tenancy/tenants`, aceite de convite por token |
| Visao geral | Funil, limites do plano e projetos recentes, cada card degradando sozinho quando o papel nao le aquele modulo |
| Membros | Troca de papel e remocao, com a regra do ultimo dono aparecendo como erro explicado |
| Convites | Emissao com o token exibido uma unica vez, listagem e revogacao |
| Papeis | Editor de permissoes que trava o que voce mesmo nao possui — a regra de escalonamento do IAM, na tela |
| Permissoes | As 37 do catalogo, agrupadas por modulo, marcando o que o seu papel alcanca |
| Chaves de API | Emissao com escopos, segredo mostrado uma vez, revogacao |
| Funil | Quadro com arrastar e soltar; ganho e perda saem pelas rotas terminais, nao por `/stage` |
| Negocios | Lista com busca e filtro, detalhe com linha do tempo de atividades |
| Empresas e contatos | CRUD completo |
| Projetos | Marcos, resumo, mudanca de situacao e arquivamento |
| Tarefas | Subtarefas, comentarios, apontamento de horas, responsavel restrito a membro ativo |
| Assinatura | Troca de plano com o rateio detalhado, e a recusa listando o que excedeu |
| Consumo | Metricas do periodo e barras de consumo contra os limites do plano |
| Faturas | Emissao, linhas, totais derivados, pagar e anular |

### A ideia por tras

Tres decisoes moldam o resto, e as tres estao detalhadas no
[README do frontend](web/README.md):

**A autorizacao aparece, nao some.** Um botao que o seu papel nao alcanca fica
desabilitado, com a permissao que falta no titulo, em vez de sumir. Entrando
como `diego@globex.test`, que e `member`, da para ver exatamente onde o modelo
de permissoes morde.

**Erro de negocio nao vira "algo deu errado".** Cada codigo do envelope de erro
tem uma leitura propria: um 422 volta como erro por campo no formulario, um 409
de regra de negocio abre a tabela de violacoes, um 403 vira um estado vazio que
diz qual permissao faltou. Todo aviso carrega o `requestId`, que casa com a
linha correspondente em `make logs`.

**Trocar de tenant limpa o cache.** Sem isso, dados de um tenant apareceriam na
tela do outro enquanto as consultas nao voltassem. Num sistema multi-tenant,
isso e justamente o que nao pode acontecer.

---

## O stack local

| Servico | Imagem | Papel |
|---|---|---|
| `db` | `supabase/postgres:15.8.1.060` | Postgres, porta 54322 no host |
| `auth` | `supabase/gotrue:v2.177.0` | emissao de JWT, e-mail autoconfirmado |
| `rest` | `postgrest/postgrest:v12.2.12` | expoe `public,core,iam,crm,projects,billing` |
| `functions` | `supabase/edge-runtime:v1.69.12` | executa as cinco funcoes |
| `gateway` | `nginx:1.27-alpine` | roteia `/auth/v1`, `/rest/v1`, `/functions/v1` |
| `migrate` | `postgres:16-alpine` | aplica as migrations em ordem e sai |

Um detalhe importante do banco: a imagem `supabase/postgres` protege os papeis
`authenticator`, `service_role` e `supabase_auth_admin` — nem o usuario
`postgres` os altera. Por isso a migration 0001 cria um papel proprio,
`app_authenticator`, que e quem o PostgREST usa para conectar. Ele **nao** tem
`BYPASSRLS`, e e justamente essa diferenca que faz a RLS valer.

As chaves `anon` e `service_role` sao geradas por `scripts/generate-keys.mjs` a
partir do `JWT_SECRET` do seu `.env`. Nao ha chave fixa no repositorio.

### Migrations

```
0001_extensions_and_roles.sql   papeis, schemas, helpers de auth
0002_core_tenancy.sql           tenants, membros, convites, auditoria, outbox,
                                e a fabrica de politicas core.enable_tenant_rls
0003_iam.sql                    permissoes, papeis, chaves, core.has_permission
0004_crm.sql                    funil, empresas, contatos, negocios, atividades
0005_projects.sql               projetos, marcos, tarefas, comentarios, horas
0006_billing.sql                planos, assinaturas, consumo, faturas
0007_permissions_seed.sql       37 permissoes, 5 papeis de sistema, 4 planos
0008_rls_policies.sql           RLS em 25 tabelas
0009_iam_functions.sql          troca atomica das permissoes de um papel
```

Sao idempotentes: `make migrate` pode rodar quantas vezes precisar.

---

## Testes

`make test` roda 38 testes em Deno, sem banco, sem HTTP e sem Supabase. E a
demonstracao pratica de que o dominio esta isolado: os casos de uso rodam com
repositorios em memoria.

```
tests/domain/value-objects_test.ts        Money, Email, Slug, Quantity, DateRange
tests/domain/crm-deal_test.ts             maquina de estados do funil
tests/domain/projects-task_test.ts        conclusao com subtarefas, projeto arquivado
tests/domain/billing-subscription_test.ts rateio, limites de plano, fatura
tests/application/create-deal_test.ts     caso de uso com repositorios em memoria
```

`make smoke` roda 53 verificacoes contra o stack no ar, cobrindo os cinco
modulos e terminando com o teste de isolamento entre dois tenants.

`make check` faz o type-check das cinco funcoes.

---

## Onde as decisoes estao registradas

- **Sem transacao entre agregados.** O PostgREST nao encadeia instrucoes numa
  transacao, entao operacoes que precisam de atomicidade viram funcoes SQL
  (`iam.replace_role_permissions`, `billing.next_invoice_number`). Onde a
  atomicidade nao e critica, o repositorio grava a raiz e depois as filhas, e o
  agregado entrega o que ficou pendente por `pullNewX()`.
- **Leituras entre modulos.** Sao poucas e todas atras de porta: o `billing` le
  contagens de outros schemas por `billing.tenant_usage_snapshot`, o `projects`
  e o `iam` consultam membros pelo `MembershipDirectory`, e o `tenancy` provisiona
  CRM e faturamento por `TenantProvisioning`. Nenhum modulo importa o dominio de
  outro.
- **JWT verificado na funcao.** O runtime roda com `VERIFY_JWT` desligado porque
  a autorizacao e nossa; a assinatura e conferida em `JwtVerifier`, com o mesmo
  segredo do GoTrue. Sem isso, as operacoes que usam a chave de servico
  aceitariam um token forjado.
- **Ambiente de desenvolvimento.** O GoTrue conecta como `postgres` e confirma
  e-mails sozinho; as senhas do `.env` sao de exemplo. Para producao, troque o
  `JWT_SECRET`, gere as chaves de novo, use um usuario dedicado para o GoTrue e
  desligue `MAILER_AUTOCONFIRM`.
