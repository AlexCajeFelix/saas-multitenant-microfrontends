# Alertas do ambiente dev

Um Prometheus com Alertmanager rodando nesta maquina, em Docker, vigia o
ambiente dev: o site na Vercel, o projeto Supabase de dev (Auth, banco, Edge
Functions e as metricas do Postgres), o ultimo deploy da `develop` e o backup
automatico do banco de dev. Os alertas chegam num ntfy local, que guarda o
historico, e viram notificacao no desktop. Nada sai da maquina alem das
proprias sondas, e nada e pago.

```bash
make alerts-up       # sobe tudo e liga a notificacao no desktop
make alerts-test     # manda um alerta de teste pelo caminho inteiro
make alerts-status   # o que e vigiado, o que falha, o que esta disparando
make alerts-key      # grava a chave secreta: liga os alertas de banco
make alerts-down     # desliga (o historico fica)
make alerts-check    # valida a configuracao e roda os testes das regras
```

So o dev. homol e staging usam o mesmo projeto Supabase, entao os alertas de
Supabase valem para eles tambem; os de site e deploy sao so do dev.

---

## Onde os alertas chegam

| Onde | Como |
|---|---|
| Notificacao do desktop | servico do usuario `saas-alertas-desktop`, instalado pelo `make alerts-up`. Critico fica na tela ate ser dispensado, aviso e resolvido somem sozinhos |
| Caixa de entrada | http://localhost:8090/alertas-dev, o ntfy. Guarda 7 dias. Com a aba aberta, o navegador tambem notifica |
| Celular (opcional) | `ALERTS_BIND=0.0.0.0 make alerts-up` abre o ntfy na rede local; no app ntfy, assine `alertas-dev` no servidor `http://<ip-desta-maquina>:8090`. Sem senha: qualquer um na mesma rede le os alertas |
| Alertmanager | http://localhost:9093: o que esta disparando, e onde silenciar um alerta por um tempo |
| Prometheus | http://localhost:9090/alerts: as regras, o que esta pendente, os alvos |

Cada notificacao junta os alertas de mesmo nome (tres zonas fora viram uma
mensagem so) e diz o que fazer:

```
🔴 Site de dev fora do ar (2)
• crm: https://alexcaje-saas-dev.vercel.app/crm/funil
  Falhando ha 5 min. Sem o bundle certo, o rewrite do shell para a zona pode ter quebrado...
• iam: https://alexcaje-saas-dev.vercel.app/iam/papeis
```

Quando o problema some, chega `✅ Resolvido: ...`. Alerta que continua
disparando repete a cada 3 h (critico) ou 12 h (aviso).

## O que e vigiado

| Alerta | Dispara quando | |
|---|---|---|
| `SiteDevFora` | o shell ou a rota de uma zona falha por 5 min. A sonda confere o bundle no HTML: se o rewrite do shell quebra, a Vercel devolve o index do shell com 200, e so o corpo denuncia | critico |
| `SupabaseDevFora` | Auth e PostgREST falham juntos por 5 min: o projeto caiu ou foi pausado pelo plano free. Cala os outros alertas de Supabase | critico |
| `SupabaseApiDevFalhando` | so um dos dois falha por 5 min | aviso |
| `EdgeFunctionDevFora` | o `/health` de uma das cinco funcoes falha por 8 min | critico |
| `DeployDevFalhou` | o ultimo run do workflow Deploy na `develop` terminou em falha. Resolve no proximo deploy que der certo | critico |
| `DeployDevTravado` | o ultimo run esta na fila ou rodando ha mais de 45 min (o timeout do job e 40) | aviso |
| `ConsultaDoDeployFalhando` | a API do GitHub nao respondeu por 30 min | aviso |
| `BackupDevFalhou` | o backup automatico do dev (`make backup-schedule`) falhou | aviso |
| `BackupDevAtrasado` | o ultimo backup conferido tem mais de 26 h, por 90 min | aviso |
| `SemInternet` | esta maquina perdeu a internet. Cala os alertas de site, Supabase e deploy, que seriam falsos | aviso |
| `ComponenteDosAlertasFora` | um dos containers do monitoramento nao responde por 5 min | aviso |

Com a chave secreta (`make alerts-key`), mais estes, pela Metrics API do
Supabase:

| Alerta | Dispara quando | |
|---|---|---|
| `BancoDevFora` | o Supabase informa o Postgres parado por 5 min | critico |
| `BancoDevSomenteLeitura` | o banco entrou em modo somente leitura (o Supabase faz isso com o disco acima de 95%) | critico |
| `BancoDevPertoDoLimite` | o banco passa de 400 MB, 80% dos 500 MB do plano free, por 30 min | aviso |
| `DiscoDevQuaseCheio` | o disco do banco passa de 80% por 30 min | aviso |
| `ConexoesDevAltas` | mais de 80% das conexoes em uso por 10 min | aviso |
| `CpuDevAlta` | CPU acima de 90% por 15 min | aviso |
| `MemoriaDevAlta` | memoria acima de 95% por 15 min | aviso |
| `MetricasDoBancoSemAcesso` | a Metrics API recusa a chave ou nao responde por 10 min | aviso |

Os prazos (`for:`) existem para um soluco de rede nao virar alerta. O do
deploy e zero: um run que falhou ja e o fato.

## Como funciona

```
                     sondas HTTP                       regras                agrupa, silencia
site (Vercel) ◀──── blackbox ────┐
Supabase dev  ◀──── blackbox ────┤
Metrics API   ◀──────────────────┼──▶ Prometheus ──▶ alertas.yml ──▶ Alertmanager ──▶ ntfy ──▶ desktop
GitHub API    ◀── json-exporter ─┤      :9090                          :9093          :8090
db-auto.sh (cron) ─▶ pushgateway ┘
```

