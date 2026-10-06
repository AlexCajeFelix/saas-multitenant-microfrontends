SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

help: ## Lista os alvos disponiveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

keys: ## Cria o .env (se faltar) e gera ANON_KEY / SERVICE_ROLE_KEY
	@node scripts/generate-keys.mjs .env

up: keys ## Sobe todo o stack e aplica as migrations
	@# O GoTrue sobe antes das migrations: e ele quem cria auth.users,
	@# tabela referenciada por core.memberships.
	@$(COMPOSE) up -d --wait db auth
	@$(COMPOSE) run --rm migrate
	@$(COMPOSE) up -d
	@bash scripts/wait-for-gateway.sh
	@echo ""
	@echo "  API      http://localhost:$$(grep -E '^GATEWAY_PORT=' .env | cut -d= -f2)"
	@echo "  Postgres postgres://postgres@localhost:$$(grep -E '^POSTGRES_PORT=' .env | cut -d= -f2)/postgres"
	@echo ""
	@echo "  make seed   popula dois tenants de demonstracao"
	@echo "  make smoke  roda o teste ponta a ponta"
	@echo "  make web    sobe a interface em http://localhost:3000"
	@echo ""

down: ## Derruba o stack mantendo os dados
	@$(COMPOSE) down

reset: ## Derruba o stack e apaga o volume do banco
	@$(COMPOSE) down -v

migrate: ## Reaplica as migrations
	@$(COMPOSE) run --rm migrate

seed: ## Cria os usuarios de demonstracao e popula os dois tenants
	@bash scripts/seed.sh

logs: ## Segue os logs das Edge Functions
	@$(COMPOSE) logs -f functions

ps: ## Estado dos servicos
	@$(COMPOSE) ps

psql: ## Abre um psql no banco
	@$(COMPOSE) exec db psql -U postgres -d postgres

test: ## Roda os testes de dominio e de aplicacao (Deno em container)
	@docker run --rm -v "$(CURDIR)":/app -w /app -e DENO_DIR=/app/.deno_cache denoland/deno:2.1.4 deno test --allow-env --allow-read tests/

check: ## Type-check das cinco Edge Functions
	@docker run --rm -v "$(CURDIR)":/app -w /app -e DENO_DIR=/app/.deno_cache denoland/deno:2.1.4 deno check supabase/functions/*/index.ts

smoke: ## Teste ponta a ponta contra o stack no ar
	@bash scripts/smoke-test.sh

web-env: keys ## Escreve o .env.local (VITE_API_URL e VITE_ANON_KEY) a partir do .env
	@bash scripts/web-env.sh

web: web-env ## Sobe as 6 zonas; abra http://localhost:3000 (o shell repassa as demais)
	@[ -d node_modules ] || pnpm install
	@pnpm dev

web-build: web-env ## Type-check e build de producao das 6 zonas
	@[ -d node_modules ] || pnpm install
	@pnpm typecheck && pnpm build

quality: ## Formatacao, lint, tipos e codigo morto (o mesmo job do CI)
	@pnpm quality

backup: ## Dump do banco do Supabase em backups/<env>/ (ENV=dev|prod, padrao dev)
	@bash scripts/backup/db-backup.sh $(or $(ENV),dev)

backups: ## Lista os pontos de restauracao (ENV=dev|prod)
	@bash scripts/backup/db-list.sh $(or $(ENV),dev)

restore: ## Restaura um backup e APAGA o estado atual: make restore ENV=dev FROM=<backup|data|latest>
	@bash scripts/backup/db-restore.sh $(or $(ENV),dev) $(or $(FROM),latest)

backup-schedule: ## Liga o backup automatico diario de dev e prod (crontab)
	@bash scripts/backup/schedule.sh on

backup-unschedule: ## Desliga o backup automatico
	@bash scripts/backup/schedule.sh off

bucket-list: ## Lista os backups no bucket do projeto (ENV=dev|prod)
	@bash scripts/backup/bucket.sh list $(or $(ENV),dev)

bucket-push: ## Sobe um backup local para o bucket: make bucket-push ENV=dev FROM=<backup|data|latest>
	@bash scripts/backup/bucket.sh push $(or $(ENV),dev) $(or $(FROM),latest)

bucket-pull: ## Baixa um backup do bucket para backups/<env>/: make bucket-pull ENV=dev FROM=<backup|data|latest>
	@bash scripts/backup/bucket.sh pull $(or $(ENV),dev) $(or $(FROM),latest)

alerts-up: ## Sobe os alertas do ambiente dev nesta maquina (ntfy em http://localhost:8090/alertas-dev)
	@bash scripts/alerts/up.sh

alerts-down: ## Desliga os alertas (mantem o historico)
	@bash scripts/alerts/down.sh

alerts-key: ## Grava a chave secreta do projeto dev, para os alertas de banco
	@bash scripts/alerts/key.sh

alerts-test: ## Manda um alerta de teste ate o ntfy e o desktop
	@bash scripts/alerts/test.sh

alerts-status: ## O que os alertas vigiam e o que esta disparando
	@bash scripts/alerts/status.sh

alerts-check: ## Valida a configuracao e roda os testes das regras de alerta
	@bash scripts/alerts/check.sh

restart-functions: ## Recarrega o runtime das Edge Functions
	@$(COMPOSE) restart functions

.PHONY: help keys up down reset migrate seed logs ps psql test check smoke backup backups restore backup-schedule backup-unschedule bucket-list bucket-push bucket-pull alerts-up alerts-down alerts-key alerts-test alerts-status alerts-check restart-functions web web-env web-build quality
