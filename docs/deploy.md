# Micro frontends, ambientes e deploy

## Visao geral

```
                         navegador
                             │
              https://<prefixo>[-<amb>].vercel.app        (shell: dono do dominio)
                             │
   ┌─────────────┬───────────┼────────────┬──────────────┬──────────────┐
   │ /, /login,  │ /tenancy/*│ /iam/*     │ /crm/*       │ /projetos/*  │ /billing/*
   │ /tenants    │           │            │              │ /tarefas/*   │
   ▼             ▼           ▼            ▼              ▼              ▼
 shell        tenancy       iam          crm          projects       billing     ← 6 projetos Vercel
   └─────────────┴───────────┴─────┬──────┴──────────────┴──────────────┘
                                   │  Authorization + x-tenant-id
                                   ▼
          Supabase (dev ou prod): Auth · PostgREST · Edge Functions · Postgres com RLS
```

O front foi dividido em **seis zonas** (multi-zones da Vercel), uma por modulo
de negocio, espelhando as cinco Edge Functions. O shell cuida do login, da
escolha de tenant e da visao geral, e repassa por rewrite os prefixos de cada
zona para o projeto dela.

| Zona | Rotas | Codigo |
|---|---|---|
| shell | `/`, `/login`, `/tenants`, `/convite` | `apps/shell` |
| tenancy | `/tenancy/*` | `apps/tenancy` |
| iam | `/iam/*` | `apps/iam` |
| crm | `/crm/*` | `apps/crm` |
| projects | `/projetos/*`, `/tarefas/*` | `apps/projects` |
| billing | `/billing/*` | `apps/billing` |

O que as zonas compartilham mora em `packages/platform`: sessao, tenant,
permissoes, cliente HTTP, clientes da API, componentes e o layout com o menu.
Cada zona so tem as proprias telas e um `main.tsx` que chama `mountZone`.

**Por que multi-zones e nao Module Federation.** Cada zona e um site estatico
independente, sem runtime compartilhado para versionar. O custo e um
carregamento de pagina ao trocar de modulo pelo menu. Sessao e tenant continuam
valendo depois do salto porque ficam no `localStorage` do mesmo dominio, ja que o
shell serve todas as zonas pelo proprio endereco.

**Links entre zonas.** Use `AppLink`, `AppNavLink` e `AppNavigate` de
`@saas/platform/components/AppLink`. Se o destino e da mesma zona, eles viram
navegacao do react-router. Se e de outra zona, viram `<a href>`. O mapa de
prefixos fica em `packages/platform/src/lib/zones.ts` e e a unica fonte da
verdade: o proxy de dev, os rewrites da Vercel e os links leem dele.

### Desenvolvimento local

```bash
make up && make seed   # backend no docker compose
make web               # as 6 zonas; abra http://localhost:3000
```

Em dev, o Vite do shell faz o papel dos rewrites da Vercel e repassa cada
prefixo para o dev server da zona (portas 3001 a 3005).

## Ambientes

| Branch | Ambiente | Front (Vercel) | Supabase |
|---|---|---|---|
| `develop` | dev | `<prefixo>-dev.vercel.app` | projeto **dev** |
| `homol` | homol | `<prefixo>-homol.vercel.app` | projeto **dev** |
| `staging` | staging | `<prefixo>-staging.vercel.app` | projeto **dev** |
| `main` | prod | `<prefixo>.vercel.app` | projeto **prod** |

O plano gratis do Supabase permite dois projetos ativos, entao homol e staging
usam o banco de dev. Projeto gratis sem uso por 7 dias e pausado. Para
reativar, use o dashboard.

Fluxo de promocao, validado pelo check `promotion`:

```
feature/*  ──PR──▶  develop  ──PR──▶  homol  ──PR──▶  staging  ──PR──▶  main
hotfix/*   ──PR──────────────────────────────────────────────────────▶  main  (depois volta para develop)
```

## Pipeline

### CI, em todo PR (`.github/workflows/ci.yml`)

| Check | O que faz |
|---|---|
| `promotion` | recusa PR fora do fluxo acima |
| `quality` | prettier, eslint, tsc, knip (codigo morto e dependencia sobrando), build das 6 zonas |
| `edge-functions` | `deno fmt`, `deno lint`, `deno check` nas cinco funcoes |
| `migrations` | aplica todas as migrations num Postgres Supabase limpo e roda `supabase db lint` |
| `drift` | compara o banco que o PR vai atingir com o repositorio (ver abaixo) |
| `secrets` | gitleaks no historico |

Os seis sao checks obrigatorios nos rulesets.

### Deploy, em push nas branches de ambiente (`.github/workflows/deploy.yml`)

Estrategia **Recreate**: um job, etapas em sequencia, sem blue/green. Se uma
etapa falha, as seguintes nao rodam. Um deploy por ambiente de cada vez; o
seguinte espera na fila.

