// SPDX-License-Identifier: AGPL-3.0-or-later
// Runtime API contract smoke test.
//
// Boots the API server in mock-Lightning / development mode and, for every
// `operationId` documented in `lib/api-spec/openapi.yaml`, issues a real HTTP
// request and validates the response body against the matching generated Zod
// schema in `lib/api-zod/src/generated/api.ts`.
//
// This is the "optional, more thorough" companion to the codegen-drift check
// (Task #104). Drift catches the case where `openapi.yaml` was changed but
// codegen wasn't re-run; this catches the inverse — an Express handler that
// silently returns a shape different from what the spec promises.
//
// The script is intentionally self-contained: it spawns the api-server as a
// child process, waits for /api/healthz, exercises every operation in order
// (chaining createInvoice → devSimulatePayment → getPaymentStatus →
// recoverPaidWindow so we can hit the recovery route with a real code), and
// kills the server in the `finally` block. Exit code is non-zero on any
// status or schema mismatch.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import type { ZodTypeAny } from "zod";
import {
  CreateInvoiceResponse,
  DevSimulatePaymentResponse,
  GetIceServersResponse,
  GetPaymentStatusResponse,
  HealthCheckAliasResponse,
  HealthCheckResponse,
  RecoverPaidWindowResponse,
} from "@workspace/api-zod";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const serverEntry = path.join(
  repoRoot,
  "artifacts",
  "api-server",
  "dist",
  "index.mjs",
);

const PORT = process.env["SMOKE_PORT"] ?? "5757";
const baseUrl = `http://127.0.0.1:${PORT}/api`;

let failures = 0;

function recordFailure(message: string): void {
  failures += 1;
  console.error(message);
}

function expectMatch(label: string, schema: ZodTypeAny, value: unknown): void {
  const result = schema.safeParse(value);
  if (result.success) {
    console.log(`  ok   schema  ${label}`);
    return;
  }
  recordFailure(`  FAIL schema  ${label} did not match its generated Zod schema`);
  console.error(`        body:   ${JSON.stringify(value)}`);
  for (const issue of result.error.issues) {
    const where = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    console.error(`        issue:  [${where}] ${issue.code}: ${issue.message}`);
  }
}

function expectStatus(label: string, got: number, want: number): void {
  if (got === want) {
    console.log(`  ok   status  ${label} -> HTTP ${got}`);
  } else {
    recordFailure(`  FAIL status  ${label} expected HTTP ${want}, got HTTP ${got}`);
  }
}

interface JsonResponse {
  status: number;
  body: unknown;
}

async function getJson(url: string): Promise<JsonResponse> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

