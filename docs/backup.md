# Backup e restore do banco

O plano free do Supabase nao tem backup. O Pro tem um backup diario e guarda
os ultimos 7 dias. Este guia cobre o equivalente local e de graca: um
`pg_dump` diario dos projetos dev e prod numa pasta desta maquina, com os 7
ultimos guardados, e um restore que devolve o banco a qualquer um deles,
conferido tabela por tabela. O Postgres 17 roda em Docker.

```bash
make backup-schedule                       # liga o backup automatico diario (crontab)
make backups ENV=prod                      # lista os pontos de restauracao
make restore ENV=prod FROM=2026-10-01      # restaura (pede para digitar o ambiente)
make restore ENV=prod                      # o mais recente (FROM=latest)
DRY_RUN=1 make restore ENV=dev FROM=...    # ensaio: restaura, confere e desfaz
make backup ENV=prod                       # backup manual, na hora
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
(`aws-0-sa-east-1.pooler.supabase.com:5432`), que e IPv4: o host direto
`db.<ref>.supabase.co` so tem IPv6 no plano free. Variaveis passadas na linha
de comando ganham do arquivo (`BACKUP_KEEP=3 make backup`).

A senha so muda pelo Dashboard ou pela Management API. O Supabase recusa
`alter role postgres` vindo de SQL. Com um token pessoal (`sbp_...`):

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/database/password" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" -d '{"password":"<nova>"}'
```

Depois atualize o `.env.backup` e os secrets do GitHub:
`SUPABASE_DB_PASSWORD_DEV`/`_PROD` no repositorio e `SUPABASE_DB_PASSWORD` nos
environments dev, homol, staging e prod.

## Automatico, como no Pro

`make backup-schedule` poe no crontab uma linha que chama
`scripts/backup/db-auto.sh` de hora em hora. Para cada ambiente de
`BACKUP_ENVS`, se a ultima verificacao tem mais de `BACKUP_INTERVAL_HOURS`
(24), ele:

1. pergunta ao banco se algo mudou desde o ultimo backup. A consulta roda no
   servidor e devolve ~100 bytes: os contadores de linhas inseridas, alteradas
   e apagadas, um md5 da estrutura e a hora em que o Postgres subiu (se ele
   reiniciou, os contadores zeram, e na duvida faz backup);
2. se mudou, faz o dump. Se nao mudou, so registra a verificacao.

Rodar de hora em hora, e nao uma vez por dia, garante o backup mesmo que a
maquina estivesse desligada no horario. Se falhar (sem internet, ou o projeto
pausado pelo plano free depois de 7 dias sem uso), ele tenta de novo na hora
seguinte. Tudo vai para `backups/backup.log`. `make backup-unschedule`
desliga.

### Retencao

Ficam os `BACKUP_KEEP` (7) backups mais recentes de cada ambiente. O mais
antigo so e apagado **depois** que o novo terminou e foi conferido, entao nunca
existem menos de 7 pontos validos.

A contagem e por quantidade, nao por dias. Como dias sem mudanca nao geram
backup, contar dias apagaria justamente o unico backup que vale quando o banco
fica parado. Com o banco mudando todo dia, sao os ultimos 7 dias, como no Pro.
Com o banco parado, os 7 continuam la, cobrindo mais tempo.

## O que entra no backup

Cada backup e uma pasta `backups/<env>/<data UTC>/`, com permissao 700:

| Arquivo | Conteudo |
|---|---|
| `db.dump` | um `pg_dump` so, uma foto consistente do banco: estrutura e dados de `public`, `core`, `iam`, `crm`, `projects`, `billing` (policies, grants e triggers inclusos), mais os dados de `auth` (usuarios, identidades, sessoes, com os hashes de senha) e de `supabase_migrations` |
| `counts.tsv` | linhas por tabela, contadas no proprio dump. Prova que o arquivo le de ponta a ponta |
| `state` | o estado do banco no backup, para o "mudou?" do proximo |
| `SHA256SUMS` | integridade. O restore recusa um backup alterado |

