import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig, type Plugin, type ProxyOptions, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { ZONES, type ZoneName } from "./src/lib/zones.ts";

/**
 * Configuracao comum das zonas. Cada app chama `defineZone` no seu
 * vite.config.ts; so muda o nome da zona.
 *
 * Contrato de publicacao (o mesmo em dev e na Vercel):
 *   - o shell serve em `/` e e dono do dominio;
 *   - cada zona publica tudo sob `/_zones/<zona>/` (em dist/_zones/<zona>),
 *     entao o shell repassa `/_zones/<zona>/*` e os prefixos de rota da zona
 *     para ela sem colisao de caminho entre os bundles;
 *   - todo build emite `version.json` com o commit, que o health check le.
 */

export type Zone = ZoneName;

const root = fileURLToPath(new URL("../..", import.meta.url));

function versionFile(zone: Zone): Plugin {
  let outDir = "dist";
  return {
    name: "saas:version-file",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const body = {
        zone,
        version: process.env.VITE_APP_VERSION ?? "dev",
        builtAt: new Date().toISOString(),
      };
      writeFileSync(resolve(outDir, "version.json"), JSON.stringify(body, null, 2) + "\n");
    },
  };
}

/** No dev, o shell faz o papel dos rewrites da Vercel: repassa cada zona. */
function devProxy(): Record<string, ProxyOptions> {
  const proxy: Record<string, ProxyOptions> = {};
  for (const [zone, { port, prefixes }] of Object.entries(ZONES)) {
    if (prefixes.length === 0) continue;
    const routes = prefixes.map((prefix: string) => prefix.slice(1));
    const target = `http://localhost:${port}`;
    proxy[`/_zones/${zone}`] = { target, ws: true, changeOrigin: true };
    // Navegacao de pagina: entrega o index.html da zona (fallback de SPA).
    proxy[`^/(${routes.join("|")})(/.*)?$`] = {
      target,
      changeOrigin: true,
      rewrite: () => `/_zones/${zone}/`,
    };
  }
  return proxy;
}

export function defineZone(zone: Zone): UserConfig {
  const { port } = ZONES[zone];
  const isShell = zone === "shell";

  return defineConfig({
    base: isShell ? "/" : `/_zones/${zone}/`,
    envDir: root,
    plugins: [react(), tailwindcss(), versionFile(zone)],
    resolve: {
      alias: { "@saas/platform": resolve(root, "packages/platform/src") },
    },
    server: {
      port,
      strictPort: true,
      proxy: isShell ? devProxy() : undefined,
    },
    preview: { port, strictPort: true },
    build: {
      // A zona publica tudo sob /_zones/<zona>/, inclusive o index.html, para
      // que o deploy sirva os arquivos no mesmo caminho em que o shell os pede.
      outDir: isShell ? "dist" : `dist/_zones/${zone}`,
      emptyOutDir: true,
    },
  });
}
