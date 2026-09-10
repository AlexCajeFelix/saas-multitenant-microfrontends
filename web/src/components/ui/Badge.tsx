import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "muted";

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  muted: "bg-slate-50 text-slate-500 ring-slate-200",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Um tom por estado, reaproveitado onde o mesmo vocabulario aparece. */
export const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  paid: "success",
  done: "success",
  won: "success",
  completed: "success",
  accepted: "success",

  open: "brand",
  in_progress: "brand",
  planning: "brand",
  trialing: "brand",
  pending: "warning",
  on_hold: "warning",
  past_due: "warning",
  blocked: "warning",
  draft: "muted",

  lost: "danger",
  suspended: "danger",
  cancelled: "danger",
  revoked: "danger",
  expired: "danger",
  void: "muted",
  archived: "muted",
  todo: "neutral",
};

export const toneFor = (status: string): Tone => STATUS_TONE[status] ?? "neutral";
