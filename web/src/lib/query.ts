import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "./api-error";

/**
 * Repetir um 4xx nao ajuda: 401 ja passou pelo refresh, 403 e 404 sao respostas
 * legitimas e 422 e culpa do que foi enviado. So vale insistir em falha de rede
 * ou erro de infraestrutura.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
