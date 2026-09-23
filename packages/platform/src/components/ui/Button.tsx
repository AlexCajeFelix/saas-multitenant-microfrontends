import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useCan } from "../../lib/permissions";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/40",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
  danger: "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/**
 * O mesmo botao, travado quando o papel do usuario nao alcanca a permissao.
 * Travar e nao esconder e proposital: trocando de usuario, da para ver onde a
 * autorizacao morde, e o motivo fica no titulo.
 */
export function PermissionButton({ permission, ...props }: ButtonProps & { permission: string }) {
  const allowed = useCan(permission);
  return (
    <Button
      {...props}
      disabled={props.disabled || !allowed}
      title={allowed ? props.title : `Seu papel nao tem a permissao ${permission}`}
    />
  );
}
