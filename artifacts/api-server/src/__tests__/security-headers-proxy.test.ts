// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { spawn, type ChildProcess, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

vi.mock("../../../../lib/api-spec/openapi.yaml", () => ({ default: "" }));
vi.mock("../../../../lib/api-spec/asyncapi.yaml", () => ({ default: "" }));

// Task #296. Bring up the API server behind the nginx config that
// README-selfhost.md actually documents and assert each Task #256
// security header survives the proxy hop unchanged. The location block
// is parsed out of README-selfhost.md at test time, so a future README
// edit that drops or rewrites a header surfaces here.

const README_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../README-selfhost.md",
);

const EXPECTED_CSP =
  "default-src 'self';" +
  "script-src 'self';" +
  "style-src 'self' 'unsafe-inline';" +
  "connect-src 'self' wss:;" +
  "worker-src 'self' blob:;" +
  "media-src 'self' blob: mediastream:;" +
  "img-src 'self' data: blob:;" +
  "font-src 'self';" +
  "object-src 'none';" +
  "frame-src 'none';" +
  "base-uri 'none';" +
  "form-action 'self';" +
  "report-to default;" +
  "frame-ancestors 'self';" +
  "script-src-attr 'none';" +
  "upgrade-insecure-requests";

const EXPECTED_REPORTING_ENDPOINTS = `default="/api/csp-report"`;

const EXPECTED_PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "display-capture=(self)",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "fullscreen=(self)",
  "autoplay=(self)",
  "web-share=(self)",
  "accelerometer=()",
  "ambient-light-sensor=()",
  "battery=()",
  "bluetooth=()",
  "browsing-topics=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "interest-cohort=()",
  "magnetometer=()",
  "midi=()",
  "otp-credentials=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-create=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "speaker-selection=()",
  "storage-access=()",
  "sync-xhr=()",
  "usb=()",
  "window-management=()",
  "xr-spatial-tracking=()",
].join(", ");

const EXPECTED_HEADERS: Record<string, string> = {
  "content-security-policy": EXPECTED_CSP,
  "permissions-policy": EXPECTED_PERMISSIONS_POLICY,
  "reporting-endpoints": EXPECTED_REPORTING_ENDPOINTS,
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-site",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
};

interface ReadmeNginxParts {
  mapBlock: string;
  locationBlock: string;
}

// Pull the ```nginx fenced code block out of README-selfhost.md and
// extract the `map $http_upgrade ...` directive plus the `location /`
// block from inside the TLS server. We rebuild a minimal HTTP server
// around them at test time — TLS termination and the :80 redirect do
// not affect response-header passthrough — but the directives the
// README tells operators to use are exercised verbatim.
function parseReadmeNginx(): ReadmeNginxParts {
  const md = readFileSync(README_PATH, "utf8");
  const fence = md.match(/```nginx\n([\s\S]*?)\n```/);
  if (!fence) {
    throw new Error(
      `Could not find a \`\`\`nginx code block in ${README_PATH}. ` +
        `Task #296's proxy test parses the documented config out of the README; ` +
        `restore the nginx example or update this test.`,
    );
  }
  const nginxConf = fence[1];

  const mapMatch = nginxConf.match(/map\s+\$http_upgrade[^{]*\{[^}]*\}/);
  if (!mapMatch) {
    throw new Error(
      `Could not find the \`map $http_upgrade $connection_upgrade\` directive ` +
        `inside the README nginx block. Without it, websocket upgrade headers ` +
        `won't be forwarded — restore the directive or update this test.`,
    );
  }

  // Find the `location /` block by tracking braces from its opening `{`.
  const locStart = nginxConf.search(/location\s+\/\s*\{/);
  if (locStart < 0) {
    throw new Error(
      `Could not find a \`location /\` block in the README nginx example.`,
    );
  }
  const openBrace = nginxConf.indexOf("{", locStart);
  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < nginxConf.length; i++) {
    const ch = nginxConf[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`Unbalanced braces in README \`location /\` block.`);
  }
  const locationBlock = nginxConf.slice(locStart, end + 1);

  return { mapBlock: mapMatch[0], locationBlock };
}

function findNginxBinary(): string {
  const r = spawnSync("which", ["nginx"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  throw new Error(
    "nginx binary not found on PATH. Task #296's reverse-proxy test " +
      "requires nginx in the test environment. Install it (e.g. " +
      "`nix-env -iA nixpkgs.nginx`, `apt-get install -y nginx`, or your " +
      "platform equivalent) before running the API server test suite.",
  );
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      void res.text().catch(() => undefined);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastErr)}`);
}

// Wrap the README-extracted directives in a minimal HTTP server so the
// test stack can run without TLS. The `proxy_pass` target inside the
// extracted location block is rewritten to point at our random upstream
// port; every other directive (proxy_set_header, proxy_http_version,
// the Upgrade/Connection plumbing) is taken verbatim from the README.
function buildNginxConf(opts: {
  listenPort: number;
  upstreamPort: number;
  prefix: string;
  parts: ReadmeNginxParts;
}): string {
  const { listenPort, upstreamPort, prefix, parts } = opts;
  const rewrittenLocation = parts.locationBlock.replace(
    /proxy_pass\s+https?:\/\/[^;]+;/,
    `proxy_pass http://127.0.0.1:${upstreamPort};`,
  );
  return `
worker_processes 1;
daemon off;
pid ${prefix}/nginx.pid;
error_log ${prefix}/error.log warn;
events { worker_connections 64; }
http {
    access_log ${prefix}/access.log;
    client_body_temp_path ${prefix}/client_body;
    proxy_temp_path ${prefix}/proxy;
    fastcgi_temp_path ${prefix}/fastcgi;
    uwsgi_temp_path ${prefix}/uwsgi;
    scgi_temp_path ${prefix}/scgi;

    ${parts.mapBlock}

    server {
        listen 127.0.0.1:${listenPort};
        server_name void.test.local;

        ${rewrittenLocation}
    }
}
`.trimStart();
}

