// Nomes estaveis de cada zona em cada ambiente, na Vercel.
//
//   prod     <prefixo>.vercel.app            <prefixo>-<zona>.vercel.app
//   outros   <prefixo>-<amb>.vercel.app      <prefixo>-<zona>-<amb>.vercel.app
//
// O prefixo vem de VERCEL_ALIAS_PREFIX (variavel do repositorio no GitHub) e
// precisa ser unico na Vercel inteira, porque *.vercel.app e global.
export function hostFor(zone, env) {
  const prefix = process.env.VERCEL_ALIAS_PREFIX;
  if (!prefix) throw new Error("VERCEL_ALIAS_PREFIX nao definido");
  const parts = [prefix];
  if (zone !== "shell") parts.push(zone);
  if (env !== "prod") parts.push(env);
  return `${parts.join("-")}.vercel.app`;
}

// Uso direto: node scripts/deploy/hosts.mjs <zona> <ambiente>
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(hostFor(process.argv[2], process.argv[3]) + "\n");
}
