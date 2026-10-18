// ===========================================================================
// Carga na API do dev: RATE requisicoes por minuto (padrao 1000), em ritmo
// constante, contra as Edge Functions do tenant "carga" (make seed-volume).
// 90% leituras paginadas (contatos, negocios, tarefas, empresas e o funil) e
// 10% escritas (um contato novo), para medir o que um restore perde.
//
//   docker run --rm -i --network host --env-file .env.carga \
//     -e RATE=1000 -e DURATION=10m grafana/k6:1.8.2 run - < tests/load/carga.js
//
// .env.carga (fora do git): API_URL, ANON_KEY, CARGA_EMAIL, CARGA_PASSWORD e
// TENANT_ID. O login acontece uma vez so, no setup: o Auth do Supabase aceita
// 30 logins por 5 minutos por IP, e a API confere o token sozinha (ES256).
//
// Os contatos criados levam o e-mail k6-<vu>-<iteracao>-<ms>@carga.test, para
// contar depois do restore quantos sobreviveram.
// ===========================================================================
import http from "k6/http";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

const API = __ENV.API_URL;
const ANON = __ENV.ANON_KEY;
const TENANT = __ENV.TENANT_ID;

const escritasOk = new Counter("escritas_ok");

export const options = {
  scenarios: {
    carga: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 1000),
      timeUnit: "1m",
      duration: __ENV.DURATION || "10m",
      // Com o banco fora, cada requisicao demora ate o timeout: sobra VU.
      preAllocatedVUs: 40,
      maxVUs: 400,
    },
  },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

const LEITURAS = [
  (p) => [`crm/contacts?page=${p}&pageSize=25`, "crm/contacts"],
  (p) => [`crm/deals?page=${p}&pageSize=25`, "crm/deals"],
  (p) => [`projects/tasks?page=${p}&pageSize=25`, "projects/tasks"],
  (p) => [`crm/companies?page=${p}&pageSize=25`, "crm/companies"],
  () => ["crm/pipeline", "crm/pipeline"],
];

export function setup() {
  const res = http.post(
    `${API}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: __ENV.CARGA_EMAIL, password: __ENV.CARGA_PASSWORD }),
    { headers: { apikey: ANON, "Content-Type": "application/json" } },
  );
  if (res.status !== 200) throw new Error(`login falhou: HTTP ${res.status} ${res.body}`);
  return { token: res.json("access_token") };
}

export default function (data) {
  const headers = {
    Authorization: `Bearer ${data.token}`,
    apikey: ANON,
    "x-tenant-id": TENANT,
    "Content-Type": "application/json",
  };
  const params = (name, tipo) => ({ headers, timeout: "15s", tags: { name, tipo } });

  if (Math.random() < 0.9) {
    const pagina = 1 + Math.floor(Math.random() * 200);
    const [rota, name] = LEITURAS[Math.floor(Math.random() * LEITURAS.length)](pagina);
    http.get(`${API}/functions/v1/${rota}`, params(name, "leitura"));
    return;
  }

  const marca = `${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${Date.now()}`;
  const res = http.post(
    `${API}/functions/v1/crm/contacts`,
    JSON.stringify({ firstName: "Carga", lastName: marca, email: `k6-${marca}@carga.test` }),
    params("crm/contacts:criar", "escrita"),
  );
  if (res.status === 200 || res.status === 201) escritasOk.add(1);
}
