import {
  forwardRef,
  useCallback,
  useEffect,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, NavLink, useNavigate, type NavLinkProps } from "react-router-dom";
import { isLocalPath } from "../lib/zones";

/**
 * Link que sabe atravessar zonas. Destino da mesma zona vira <Link> do
 * react-router; destino de outra zona vira <a href>, um carregamento inteiro,
 * porque o router desta zona nao conhece aquelas rotas.
 */
export const AppLink = forwardRef<
  HTMLAnchorElement,
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; children?: ReactNode }
>(function AppLink({ to, children, ...rest }, ref) {
  if (isLocalPath(to)) {
    return (
      <Link ref={ref} to={to} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a ref={ref} href={to} {...rest}>
      {children}
    </a>
  );
});

/**
 * NavLink que atravessa zonas. Fora da zona corrente o estado "ativo" e
 * calculado pelo proprio caminho do navegador.
 */
export function AppNavLink({
  to,
  end,
  className,
  children,
  title,
  onClick,
}: {
  to: string;
  end?: boolean;
  className: (state: { isActive: boolean }) => string;
  children: ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  if (isLocalPath(to)) {
    return (
      <NavLink
        to={to}
        end={end}
        title={title}
        onClick={onClick}
        className={className as NavLinkProps["className"]}
      >
        {children}
      </NavLink>
    );
  }
  const path = window.location.pathname;
  const isActive = end ? path === to : path === to || path.startsWith(`${to}/`);
  return (
    <a href={to} title={title} onClick={onClick} className={className({ isActive })}>
      {children}
    </a>
  );
}

/** `navigate()` que troca de zona com um carregamento inteiro quando preciso. */
function useAppNavigate(): (to: string, options?: { replace?: boolean }) => void {
  const navigate = useNavigate();
  return useCallback(
    (to: string, options?: { replace?: boolean }) => {
      if (isLocalPath(to)) {
        navigate(to, options);
      } else if (options?.replace) {
        window.location.replace(to);
      } else {
        window.location.assign(to);
      }
    },
    [navigate],
  );
}

/** <Navigate> que atravessa zonas. */
export function AppNavigate({ to, replace }: { to: string; replace?: boolean }) {
  const navigate = useAppNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, to, replace]);
  return null;
}
