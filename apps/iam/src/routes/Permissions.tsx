import { useQuery } from "@tanstack/react-query";
import { Check, Minus } from "lucide-react";
import { iamApi } from "@saas/platform/api/iam";
import { useTenant } from "@saas/platform/lib/tenant";
import { usePermissions } from "@saas/platform/lib/permissions";
import { PageHeader, Section } from "@saas/platform/components/PageHeader";
import { Badge } from "@saas/platform/components/ui/Badge";
import { Spinner, QueryError } from "@saas/platform/components/ui/States";

/**
 * O catalogo inteiro, agrupado por modulo, com marcacao do que o papel do
 * usuario corrente alcanca. E a tela que torna visivel a diferenca entre
 * owner, manager, member e viewer.
 */
export function Permissions() {
  const { tenantId } = useTenant();
  const { can, role } = usePermissions();

  const catalog = useQuery({
    queryKey: ["permissions", tenantId],
    queryFn: iamApi.permissions,
    staleTime: 5 * 60_000,
  });

  if (catalog.isPending) return <Spinner />;
  if (catalog.isError) return <QueryError error={catalog.error} />;

  const mine = catalog.data.modules
    .flatMap((group) => group.permissions)
    .filter((permission) => can(permission.slug)).length;

  return (
    <>
      <PageHeader
        title="Catalogo de permissoes"
        subtitle={`${catalog.data.total} permissoes no formato modulo.recurso.acao. Voce alcanca ${mine} delas como ${role ?? "—"}.`}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {catalog.data.modules.map((group) => (
          <Section
            key={group.module}
            title={group.module}
            description={`${group.permissions.length} permissoes`}
          >
            <ul className="divide-y divide-slate-100">
              {group.permissions.map((permission) => {
                const granted = can(permission.slug);
                return (
                  <li key={permission.slug} className="flex items-start gap-2.5 px-4 py-2 text-sm">
                    <span
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${
                        granted ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                      }`}
                      aria-hidden
                    >
                      {granted ? <Check size={11} /> : <Minus size={11} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <code
                        className={`font-mono text-xs ${granted ? "text-slate-800" : "text-slate-400"}`}
                      >
                        {permission.slug}
                      </code>
                      <span className="block text-xs text-slate-500">{permission.description}</span>
                    </span>
                    {permission.slug.endsWith(".write") && <Badge tone="muted">escrita</Badge>}
                  </li>
                );
              })}
            </ul>
          </Section>
        ))}
      </div>
    </>
  );
}