Ficam de fora, de proposito:
- `auth.schema_migrations`, que e do GoTrue e acompanha a versao dele;
- a estrutura de `auth`, `storage`, `realtime` etc., que e da plataforma;
- tudo o que nao mora no Postgres: arquivos do Storage (a aplicacao nao usa),
  configuracoes do projeto (Auth, schemas expostos na API), Edge Functions e
  seus secrets. Esses vem do repositorio e do pipeline de deploy.

## Como o restore funciona

`scripts/backup/db-restore.sh` monta um unico script SQL e o roda numa
transacao:

1. derruba os schemas da aplicacao e os objetos de `public` que o dump recria;
2. esvazia as tabelas de `auth` e o historico de migrations;
3. cria a estrutura (tabelas, tipos, funcoes);
4. carrega os dados de `auth`, na ordem das FKs (`users` antes de
   `identities`). As tabelas de `auth` ja existem com as FKs valendo, entao a
   ordem sai das FKs do proprio dump, via `tsort`. Vem antes dos dados da
   aplicacao porque `core.memberships` aponta para `auth.users`;
5. carrega os dados da aplicacao;
6. cria indices, FKs, triggers, policies e grants;
7. confere a contagem de cada tabela com o `counts.tsv`. Se alguma diferir, a
   transacao e desfeita;
8. ajusta as sequencias. Nunca ficam abaixo do maior id restaurado, mesmo que
   o dump tenha pego uma sequencia atrasada;
9. avisa o PostgREST para recarregar o schema e faz o commit.

Se qualquer passo ate o 7 falhar, o banco fica exatamente como estava. As
sequencias ficam para o passo 8, depois da conferencia, porque `setval` nao e
transacional: um rollback nao o desfaz. Pelo mesmo motivo o ensaio
(`DRY_RUN=1`) faz os passos 1 a 7 e desfaz, sem nunca chegar no 8: nao deixa
efeito nenhum. Mesmo assim ele segura locks nas tabelas por alguns segundos.

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

## Egress

O plano free tem 5 GB/mes de egress somados entre todos os servicos. O dump
aparece no painel como "Shared Pooler Egress". Medido em 2026-10-01, com o
banco de ~12 MB:

| Operacao | Egress |
|---|---|
| verificacao "mudou?" | 5 KB |
| backup completo | 1,2 MB, quase tudo metadado: o `pg_dump` le o catalogo inteiro |
| restore | ~84 KB (o restore envia dados, e entrada nao conta) |

Backup diario de dev e prod com o banco mudando todo dia: ~75 MB/mes (1,5% da
cota). Nos dias sem mudanca, 5 KB. O protocolo do Postgres nao comprime: com o
banco grande, cada backup puxa mais ou menos o tamanho dos dados. Perto de
~150 MB, o diario sozinho passaria da cota do free.

## Testes de restauracao (2026-10-01, dev)

Os dois testes foram destrutivos de verdade, no projeto de dev. Em cada um:
impressao digital do banco (md5 de 618 itens de estrutura e do conteudo das 52
tabelas), apagar os 5 schemas, `public.schema_version()`, todos os usuarios do
Auth e o historico de migrations (a API passou a falhar e o login a dar
`invalid_credentials`), restaurar e comparar.

1. **Formato com dois dumps:** 9 s; impressao digital identica; login e Edge
   Functions ok.
2. **Formato de dump unico:** 6 s; impressao digital identica. Este teste
   achou dois bugs, ja corrigidos:
   - os dados de `auth` precisavam entrar na ordem das FKs (o ensaio pegou,
     sem efeito);
   - ensaios anteriores tinham voltado a sequencia de `auth.refresh_tokens`
     (`setval` nao e transacional), e o login dava chave duplicada. Corrigido
     com as sequencias no fim, fora do ensaio, e nunca abaixo do maior id. O
     restore do backup que tinha capturado a sequencia atrasada a corrigiu: o
     login voltou e a impressao digital ficou identica.

Tambem testado: um dump com 1 byte alterado e recusado no SHA256 antes de tocar
no banco; o ensaio nao muda a sequencia; o dump de prod passa no ensaio sobre
o banco de dev; a retencao mantem os 7 mais recentes; o `db-auto.sh` funciona
no ambiente minimo do cron.
