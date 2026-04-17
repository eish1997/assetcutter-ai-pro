import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type BbBrowserCliResult = {
  stdout: string;
  stderr: string;
  code: number;
};

export type RunBbBrowserCliOptions = {
  /** 与 bb-browser CLI `--tab` 一致，避免 eval/press 落到错误的当前标签页 */
  tabId?: string | number;
};

const require = createRequire(import.meta.url);

/** 直接跑 bb-browser 的 cli.js，避免 Windows 下 `npx` + `shell:true` 把 eval 脚本里的引号、`)` 截断导致 Daemon JSON 解析失败 */
function resolveBbBrowserCliJs(): string {
  try {
    const pkg = require.resolve("bb-browser/package.json");
    return join(dirname(pkg), "dist", "cli.js");
  } catch {
    return "";
  }
}

/**
 * 约定：调用方统一传 `['-y','bb-browser', <子命令>...]`（与 npx 一致），本模块在能解析到包时改为 `node cli.js <子命令>...`。
 */
function normalizeSubcommandArgs(args: string[]): string[] {
  if (args.length >= 2 && args[0] === "-y" && args[1] === "bb-browser") {
    return args.slice(2);
  }
  return args;
}

const BB_NPX_FALLBACK = "npx";

export function runBbBrowserCli(
  args: string[],
  options: RunBbBrowserCliOptions = {}
): Promise<BbBrowserCliResult> {
  const sub = normalizeSubcommandArgs(args);
  const cliJs = resolveBbBrowserCliJs();
  const useDirectNode = cliJs !== "";

  const exe = useDirectNode ? process.execPath : BB_NPX_FALLBACK;
  let spawnArgs = useDirectNode ? [cliJs, ...sub] : ["-y", "bb-browser", ...sub];
  if (options.tabId != null && String(options.tabId).trim() !== "") {
    spawnArgs = [...spawnArgs, "--tab", String(options.tabId).trim()];
  }

  return new Promise((resolve) => {
    const child = spawn(exe, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      /** 直连 node + cli.js 时禁止 shell，保证 eval 长脚本整段作为一个 argv 传递 */
      shell: useDirectNode ? false : process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.on("error", (error) => {
      resolve({ stdout, stderr: String(error), code: -1 });
    });
  });
}

export function stripNpmWarn(stderr: string): string {
  return stderr.replace(/^npm warn[^\n]*\n?/gm, "").trim();
}
