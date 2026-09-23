#!/usr/bin/env node
// Gera o vercel.json de uma zona para um ambiente.
//
//   node scripts/deploy/vercel-config.mjs <zona> <ambiente>
//
// Zona: o SPA inteiro vive em /_zones/<zona>/; qualquer outro caminho (as rotas
// que o shell repassa, como /crm/funil) cai no index.html da zona.
//
// Shell: dono do dominio publico. Repassa /_zones/<zona>/* e os prefixos de
// rota de cada zona para o alias estavel daquela zona no MESMO ambiente, e
// entrega o proprio index.html para o resto.
import { ZONES } from "../../packages/platform/src/lib/zones.ts";
import { hostFor } from "./hosts.mjs";

const [zone, env] = process.argv.slice(2);
if (!zone || !env || !(zone in ZONES)) {
  console.error(
    "uso: vercel-config.mjs <shell|tenancy|iam|crm|projects|billing> <dev|homol|staging|prod>",
  );
  process.exit(2);
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
const noCache = [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }];
const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];

let config;

if (zone === "shell") {
  const rewrites = [];
  for (const [name, { prefixes }] of Object.entries(ZONES)) {
    if (prefixes.length === 0) continue;
    const origin = `https://${hostFor(name, env)}`;
    rewrites.push({
      source: `/_zones/${name}/:path*`,
      destination: `${origin}/_zones/${name}/:path*`,
    });
    for (const prefix of prefixes) {
      rewrites.push({ source: prefix, destination: `${origin}${prefix}` });
      rewrites.push({ source: `${prefix}/:path*`, destination: `${origin}${prefix}/:path*` });
    }
  }
  rewrites.push({ source: "/(.*)", destination: "/index.html" });
  config = {
    cleanUrls: false,
    trailingSlash: false,
    rewrites,
    headers: [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/assets/(.*)", headers: immutable },
      { source: "/(index.html|version.json)", headers: noCache },
    ],
  };
} else {
  config = {
    cleanUrls: false,
    trailingSlash: false,
    rewrites: [{ source: "/(.*)", destination: `/_zones/${zone}/index.html` }],
    headers: [
      { source: "/(.*)", headers: securityHeaders },
      { source: `/_zones/${zone}/assets/(.*)`, headers: immutable },
      { source: `/_zones/${zone}/(index.html|version.json)`, headers: noCache },
    ],
  };
}

process.stdout.write(JSON.stringify(config, null, 2) + "\n");
