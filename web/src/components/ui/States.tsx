import type { ReactNode } from "react";
import { Loader2, ShieldOff, Inbox, AlertTriangle } from "lucide-react";
import { isApiError } from "../../lib/api-error";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 size={16} className="animate-spin" />
      {label ?? "Carregando"}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon,
  action,
}: {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-slate-300">{icon ?? <Inbox size={28} />}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {message && <p className="max-w-md text-sm text-slate-500">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Um 403 nao e uma falha: e a resposta certa para quem nao tem a permissao.
 * Por isso ele vira um estado explicado, e nao uma tela de erro.
 */
export function QueryError({ error }: { error: unknown }) {
  if (isApiError(error) && error.code === "FORBIDDEN") {
    const missing = error.missingPermissions;
    return (
      <EmptyState
        icon={<ShieldOff size={28} />}
        title="Seu papel nao alcanca esta tela"
        message={
          missing.length
            ? `Faltam as permissoes ${missing.join(", ")}.`
            : error.message
        }
      />
    );
  }

  const message = isApiError(error) ? error.message : "Nao consegui carregar os dados.";
  const requestId = isApiError(error) ? error.requestId : null;

  return (
    <EmptyState
      icon={<AlertTriangle size={28} />}
      title="Deu erro ao carregar"
      message={requestId ? `${message} (requestId ${requestId})` : message}
    />
  );
}
