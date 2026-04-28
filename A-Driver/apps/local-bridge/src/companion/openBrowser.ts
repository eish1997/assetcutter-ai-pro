import { spawn } from "node:child_process";

/** 打开本机控制台页（Windows / macOS / Linux 尽力而为） */
export function openDefaultBrowser(url: string): void {
  const u = url.trim();
  if (!u) return;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", u], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    if (process.platform === "darwin") {
      spawn("open", [u], { detached: true, stdio: "ignore" }).unref();
      return;
    }
    spawn("xdg-open", [u], { detached: true, stdio: "ignore" }).unref();
  } catch (e) {
    console.warn("[companion] open browser failed:", e);
  }
}
