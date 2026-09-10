import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Page } from "../../lib/http";
import { Button } from "./Button";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-160 border-collapse text-sm">{children}</table>
    </div>
  );
}

// O Tailwind so ve classes escritas por extenso, entao nada de `text-${align}`.
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function Th({
  children,
  className = "",
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={`border-b border-slate-200 px-4 py-2.5 text-xs font-medium tracking-wide text-slate-500 uppercase ${ALIGN[align]} ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <td className={`border-b border-slate-100 px-4 py-2.5 text-slate-700 ${ALIGN[align]} ${className}`}>
      {children}
    </td>
  );
}

export function Tr({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={onClick ? "cursor-pointer transition-colors hover:bg-slate-50" : undefined}
    >
      {children}
    </tr>
  );
}

/** Navegacao que fala o mesmo envelope de pagina que o backend devolve. */
export function Pagination<T>({
  page,
  onChange,
  label = "registros",
}: {
  page: Page<T> | undefined;
  onChange: (next: number) => void;
  label?: string;
}) {
  if (!page || page.total === 0) return null;

  const from = (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.page * page.pageSize, page.total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5">
      <p className="text-xs text-slate-500">
        {from}–{to} de <span className="font-medium text-slate-700">{page.total}</span> {label}
      </p>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          onClick={() => onChange(page.page - 1)}
          disabled={page.page <= 1}
          icon={<ChevronLeft size={14} />}
          aria-label="Pagina anterior"
        />
        <span className="px-2 text-xs text-slate-500 tabular-nums">
          {page.page} / {Math.max(page.totalPages, 1)}
        </span>
        <Button
          size="sm"
          onClick={() => onChange(page.page + 1)}
          disabled={!page.hasNext}
          icon={<ChevronRight size={14} />}
          aria-label="Proxima pagina"
        />
      </div>
    </div>
  );
}
