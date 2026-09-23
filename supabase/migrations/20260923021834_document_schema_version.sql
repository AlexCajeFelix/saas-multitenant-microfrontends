-- Documenta a funcao usada pelo health check. Primeira migration aplicada
-- pela integracao GitHub do Supabase (SUPABASE_DEPLOY_MODE=integration).
comment on function public.schema_version() is
  'Ultima migration aplicada (supabase_migrations.schema_migrations). Lida pelo health check do deploy.';