interface Stack {
  upstream: HttpServer;
  nginx: ChildProcess;
  proxyBaseUrl: string;
  cleanup: () => Promise<void>;
}

async function startStack(parts: ReadmeNginxParts): Promise<Stack> {
  delete process.env["SERVE_STATIC"];
  vi.resetModules();
  const mod = await import("../app");
  const app = mod.default;

  const upstreamPort = await pickFreePort();
  const listenPort = await pickFreePort();

  const upstream = createServer(app);
  await new Promise<void>((r) => upstream.listen(upstreamPort, "127.0.0.1", r));

  const prefix = mkdtempSync(path.join(tmpdir(), "void-nginx-"));
  mkdirSync(path.join(prefix, "client_body"), { recursive: true });
  const confPath = path.join(prefix, "nginx.conf");
  writeFileSync(
    confPath,
    buildNginxConf({ listenPort, upstreamPort, prefix, parts }),
  );

  const nginxBin = findNginxBinary();
  const nginx = spawn(
    nginxBin,
    ["-c", confPath, "-p", prefix, "-e", path.join(prefix, "error.log")],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const proxyBaseUrl = `http://127.0.0.1:${listenPort}`;
  try {
    await waitForHttp(`${proxyBaseUrl}/api/health`, 5000);
  } catch (e) {
    nginx.kill("SIGTERM");
    await new Promise<void>((r) => upstream.close(() => r()));
    rmSync(prefix, { recursive: true, force: true });
    throw e;
  }

  return {
    upstream,
    nginx,
    proxyBaseUrl,
    cleanup: async () => {
      nginx.kill("SIGTERM");
      await new Promise<void>((r) => setTimeout(r, 100));
      if (!nginx.killed) nginx.kill("SIGKILL");
      await new Promise<void>((r) => upstream.close(() => r()));
      rmSync(prefix, { recursive: true, force: true });
    },
  };
}

function lowerCaseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function assertHeadersSurvived(
  proxied: Record<string, string>,
  context: string,
): void {
  const lost: string[] = [];
  const wrong: string[] = [];
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    const actual = proxied[name];
    if (actual === undefined) {
      lost.push(name);
    } else if (actual !== expected) {
      wrong.push(`${name}: expected "${expected}", got "${actual}"`);
    }
  }
  if (lost.length > 0 || wrong.length > 0) {
    const parts: string[] = [
      `Reverse proxy stripped or rewrote security headers on ${context}.`,
      `The nginx config in README-selfhost.md must preserve every header the API server emits.`,
    ];
    if (lost.length > 0) {
      parts.push(`Headers dropped by the proxy: ${lost.join(", ")}`);
    }
    if (wrong.length > 0) {
      parts.push(`Headers rewritten by the proxy:\n  - ${wrong.join("\n  - ")}`);
    }
    throw new Error(parts.join("\n"));
  }
}

describe("HTTP security headers survive the README nginx reverse proxy", () => {
  let stack: Stack;
  let parts: ReadmeNginxParts;

  beforeAll(async () => {
    parts = parseReadmeNginx();
    stack = await startStack(parts);
  }, 15000);

  afterAll(async () => {
    await stack?.cleanup();
  });

  it("preserves every Task #256 header on a normal 200 response", async () => {
    const res = await fetch(`${stack.proxyBaseUrl}/api/health`);
    expect(res.status).toBe(200);
    assertHeadersSurvived(lowerCaseHeaders(res), "GET /api/health (200)");
  });

  it("preserves every Task #256 header on a 404 response", async () => {
    const res = await fetch(`${stack.proxyBaseUrl}/api/this-route-does-not-exist`);
    expect(res.status).toBe(404);
    assertHeadersSurvived(
      lowerCaseHeaders(res),
      "GET /api/this-route-does-not-exist (404)",
    );
  });

  it("preserves every Task #256 header on an OPTIONS preflight", async () => {
    const res = await fetch(`${stack.proxyBaseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.test",
        "Access-Control-Request-Method": "GET",
      },
    });
    assertHeadersSurvived(
      lowerCaseHeaders(res),
      "OPTIONS /api/health (preflight)",
    );
  });
});