1. **Banco**: migrations e Edge Functions sobem pela integracao GitHub do
   Supabase (`SUPABASE_DEPLOY_MODE=integration`) ou pelo proprio pipeline
   (`cli`). Depois o pipeline expoe os schemas dos modulos na API e espera
   `schema_version()` chegar na ultima migration do repositorio.
2. **Drift pos-deploy**: o schema real tem que bater exatamente com o das
   migrations.
3. **Zonas**: build e deploy das cinco, cada uma no alias do ambiente.
4. **Shell**: build e deploy, com os rewrites apontando para as zonas daquele
   ambiente.
5. **Health check** (`scripts/deploy/health-check.sh`): pela URL publica,
   confere que o shell e as cinco zonas servem **o commit deste deploy**
   (`version.json`), que cada rota de zona entrega o bundle certo, que o Auth
   responde, que o banco esta na migration certa e que as cinco Edge Functions
   respondem.

**Rollback**: *Actions → Deploy → Run workflow*, escolha o ambiente e informe em
`ref` o commit bom. O Recreate roda de novo na versao antiga. Migrations nao
voltam, entao nesse caso o health check aceita o banco a frente da versao.

### Drift

`scripts/deploy/supabase-drift.sh <ref>` faz tres perguntas:

1. Existe no banco alguma migration que nao esta no repositorio? Isso quer dizer
   que alguem mexeu por fora, e o check **falha**.
2. Existe no repositorio alguma migration ainda nao aplicada? No PR, isso e
   **aviso**: o resumo do job lista o que o merge vai subir. Depois do deploy, e
   **falha**.
3. O schema real bate com o que as migrations produzem? Qualquer diferenca de
   `supabase db diff` e drift e **falha**.

Para criar uma migration nova, use `supabase migration new <nome>` e escreva o SQL.

## Configuracao (uma vez)

### GitHub

`scripts/setup/github.sh <owner/repo>` cria os quatro environments (cada um
publicavel so pela sua branch, e prod com aprovacao), as variaveis e os
rulesets:

- **ambientes** (develop, homol, staging, main): so por PR, os seis checks
  verdes e atualizados, sem force push e sem delete.
- **producao** (main): alem disso, 1 aprovacao e merge commit. O admin pode
  fazer bypass quando trabalha sozinho.
- **tags** (`v*`): imutaveis.

Rulesets e protecao de environment sao gratis em repositorio **publico**. Em
repositorio privado, exigem GitHub Pro ou Team.

| Onde | Nome | Valor |
|---|---|---|
| secret do repo | `SUPABASE_ACCESS_TOKEN` | token pessoal: supabase.com/dashboard/account/tokens |
| secret do repo | `VERCEL_TOKEN` | vercel.com/account/tokens |
| var do repo | `VERCEL_SCOPE` | opcional: slug do time na Vercel (sem ele, a conta dona do token) |
| var do repo | `VERCEL_ALIAS_PREFIX` | prefixo unico dos dominios `*.vercel.app` |
| var do repo | `SUPABASE_REF_DEV`, `SUPABASE_REF_PROD` | ref de cada projeto (usado pelo `drift` no PR) |
| var do repo | `SUPABASE_DEPLOY_MODE` | `integration` (padrao) ou `cli` |
| var do environment | `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` | do projeto daquele ambiente; a chave e a *publishable* |
| var do environment | `SHOW_DEMO_USERS` | `true` fora de prod |

Nenhum segredo vai para o bundle do front. A chave *publishable* e publica por
definicao, e a protecao dos dados vem da RLS.

### Supabase: integracao GitHub

Em cada projeto, va em *Project Settings → Integrations → GitHub* e conecte este
repositorio. Em *Supabase directory*, informe `.`, a raiz onde fica a pasta
`supabase/`. Depois ligue **Deploy to production**:

| Projeto | Branch de producao |
|---|---|
| dev | `develop` |
| prod | `main` |

Enquanto a integracao nao estiver ligada, use `SUPABASE_DEPLOY_MODE=cli`: o
pipeline aplica migrations e funcoes pelo CLI. Depois de ligar, troque para
`integration`, e o pipeline passa a so esperar e verificar.

A integracao nao aplica a secao `[api]` do `config.toml`. Por isso o pipeline
expoe os schemas `core, iam, crm, projects, billing` pela Management API a cada
deploy.

### Vercel

Nada a configurar a mao. Na primeira vez, o pipeline cria os seis projetos
(`<prefixo>-shell`, `<prefixo>-crm`...). Todos sao sites estaticos, sem build
na Vercel e com a Deployment Protection desligada, porque o shell precisa buscar
as zonas por rewrite. O conteudo e o mesmo bundle publico que o navegador
baixaria de qualquer jeito.

Vercel Hobby e para uso **nao comercial**. Se o projeto virar produto, passe
para o Pro ou mude o destino dos deploys.
