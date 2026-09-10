import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ANON_KEY, API_URL } from "./config";
import { ApiError } from "./api-error";

const STORAGE_KEY = "saas.session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Instante da expiracao do access token, em milissegundos. */
  expiresAt: number;
  userId: string;
  email: string;
}

interface GoTrueToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { id?: string; email?: string };
}

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function store(session: Session | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Navegador com armazenamento bloqueado: a sessao vale so por esta aba.
  }
}

/** Le `sub` e `email` do proprio JWT, para nao depender do corpo do GoTrue. */
function decodeClaims(token: string): { sub: string; email: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { sub?: string; email?: string };
    return { sub: claims.sub ?? "", email: claims.email ?? "" };
  } catch {
    return { sub: "", email: "" };
  }
}

async function grant(body: Record<string, string>, grantType: string): Promise<Session> {
  const response = await fetch(`${API_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!response) {
    throw new ApiError({
      code: "NETWORK_ERROR",
      message: `Nao consegui falar com a API em ${API_URL}. O stack esta no ar? (make up)`,
      status: 0,
    });
  }

  const payload = (await response.json().catch(() => ({}))) as GoTrueToken & {
    msg?: string;
    error_description?: string;
  };

  if (!response.ok) {
    throw new ApiError({
      code: "UNAUTHORIZED",
      message: payload.error_description ?? payload.msg ?? "E-mail ou senha invalidos",
      status: response.status,
    });
  }

  const claims = decodeClaims(payload.access_token);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    userId: payload.user?.id ?? claims.sub,
    email: payload.user?.email ?? claims.email,
  };
}

/**
 * Espelho da sessao fora do React. O cliente HTTP precisa do access token em
 * toda requisicao e nao pode chamar hook; ler daqui e sempre ver o valor atual,
 * inclusive logo depois de um refresh.
 */
let liveSession: Session | null = readStored();

export function peekSession(): Session | null {
  return liveSession;
}

/** Preenchidos pelo <AuthProvider>; usados pelo cliente HTTP em um 401. */
export const authHandlers: {
  refresh: (() => Promise<boolean>) | null;
  logout: (() => void) | null;
} = { refresh: null, logout: null };

interface AuthValue {
  session: Session | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Usado pelo cliente HTTP quando uma chamada volta 401. */
  refresh: () => Promise<boolean>;
  /** Le a sessao corrente sem passar por estado do React. */
  peek: () => Session | null;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readStored());
  const [ready, setReady] = useState(false);
  const sessionRef = useRef(session);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const apply = useCallback((next: Session | null) => {
    sessionRef.current = next;
    liveSession = next;
    store(next);
    setSession(next);
  }, []);

  /**
   * Renova o access token. Chamadas concorrentes compartilham a mesma promessa,
   * senao um refresh perde a corrida para o outro e invalida o token novo.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return await inFlight.current;
    const current = sessionRef.current;
    if (!current) return false;

    inFlight.current = (async () => {
      try {
        apply(await grant({ refresh_token: current.refreshToken }, "refresh_token"));
        return true;
      } catch {
        apply(null);
        return false;
      } finally {
        inFlight.current = null;
      }
    })();

    return await inFlight.current;
  }, [apply]);

  // O cliente HTTP so sabe renovar e deslogar por estas duas pontas.
  useEffect(() => {
    authHandlers.refresh = refresh;
    authHandlers.logout = () => apply(null);
  }, [refresh, apply]);

  // Uma sessao guardada no localStorage pode ter vencido enquanto a aba
  // estava fechada; renovamos antes de deixar a aplicacao pintar.
  useEffect(() => {
    const current = sessionRef.current;
    if (current && current.expiresAt - Date.now() < 60_000) {
      void refresh().finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [refresh]);

  // Renovacao agendada: um minuto antes de vencer, com piso de dez segundos.
  useEffect(() => {
    if (!session) return;
    const delay = Math.max(session.expiresAt - Date.now() - 60_000, 10_000);
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [session, refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      ready,
      signIn: async (email, password) => {
        apply(await grant({ email, password }, "password"));
      },
      signUp: async (email, password) => {
        const response = await fetch(`${API_URL}/auth/v1/signup`, {
          method: "POST",
          headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { msg?: string };
          throw new ApiError({
            code: "VALIDATION_ERROR",
            message: payload.msg ?? "Nao consegui criar a conta",
            status: response.status,
          });
        }
        // MAILER_AUTOCONFIRM esta ligado no ambiente local, entao ja da para entrar.
        apply(await grant({ email, password }, "password"));
      },
      signOut: () => apply(null),
      refresh,
      peek: () => sessionRef.current,
    }),
    [session, ready, apply, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return value;
}
