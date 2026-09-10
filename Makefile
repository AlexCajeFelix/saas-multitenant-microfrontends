SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

help: ## Lista os alvos disponiveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

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

web-env: keys ## Copia VITE_API_URL e VITE_ANON_KEY do .env para web/.env.local
	@bash scripts/web-env.sh

web: web-env ## Sobe o frontend em http://localhost:3000
	@cd web && [ -d node_modules ] || npm install
	@cd web && npm run dev

web-build: web-env ## Type-check e build de producao do frontend
	@cd web && [ -d node_modules ] || npm install
	@cd web && npm run build

restart-functions: ## Recarrega o runtime das Edge Functions
	@$(COMPOSE) restart functions

.PHONY: help keys up down reset migrate seed logs ps psql test check smoke restart-functions web web-env web-build
