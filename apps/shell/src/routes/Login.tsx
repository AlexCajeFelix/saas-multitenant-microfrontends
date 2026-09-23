import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { LogIn, UserPlus } from "lucide-react";
import { useAuth } from "@saas/platform/lib/auth";
import { SEED_PASSWORD, SEED_USERS, API_URL, SHOW_DEMO_USERS } from "@saas/platform/lib/config";
import { AppNavigate } from "@saas/platform/components/AppLink";
import { isApiError } from "@saas/platform/lib/api-error";
import { Button } from "@saas/platform/components/ui/Button";
import { Field, Input } from "@saas/platform/components/ui/Field";
import { roleLabel } from "@saas/platform/lib/format";

export function Login() {
  const { session, signIn, signUp } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    // `next` pode apontar para outra zona (ex.: /crm/funil); so aceitamos
    // caminho relativo ao proprio dominio, nunca uma URL externa.
    const next = params.get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return <AppNavigate to={target} replace />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") await signIn(email, password);
      else await signUp(email, password);
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : "Nao consegui entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <aside className="hidden flex-col justify-between bg-slate-900 p-10 text-slate-300 lg:flex">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
            S
          </div>
          <span className="text-sm font-semibold text-white">SaaS multi-tenant</span>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Cinco modulos, um banco, um tenant por vez.
          </h1>
          <p className="mt-4 text-sm leading-relaxed">
            Tenancy, IAM, CRM, projetos e faturamento sobre Postgres com Row Level Security. Cada
            requisicao carrega o tenant corrente, e e o banco que decide o que voce ve.
          </p>
          <dl className="mt-8 grid grid-cols-3 gap-4 text-xs">
            <div>
              <dt className="text-slate-500">Tabelas com RLS</dt>
              <dd className="mt-0.5 text-lg font-semibold text-white">25</dd>
            </div>
            <div>
              <dt className="text-slate-500">Politicas</dt>
              <dd className="mt-0.5 text-lg font-semibold text-white">89</dd>
            </div>
            <div>
              <dt className="text-slate-500">Permissoes</dt>
              <dd className="mt-0.5 text-lg font-semibold text-white">37</dd>
            </div>
          </dl>
        </div>

        <p className="font-mono text-xs text-slate-500">{API_URL}</p>
      </aside>

      <main className="flex flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "signin"
              ? "Use um dos usuarios de demonstracao ou o seu."
              : "O ambiente local confirma o e-mail sozinho."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <Field label="E-mail">
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@empresa.test"
              />
            </Field>
            <Field label="Senha">
              <Input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              loading={busy}
              className="w-full"
              icon={mode === "signin" ? <LogIn size={15} /> : <UserPlus size={15} />}
            >
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            className="mt-3 w-full text-center text-xs text-slate-500 hover:text-slate-800"
          >
            {mode === "signin" ? "Nao tenho conta ainda" : "Ja tenho conta"}
          </button>

          {SHOW_DEMO_USERS && (
            <div className="mt-8 border-t border-slate-200 pt-5">
              <p className="mb-2 text-xs font-medium text-slate-600">
                Usuarios de <code className="font-mono">make seed</code>
              </p>
              <div className="grid gap-1.5">
                {SEED_USERS.map((user) => (
                  <button
                    key={user.email}
                    type="button"
                    onClick={() => {
                      setMode("signin");
                      setEmail(user.email);
                      setPassword(SEED_PASSWORD);
                      setError(null);
                    }}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-xs hover:border-brand-200 hover:bg-brand-50"
                  >
                    <span className="truncate font-medium text-slate-700">{user.email}</span>
                    <span className="shrink-0 text-slate-500">
                      {roleLabel(user.role)} · {user.tenant}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Todos com a senha {SEED_PASSWORD}. Clique para preencher.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
