export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(
  /\/+$/,
  "",
);
export const ANON_KEY = import.meta.env.VITE_ANON_KEY ?? "";

/** Commit que gerou este bundle; o health check do deploy compara com o esperado. */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

/** Atalho de login com os usuarios do seed. Desligado em producao. */
export const SHOW_DEMO_USERS = (import.meta.env.VITE_SHOW_DEMO_USERS ?? "true") === "true";

/** Os quatro usuarios que `make seed` cria, oferecidos em um clique no login. */
export const SEED_USERS = [
  { email: "alice@acme.test", role: "owner", tenant: "acme" },
  { email: "bruno@acme.test", role: "manager", tenant: "acme" },
  { email: "carla@globex.test", role: "owner", tenant: "globex" },
  { email: "diego@globex.test", role: "member", tenant: "globex" },
] as const;

export const SEED_PASSWORD = "Password123!";
