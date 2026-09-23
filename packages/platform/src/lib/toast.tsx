import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import type { ApiError } from "./api-error";
import { isApiError, type LimitViolation } from "./api-error";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  requestId?: string | null;
  violations?: LimitViolation[];
  missing?: string[];
}

interface ToastValue {
  notify: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  /** Traduz o envelope de erro do backend para algo que se le na tela. */
  notifyError: (error: unknown, fallbackTitle?: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/**
 * Cada codigo de erro tem uma leitura propria. O que importa aqui e nao
 * transformar um 409 de regra de negocio, que carrega a explicacao, num
 * "algo deu errado" generico.
 */
function describe(error: ApiError, fallbackTitle: string): Omit<Toast, "id" | "kind"> {
  switch (error.code) {
    case "VALIDATION_ERROR": {
      const fields = Object.entries(error.fieldErrors);
      return {
        title: "Dados invalidos",
        message: fields.length
          ? fields.map(([field, reason]) => `${field}: ${reason}`).join(" · ")
          : error.message,
        requestId: error.requestId,
      };
    }
    case "BUSINESS_RULE_VIOLATION":
      return {
        title: "A regra de negocio recusou",
        message: error.message,
        violations: error.violations,
        requestId: error.requestId,
      };
    case "FORBIDDEN":
      return {
        title: "Sem permissao",
        message: error.message,
        missing: error.missingPermissions,
        requestId: error.requestId,
      };
    case "CONFLICT":
      return { title: "Ja existe", message: error.message, requestId: error.requestId };
    case "NOT_FOUND":
      return { title: "Nao encontrado", message: error.message, requestId: error.requestId };
    case "NETWORK_ERROR":
      return { title: "API fora do ar", message: error.message };
    case "UNAUTHORIZED":
      return { title: "Sessao expirada", message: error.message };
    default:
      return { title: fallbackTitle, message: error.message, requestId: error.requestId };
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { ...toast, id }]);
      // Erro com detalhe fica mais tempo na tela; ha o que ler.
      const ttl = toast.kind === "error" ? 9000 : 4000;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = useMemo<ToastValue>(
    () => ({
      notify: (kind, title, message) => push({ kind, title, message }),
      success: (title, message) => push({ kind: "success", title, message }),
      notifyError: (error, fallbackTitle = "Nao consegui concluir") => {
        if (isApiError(error)) {
          push({ kind: "error", ...describe(error, fallbackTitle) });
          return;
        }
        push({
          kind: "error",
          title: fallbackTitle,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-100 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const TONE: Record<ToastKind, string> = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  error: "border-rose-300 bg-rose-50 text-rose-900",
  info: "border-slate-300 bg-white text-slate-900",
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon =
    toast.kind === "success" ? CheckCircle2 : toast.kind === "error" ? AlertTriangle : Info;
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-lg border p-3 shadow-lg shadow-slate-900/5 ${TONE[toast.kind]}`}
    >
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.message && (
            <p className="mt-0.5 text-sm break-words opacity-90">{toast.message}</p>
          )}

          {!!toast.violations?.length && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left opacity-70">
                <tr>
                  <th className="font-medium">Recurso</th>
                  <th className="font-medium">Limite</th>
                  <th className="font-medium">Atual</th>
                </tr>
              </thead>
              <tbody>
                {toast.violations.map((violation) => (
                  <tr key={violation.resource}>
                    <td className="py-0.5">{violation.resource}</td>
                    <td className="py-0.5 tabular-nums">{violation.limit}</td>
                    <td className="py-0.5 font-semibold tabular-nums">{violation.current}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!!toast.missing?.length && (
            <p className="mt-1 font-mono text-xs opacity-80">falta: {toast.missing.join(", ")}</p>
          )}

          {toast.requestId && (
            <p className="mt-1 font-mono text-[11px] opacity-60">requestId {toast.requestId}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return value;
}
