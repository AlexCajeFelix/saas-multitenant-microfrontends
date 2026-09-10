import type { LimitReport } from "../../api/types";

/**
 * Consumo contra o limite, em barra. E a leitura visual da mesma regra que o
 * PlanLimitPolicy aplica no dominio antes de aceitar uma descida de plano.
 */
export function LimitMeters({ report }: { report: LimitReport }) {
  const entries = Object.entries(report.limits);
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-slate-500">Plano sem limites.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {entries.map(([resource, limit]) => {
        const current = Number(report.usage?.[resource] ?? 0);
        const unlimited = limit === null;
        const pct = unlimited ? 0 : Math.min(Math.round((current / Math.max(limit, 1)) * 100), 100);
        const over = !unlimited && current > limit;
        const near = !unlimited && !over && pct >= 80;

        return (
          <li key={resource} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-slate-700 capitalize">{resource}</span>
              <span
                className={`text-xs tabular-nums ${
                  over ? "font-semibold text-rose-600" : near ? "text-amber-700" : "text-slate-500"
                }`}
              >
                {current} / {unlimited ? "ilimitado" : limit}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${
                  over ? "bg-rose-500" : near ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: unlimited ? "6%" : `${Math.max(pct, current ? 3 : 0)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
