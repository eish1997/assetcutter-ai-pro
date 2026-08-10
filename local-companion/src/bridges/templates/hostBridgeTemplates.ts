import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';

export type BridgeTemplateId =
  | 'python_http_startup'
  | 'lua_heartbeat'
  | 'extendscript_heartbeat'
  | 'project_plugin'
  | 'manual_script_dir'
  | 'maya_command_port';

export type GeneratedBridgeFile = {
  relativePath: string;
  contents: string;
  encoding: 'utf8';
};

export type TemplateInput = {
  hostId: string;
  hostName: string;
  port: number;
  entryFile: string;
  heartbeatFile?: string;
  pythonHealthVersionCode?: string;
};

export type ProbeInput = {
  hostId: string;
  port: number;
  heartbeatPath?: string;
  timeoutMs?: number;
};

export type ProbeResult = {
  ok: boolean;
  message: string;
};

export type UninstallInput = {
  generatedFiles: string[];
};

export type UninstallPlan = {
  generatedFiles: string[];
};

export type BridgeTemplate = {
  id: BridgeTemplateId;
  generateInstallFiles(input: TemplateInput): GeneratedBridgeFile[];
  probe(input: ProbeInput): Promise<ProbeResult>;
  uninstall(input: UninstallInput): UninstallPlan;
};

function assertSafeRelativePath(relativePath: string): string {
  const raw = String(relativePath || '').trim();
  if (!raw) throw new Error('template_path_required');
  if (isAbsolute(raw) || /^[a-z]:[\\/]/i.test(raw)) throw new Error('template_path_must_be_relative');
  const normalized = normalize(raw).replace(/\\/g, '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('template_path_outside_target');
  }
  return normalized;
}

function generatedFile(relativePath: string, contents: string): GeneratedBridgeFile {
  return {
    relativePath: assertSafeRelativePath(relativePath),
    contents,
    encoding: 'utf8',
  };
}

function jsonString(value: string): string {
  return JSON.stringify(value);
}

function jsxString(value: string): string {
  return JSON.stringify(value).replace(/\u2028|\u2029/g, '');
}

function luaSingleQuoted(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function indentPython(code: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return String(code || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n');
}

async function httpHealthProbe(input: ProbeInput): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs || 1800);
  try {
    const res = await fetch(`http://127.0.0.1:${input.port}/health`, { signal: controller.signal });
    if (!res.ok) return { ok: false, message: `${input.hostId} 桥接返回 HTTP ${res.status}，请确认宿主内桥接脚本已启动。` };
    const json = (await res.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    return json?.ok
      ? { ok: true, message: `${input.hostId} 桥接已连接${json.version ? ` (${json.version})` : ''}` }
      : { ok: false, message: `${input.hostId} 桥接响应无效，请重启宿主后重新探测。` };
  } catch (e) {
    return { ok: false, message: `${input.hostId} 桥接暂时无法连接，请先打开宿主并加载桥接脚本后再探测。原因：${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function heartbeatProbe(input: ProbeInput): Promise<ProbeResult> {
  if (!input.heartbeatPath) return { ok: false, message: `${input.hostId} 心跳文件路径未配置，请先安装桥接。` };
  try {
    if (!existsSync(input.heartbeatPath)) return { ok: false, message: `${input.hostId} 尚未产生心跳文件，请打开宿主并运行桥接脚本后再探测。` };
    const st = statSync(input.heartbeatPath);
    const ageMs = Date.now() - st.mtimeMs;
    if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) return { ok: false, message: `${input.hostId} 心跳已过期，请在宿主内重新运行桥接脚本。` };
    const json = JSON.parse(readFileSync(input.heartbeatPath, 'utf8')) as { ok?: boolean; host?: string };
    if (!json?.ok) return { ok: false, message: `${input.hostId} 心跳内容无效，请重新运行桥接脚本。` };
    if (json.host && json.host !== input.hostId) return { ok: false, message: `${input.hostId} 心跳属于 ${json.host}，请确认选择的是当前宿主目录。` };
    return { ok: true, message: `${input.hostId} 心跳已连接` };
  } catch (e) {
    return { ok: false, message: `${input.hostId} 心跳探测失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function commandPortProbe(input: ProbeInput): Promise<ProbeResult> {
  const net = await import('node:net');
  return await new Promise<ProbeResult>((resolveProbe) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: input.port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolveProbe({ ok: false, message: `${input.hostId} 命令端口探测超时，请确认宿主已启动并开启桥接端口。` });
    }, input.timeoutMs || 1800);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end('print("AssetCutter command port probe")\n');
      resolveProbe({ ok: true, message: `${input.hostId} 命令端口已连接` });
    });
    socket.once('error', (e) => {
      clearTimeout(timer);
      resolveProbe({ ok: false, message: `${input.hostId} 命令端口暂时无法连接，请先打开宿主后再探测。原因：${e.message}` });
    });
  });
}

