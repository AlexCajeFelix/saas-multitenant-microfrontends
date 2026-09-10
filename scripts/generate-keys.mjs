#!/usr/bin/env node
/**
 * Gera as chaves `anon` e `service_role` assinadas com o JWT_SECRET do .env
 * e grava as duas de volta no arquivo. Sem dependencias externas: usa apenas
 * o modulo `crypto` do Node.
 *
 *   node scripts/generate-keys.mjs [caminho-do-.env]
 */
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.argv[2] ?? ".env");
const examplePath = resolve(".env.example");

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    console.error(`Nao encontrei ${envPath} nem ${examplePath}.`);
    process.exit(1);
  }
  copyFileSync(examplePath, envPath);
  console.log(`.env criado a partir de .env.example`);
}

const raw = readFileSync(envPath, "utf8");

function readVar(name) {
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

const secret = readVar("JWT_SECRET");
if (!secret || secret.length < 32) {
  console.error("JWT_SECRET ausente ou com menos de 32 caracteres no .env");
  process.exit(1);
}

const base64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.${signature}`;
}

const issuedAt = Math.floor(Date.now() / 1000);
const expiresAt = issuedAt + 60 * 60 * 24 * 365 * 5; // 5 anos, e um ambiente local

const keys = {
  ANON_KEY: sign({ role: "anon", iss: "supabase-local", iat: issuedAt, exp: expiresAt }),
  SERVICE_ROLE_KEY: sign({
    role: "service_role",
    iss: "supabase-local",
    iat: issuedAt,
    exp: expiresAt,
  }),
};

let output = raw;
for (const [name, value] of Object.entries(keys)) {
  const line = `${name}=${value}`;
  output = new RegExp(`^${name}=.*$`, "m").test(output)
    ? output.replace(new RegExp(`^${name}=.*$`, "m"), line)
    : `${output.trimEnd()}\n${line}\n`;
}
writeFileSync(envPath, output);

console.log("Chaves geradas em", envPath);
console.log("ANON_KEY        =", keys.ANON_KEY);
console.log("SERVICE_ROLE_KEY=", keys.SERVICE_ROLE_KEY);