async function postJson(url: string, body: unknown = {}): Promise<JsonResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return;
      lastErr = new Error(`Health check responded with HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(
    `API server did not become healthy at ${baseUrl}/healthz within ${timeoutMs}ms (last error: ${String(lastErr)})`,
  );
}

function startServer(): ChildProcess {
  if (!existsSync(serverEntry)) {
    throw new Error(
      `API server build output not found at ${serverEntry}.\n` +
        `Build it first:\n` +
        `  pnpm --filter @workspace/api-server run build`,
    );
  }

  // Strip placeholder/secret guards: an empty TURN_SECRET / PAYWALL_SECRET
  // makes the API server fall back to "no TURN" and an ephemeral paywall
  // secret respectively (see lib/turnSecret.ts and lib/paywallSecret.ts) —
  // exactly what the smoke needs.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["TURN_URL"];
  delete env["TURN_SECRET"];
  delete env["PAYWALL_SECRET"];
  env["PORT"] = PORT;
  env["NODE_ENV"] = "development";
  env["LIGHTNING_BACKEND"] = "mock";

  console.log(`Spawning api-server (PORT=${PORT}, mock Lightning, dev mode)…`);
  const child = spawn("node", ["--enable-source-maps", serverEntry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) =>
    process.stderr.write(`[api-server] ${chunk}`),
  );
  child.stderr?.on("data", (chunk: Buffer) =>
    process.stderr.write(`[api-server] ${chunk}`),
  );
  return child;
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server.kill("SIGTERM");
  const winner = await Promise.race([
    exited.then(() => "exited" as const),
    sleep(5_000).then(() => "timeout" as const),
  ]);
  if (winner === "timeout") {
    server.kill("SIGKILL");
    await exited;
  }
}

async function runSmoke(): Promise<void> {
  // 1. healthCheck — GET /api/healthz
  console.log("\nhealthCheck (GET /healthz)");
  const h1 = await getJson(`${baseUrl}/healthz`);
  expectStatus("healthCheck", h1.status, 200);
  expectMatch("HealthCheckResponse", HealthCheckResponse, h1.body);

  // 2. healthCheckAlias — GET /api/health
  console.log("\nhealthCheckAlias (GET /health)");
  const h2 = await getJson(`${baseUrl}/health`);
  expectStatus("healthCheckAlias", h2.status, 200);
  expectMatch("HealthCheckAliasResponse", HealthCheckAliasResponse, h2.body);

  // 3. getIceServers — GET /api/ice-servers
  // TURN is unset, so this exercises the public-STUN branch (no `ttl` /
  // `expiresAt`), which the spec marks as optional. Both branches share the
  // same response schema.
  console.log("\ngetIceServers (GET /ice-servers)");
  const ice = await getJson(`${baseUrl}/ice-servers`);
  expectStatus("getIceServers", ice.status, 200);
  expectMatch("GetIceServersResponse", GetIceServersResponse, ice.body);

  // 4. createInvoice — POST /api/paywall/invoice
  console.log("\ncreateInvoice (POST /paywall/invoice)");
  const inv = await postJson(`${baseUrl}/paywall/invoice`, { tier: "standard" });
  expectStatus("createInvoice", inv.status, 200);
  expectMatch("CreateInvoiceResponse", CreateInvoiceResponse, inv.body);

  const invBody = inv.body as { paymentHash?: unknown };
  if (typeof invBody.paymentHash !== "string") {
    recordFailure(
      "  FAIL chain   createInvoice did not return a paymentHash string; cannot exercise getPaymentStatus / devSimulatePayment / recoverPaidWindow",
    );
    return;
  }
  const paymentHash = invBody.paymentHash;

  // 5. getPaymentStatus (unpaid branch) — GET /api/paywall/status/:hash
  console.log("\ngetPaymentStatus pre-payment (GET /paywall/status/:paymentHash)");
  const unpaid = await getJson(`${baseUrl}/paywall/status/${paymentHash}`);
  expectStatus("getPaymentStatus (unpaid)", unpaid.status, 200);
  expectMatch("GetPaymentStatusResponse (unpaid)", GetPaymentStatusResponse, unpaid.body);

  // 6. devSimulatePayment — POST /api/paywall/dev-pay/:hash
  console.log("\ndevSimulatePayment (POST /paywall/dev-pay/:paymentHash)");
  const dev = await postJson(`${baseUrl}/paywall/dev-pay/${paymentHash}`);
  expectStatus("devSimulatePayment", dev.status, 200);
  expectMatch("DevSimulatePaymentResponse", DevSimulatePaymentResponse, dev.body);

  // 7. getPaymentStatus (paid branch) — yields the recoveryCode we need
  // for /paywall/recover. The spec says recoveryCode is only present on the
  // first paid poll, so we capture it here.
  console.log("\ngetPaymentStatus post-payment (GET /paywall/status/:paymentHash)");
  const paid = await getJson(`${baseUrl}/paywall/status/${paymentHash}`);
  expectStatus("getPaymentStatus (paid)", paid.status, 200);
  expectMatch("GetPaymentStatusResponse (paid)", GetPaymentStatusResponse, paid.body);

  const paidBody = paid.body as { recoveryCode?: unknown };
  if (typeof paidBody.recoveryCode !== "string") {
    recordFailure(
      "  FAIL chain   paid getPaymentStatus did not return a recoveryCode string; cannot exercise recoverPaidWindow",
    );
    return;
  }
  const recoveryCode = paidBody.recoveryCode;

  // 8. recoverPaidWindow — POST /api/paywall/recover
  console.log("\nrecoverPaidWindow (POST /paywall/recover)");
  const rec = await postJson(`${baseUrl}/paywall/recover`, { code: recoveryCode });
  expectStatus("recoverPaidWindow", rec.status, 200);
  expectMatch("RecoverPaidWindowResponse", RecoverPaidWindowResponse, rec.body);
}

async function main(): Promise<void> {
  const server = startServer();
  let serverCrashed = false;
  server.once("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      serverCrashed = true;
      recordFailure(
        `  FAIL server  api-server exited unexpectedly with code=${code} signal=${signal ?? "<none>"}`,
      );
    }
  });

  try {
    await waitForHealth();
    await runSmoke();
  } finally {
    await stopServer(server);
  }

  console.log("");
  if (failures > 0 || serverCrashed) {
    console.error(
      `Smoke FAILED: ${failures} status / schema mismatch(es)${serverCrashed ? " + server crash" : ""}.`,
    );
    process.exit(1);
  }
  console.log(
    "Smoke OK — all 7 documented operations validated against their generated Zod schemas.",
  );
}

main().catch((err) => {
  console.error("Smoke crashed:", err);
  process.exit(1);
});
