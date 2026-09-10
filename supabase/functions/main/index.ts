/**
 * Main service do edge-runtime.
 *
 * O gateway entrega aqui tudo que chega em /functions/v1/. O primeiro segmento
 * do caminho nomeia o modulo; este servico cria (ou reaproveita) o worker
 * daquele modulo e repassa a requisicao.
 */

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const MODULES = new Set(["tenancy", "iam", "crm", "projects", "billing"]);
const FUNCTIONS_ROOT = "/home/deno/functions";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-tenant-id, x-request-id",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    },
  });
}

Deno.serve(async (request: Request) => {
  const { pathname } = new URL(request.url);
  const moduleName = pathname.split("/").filter(Boolean)[0] ?? "";

  if (moduleName === "" || moduleName === "health") {
    return json({ status: "ok", modules: [...MODULES].sort() }, 200);
  }

  if (!MODULES.has(moduleName)) {
    return json(
      {
        error: {
          code: "MODULE_NOT_FOUND",
          message: `Modulo desconhecido: ${moduleName}`,
          details: { available: [...MODULES].sort() },
        },
      },
      404,
    );
  }

  try {
    const envVars = Object.entries(Deno.env.toObject());
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_ROOT}/${moduleName}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 5 * 60 * 1000,
      noModuleCache: false,
      importMapPath: null,
      envVars,
    });
    return await worker.fetch(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "error", module: moduleName, message }));
    return json(
      {
        error: {
          code: "WORKER_BOOT_FAILED",
          message: `Falha ao iniciar o modulo ${moduleName}`,
          details: { reason: message },
        },
      },
      500,
    );
  }
});
