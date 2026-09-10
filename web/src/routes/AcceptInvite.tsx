import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { MailCheck } from "lucide-react";
import { tenancyApi } from "../api/tenancy";
import { useApiMutation, fieldError } from "../lib/mutations";
import { useAuth } from "../lib/auth";
import { useTenant } from "../lib/tenant";
import { roleLabel } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Field";

/**
 * O convite so e aceito pelo usuario cujo e-mail foi convidado, e o token vale
 * uma vez. A rota nao leva `x-tenant-id`: quem aceita ainda nao e membro.
 */
export function AcceptInvite() {
  const [params] = useSearchParams();
  const { session } = useAuth();
  const { select } = useTenant();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get("token") ?? "");

  const accept = useApiMutation({
    mutationFn: (value: string) => tenancyApi.acceptInvitation(value),
    invalidate: [["tenants"]],
    onDone: (result) => {
      select(result.membership.tenantId);
      navigate("/");
    },
  });

  // Token vindo pela URL entra direto, sem exigir um clique a mais.
  useEffect(() => {
    const fromUrl = params.get("token");
    if (fromUrl && fromUrl.length >= 32) accept.mutate(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    accept.mutate(token.trim());
  }

  const membership = accept.data?.membership;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <MailCheck size={17} />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">Aceitar convite</h1>
            <p className="text-xs text-slate-500">Entrando como {session?.email}</p>
          </div>
        </div>

        {membership ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Convite aceito. Voce entrou como {roleLabel(membership.role)}.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field
              label="Token do convite"
              hint="Ele aparece uma unica vez, na tela de quem convidou."
              error={fieldError(accept.error, "token")}
            >
              <Input
                required
                minLength={32}
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="cole o token aqui"
                className="font-mono text-xs"
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={accept.isPending}
            >
              Aceitar
            </Button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          <Link to="/tenants" className="font-medium text-brand-700 hover:underline">
            Voltar aos meus tenants
          </Link>
        </p>
      </div>
    </div>
  );
}
