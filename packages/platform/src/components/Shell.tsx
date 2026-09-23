import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  Building2,
  CheckSquare,
  ChevronsUpDown,
  CreditCard,
  FolderKanban,
  Gauge,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Menu,
  Receipt,
  Settings,
  ShieldCheck,
  Contact as ContactIcon,
  Handshake,
  Users,
  X,
  Layers,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTenant } from "../lib/tenant";
import { usePermissions } from "../lib/permissions";
import { initials, roleLabel } from "../lib/format";
import { Badge } from "./ui/Badge";
import { AppNavLink } from "./AppLink";
import { APP_VERSION } from "../lib/config";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Users;
  /** Permissao de leitura da tela; sem ela o item aparece com cadeado. */
  permission?: string;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Geral",
    items: [{ to: "/", label: "Visao geral", icon: Gauge }],
  },
  {
    section: "Tenancy",
    items: [
      { to: "/tenancy/membros", label: "Membros", icon: Users, permission: "tenancy.member.read" },
      {
        to: "/tenancy/convites",
        label: "Convites",
        icon: Mail,
        permission: "tenancy.invitation.read",
      },
      {
        to: "/tenancy/ajustes",
        label: "Ajustes",
        icon: Settings,
        permission: "tenancy.tenant.read",
      },
    ],
  },
  {
    section: "IAM",
    items: [
      { to: "/iam/papeis", label: "Papeis", icon: ShieldCheck, permission: "iam.role.read" },
      {
        to: "/iam/permissoes",
        label: "Permissoes",
        icon: Layers,
        permission: "iam.permission.read",
      },
      { to: "/iam/chaves", label: "Chaves de API", icon: KeyRound, permission: "iam.api_key.read" },
    ],
  },
  {
    section: "CRM",
    items: [
      { to: "/crm/funil", label: "Funil", icon: Handshake, permission: "crm.pipeline.read" },
      { to: "/crm/negocios", label: "Negocios", icon: FolderKanban, permission: "crm.deal.read" },
      { to: "/crm/empresas", label: "Empresas", icon: Building2, permission: "crm.company.read" },
      { to: "/crm/contatos", label: "Contatos", icon: ContactIcon, permission: "crm.contact.read" },
    ],
  },
  {
    section: "Projetos",
    items: [
      {
        to: "/projetos",
        label: "Projetos",
        icon: FolderKanban,
        permission: "projects.project.read",
      },
      { to: "/tarefas", label: "Tarefas", icon: CheckSquare, permission: "projects.task.read" },
    ],
  },
  {
    section: "Faturamento",
    items: [
      {
        to: "/billing/assinatura",
        label: "Assinatura",
        icon: CreditCard,
        permission: "billing.subscription.read",
      },
      { to: "/billing/planos", label: "Planos", icon: Layers, permission: "billing.plan.read" },
      { to: "/billing/consumo", label: "Consumo", icon: Gauge, permission: "billing.usage.read" },
      {
        to: "/billing/faturas",
        label: "Faturas",
        icon: Receipt,
        permission: "billing.invoice.read",
      },
    ],
  },
];

export function Shell() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Navegou no celular: a gaveta fecha sozinha.
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:flex">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-3 left-3 z-30 rounded-lg border border-slate-300 bg-white p-2 shadow-sm lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu size={16} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-4 lg:pt-5">
          <div className="flex items-center gap-2">
            <div className="grid size-7 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
              S
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              SaaS multi-tenant
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-slate-400 lg:hidden"
            aria-label="Fechar menu"
          >
            <X size={16} />
          </button>
        </div>

        <TenantSwitcher />

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV.map((group) => (
            <div key={group.section} className="mb-3">
              <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                {group.section}
              </p>
              {group.items.map((item) => (
                <NavRow key={item.to} item={item} />
              ))}
            </div>
          ))}
        </nav>

        <UserCard />
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-7xl px-4 pt-14 pb-12 sm:px-6 lg:pt-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavRow({ item }: { item: NavItem }) {
  const { can, loading } = usePermissions();
  const locked = Boolean(item.permission) && !loading && !can(item.permission!);
  const Icon = item.icon;

  return (
    <AppNavLink
      to={item.to}
      end={item.to === "/"}
      title={locked ? `Seu papel nao tem ${item.permission}` : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          isActive
            ? "bg-brand-50 font-medium text-brand-700"
            : locked
              ? "text-slate-400 hover:bg-slate-50"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`
      }
    >
      <Icon size={15} className="shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {locked && <Lock size={12} className="shrink-0 text-slate-300" />}
    </AppNavLink>
  );
}

function TenantSwitcher() {
  const { tenants, tenant, select } = useTenant();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative px-3 py-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-left hover:bg-slate-100"
      >
        <div className="grid size-6 shrink-0 place-items-center rounded bg-slate-700 text-[10px] font-semibold text-white">
          {tenant ? initials(tenant.name) : "—"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-900">
            {tenant?.name ?? "Nenhum tenant"}
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {tenant ? roleLabel(tenant.myRole) : "escolha um"}
          </p>
        </div>
        <ChevronsUpDown size={14} className="shrink-0 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="card animate-rise absolute right-3 left-3 z-20 mt-1 max-h-72 overflow-y-auto p-1">
            {tenants.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  select(option.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50 ${
                  option.id === tenant?.id ? "bg-brand-50 text-brand-700" : "text-slate-700"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{option.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{option.slug}</span>
                </span>
                <Badge tone={option.status === "active" ? "neutral" : "danger"}>
                  {roleLabel(option.myRole)}
                </Badge>
              </button>
            ))}
            <AppNavLink
              to="/tenants"
              onClick={() => setOpen(false)}
              className={() =>
                "mt-1 block rounded-md border-t border-slate-100 px-2 py-1.5 text-xs font-medium text-brand-700 hover:bg-slate-50"
              }
            >
              Gerenciar tenants
            </AppNavLink>
          </div>
        </>
      )}
    </div>
  );
}

function UserCard() {
  const { session, signOut } = useAuth();
  const { role, whoami } = usePermissions();

  return (
    <div className="border-t border-slate-200 p-3">
      <div className="flex items-center gap-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
          {initials(session?.email ?? "?")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-800">{session?.email}</p>
          <p className="truncate text-[11px] text-slate-500">
            {roleLabel(role)}
            {whoami ? ` · ${whoami.permissions.length} permissoes` : ""}
          </p>
          <p className="truncate font-mono text-[10px] text-slate-400" title={APP_VERSION}>
            versao {APP_VERSION.slice(0, 7)}
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          title="Sair"
          aria-label="Sair"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
}
