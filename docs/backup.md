# Backup e restore do banco

O plano free do Supabase nao tem backup que de para baixar. Este guia cobre o
nosso: `pg_dump` dos projetos dev e prod numa pasta local, e um restore que
devolve o banco ao estado do dump, conferido tabela por tabela. Custo zero:
roda na sua maquina, com o Postgres 17 em Docker.

```bash
make backup ENV=prod                                    # dump em backups/prod/<data UTC>/
DRY_RUN=1 make restore ENV=dev FROM=backups/dev/<data>  # ensaio: restaura, confere e desfaz
make restore ENV=dev FROM=backups/dev/<data>            # restaura de verdade (pede confirmacao)
```

homol e staging usam o banco de dev, entao os ambientes de backup sao so `dev`
e `prod`.

---

## Configurar

```bash
cp .env.backup.example .env.backup   # fora do git (.env.*)
chmod 600 .env.backup
```

Preencha `SUPABASE_DB_PASSWORD_DEV` e `SUPABASE_DB_PASSWORD_PROD` com a senha
do usuario `postgres` de cada projeto, a mesma dos secrets de mesmo nome no
GitHub. A conexao e pelo pooler em modo sessao
(`aws-0-sa-east-1.pooler.supabase.com:5432`). Ele e IPv4. O host direto
`db.<ref>.supabase.co` so tem IPv6 no plano free.

A senha so pode ser trocada pelo Dashboard ou pela Management API. O Supabase
recusa `alter role postgres` vindo de SQL. Para trocar pela API, com um token
pessoal (`sbp_...`):

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/database/password" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{"password":"<nova>"}'
```

Depois atualize o `.env.backup` e os secrets do GitHub:
`SUPABASE_DB_PASSWORD_DEV`/`_PROD` no repositorio e `SUPABASE_DB_PASSWORD` nos
environments dev, homol, staging e prod. O pooler pode levar alguns segundos
para aceitar a senha nova.

## O que entra no backup

Cada execucao cria `backups/<env>/<data UTC>/`, com permissao 700:

| Arquivo | Conteudo |
|---|---|
| `app.dump` | schemas `public`, `core`, `iam`, `crm`, `projects`, `billing`: estrutura e dados, incluindo policies, grants e triggers |
| `platform.dump` | so os dados de `auth` (usuarios, identidades, sessoes, com os hashes de senha) e de `supabase_migrations` (o historico que o health check e o drift leem) |
| `counts.tsv` | linhas por tabela, contadas no proprio dump. Prova que o arquivo le de ponta a ponta |
| `SHA256SUMS` | integridade. O restore recusa um dump alterado |

Ficam de fora, de proposito:
- `auth.schema_migrations`, que e do GoTrue e acompanha a versao dele, nao o
  backup;
- a estrutura de `auth`, `storage`, `realtime` etc., que e da plataforma;
- tudo o que nao mora no Postgres: arquivos do Storage (a aplicacao nao usa),
  configuracoes do projeto (Auth, schemas expostos na API), Edge Functions e
  seus secrets. Esses vem do repositorio e do pipeline de deploy.

Backups com mais de `BACKUP_KEEP_DAYS` dias (padrao 30) sao apagados a cada
execucao.

## Como o restore funciona

`scripts/backup/db-restore.sh` monta um unico script SQL e o roda numa
transacao:

1. derruba os schemas da aplicacao e os objetos de `public` que o dump recria;
2. esvazia as tabelas de `auth` e o historico de migrations;
3. cria a estrutura (tabelas, tipos, funcoes) a partir do `app.dump`;
4. carrega os dados de `auth`. Vem antes dos dados da aplicacao porque
   `core.memberships` aponta para `auth.users`;
5. carrega os dados da aplicacao;
6. cria indices, FKs, triggers, policies e grants;
7. confere a contagem de cada tabela com o `counts.tsv`. Se alguma diferir, a
   transacao e desfeita;
8. avisa o PostgREST para recarregar o schema e faz o commit.

Se qualquer passo falhar, o banco fica exatamente como estava. Com `DRY_RUN=1`
o script faz tudo e confere, mas termina em `rollback`: serve para ensaiar o
restore, inclusive o de um dump de prod sobre o banco de dev, sem efeito. Mesmo
assim o ensaio segura locks nas tabelas por alguns segundos.

So voltam do dump os objetos do usuario `postgres`. O resto e da plataforma: o
schema `public` (de `pg_database_owner`) e os default privileges do
`supabase_admin` ja existem em qualquer projeto, e o `postgres` nem tem
permissao para recria-los.

### Restaurar num projeto novo

Se o projeto se perder de vez:
1. crie o projeto;
2. aponte o environment do GitHub para ele e rode o deploy, que publica as Edge
   Functions e a configuracao;
3. rode o restore.

O restore recria os schemas sozinho, entao as migrations nao precisam ter
rodado antes. Se o deploy ja as aplicou, o restore as substitui.

## Agendar

Para um backup diario de prod as 3h, com `crontab -e`:

```cron
0 3 * * * cd /caminho/do/repo && make backup ENV=prod >> backups/cron.log 2>&1
```

O plano free pausa o projeto depois de 7 dias sem uso. Com o projeto pausado o
backup falha na conexao. Reative pelo Dashboard e rode de novo.

## Teste de restauracao (2026-10-01, dev)

Foi um teste destrutivo de verdade no projeto de dev:

1. `make backup ENV=dev`: 52 tabelas e 215 linhas em 3 s, 204 KB;
2. impressao digital do banco: md5 de 618 itens de estrutura (colunas,
   constraints, indices, policies, RLS, triggers, funcoes, tipos, grants) e do
   conteudo das 52 tabelas;
3. apagados os 5 schemas da aplicacao, `public.schema_version()`, todos os
   usuarios do Auth e o historico de migrations. A API passou a responder 404 no
   `rpc/schema_version` e o login passou a dar `invalid_credentials`;
4. `make restore ENV=dev FROM=...`: 9 s, 52 tabelas e 215 linhas conferidas;
5. impressao digital identica a de antes, na estrutura e nos dados. O login
   voltou com a senha de antes e `tenancy/tenants`, `iam/whoami` e
   `billing/plans` responderam 200 com RLS.

Um dump com 1 byte alterado foi recusado na conferencia do SHA256, antes de
tocar no banco. O dump de prod do mesmo dia passou no ensaio (`DRY_RUN=1`)
sobre o banco de dev.
