import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANION_SEMVER } from "./pluginHost.js";

/** 仅绑定回环；P0 CORS 为 `*` 便于 HTTPS 站点探测，生产收紧见规范 §8 */
const defaultCors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dashboardPath = path.join(moduleDir, "static", "dashboard.html");

let dashboardCache: string | null = null;

function loadDashboardHtml(): string {
  if (dashboardCache != null) return dashboardCache;
  if (existsSync(dashboardPath)) {
    dashboardCache = readFileSync(dashboardPath, "utf8");
    return dashboardCache;
  }
  dashboardCache = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>本地伴侣</title></head>
<body style="background:#0a0a0c;color:#e4e4e7;font-family:system-ui;padding:2rem">
<p>未找到 dashboard 模板文件。</p></body></html>`;
  return dashboardCache;
}

export type CompanionLocalHttpOpts = {
  host?: string;
  port: number;
  getCapabilities: () => unknown;
  getRuntimeStatus: () => unknown;
};

export function startCompanionLocalHttpServer(opts: CompanionLocalHttpOpts): {
  close: () => Promise<void>;
} {
  const host = opts.host ?? "127.0.0.1";
  const server = http.createServer((req, res) => {
    const raw = req.url?.split("?")[0] || "/";

    if (req.method === "OPTIONS") {
      res.writeHead(204, defaultCors);
      res.end();
      return;
    }

    if (req.method === "GET" && (raw === "/" || raw === "/index.html")) {
      const html = loadDashboardHtml();
      res.writeHead(200, {
        ...defaultCors,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    if (req.method === "GET" && (raw === "/v1/capabilities" || raw === "/v1/capabilities/")) {
      const body = JSON.stringify(opts.getCapabilities());
      res.writeHead(200, {
        ...defaultCors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && (raw === "/v1/runtime-status" || raw === "/v1/runtime-status/")) {
      const body = JSON.stringify(opts.getRuntimeStatus());
      res.writeHead(200, {
        ...defaultCors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    if (req.method === "GET" && (raw === "/v1/health" || raw === "/health")) {
      const body = JSON.stringify({
        ok: true,
        service: "companion",
        relay: "embedded-local-bridge",
        companionVersion: COMPANION_SEMVER,
      });
      res.writeHead(200, {
        ...defaultCors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }

    res.writeHead(404, {
      ...defaultCors,
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify({ error: "not_found", path: raw }));
  });

  server.listen(opts.port, host, () => {
    console.log(`[companion-http] 控制台 http://${host}:${opts.port}/`);
    console.log(`[companion-http] capabilities http://${host}:${opts.port}/v1/capabilities`);
  });

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err != null ? reject(err) : resolve()));
      }),
  };
}