| Arquivo | O que tem |
|---|---|
| `monitoring/docker-compose.yml` | os seis containers, com versoes fixas, portas so em 127.0.0.1 |
| `monitoring/prometheus/prometheus.yml` | o que coletar e de quanto em quanto tempo |
| `monitoring/prometheus/alertas.yml` | as regras |
| `monitoring/prometheus/alertas_test.yml` | testes das regras, com series simuladas |
| `monitoring/alertmanager/alertmanager.yml` | agrupamento, repeticao e o que cala o que |
| `monitoring/blackbox/blackbox.yml` | o que cada sonda exige da resposta |
| `monitoring/json-exporter/github.yml` | o ultimo run do Deploy virando metrica |
| `monitoring/ntfy/templates/alertas.yml` | titulo, texto e prioridade da notificacao |
| `monitoring/targets/` | os alvos, gerados pelo `up.sh` (fora do git) |
| `scripts/alerts/` | subir, descer, testar, status, chave, e a ponte para o desktop |

O backup automatico (`scripts/backup/db-auto.sh`) empurra o resultado de cada
execucao para o Pushgateway. Com o monitoramento desligado, o envio falha calado
e o backup segue igual. O `make alerts-up` tambem empurra a hora do ultimo
backup conferido de cada ambiente (o `.last-run`), entao o alerta de atraso vale
desde o primeiro minuto. `make backup-unschedule` tira o backup do alerta:
desligado de proposito nao e atraso.

## Configurar

Nada a mao. Na primeira vez, o `make alerts-up` cria o `.env.alerts` (fora do
git, 600) com o environment `dev` do GitHub, lido pelo `gh`: a URL e a chave
publishable do Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) e o prefixo da
Vercel (`VERCEL_ALIAS_PREFIX`). O `.env.alerts.example` mostra as chaves, para
quem preferir preencher a mao.

### Chave secreta (alertas de banco)

A Metrics API do Supabase pede a chave secreta do projeto. Crie uma em
*Project Settings > API Keys > Secret keys* (pode ser so para isto, e da para
revogar quando quiser) e rode:

```bash
make alerts-key   # pede a chave sem eco, confere contra a API e grava no .env.alerts
```

Sem ela, os alertas de banco ficam de fora, e o resto funciona. O `up.sh`
tambem aceita a `SUPABASE_SECRET_KEY_DEV` ou um `SUPABASE_ACCESS_TOKEN` do
`.env.backup`. A chave chega ao Prometheus por um secret do compose, nunca pela
configuracao. Se ela for trocada, o alerta `MetricasDoBancoSemAcesso` avisa.

### Mudar a configuracao

Edite os arquivos de `monitoring/`, rode `make alerts-check` e depois
`make alerts-up`, que recarrega o Prometheus e o Alertmanager sem perder nada.
Mudancas no `server.yml` do ntfy pedem `make alerts-down && make alerts-up`.

## Cotas

Contas para a maquina ligada o mes inteiro (43.200 min). Desligada a noite, cai
pela metade.

| Sonda | Intervalo | Por mes | Cota gratis |
|---|---|---|---|
| site: shell + 5 zonas | 2 min | 130 mil requisicoes, ~190 MB | Vercel Hobby: 1 milhao de edge requests (13%), 100 GB de transferencia |
| Auth e PostgREST | 2 min | 43 mil requisicoes, ~35 MB de egress | Supabase free: 5 GB de egress (0,7%) |
| Edge Functions | 4 min | 54 mil invocacoes | Supabase free: 500 mil invocacoes (11%) |
| Metrics API (com a chave) | 1 min | 43 mil requisicoes | o Supabase recomenda 1 min |
| API do GitHub | 4 min | 15 consultas por hora | 60 por hora por IP, sem token |

As cotas do Supabase sao da organizacao, somando dev e prod; as do backup
estao no [guia de backup](backup.md#egress-e-limites-do-bucket). O uso do mes
fica em Dashboard > Organization > Usage, no Supabase, e em Usage, na Vercel.

## Limites

- **So com esta maquina ligada.** Desligada, ou com o Docker parado, nao ha
  alerta nenhum. Isto nao substitui um monitor externo de disponibilidade.
- **As sondas contam como uso do projeto.** Batendo no Supabase de 2 em 2
  minutos, o dev provavelmente nao chega aos 7 dias sem uso que fazem o plano
  free pausar o projeto, enquanto esta maquina estiver ligada. Se pausar mesmo
  assim, o `SupabaseDevFora` avisa.
- **Deploy e o ultimo run da branch.** O alerta olha o ultimo run do workflow
  Deploy na `develop`. Um rollback disparado a mao a partir da `develop` para
  outro ambiente conta como dev.
- **O ntfy nao tem senha.** Ele escuta so em 127.0.0.1, a menos que
  `ALERTS_BIND` diga o contrario.

## Conferido em 2026-10-06

- `make alerts-check`: configuracao valida, 19 regras, todos os testes de
  `alertas_test.yml` passando;
- `make alerts-up` com o dev saudavel: 21 alvos ok e nenhum alerta;
- sondas contra alvos quebrados: rota inexistente (a Vercel devolve o index do
  shell com 200) reprova a sonda de zona, Auth e PostgREST sem chave (401) e
  funcao inexistente (404) reprovam;
- `make alerts-test`: o alerta passou pelo Alertmanager, chegou no ntfy e
  apareceu no desktop.