function uninstallGeneratedFiles(input: UninstallInput): UninstallPlan {
  return { generatedFiles: input.generatedFiles.map(assertSafeRelativePath) };
}

export const PYTHON_HTTP_STARTUP_TEMPLATE: BridgeTemplate = {
  id: 'python_http_startup',
  generateInstallFiles(input) {
    const versionBlock = input.pythonHealthVersionCode
      ? `            version = ""
            try:
${indentPython(input.pythonHealthVersionCode, 16)}
            except Exception:
                version = ""
`
      : '            version = ""\n';
    return [
      generatedFile(
        input.entryFile,
        `# AssetCutter ${input.hostName} Bridge
# Auto-generated by AssetCutter local companion.
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST_ID = ${jsonString(input.hostId)}
HOST_NAME = ${jsonString(input.hostName)}
PORT = ${input.port}
_server = None
_thread = None

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return
    def _send(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path.split("?", 1)[0] == "/health":
${versionBlock}            self._send(200, {"ok": True, "host": HOST_ID, "name": HOST_NAME, "version": version})
        else:
            self._send(404, {"ok": False, "error": "not_found"})

def _ensure_server():
    global _server, _thread
    if _server is not None:
        return
    try:
        _server = HTTPServer(("127.0.0.1", PORT), Handler)
        _thread = threading.Thread(target=_server.serve_forever, daemon=True)
        _thread.start()
        print("[AssetCutter %s Bridge] listening on 127.0.0.1:%s" % (HOST_NAME, PORT))
    except OSError as e:
        _server = None
        print("[AssetCutter %s Bridge] failed: %s" % (HOST_NAME, e))

def register():
    _ensure_server()

def unregister():
    # Blender 5.x may call unregister during startup script loading. Keep the
    # startup bridge alive for the current process; the daemon thread exits with
    # Blender.
    return

register()
`,
      ),
    ];
  },
  probe: httpHealthProbe,
  uninstall: uninstallGeneratedFiles,
};

export const LUA_HEARTBEAT_TEMPLATE: BridgeTemplate = {
  id: 'lua_heartbeat',
  generateInstallFiles(input) {
    const heartbeatFile = input.heartbeatFile || `${input.hostId}-heartbeat.json`;
    return [
      generatedFile(
        input.entryFile,
        `-- AssetCutter ${input.hostName} Bridge
local host_id = ${jsonString(input.hostId)}
local host_name = ${jsonString(input.hostName)}
local port = ${input.port}
local heartbeat_file = ${jsonString(heartbeatFile)}
local payload = string.format('{"ok":true,"host":"${luaSingleQuoted(input.hostId)}","name":"${luaSingleQuoted(input.hostName)}","port":%d,"at":"%s"}', port, os.date("!%Y-%m-%dT%H:%M:%SZ"))

local function ensure_parent(path)
  local sep = package.config:sub(1, 1)
  local dir = path:gsub("[/\\\\][^/\\\\]+$", "")
  if dir and #dir > 0 then
    if sep == "\\\\" then
      os.execute('mkdir "' .. dir .. '" >NUL 2>NUL')
    else
      os.execute('mkdir -p "' .. dir:gsub('"', '\\\\"') .. '" >/dev/null 2>/dev/null')
    end
  end
end

local function write_heartbeat()
  ensure_parent(heartbeat_file)
  local f = io.open(heartbeat_file, "w")
  if f then
    f:write(payload)
    f:close()
  end
end

write_heartbeat()
`,
      ),
    ];
  },
  probe: heartbeatProbe,
  uninstall: uninstallGeneratedFiles,
};

export const EXTENDSCRIPT_HEARTBEAT_TEMPLATE: BridgeTemplate = {
  id: 'extendscript_heartbeat',
  generateInstallFiles(input) {
    const heartbeatFile = input.heartbeatFile || `${input.hostId}-heartbeat.json`;
    return [
      generatedFile(
        input.entryFile,
`// AssetCutter ${input.hostName} Bridge
// Auto-generated by AssetCutter local companion.
(function () {
  var heartbeatPath = ${jsxString(heartbeatFile)};
  var payload = {
    ok: true,
    host: ${jsxString(input.hostId)},
    name: ${jsxString(input.hostName)},
    port: ${input.port},
    at: new Date().toUTCString()
  };
  try {
    var heartbeatFile = new File(heartbeatPath);
    if (!heartbeatFile.parent.exists) heartbeatFile.parent.create();
    heartbeatFile.encoding = "UTF-8";
    if (heartbeatFile.open("w")) {
      heartbeatFile.write(JSON.stringify(payload));
      heartbeatFile.close();
    }
    $.writeln("[AssetCutter ${input.hostName} Bridge] heartbeat: " + heartbeatPath);
  } catch (e) {
    $.writeln("[AssetCutter ${input.hostName} Bridge] failed: " + e);
  }
})();
`,
      ),
    ];
  },
  probe: heartbeatProbe,
  uninstall: uninstallGeneratedFiles,
};

