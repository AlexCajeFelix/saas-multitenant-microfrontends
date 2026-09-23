/**
 * Mapa das zonas (micro frontends). Cada zona e um app Vite publicado como um
 * projeto proprio na Vercel; o shell e dono do dominio e repassa, por rewrite,
 * os prefixos abaixo para a zona correspondente.
 *
 * Navegar dentro da zona e client-side (react-router). Navegar para outra zona
 * e um carregamento de pagina inteiro, porque o bundle e outro. A sessao e o
 * tenant sobrevivem ao salto porque moram no localStorage do mesmo dominio.
 */
export const ZONES = {
  shell: { port: 3000, prefixes: [] },
  tenancy: { port: 3001, prefixes: ["/tenancy"] },
  iam: { port: 3002, prefixes: ["/iam"] },
  crm: { port: 3003, prefixes: ["/crm"] },
  projects: { port: 3004, prefixes: ["/projetos", "/tarefas"] },
  billing: { port: 3005, prefixes: ["/billing"] },
} as const satisfies Record<string, { port: number; prefixes: readonly string[] }>;

export type ZoneName = keyof typeof ZONES;

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

/** Qual zona atende um caminho. O que nao casa com prefixo nenhum e do shell. */
function zoneOf(path: string): ZoneName {
  for (const [zone, { prefixes }] of Object.entries(ZONES)) {
    if (prefixes.some((prefix: string) => matches(path, prefix))) return zone as ZoneName;
  }
  return "shell";
}

let currentZone: ZoneName = "shell";

export function setCurrentZone(zone: ZoneName): void {
  currentZone = zone;
}

/** True quando o caminho pertence a zona que esta rodando agora. */
export function isLocalPath(path: string): boolean {
  return zoneOf(path) === currentZone;
}
