import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { isApiError } from "./api-error";
import { useToast } from "./toast";

/**
 * Toda escrita nesta aplicacao faz a mesma coisa: chama a API, invalida o que
 * ficou velho, avisa quem esta olhando e traduz o erro. Isto e esse contorno.
 */
export function useApiMutation<TData, TVars = void>({
  mutationFn,
  success,
  invalidate = [],
  onDone,
}: {
  mutationFn: (vars: TVars) => Promise<TData>;
  success?: string;
  invalidate?: QueryKey[];
  onDone?: (data: TData, vars: TVars) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn,
    onSuccess: (data, vars) => {
      for (const key of invalidate) void queryClient.invalidateQueries({ queryKey: key });
      if (success) toast.success(success);
      onDone?.(data, vars);
    },
    onError: (error) => toast.notifyError(error),
  });
}

/** O motivo que o backend deu para um campo especifico, em um 422. */
export function fieldError(error: unknown, field: string): string | undefined {
  if (!isApiError(error) || error.code !== "VALIDATION_ERROR") return undefined;
  return error.fieldErrors[field];
}

/**
 * Campo vazio precisa virar `undefined`, nao string vazia: o validador do
 * backend trata `""` como ausente e o schema recusaria um opcional enviado assim.
 */
export function optional(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