export const PROJECT_PLUGIN_TEMPLATE: BridgeTemplate = {
  id: 'project_plugin',
  generateInstallFiles(input) {
    const pluginRoot = assertSafeRelativePath(input.entryFile || 'assetcutter_bridge');
    const pythonBridge = `${pluginRoot}/assetcutter_bridge.py`;
    const manifest = `${pluginRoot}/assetcutter-bridge.json`;
    const readme = `${pluginRoot}/README.md`;
    const pythonFiles = PYTHON_HTTP_STARTUP_TEMPLATE.generateInstallFiles({
      ...input,
      entryFile: pythonBridge,
    });
    return [
      ...pythonFiles,
      generatedFile(
        manifest,
        `${JSON.stringify(
          {
            name: 'AssetCutter Bridge',
            host: input.hostId,
            hostName: input.hostName,
            entry: 'assetcutter_bridge.py',
            port: input.port,
            probe: { kind: 'http', path: '/health' },
          },
          null,
          2,
        )}\n`,
      ),
      generatedFile(
        readme,
        `# AssetCutter ${input.hostName} Bridge

This project plugin was generated by AssetCutter local companion.

Load or execute assetcutter_bridge.py from ${input.hostName}, then probe the connection in AssetCutter.
`,
      ),
    ];
  },
  probe: httpHealthProbe,
  uninstall: uninstallGeneratedFiles,
};

export const MANUAL_SCRIPT_DIR_TEMPLATE: BridgeTemplate = {
  id: 'manual_script_dir',
  generateInstallFiles(input) {
    const heartbeatFile = input.heartbeatFile || `${input.hostId}-heartbeat.json`;
    return [
      generatedFile(
        input.entryFile,
        `# AssetCutter ${input.hostName} Bridge
# Auto-generated by AssetCutter local companion.
import json
import os
from datetime import datetime, timezone

HOST_ID = ${jsonString(input.hostId)}
HOST_NAME = ${jsonString(input.hostName)}
PORT = ${input.port}
HEARTBEAT_FILE = ${jsonString(heartbeatFile)}

def write_heartbeat():
    parent = os.path.dirname(HEARTBEAT_FILE)
    if parent:
        os.makedirs(parent, exist_ok=True)
    payload = {
        "ok": True,
        "host": HOST_ID,
        "name": HOST_NAME,
        "port": PORT,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    with open(HEARTBEAT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f)

write_heartbeat()
print("[AssetCutter %s Bridge] heartbeat written: %s" % (HOST_NAME, HEARTBEAT_FILE))
`,
      ),
    ];
  },
  probe: heartbeatProbe,
  uninstall: uninstallGeneratedFiles,
};

export const MAYA_COMMAND_PORT_TEMPLATE: BridgeTemplate = {
  id: 'maya_command_port',
  generateInstallFiles(input) {
    return [
      generatedFile(
        'assetcutter_maya_cmdport_boot.py',
        `# AssetCutter ${input.hostName} Command Port boot
def ensure(port=${input.port}):
    import maya.cmds as cmds
    for name in ("127.0.0.1:%d" % port, "localhost:%d" % port, ":%d" % port):
        try:
            if not cmds.commandPort(name, q=True):
                cmds.commandPort(name=name, sourceType="python", echoOutput=False)
            return
        except Exception:
            pass
`,
      ),
      generatedFile(
        input.entryFile,
        `# AssetCutter ${input.hostName} userSetup hook
try:
    import assetcutter_maya_cmdport_boot as _ac_maya_cmdport_boot
    _ac_maya_cmdport_boot.ensure(${input.port})
except Exception as e:
    print("[AssetCutter ${input.hostName} Bridge] userSetup error: %s" % e)
`,
      ),
    ];
  },
  probe: commandPortProbe,
  uninstall: uninstallGeneratedFiles,
};

export const HOST_BRIDGE_TEMPLATES: BridgeTemplate[] = [
  PYTHON_HTTP_STARTUP_TEMPLATE,
  LUA_HEARTBEAT_TEMPLATE,
  EXTENDSCRIPT_HEARTBEAT_TEMPLATE,
  PROJECT_PLUGIN_TEMPLATE,
  MANUAL_SCRIPT_DIR_TEMPLATE,
  MAYA_COMMAND_PORT_TEMPLATE,
];

export function getHostBridgeTemplate(id: BridgeTemplateId): BridgeTemplate | null {
  return HOST_BRIDGE_TEMPLATES.find((template) => template.id === id) || null;
}
