import type { SendMessagePayload } from "@a-driver/protocol";
import type {
  ConnectorContext,
  ConnectorReplyEvent,
  SiteConnector,
} from "../core/plugin-runtime/siteConnector.js";
import { runBbBrowserCli, stripNpmWarn } from "./runBbBrowserCli.js";

type ReplyCallback = (event: ConnectorReplyEvent) => void;
/** 默认用搜索（自由文本）；维基摘要 wikipedia/summary 只适合「条目标题」易误触消歧义页 */
const DEFAULT_ROUTE =
  process.env.BB_BROWSER_SITE_ROUTE?.trim() || "duckduckgo/search";

function extractBbBrowserImages(obj: unknown): string[] {
  const out: string[] = [];
  if (!obj || typeof obj !== "object") return out;
  const o = obj as Record<string, unknown>;
  const add = (s: string) => {
    const t = s.trim();
    if (!t) return;
    if (t.startsWith("data:image/") || /^https:\/\//i.test(t)) out.push(t);
  };
  if (typeof o.imageUrl === "string") add(o.imageUrl);
  if (typeof o.image === "string") add(o.image);
  if (Array.isArray(o.images)) {
    for (const it of o.images) {
      if (typeof it === "string") add(it);
      else if (it && typeof it === "object" && typeof (it as Record<string, unknown>).url === "string") {
        add(String((it as Record<string, unknown>).url));
      }
    }
  }
  return out;
}

function formatBbDisplayText(raw: string, parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    const data = o.data;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (Array.isArray(d.results) && d.results.length > 0) {
        const lines: string[] = [];
        let n = 0;
        for (const item of d.results) {
          if (n >= 10) break;
          if (!item || typeof item !== "object") continue;
          const r = item as Record<string, unknown>;
          const title = typeof r.title === "string" ? r.title.trim() : "";
          const snippet = typeof r.snippet === "string" ? r.snippet.trim() : "";
          if (!title && !snippet) continue;
          n += 1;
          lines.push(
            snippet ? `${n}. ${title}\n${snippet}` : `${n}. ${title}`
          );
        }
        if (lines.length) return lines.join("\n\n");
      }
      if (typeof d.extract === "string" && d.extract.trim()) return d.extract.trim();
      if (typeof d.description === "string" && d.description.trim()) return d.description.trim();
      if (typeof d.text === "string" && d.text.trim()) return d.text.trim();
    }
    if (typeof o.text === "string" && o.text.trim()) return o.text.trim();
    if (typeof o.summary === "string" && o.summary.trim()) return o.summary.trim();
    if (typeof o.content === "string" && o.content.trim()) return o.content.trim();
  }
  return raw;
}

function tryParseBbStdoutJson(stdout: string): Record<string, unknown> | null {
  const t = stdout.trim();
  if (!t || t[0] !== "{") return null;
  try {
    const o = JSON.parse(t) as unknown;
    return o && typeof o === "object" ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function bbBrowserFailureMessage(envelope: Record<string, unknown>): string {
  const err = typeof envelope.error === "string" ? envelope.error : "bb-browser 调用失败";
  const action = typeof envelope.action === "string" ? envelope.action : "";
  const needUpdate =
    action.includes("site update") ||
    err.includes("not found") ||
    err.includes("未找到");
  const hint = needUpdate
    ? " 请先在本机执行一次: npx bb-browser site update（安装社区站点库后再试）。"
    : "";
  return `${err}.${hint}`;
}

/** bb-browser `site` 子命令（DuckDuckGo 等）；与网页 Gemini 的 {@link GeminiGoogleWebConnector} 区分 */
export class BbBrowserConnector implements SiteConnector {
  readonly id = "bb-site";
  readonly version = "0.1.0";
  private readonly listeners = new Set<ReplyCallback>();
  private initialized = false;

  match(input: { connectorId: string }): boolean {
    return input.connectorId === this.id;
  }

  async init(_ctx: ConnectorContext): Promise<void> {
    this.initialized = true;
  }

  async sendMessage(input: SendMessagePayload): Promise<void> {
    if (!this.initialized) {
      throw new Error("connector not initialized");
    }

    const route = input.threadId?.trim() || DEFAULT_ROUTE;
    let textArg = input.text;
    if (input.images?.length) {
      textArg = `${input.text}\n\n[系统：附 ${input.images.length} 张图；bb-browser site 单行参数当前仅传合成文本，多模态需专用站点适配。]`;
    }
    const args = ["-y", "bb-browser", "site", route, textArg, "--json"];
    const result = await runBbBrowserCli(args);

    const raw = result.stdout.trim() || "(empty bb-browser response)";
    const envelope = tryParseBbStdoutJson(result.stdout);
    if (envelope && envelope.success === false) {
      throw new Error(bbBrowserFailureMessage(envelope));
    }

    if (result.code !== 0) {
      const detail =
        (envelope && typeof envelope.error === "string" && envelope.error) ||
        result.stdout.trim() ||
        stripNpmWarn(result.stderr) ||
        "bb-browser command failed";
      throw new Error(detail);
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const displayText = parsed ? formatBbDisplayText(raw, parsed) : raw;
    const images = parsed ? extractBbBrowserImages(parsed) : [];

    const mid = Math.max(1, Math.floor(displayText.length / 2));
    this.emit({ kind: "delta", text: displayText.slice(0, mid) });
    if (mid < displayText.length) {
      this.emit({ kind: "delta", text: displayText.slice(mid) });
    }
    this.emit({
      kind: "completed",
      text: displayText,
      ...(images.length ? { images } : {}),
    });
  }

  subscribeReplies(cb: ReplyCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; reason?: string }> {
    const result = await runBbBrowserCli(["-y", "bb-browser", "--version"]);
    if (result.code !== 0) {
      return {
        healthy: false,
        reason: result.stderr || "bb-browser is unavailable",
      };
    }
    const list = await runBbBrowserCli(["-y", "bb-browser", "site", "list", "--json"]);
    if (list.code !== 0) {
      return { healthy: true };
    }
    try {
      const arr = JSON.parse(list.stdout.trim()) as unknown;
      if (!Array.isArray(arr) || arr.length === 0) {
        return {
          healthy: false,
          reason:
            "未安装 bb-browser 社区站点（site list 为空）。请执行: npx bb-browser site update",
        };
      }
    } catch {
      /* 旧版 bb-browser 可能无 site list --json，跳过 */
    }
    return { healthy: true };
  }

  async teardown(): Promise<void> {
    this.listeners.clear();
    this.initialized = false;
  }

  private emit(event: ConnectorReplyEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

}
